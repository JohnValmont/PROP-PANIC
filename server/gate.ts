/**
 * The front door: how many people this server lets play at once, and a fair line for everyone else.
 *
 * A free hosting plan has a sliver of a CPU and a monthly bandwidth allowance, so the server runs a fixed number of
 * TABLES (rooms) and SEATS (human players across all tables). When they are taken, a newcomer is not turned away:
 * their socket stays open, they get a place in line and a live position, and when a seat frees the person at the
 * front is handed a short-lived PASS that reserves it for them. Nobody already playing is ever removed to make room,
 * and a player reconnecting to a seat they hold always gets back in.
 *
 * On top of the fixed limits sits a LOAD BRAKE: if the game loop starts running late (the CPU quota is being hit),
 * new players wait in line until it recovers, whatever the seat count says.
 *
 * Settings (environment): PP_SEATS (default 24), PP_TABLES (default 4), PP_LINE_MAX (default 400),
 * PP_BRAKE_MS (how late, smoothed, the game loop may run before the brake engages; default 20, 0 turns the brake off).
 */
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { MAP_NAMES } from '../shared/map';
import type { Room } from './room';

const num = (name: string, fallback: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback; };

export const GATE = {
  seats: num('PP_SEATS', 24),
  tables: num('PP_TABLES', 4),
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
  /** Did the pass need a table of its own (a new private room, or quick play with no public table to join)? */
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
  private reservedTables(): number { let n = 0; for (const p of this.passes.values()) if (p.newTable) n++; return n; }
  private liveTables(): number { let n = 0; for (const r of this.rooms.values()) if (!r.closed) n++; return n; }

  /** A public table quick play can drop someone into right now. */
  publicTable(): Room | null {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (!r.isPublic || r.closed || r.humanSlots >= GATE.publicSeats) continue;
      if (!best || r.humanSlots > best.humanSlots) best = r; // fill the busiest table first
    }
    return best;
  }

  /** Does this intent need a table that is not running yet? */
  private needsTable(intent: Intent): boolean {
    if (intent.mode === 'create') return true;
    if (intent.mode === 'quick') return !this.publicTable();
    return false;
  }

  /** Is there room for one more player with this intent, counting seats that passes are holding? (The line itself is checked by the caller.) */
  private fits(intent: Intent): boolean {
    if (this.hot) return false;
    if (this.used() + this.reserved() >= GATE.seats) return false;
    if (this.needsTable(intent) && this.liveTables() + this.reservedTables() >= GATE.tables) return false;
    return true;
  }

  /** Called for a fresh hello. 'ok': let them in now. 'line': they have been put in line. 'busy': the line itself is full. */
  admit(ws: WebSocket, intent: Intent, passKey: unknown): 'ok' | 'line' | 'busy' {
    // a pass is a seat the line already reserved for this person
    if (typeof passKey === 'string' && passKey.length <= 64) {
      const p = this.passes.get(passKey);
      if (p && p.until > Date.now()) { this.passes.delete(passKey); this.admittedSince++; return 'ok'; }
    }
    // nobody jumps the line: walk-ins only get a seat when nobody is waiting for one
    if (!this.line.length && this.fits(intent)) { this.admittedSince++; return 'ok'; }
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
    // hand out passes, front of the line first; someone whose intent cannot fit yet (a new table) does not block
    // the people behind them who only need a seat, but only a few places are looked past
    let looked = 0;
    for (const w of this.line) {
      if (w.pass) continue;
      if (++looked > 6) break;
      if (!this.fits(w.intent)) continue;
      w.pass = randomBytes(18).toString('base64url');
      w.passUntil = t + GATE.passMs;
      w.newTable = this.needsTable(w.intent);
      this.passes.set(w.pass, { key: w.pass, until: w.passUntil, newTable: w.newTable, ws: w.ws });
      this.send(w.ws, { t: 'ready', pass: w.pass, ms: GATE.passMs });
    }
    for (const w of this.line) this.tell(w, false);
  }

  /** Seconds until a seat frees for someone at this position, from how often seats freed recently; 0 = no idea yet. */
  private eta(pos: number): number {
    if (this.releases.length < 3) return 0;
    const span = Math.max(60_000, Date.now() - this.releases[0]);
    const perSec = this.releases.length / (span / 1000);
    return Math.round(pos / perSec);
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
      tables: GATE.tables, locked: GATE.lockedShown, hot: this.hot, eta: this.eta(Math.max(1, this.line.length + 1)),
      list: tables.slice(0, GATE.tables + 4),
    });
    this.statusAt = t;
    return this.statusCache;
  }
}
