/**
 * The front door: how many people this server lets play at once, and a fair line for everyone else.
 *
 * A free hosting plan has a sliver of a CPU and a monthly bandwidth allowance, so the server has a fixed number of
 * SEATS (human players across every room). Seats are the only thing people wait in line for: while one is free,
 * Play gets you in. When all are taken, a newcomer is not turned away: their socket stays open, they get a place in
 * line with a live position and a waiting-time estimate, and when a seat frees the person at the front is handed a
 * short-lived PASS that reserves it for them. Nobody already playing is ever removed to make room, and a player
 * reconnecting to a seat they hold always gets back in.
 *
 * Public tables (quick play) need no limit of their own: quick play fills the busiest table first and only opens a
 * new one when every public table has 8 people, so 24 seats never need more than 3. Private rooms are different (one
 * person can open one and fill it with bots, which cost CPU), so they have a few PRIVATE TABLES of their own. When
 * those are in use, Private room says so straight away rather than putting someone in line with seats still free.
 *
 * On top of the fixed limits sits a LOAD BRAKE: if the game loop starts running late (the CPU quota is being hit),
 * new players wait in line until it recovers, whatever the seat count says.
 *
 * Settings (environment): PP_SEATS (default 24), PP_PRIVATE_TABLES (default 3), PP_LINE_MAX (default 400),
 * PP_BRAKE_MS (how late, smoothed, the game loop may run before the brake engages; default 20, 0 turns the brake off).
 */
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CFG } from '../shared/constants';
import { MAP_NAMES } from '../shared/map';
import type { Room } from './room';

const num = (name: string, fallback: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback; };

export const GATE = {
  seats: num('PP_SEATS', 24),
  privateTables: num('PP_PRIVATE_TABLES', 3),
  lineMax: num('PP_LINE_MAX', 400),
  /** How long a pass holds a seat for the person it was given to. */
  passMs: num('PP_PASS_MS', 30_000),
  /** Humans in one public table (quick play); private tables take up to CFG.MAX_PLAYERS. */
  publicSeats: 8,
  /** Slots the menu shows as locked: tables that will open once the game leaves alpha. */
  lockedShown: 2,
  brakeMs: process.env.PP_BRAKE_MS === '0' ? 0 : num('PP_BRAKE_MS', 20),
};

/** What a player asked for when they pressed a button on the menu. */
export interface Intent { mode: 'quick' | 'create' | 'join'; code: string; }

export interface Waiter {
  ws: WebSocket;
  intent: Intent;
  since: number;
  /** Set once this person has been handed a pass. */
  pass: string;
  passUntil: number;
  /** Did the pass need a private table of its own? */
  newTable: boolean;
  lastPos: number;
}

interface Pass { key: string; until: number; newTable: boolean; ws: WebSocket | null; }

const PHASES: Record<string, string> = { lobby: 'In the lobby', hiding: 'Hiding', hunt: 'Hunting', end: 'Round over' };

export class Gate {
  readonly line: Waiter[] = [];
  private passes = new Map<string, Pass>();
  /** Times at which seats were given up, for a waiting-time estimate (last 20 minutes). */
  private releases: number[] = [];
  private lastUsed = 0;
  private admittedSince = 0;
  /** Game-loop lateness in ms, smoothed. */
  lag = 0;
  hot = false;
  private statusCache = '';
  private statusAt = 0;

  constructor(private rooms: Map<string, Room>) {}

  /** Humans holding a seat (a dropped player keeps theirs through the reconnect grace period). */
  used(): number { let n = 0; for (const r of this.rooms.values()) if (!r.closed) n += r.humanSlots; return n; }
  private reserved(): number { return this.passes.size; }
  private reservedPrivate(): number { let n = 0; for (const p of this.passes.values()) if (p.newTable) n++; return n; }
  private livePrivate(): number { let n = 0; for (const r of this.rooms.values()) if (!r.closed && !r.isPublic) n++; return n; }
  /** Tables quick play can need for every seat to be usable. */
  get publicTables(): number { return Math.ceil(GATE.seats / GATE.publicSeats); }
  private seatFree(): boolean { return !this.hot && this.used() + this.reserved() < GATE.seats; }
  private privateFree(): boolean { return this.livePrivate() + this.reservedPrivate() < GATE.privateTables; }

  /** A public table quick play can drop someone into right now. */
  publicTable(): Room | null {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.closed || r.humanSlots >= GATE.publicSeats) continue;
      if (!best || r.humanSlots > best.humanSlots) best = r; // fill the busiest table first
    }
    return best;
  }

  /** Is there room for one more player with this intent, counting seats that passes are holding? (The line itself is checked by the caller.) */
  private fits(intent: Intent): boolean {
    return this.seatFree() && (intent.mode !== 'create' || this.privateFree());
  }

  /**
   * Called for a fresh hello. 'ok': let them in now. 'line': they have been put in line (every seat is taken).
   * 'noTable': a seat is free but every private table is in use (tell them; Play still works). 'busy': the line is full.
   */
  admit(ws: WebSocket, intent: Intent, passKey: unknown): 'ok' | 'line' | 'noTable' | 'busy' {
    // a pass is a seat the line already reserved for this person
    if (typeof passKey === 'string' && passKey.length <= 64) {
      const p = this.passes.get(passKey);
      if (p && p.until > Date.now()) { this.passes.delete(passKey); this.admittedSince++; return 'ok'; }
    }
    // nobody jumps the line: walk-ins only get a seat when nobody is waiting for one
    if (!this.line.length && this.fits(intent)) { this.admittedSince++; return 'ok'; }
    // seats to spare and only the private tables taken: waiting in line would be waiting for nothing
    if (intent.mode === 'create' && this.seatFree() && !this.privateFree()) return 'noTable';
    if (this.line.length >= GATE.lineMax) return 'busy';
    const w: Waiter = { ws, intent, since: Date.now(), pass: '', passUntil: 0, newTable: false, lastPos: 0 };
    this.line.push(w);
    this.tell(w, true);
    return 'line';
  }

  /**
   * The person left the line. `release`: they said so (Leave), so a pass they hold goes straight back to the pool.
   * A socket that merely closed keeps its pass until it runs out: the browser closes the line connection once its
   * game connection is in, and that order must not cost them the seat.
   */
  drop(ws: WebSocket, release = false) {
    const i = this.line.findIndex((w) => w.ws === ws);
    if (i < 0) return;
    const w = this.line[i];
    this.line.splice(i, 1);
    if (w.pass && release) this.passes.delete(w.pass);
  }

  isWaiting(ws: WebSocket): boolean { return this.line.some((w) => w.ws === ws); }

  /** Called with how late the game loop's last tick was. */
  sample(lateMs: number) {
    this.lag += (Math.max(0, lateMs) - this.lag) * 0.1;
    // hysteresis: brake at a sustained 20 ms late (ticks running at about 70% speed), release at 40% of that
    if (!GATE.brakeMs) { this.hot = false; return; }
    if (!this.hot && this.lag > GATE.brakeMs) this.hot = true;
    else if (this.hot && this.lag < GATE.brakeMs * 0.4) this.hot = false;
  }

  /** Once a second: expire passes, hand out new ones, and tell everyone in line where they stand. */
  pump() {
    const t = Date.now();
    // seats given up since last time = before + let in - now
    const used = this.used();
    const freed = this.lastUsed + this.admittedSince - used;
    for (let i = 0; i < freed; i++) this.releases.push(t);
    this.lastUsed = used; this.admittedSince = 0;
    while (this.releases.length && t - this.releases[0] > 20 * 60_000) this.releases.shift();

    for (const [k, p] of this.passes) if (p.until <= t) this.passes.delete(k);
    // waiters who let their pass run out lose their place (they had a whole pass window to take it)
    for (let i = this.line.length - 1; i >= 0; i--) {
      const w = this.line[i];
      if (w.ws.readyState !== 1) { this.drop(w.ws); continue; }
      if (w.pass && w.passUntil <= t) {
        this.line.splice(i, 1);
        this.send(w.ws, { t: 'missed' });
        try { w.ws.close(1000, 'missed'); } catch { /* ignore */ }
      }
    }
    // hand out passes, front of the line first; someone waiting for a private table does not block the people
    // behind them who only need a seat, but only a few places are looked past
    let looked = 0;
    for (const w of this.line) {
      if (w.pass) continue;
      if (++looked > 6) break;
      if (!this.fits(w.intent)) continue;
      w.pass = randomBytes(18).toString('base64url');
      w.passUntil = t + GATE.passMs;
      w.newTable = w.intent.mode === 'create';
      this.passes.set(w.pass, { key: w.pass, until: w.passUntil, newTable: w.newTable, ws: w.ws });
      this.send(w.ws, { t: 'ready', pass: w.pass, ms: GATE.passMs });
    }
    for (const w of this.line) this.tell(w, false);
  }

  /**
   * Seconds until a seat frees for someone at this position: always a number, never "no idea".
   * With some history (3+ seats freed in the last 20 minutes) it is the measured rate. Before that, a model of the
   * game: people tend to leave when a round ends, so it is the time until the soonest round end at any table, plus one
   * more gap between round ends (a round's length shared across the tables running) for every place ahead.
   */
  eta(pos: number): number {
    let sec: number;
    if (this.releases.length >= 3) {
      const span = Math.max(60_000, Date.now() - this.releases[0]);
      sec = pos / (this.releases.length / (span / 1000));
    } else {
      const roundS = (CFG.HIDE_MS + CFG.HUNT_MS + CFG.END_MS) / 1000;
      const live = [...this.rooms.values()].filter((r) => !r.closed);
      sec = this.nextRoundEnd(live, roundS) + (pos - 1) * (roundS / Math.max(1, live.length));
    }
    return Math.max(20, Math.round(sec));
  }

  /** Seconds until the next round ends at any table (a table still in its lobby counts as half a round away). */
  private nextRoundEnd(live: Room[], roundS: number): number {
    const t = performance.now();
    let best = Infinity;
    for (const r of live) {
      const left = Math.max(0, (r.phaseEnds - t) / 1000);
      const s = r.phase === 'hiding' ? left + CFG.HUNT_MS / 1000 : r.phase === 'hunt' || r.phase === 'end' ? left : roundS / 2;
      best = Math.min(best, s);
    }
    return Number.isFinite(best) ? best : 60;
  }

  private tell(w: Waiter, force: boolean) {
    if (w.pass) return;
    const pos = this.line.filter((q) => !q.pass).indexOf(w) + 1;
    if (!force && pos === w.lastPos) return; // only when something changed: a line of 200 costs nothing while it stands still
    w.lastPos = pos;
    this.send(w.ws, { t: 'line', pos, size: this.line.length, eta: this.eta(pos), used: this.used(), seats: GATE.seats, hot: this.hot ? 1 : 0 });
  }

  private send(ws: WebSocket, m: object) { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch { /* closing */ } }

  /**
   * What the menu's table board shows. Public tables carry their code (they are open to anyone anyway);
   * private tables never do. Cached for a second, so a crowd of open menus costs one build per second at most.
   */
  status(): string {
    const t = Date.now();
    if (this.statusCache && t - this.statusAt < 1000) return this.statusCache;
    const tables = [...this.rooms.values()].filter((r) => !r.closed).map((r) => ({
      code: r.isPublic ? r.code : '',
      pub: r.isPublic,
      map: MAP_NAMES[r.mapId] ?? '',
      phase: PHASES[r.phase] ?? '',
      humans: r.humanSlots,
      bots: [...r.players.values()].filter((p) => p.bot).length,
      cap: r.isPublic ? GATE.publicSeats : 12,
    })).sort((a, b) => Number(b.pub) - Number(a.pub) || b.humans - a.humans);
    const used = this.used();
    this.statusCache = JSON.stringify({
      alpha: true, seats: GATE.seats, used, reserved: this.reserved(), line: this.line.length,
      // the wait the next person to press Play would face
      eta: this.eta(this.line.length + 1),
      publicTables: this.publicTables, privateTables: GATE.privateTables, privateUsed: this.livePrivate(),
      locked: GATE.lockedShown, hot: this.hot,
      list: tables.filter((x) => x.pub).slice(0, this.publicTables + 2),
    });
    this.statusAt = t;
    return this.statusCache;
  }
}
