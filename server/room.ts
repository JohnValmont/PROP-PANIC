/**
 * One game room: authoritative simulation of lobby -> hiding -> hunt -> end, forever.
 * Clients only ever send intent (inputs, "fire", "use ability"); every outcome is decided here.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { WebSocket } from 'ws';
import { CFG, CHAOS_WEIGHTS, COINS, F, NEAR_RANGE, QUICK_CHAT, ROUNDS_DEFAULT, ROUND_CHOICES, SCORE, TAUNTS, TAUNT_RANGE, type Phase, type Team } from '../shared/constants';
import { buildMap, BOUNDS, type GameMap } from '../shared/map';
import { World, aimDir, newBody, rayOBB, type Body, type Cmd } from '../shared/physics';
import { PROPS, PROP_INDEX, STARTER_PROPS, propBody, type PropDef } from '../shared/props';
import type { Award, Results, RosterEntry } from '../shared/protocol';
import { Bot, NavGrid, botName } from './bots';

const now = () => performance.now();
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pickOf = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const TAU = Math.PI * 2;
/** Any finite angle, folded into (-pi, pi]. */
const wrapAngle = (a: number) => a - Math.round(a / TAU) * TAU;
function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const DUCK = PROP_INDEX['duck'];
const PUBLIC_FILL = 5;
const DC_GRACE_MS = 30_000;
const AFK_MS = 240_000;

function newStats() {
  return { shots: 0, hits: 0, innocents: 0, kills: 0, bonks: 0, escapes: 0, taunts: 0, bamboozles: 0, near: 0, quacks: 0, diedAt: 0, pts: 0, haunts: 0, spooks: 0 };
}

export interface Decoy { id: number; type: number; x: number; y: number; z: number; yaw: number; owner: number; nextHop: number; hopUntil: number; }
export interface Pulse { x: number; z: number; t0: number; by: number; seen: Set<number>; }

export class Player {
  team: Team = 'prop';
  alive = true;
  body: Body;
  yaw = 0; pitch = 0; facing = 0;
  disguise = STARTER_PROPS[0];
  hp = CFG.PROP_HP;
  focus = CFG.FOCUS_MAX;
  quackUntil = 0; panicUntil = 0; ghostUntil = 0; revealUntil = 0; boostUntil = 0;
  lastMovedAt = 0; nextFireAt = 0; lastShotAt = 0; nextTransformAt = 0; nextChatAt = 0;
  cd = { decoy: 0, ghost: 0, taunt: 0, pulse: 0, shock: 0, haunt: 0 };
  cdDirty = true;
  bank = 0.3; bankT = now(); ack = 0;
  score = 0; hunterTurns = 0;
  stats = newStats();
  look = 0; bonkUntil = 0; nextBonkAt = 0; escapeAt = 0;
  connected = true; dcAt = 0; host = false;
  bot: Bot | null = null;
  hist: number[][] = [];
  msgN = 0; msgT = 0;
  stuckN = 0;
  /** Round-trip time in ms, measured by the socket heartbeat. */
  rtt = 0;
  lastInputAt = now();
  /** Interest management: which props this hunter can currently see, and when each pair is next re-tested. */
  sight = new Map<number, { until: number; next: number }>();
  /** Decoys this hunter has laid eyes on this round. Until then the hunter's client is told nothing about them. */
  knownDecoys = new Set<number>();
  playing = false; // took part in the current round

  constructor(public id: number, public name: string, public token: string, public ws: WebSocket | null) {
    const d = propBody(PROPS[this.disguise]);
    this.body = newBody(d.hw, d.h);
  }
  get human() { return !this.bot; }
}

export class Room {
  players = new Map<number, Player>();
  phase: Phase = 'lobby';
  phaseEnds = 0;
  round = 0;
  seed = 1;
  map: GameMap;
  world: World;
  chaos = 0;
  event: { kind: string; until: number } | null = null;
  decoys: Decoy[] = [];
  pulses: Pulse[] = [];
  /** Innocent objects a ghost has just rattled: decor id -> who did it and until when shooting it counts as being spooked. */
  haunted = new Map<number, { by: number; until: number }>();
  botsWanted = 0;
  createdAt = now();
  emptySince = 0;
  closed = false;
  private navGrid: NavGrid | null = null;
  private nextId = 1;
  private lastTick = now();
  private rosterDirty = true;
  private countdownAt = 0;
  private lastLobbyMsg = 0;
  private nextRoll = 0;
  private panic = false;
  private firstDeath = 0;
  private lastEventKind = '';
  mapId = 0;
  private unstickN = 0;
  /** 0 = alternate maps each round, otherwise map id + 1. */
  mapPref = 0;
  /** Rounds in the game being played (fixed when it starts), and what the host has picked for the next one. */
  rounds = ROUNDS_DEFAULT;
  roundsPref = ROUNDS_DEFAULT;
  /** Every round this room has started, across games. */
  private played = 0;
  private lastProp = false;
  private roundProps = 0;
  private huntAt = 0;
  now = now();

  constructor(public code: string, public isPublic: boolean) {
    this.map = buildMap(this.seed);
    this.world = new World(this.map);
    if (isPublic) this.botsWanted = PUBLIC_FILL - 1;
  }

  nav(): NavGrid { return (this.navGrid ??= new NavGrid(this.world)); }
  get humans(): number { let n = 0; for (const p of this.players.values()) if (p.human && p.connected) n++; return n; }
  get humanSlots(): number { let n = 0; for (const p of this.players.values()) if (p.human) n++; return n; }

  // ================================================================ networking helpers
  /**
   * Every byte to a client goes through here. A client that has stopped reading must not be allowed
   * to make the server queue without bound: droppable traffic (snapshots) is skipped while it is
   * behind, and a hopeless backlog ends the connection.
   */
  private out(p: Player, s: string, droppable = false) {
    const ws = p.ws;
    if (!ws || ws.readyState !== 1) return;
    const queued = ws.bufferedAmount ?? 0;
    if (queued > 1_000_000) { try { ws.terminate(); } catch { /* ignore */ } return; }
    if (droppable && queued > 96_000) return;
    ws.send(s);
  }
  private send(p: Player, msg: object) { this.out(p, JSON.stringify(msg)); }
  private broadcast(msg: object, filter?: (p: Player) => boolean) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (!filter || filter(p)) this.out(p, s);
  }
  private toast(p: Player, msg: string) { this.send(p, { t: 'ev', k: 'toast', msg }); }

  /** A hunter who is in the round: the one audience that the props' secrets are kept from. */
  private hunting(p: Player): boolean { return p.team === 'hunter' && p.alive && (this.phase === 'hiding' || this.phase === 'hunt'); }

  /**
   * Send an event that gives away where prop `q` is (a puff of smoke, say). Everybody gets it except hunting
   * hunters, who get it only if they can see `q` at this moment, and never while the props are still hiding.
   */
  private emitAt(q: Player, msg: object) {
    const s = JSON.stringify(msg), t = this.now;
    for (const p of this.players.values()) {
      if (this.hunting(p) && (this.phase !== 'hunt' || q.ghostUntil > t || !this.inView(p, q, t))) continue;
      this.out(p, s);
    }
  }

  /** May `p` be told about this decoy? Its own side always; a hunting hunter only once they have seen it. */
  private knowsDecoy(p: Player, id: number): boolean { return !this.hunting(p) || p.knownDecoys.has(id); }
  /** A decoy as `viewer` may see it: who planted it is not a hunter's business. */
  private decoyView(d: Decoy, viewer: Player) { return { id: d.id, type: d.type, x: d.x, y: d.y, z: d.z, yaw: d.yaw, owner: this.hunting(viewer) ? 0 : d.owner }; }
  private points(p: Player, n: number, why: string) {
    p.stats.pts += n;
    if (why) this.send(p, { t: 'ev', k: 'pts', n: Math.round(n), why });
  }

  // ================================================================ membership
  addPlayer(name: string, ws: WebSocket | null, bot = false, look = Math.floor(Math.random() * 64)): Player {
    const p = new Player(this.nextId++, name, randomBytes(18).toString('base64url'), ws); // the seat token is a bearer credential: unguessable
    if (bot) p.bot = new Bot();
    p.look = look;
    this.players.set(p.id, p);
    if (p.human && ![...this.players.values()].some((q) => q.host)) p.host = true;
    p.disguise = pickOf(this.map.starters);

    const left = this.phaseEnds - this.now;
    if (this.phase === 'lobby' || this.phase === 'end') this.spawnProp(p);
    else if (this.phase === 'hiding' || (this.phase === 'hunt' && left > CFG.LATE_JOIN_MS)) {
      this.spawnProp(p);
      p.playing = true;
      if (this.phase === 'hunt') p.ghostUntil = this.now + 4000;
    } else { p.alive = false; p.team = 'spec'; }

    if (p.human) {
      this.send(p, { t: 'welcome', id: p.id, token: p.token, code: this.code, pub: this.isPublic, now: this.now });
      this.sendState(p);
      this.balanceBots();
    }
    this.rosterDirty = true;
    return p;
  }

  /** Full state for a client that just (re)connected. */
  private sendState(p: Player) {
    this.send(p, { t: 'phase', phase: this.phase, ends: this.phaseEnds, round: this.round, rounds: this.rounds, seed: this.seed, map: this.mapId, next: this.nextMap(), results: this.phase === 'end' ? this.lastResults : undefined });
    this.send(p, { t: 'roster', p: this.roster(p) });
    this.send(p, { t: 'decoys', d: this.decoys.filter((d) => this.knowsDecoy(p, d.id)).map((d) => this.decoyView(d, p)) });
    if (this.event && this.event.until > this.now) this.send(p, { t: 'ev', k: 'chaos', kind: this.event.kind, ms: this.event.until - this.now, seed: this.round });
    if (this.panic) this.send(p, { t: 'ev', k: 'panic' });
    p.cdDirty = true;
    this.sendLobby();
  }

  reattach(token: string, ws: WebSocket): Player | null {
    for (const p of this.players.values()) {
      if (p.human && sameToken(p.token, token)) {
        if (p.ws && p.ws !== ws) { try { p.ws.close(); } catch { /* ignore */ } }
        p.ws = ws; p.connected = true; p.dcAt = 0; p.bank = 0.3; p.bankT = now();
        p.ack = 0; // a reconnecting client numbers its inputs from 1 again: keeping the old count would ignore them all
        this.send(p, { t: 'welcome', id: p.id, token: p.token, code: this.code, pub: this.isPublic, now: this.now });
        this.sendState(p);
        this.rosterDirty = true;
        return p;
      }
    }
    return null;
  }

  disconnect(p: Player) {
    p.connected = false; p.dcAt = now(); p.ws = null;
    this.rosterDirty = true;
  }

  removePlayer(p: Player) {
    if (!this.players.delete(p.id)) return;
    if (p.host) { p.host = false; const next = [...this.players.values()].find((q) => q.human && q.connected); if (next) next.host = true; }
    for (const d of this.decoys.filter((o) => o.owner === p.id)) this.popDecoy(d, null);
    this.rosterDirty = true;
    if (p.human) this.balanceBots();
  }

  private balanceBots() {
    if (this.phase !== 'lobby' && this.phase !== 'end') {
      // mid-round only make room for humans, never reshuffle the teams
      if (this.players.size > CFG.MAX_PLAYERS) { const b = [...this.players.values()].find((q) => q.bot && !q.alive) ?? [...this.players.values()].find((q) => q.bot && q.team === 'prop'); if (b) this.removePlayer(b); }
      return;
    }
    const want = this.isPublic ? Math.max(0, PUBLIC_FILL - this.humanSlots) : this.botsWanted;
    const bots = [...this.players.values()].filter((q) => q.bot);
    const cap = Math.max(0, Math.min(want, CFG.MAX_PLAYERS - this.humanSlots));
    for (let i = bots.length; i < cap; i++) this.addPlayer(botName(new Set([...this.players.values()].map((q) => q.name))), null, true);
    for (let i = bots.length; i > cap; i--) this.removePlayer(bots[i - 1]);
  }

  /**
   * The player list as `viewer` is allowed to see it. A hunting hunter is never told what a living
   * prop is disguised as: that only arrives with the prop's position, while the prop is in view.
   */
  roster(viewer?: Player): RosterEntry[] {
    const hide = !!viewer && viewer.team === 'hunter' && viewer.alive && (this.phase === 'hiding' || this.phase === 'hunt');
    return [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, alive: p.alive, bot: !!p.bot, host: p.host,
      score: Math.round(p.score), disguise: hide && p.team === 'prop' && p.alive ? -1 : p.disguise, conn: p.connected,
      quack: p.team === 'hunter' && p.quackUntil > this.now, look: p.look, ping: p.bot ? 0 : Math.round(p.rtt / 5) * 5,
    }));
  }
  private sendRoster() {
    let full = '', masked = '';
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      const hunting = p.team === 'hunter' && p.alive && (this.phase === 'hiding' || this.phase === 'hunt');
      if (hunting) this.out(p, (masked ||= JSON.stringify({ t: 'roster', p: this.roster(p) })));
      else this.out(p, (full ||= JSON.stringify({ t: 'roster', p: this.roster() })));
    }
  }

  private sendLobby() {
    const n = this.players.size;
    this.broadcast({ t: 'lobby', bots: [...this.players.values()].filter((q) => q.bot).length, countdown: this.countdownAt ? Math.max(0, this.countdownAt - this.now) : 0, canStart: n >= 2, map: this.mapPref, rounds: this.isPublic ? ROUNDS_DEFAULT : this.roundsPref });
  }

  // ================================================================ spawning & forms
  private randomSpot(hw: number, h: number): [number, number] {
    for (let i = 0; i < 200; i++) {
      const x = BOUNDS.x0 + 1 + Math.random() * (BOUNDS.x1 - BOUNDS.x0 - 2), z = BOUNDS.z0 + 1 + Math.random() * (BOUNDS.z1 - BOUNDS.z0 - 2);
      if (this.world.fits(x, 0, z, hw + 0.05, h)) return [x, z];
    }
    return [0, 0];
  }

  private place(p: Player, pts: [number, number][]) {
    const b = p.body;
    const order = pts.map((_, i) => i).sort(() => Math.random() - 0.5);
    let spot: [number, number] | null = null;
    for (const i of order) {
      const [x, z] = pts[i];
      if (!this.world.fits(x, 0, z, b.hw, b.h)) continue;
      let clash = false;
      for (const q of this.players.values()) if (q !== p && q.alive && Math.hypot(q.body.x - x, q.body.z - z) < 0.7) { clash = true; break; }
      if (!clash) { spot = [x, z]; break; }
    }
    if (!spot) spot = this.randomSpot(b.hw, b.h);
    b.x = spot[0]; b.z = spot[1]; b.y = 0; b.vx = b.vy = b.vz = 0; b.ground = true; b.dashLeft = 0; b.dashCd = 0;
    p.hist.length = 0;
  }

  private spawnProp(p: Player) {
    p.team = 'prop'; p.alive = true; p.hp = CFG.PROP_HP;
    p.quackUntil = p.panicUntil = p.ghostUntil = p.revealUntil = p.boostUntil = 0;
    p.bonkUntil = p.nextBonkAt = p.escapeAt = 0;
    p.cd = { decoy: 0, ghost: 0, taunt: 0, pulse: 0, shock: 0, haunt: 0 }; p.cdDirty = true;
    const d = propBody(PROPS[p.disguise]);
    p.body.hw = d.hw; p.body.h = d.h;
    this.place(p, this.map.propSpawns);
    p.facing = p.yaw = Math.random() < 0.5 ? 0 : Math.PI;
  }

  private spawnHunter(p: Player) {
    p.team = 'hunter'; p.alive = true; p.focus = CFG.FOCUS_MAX; p.bonkUntil = 0;
    p.quackUntil = p.panicUntil = p.ghostUntil = p.revealUntil = p.boostUntil = 0;
    // the gadgets come online a few seconds into the hunt (a stand-in who takes over mid-hunt waits the same few seconds)
    const go = this.phase === 'hunt' ? this.now : this.now + CFG.HIDE_MS;
    p.cd = { decoy: 0, ghost: 0, taunt: 0, pulse: go + 6000, shock: go + 8000, haunt: 0 }; p.cdDirty = true;
    p.body.hw = CFG.HUNTER_HW; p.body.h = CFG.HUNTER_H;
    this.place(p, this.map.hunterSpawns);
    p.facing = p.yaw = 0; p.pitch = 0;
  }

  /** Resize a body, nudging it to somewhere it fits. Returns false if nowhere nearby works. */
  private resize(p: Player, hw: number, h: number, allowMove: boolean): boolean {
    const b = p.body;
    const tryAt = (x: number, y: number, z: number) => {
      if (!this.world.fits(x, y, z, hw, h)) return false;
      b.x = x; b.y = y; b.z = z; b.hw = hw; b.h = h; return true;
    };
    for (const dy of [0, 0.05, 0.15, 0.3, 0.5]) if (tryAt(b.x, b.y + dy, b.z)) return true;
    for (const r of [0.15, 0.3, 0.5]) for (let a = 0; a < 8; a++) {
      if (tryAt(b.x + Math.cos(a * 0.785) * r, b.y + 0.02, b.z + Math.sin(a * 0.785) * r)) return true;
    }
    if (!allowMove) return false;
    for (let r = 0.75; r <= 4; r += 0.5) for (let a = 0; a < 12; a++) {
      if (tryAt(b.x + Math.cos(a * 0.5236) * r, 0, b.z + Math.sin(a * 0.5236) * r)) return true;
    }
    const [x, z] = this.randomSpot(hw, h);
    b.x = x; b.y = 0; b.z = z; b.hw = hw; b.h = h;
    return true;
  }

  // ================================================================ round flow
  private lastResults: Results | undefined;
  private setPhase(phase: Phase, ms: number, results?: Results) {
    this.lastResults = results;
    this.rosterDirty = true; // what a viewer may know about the other team changes with the phase
    this.phase = phase;
    this.phaseEnds = ms ? this.now + ms : 0;
    this.broadcast({ t: 'phase', phase, ends: this.phaseEnds, round: this.round, rounds: this.rounds, seed: this.seed, map: this.mapId, next: this.nextMap(), results });
    this.rosterDirty = true;
  }

  private nextMap(): number { return this.mapPref ? this.mapPref - 1 : this.played % 2; }

  private loadMap(seed: number, id = 0) {
    this.seed = seed; this.mapId = id;
    this.map = buildMap(seed, id);
    this.world = new World(this.map);
    this.navGrid = null;
  }

  startRound() {
    this.balanceBots();
    const all = [...this.players.values()].filter((p) => p.bot || p.connected);
    if (all.length < 2) { this.toLobby(); return; }
    const mapId = this.nextMap();
    if (this.round === 0) {
      // a new game: the host's choice of length is fixed for its duration, and everyone starts level
      this.rounds = this.isPublic ? ROUNDS_DEFAULT : this.roundsPref;
      for (const p of this.players.values()) { p.score = 0; p.hunterTurns = 0; }
    }
    this.round++; this.played++;
    this.loadMap(1000 + Math.floor(Math.random() * 1e9), mapId);
    this.chaos = 0; this.event = null; this.decoys = []; this.pulses = []; this.panic = false; this.firstDeath = 0; this.lastProp = false; this.roundProps = 0;
    this.haunted.clear();
    this.world.gravScale = 1; this.countdownAt = 0;

    const nH = all.length <= 5 ? 1 : all.length <= 9 ? 2 : 3;
    const order = all.slice().sort((a, b) => a.hunterTurns - b.hunterTurns || Math.random() - 0.5);
    const hunters = new Set(order.slice(0, nH));
    for (const p of this.players.values()) { p.stats = newStats(); p.playing = false; p.alive = false; p.team = 'spec'; p.sight.clear(); p.knownDecoys.clear(); }
    // props first so hunters never share a spawn with them
    for (const p of all) {
      p.playing = true;
      if (!hunters.has(p)) { p.disguise = pickOf(this.map.starters); this.spawnProp(p); }
    }
    for (const p of hunters) { p.hunterTurns++; this.spawnHunter(p); }
    this.setPhase('hiding', CFG.HIDE_MS);
    this.broadcast({ t: 'decoys', d: [] });
  }

  private toLobby() {
    this.loadMap(1);
    this.round = 0; this.chaos = 0; this.event = null; this.decoys = []; this.pulses = []; this.panic = false; this.countdownAt = 0; this.haunted.clear();
    for (const p of this.players.values()) { p.hunterTurns = 0; p.disguise = pickOf(STARTER_PROPS); this.spawnProp(p); }
    this.setPhase('lobby', 0);
    this.broadcast({ t: 'decoys', d: [] });
  }

  private endRound(winner: 'props' | 'hunters') {
    const t = this.now;
    const awards: Award[] = [];
    const played = [...this.players.values()].filter((p) => p.playing);
    for (const p of played) {
      if (p.team === 'prop' && p.alive) this.points(p, SCORE.survived, 'Survived!');
      if (p.team === 'hunter' && winner === 'hunters') this.points(p, SCORE.sweep, 'Clean sweep');
      if (p.team === 'prop' && winner === 'props' && !p.alive) this.points(p, SCORE.teamWin, 'Team win');
    }
    const best = (f: (p: Player) => number, min: number): Player | null => {
      let b: Player | null = null, bv = min - 1e-9;
      for (const p of played) { const v = f(p); if (v > bv) { bv = v; b = p; } }
      return b;
    };
    const add = (title: string, p: Player | null, detail: (p: Player) => string) => { if (p && awards.length < 4 && !awards.some((a) => a.name === p.name)) awards.push({ title, name: p.name, detail: detail(p) }); };
    add('Untouchable', best((p) => (p.team === 'prop' && p.alive && p.hp >= CFG.PROP_HP ? 1 + p.stats.near : 0), 1), () => 'survived without a scratch');
    add('Furniture Assassin', best((p) => p.stats.innocents, 3), (p) => `murdered ${p.stats.innocents} innocent toys`);
    add('Bonk Master', best((p) => p.stats.bonks, 1), (p) => `landed on a hunter's head ${p.stats.bonks}×`);
    add('Escape Artist', best((p) => p.stats.escapes, 2), (p) => `got hit and got away ${p.stats.escapes}×`);
    add('Bamboozler', best((p) => p.stats.bamboozles, 1), (p) => `fooled hunters ${p.stats.bamboozles}× with decoys`);
    add('Poltergeist', best((p) => p.stats.spooks, 1), (p) => `spooked hunters ${p.stats.spooks}× from beyond`);
    add('Sharpshooter', best((p) => (p.stats.shots >= 4 && p.stats.hits >= 2 ? p.stats.hits / p.stats.shots : 0), 0.34), (p) => `${Math.round((100 * p.stats.hits) / p.stats.shots)}% accuracy`);
    add('Daredevil', best((p) => p.stats.near, 5), (p) => `${Math.round(p.stats.near)}s within arm's reach of a hunter`);
    add('Loudmouth', best((p) => p.stats.taunts, 2), (p) => `taunted ${p.stats.taunts} times`);
    add('Quack Attack', best((p) => p.stats.quacks, 1), (p) => `got turned into a duck ${p.stats.quacks}×`);
    add('Top Hunter', best((p) => p.stats.kills, 2), (p) => `${p.stats.kills} props caught`);
    if (this.firstDeath) add('First to Fall', this.players.get(this.firstDeath) ?? null, () => 'found before anyone else');

    for (const p of played) p.score += p.stats.pts;
    const roundCoins = (p: Player) => Math.max(COINS.round, Math.min(COINS.roundCap, COINS.round + Math.floor(p.stats.pts / COINS.perPoints)))
      + (p.team !== 'spec' && (p.team === 'hunter') === (winner === 'hunters') ? COINS.win : 0); // a hunter who was stood down is on neither side
    const board = played
      .map((p) => ({ id: p.id, name: p.name, team: p.team, round: Math.round(p.stats.pts), total: Math.round(p.score), survived: p.team === 'prop' && p.alive, coins: roundCoins(p) }))
      .sort((a, b) => b.round - a.round);
    // the last round of a game also settles the game: final standings, and a bonus for finishing and for the podium
    const last = this.round >= this.rounds;
    const paid = Math.min(COINS.place.length, played.length - 1); // last place never takes a podium bonus
    const final = last ? played.slice().sort((a, b) => b.score - a.score)
      .map((p, i) => ({ id: p.id, name: p.name, total: Math.round(p.score), coins: COINS.game + (i < paid ? COINS.place[i] : 0), bot: !!p.bot })) : undefined;
    this.event = null; this.world.gravScale = 1; this.pulses = []; this.haunted.clear();
    void t;
    this.setPhase('end', last ? CFG.FINAL_MS : CFG.END_MS, { winner, awards, board, n: this.played, round: this.round, rounds: this.rounds, final });
  }

  // ================================================================ input
  onMessage(p: Player, m: any) {
    // flood guard
    const t = now();
    if (t - p.msgT > 1000) { p.msgT = t; p.msgN = 0; }
    if (++p.msgN > 400) { try { p.ws?.close(4008, 'rate'); } catch { /* ignore */ } return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t !== 'in' && m.t !== 'ping') p.lastInputAt = t;
    switch (m.t) {
      case 'in': this.onInput(p, m.c); break;
      case 'fire': if (fin(m.yaw) && fin(m.pitch) && p.team === 'hunter') { p.yaw = wrapAngle(m.yaw); this.fire(p, p.yaw, m.pitch, fin(m.rt) ? m.rt : this.now); } break;
      case 'tf': if (fin(m.d)) this.transform(p, m.d | 0); break;
      case 'ab': this.ability(p, m.k); break;
      case 'haunt': if (fin(m.d)) this.haunt(p, m.d | 0); break;
      case 'taunt': this.taunt(p, fin(m.i) ? m.i | 0 : 0); break;
      case 'chat': if (fin(m.i) && m.i >= 0 && m.i < QUICK_CHAT.length && t > p.nextChatAt) { p.nextChatAt = t + 1500; this.broadcast({ t: 'ev', k: 'chat', who: p.id, i: m.i | 0 }); } break;
      case 'start': if (p.host && this.phase === 'lobby' && this.players.size >= 2) this.startRound(); break;
      case 'rounds': if (p.host && !this.isPublic && fin(m.n) && ROUND_CHOICES.includes(m.n)) { this.roundsPref = m.n; this.sendLobby(); } break;
      case 'map': if (p.host && !this.isPublic && fin(m.m)) { this.mapPref = Math.max(0, Math.min(2, m.m | 0)); this.sendLobby(); } break;
      case 'bots': if (p.host && !this.isPublic && fin(m.n)) { this.botsWanted = Math.max(0, Math.min(8, m.n | 0)); this.balanceBots(); this.sendLobby(); } break;
      case 'ping': if (fin(m.c)) this.send(p, { t: 'pong', c: m.c, now: now() }); break;
    }
  }

  private onInput(p: Player, cmds: unknown) {
    if (!Array.isArray(cmds) || cmds.length > 24) return;
    const t = now();
    p.bank = Math.min(0.6, p.bank + (t - p.bankT) / 1000); p.bankT = t;
    for (const c of cmds) {
      if (!Array.isArray(c) || c.length < 8) return;
      for (let i = 0; i < 8; i++) if (!fin(c[i])) return;
      const seq = c[0] | 0;
      // Inputs arrive in order on one socket and are never resent, so a number that goes backwards can only be a
      // client that started counting again (reconnect, reload). Ignoring those froze the player; the time bank
      // below already stops anyone gaining movement by replaying inputs.
      if (seq === p.ack) continue;
      p.ack = seq;
      let dt = Math.min(0.05, Math.max(0, c[1]));
      // a client can never simulate more time than has really passed (speed-hack guard)
      if (dt > p.bank) dt = Math.max(0, p.bank);
      p.bank -= dt;
      if (dt <= 0) continue;
      const cmd: Cmd = { dt, mx: Math.max(-1, Math.min(1, c[2])), mz: Math.max(-1, Math.min(1, c[3])), yaw: wrapAngle(c[4]), jump: (c[6] & 1) !== 0, dash: (c[6] & 2) !== 0 };
      if (cmd.mx !== 0 || cmd.mz !== 0 || cmd.jump || Math.abs(cmd.yaw - p.yaw) > 0.002) p.lastInputAt = t;
      this.applyCmd(p, cmd, c[5], wrapAngle(c[7]), t);
    }
  }

  canMove(p: Player): boolean {
    if (!p.alive || p.team === 'spec') return false;
    if (this.phase === 'hiding' && p.team === 'hunter') return false;
    return true;
  }

  speedOf(p: Player, t: number): number {
    if (p.team === 'hunter') return p.quackUntil > t ? CFG.QUACK_SPEED : CFG.HUNTER_SPEED;
    let s = CFG.PROP_SPEED;
    if (p.panicUntil > t) s *= CFG.PANIC_BURST_MUL;
    if (p.boostUntil > t) s *= 1.35;
    if (this.panic && this.phase === 'hunt') s *= CFG.PANIC_TIME_MUL;
    return s;
  }
  jumpOf(p: Player, t: number): number { return p.team === 'hunter' ? (p.quackUntil > t ? 6.2 : CFG.HUNTER_JUMP) : CFG.PROP_JUMP; }

  applyCmd(p: Player, cmd: Cmd, pitch: number, facing: number, t: number) {
    if (!p.alive || p.team === 'spec') return;
    if (!this.canMove(p)) { cmd.mx = 0; cmd.mz = 0; cmd.jump = false; cmd.dash = false; }
    p.yaw = cmd.yaw;
    p.pitch = Math.max(-1.55, Math.min(1.55, pitch));
    this.world.step(p.body, cmd, this.speedOf(p, t), this.jumpOf(p, t), p.team === 'prop');
    p.facing = p.team === 'prop' ? facing : cmd.yaw;
    const b = p.body;
    if (Math.hypot(b.vx, b.vz) > 0.6 || !b.ground) p.lastMovedAt = t;
    if (b.y < -3 || b.y > 6) { const [x, z] = this.randomSpot(b.hw, b.h); b.x = x; b.y = 0; b.z = z; b.vy = 0; }
  }

  // ================================================================ actions
  private posAt(q: Player, rt: number): number[] {
    const h = q.hist;
    if (h.length < 2 || rt >= h[h.length - 1][0]) return [0, q.body.x, q.body.y, q.body.z, q.facing];
    for (let i = h.length - 2; i >= 0; i--) {
      if (h[i][0] <= rt) {
        const a = h[i], b = h[i + 1], k = (rt - a[0]) / Math.max(1, b[0] - a[0]);
        return [0, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k, b[4]];
      }
    }
    return h[0];
  }

  fire(p: Player, yaw: number, pitch: number, rt: number) {
    const t = this.now;
    if (this.phase !== 'hunt' || p.team !== 'hunter' || !p.alive || p.quackUntil > t || p.bonkUntil > t || t < p.nextFireAt) return;
    p.nextFireAt = t + CFG.FIRE_MS - 40;
    p.lastShotAt = t;
    p.stats.shots++;
    pitch = Math.max(-1.55, Math.min(1.55, pitch));
    rt = Math.max(t - 400, Math.min(t, rt));
    const ox = p.body.x, oy = p.body.y + CFG.HUNTER_EYE, oz = p.body.z;
    const [dx, dy, dz] = aimDir(yaw, pitch);
    const w = this.world.raycast(ox, oy, oz, dx, dy, dz, CFG.RANGE);
    let best = w.t, kind: 0 | 1 | 2 | 3 | 4 = w.t === Infinity ? 0 : w.decor >= 0 ? 2 : 1, target = w.decor;
    let victim: Player | null = null, decoy: Decoy | null = null;
    for (const q of this.players.values()) {
      if (q.team !== 'prop' || !q.alive) continue;
      const def = PROPS[q.disguise];
      const pos = this.posAt(q, rt);
      const tt = rayOBB(ox, oy, oz, dx, dy, dz, pos[1], pos[2], pos[3], def.w, def.h, def.d, pos[4], 0.06);
      if (tt < best) { best = tt; victim = q; decoy = null; kind = 3; target = q.id; }
    }
    for (const d of this.decoys) {
      const def = PROPS[d.type];
      const tt = rayOBB(ox, oy, oz, dx, dy, dz, d.x, d.y, d.z, def.w, def.h, def.d, d.yaw, 0.04);
      if (tt < best) { best = tt; decoy = d; victim = null; kind = 4; target = d.id; }
    }
    const dist = best === Infinity ? CFG.RANGE : best;
    const hx = r2(ox + dx * dist), hy = r2(oy + dy * dist), hz = r2(oz + dz * dist);
    // an innocent object a ghost had just rattled: the hunter fell for it
    const bait = kind === 2 ? this.haunted.get(target) : undefined;
    const spooked = !!bait && bait.until > t;
    this.broadcast({ t: 'ev', k: 'shot', by: p.id, x: hx, y: hy, z: hz, hit: kind, tg: target, hp: victim ? Math.max(0, victim.hp - CFG.DMG) : undefined, sp: spooked ? 1 : undefined });

    if (victim) {
      p.stats.hits++;
      p.focus = Math.min(CFG.FOCUS_MAX, p.focus + CFG.FOCUS_HIT);
      this.points(p, SCORE.hit, '');
      victim.hp -= CFG.DMG;
      victim.panicUntil = t + CFG.PANIC_BURST_MS;
      victim.escapeAt = t + CFG.ESCAPE_MS;
      victim.revealUntil = Math.max(victim.revealUntil, t + 1500);
      victim.ghostUntil = 0;
      if (victim.hp <= 0) {
        victim.hp = 0; victim.alive = false; victim.stats.diedAt = t;
        if (!this.firstDeath) this.firstDeath = victim.id;
        p.stats.kills++; p.focus = Math.min(CFG.FOCUS_MAX, p.focus + CFG.FOCUS_KILL);
        this.points(p, SCORE.catch, 'Prop caught!');
        this.broadcast({ t: 'ev', k: 'kill', by: p.id, who: victim.id, ty: victim.disguise, x: r2(victim.body.x), y: r2(victim.body.y), z: r2(victim.body.z) });
        // out of hiding, into haunting: a moment to read the banner, then the ghost may start rattling things
        victim.cd.haunt = t + 2500; victim.cdDirty = true;
        this.rosterDirty = true;
      }
      this.send(victim, { t: 'ev', k: 'hurt', hp: victim.hp });
    } else if (decoy) {
      this.popDecoy(decoy, p);
    } else if (kind === 2) {
      p.stats.innocents++;
      this.points(p, SCORE.innocent, '');
      if (spooked && bait) {
        this.haunted.delete(target);
        const ghost = this.players.get(bait.by);
        if (ghost) { ghost.stats.spooks++; this.points(ghost, ghost.playing ? SCORE.spook : 0, 'Spooked a hunter!'); }
        this.chaos = Math.min(100, this.chaos + CFG.CHAOS_SPOOK);
        this.broadcast({ t: 'ev', k: 'spook', d: target, by: p.id, ghost: bait.by, x: hx, y: hy, z: hz });
        this.drain(p, CFG.FOCUS_SPOOK);
      } else {
        this.chaos = Math.min(100, this.chaos + CFG.CHAOS_MISS);
        this.drain(p, CFG.FOCUS_MISS);
      }
    }
  }

  /**
   * A ghost (a caught prop, or a late joiner sitting the round out) rattles an innocent object. Nothing happens
   * to the hunters unless one of them shoots it while it is still hot; either way it stirs up a little chaos.
   * The ghost's camera is the client's own business, so any object on the map may be haunted: the cooldown is the limit.
   */
  haunt(p: Player, decorId: number) {
    const t = this.now;
    if (!CFG.HAUNT_ON || this.phase !== 'hunt' || p.alive || p.team === 'hunter' || t < p.cd.haunt) return;
    const d = this.map.decor[decorId];
    if (!d) return;
    const frenzy = !!this.event && this.event.kind === 'poltergeist' && this.event.until > t;
    p.cd.haunt = t + CFG.CD_HAUNT * (frenzy ? CFG.HAUNT_FRENZY : 1); p.cdDirty = true;
    p.stats.haunts++;
    this.haunted.set(d.id, { by: p.id, until: t + CFG.HAUNT_BAIT_MS });
    this.chaos = Math.min(100, this.chaos + CFG.CHAOS_HAUNT);
    this.broadcast({ t: 'ev', k: 'haunt', d: d.id, by: p.id });
  }

  private drain(p: Player, n: number) {
    p.focus -= n;
    if (p.focus > 0) return;
    // out of focus: the blaster backfires and the hunter spends a while as a rubber duck
    const t = this.now;
    p.focus = 0; p.quackUntil = t + CFG.QUACK_MS; p.stats.quacks++;
    const d = propBody(PROPS[DUCK]);
    this.resize(p, d.hw, d.h, false);
    this.broadcast({ t: 'ev', k: 'quack', who: p.id, on: true });
    this.rosterDirty = true;
  }

  private popDecoy(d: Decoy, by: Player | null) {
    this.decoys = this.decoys.filter((o) => o !== d);
    // the hunter who shot it has certainly seen it, whatever the sight test made of the angle
    if (by && !by.knownDecoys.has(d.id)) { by.knownDecoys.add(d.id); this.send(by, { t: 'ev', k: 'decoy', ...this.decoyView(d, by) }); }
    this.broadcast({ t: 'ev', k: 'decoyPop', id: d.id, by: by ? by.id : 0 }, (q) => this.knowsDecoy(q, d.id));
    for (const q of this.players.values()) q.knownDecoys.delete(d.id);
    if (!by) return;
    const owner = this.players.get(d.owner);
    if (owner) { owner.stats.bamboozles++; this.points(owner, SCORE.bamboozle, 'Bamboozled a hunter!'); }
    this.send(by, { t: 'ev', k: 'blind', ms: 1800 });
    this.chaos = Math.min(100, this.chaos + CFG.CHAOS_DECOY);
    this.drain(by, CFG.FOCUS_DECOY);
  }

  transform(p: Player, decorId: number) {
    const t = this.now;
    if (p.team !== 'prop' || !p.alive || t < p.nextTransformAt) return;
    const d = this.map.decor[decorId];
    if (!d) return;
    const b = p.body;
    if (Math.hypot(d.x - b.x, d.y - b.y, d.z - b.z) > CFG.TRANSFORM_RANGE + 1) return;
    p.nextTransformAt = t + CFG.CD_TRANSFORM;
    if (d.type === p.disguise) return;
    const nb = propBody(PROPS[d.type]);
    if (!this.resize(p, nb.hw, nb.h, false)) { this.toast(p, 'Not enough room to become that here!'); return; }
    p.disguise = d.type;
    this.rosterDirty = true;
    this.emitAt(p, { t: 'ev', k: 'poof', x: r2(b.x), y: r2(b.y), z: r2(b.z) });
  }

  ability(p: Player, k: unknown) {
    const t = this.now;
    if (!p.alive) return;
    const b = p.body;
    if (k === 'decoy' && p.team === 'prop' && t >= p.cd.decoy) {
      p.cd.decoy = t + CFG.CD_DECOY; p.cdDirty = true;
      const old = this.decoys.find((d) => d.owner === p.id);
      if (old) this.popDecoy(old, null);
      const d: Decoy = { id: this.nextId++, type: p.disguise, x: r3(b.x), y: r3(b.y), z: r3(b.z), yaw: r3(p.facing), owner: p.id, nextHop: t + 3000 + Math.random() * 5000, hopUntil: 0 };
      this.decoys.push(d);
      // hunters are not told: a decoy reaches a hunter's client when that hunter first has it in view (see snapshot)
      this.broadcast({ t: 'ev', k: 'decoy', id: d.id, type: d.type, x: d.x, y: d.y, z: d.z, yaw: d.yaw, owner: d.owner }, (q) => !this.hunting(q));
    } else if (k === 'ghost' && p.team === 'prop' && t >= p.cd.ghost && this.phase !== 'lobby') {
      p.cd.ghost = t + CFG.CD_GHOST; p.cdDirty = true;
      this.emitAt(p, { t: 'ev', k: 'poof', x: r2(b.x), y: r2(b.y), z: r2(b.z) }); // before vanishing: a hunter watching sees the puff
      p.ghostUntil = t + CFG.GHOST_MS;
    } else if (k === 'pulse' && p.team === 'hunter' && this.phase === 'hunt' && t >= p.cd.pulse && p.quackUntil <= t) {
      p.cd.pulse = t + CFG.CD_PULSE; p.cdDirty = true;
      this.pulses.push({ x: b.x, z: b.z, t0: t, by: p.id, seen: new Set() });
      this.broadcast({ t: 'ev', k: 'pulse', by: p.id, x: r2(b.x), z: r2(b.z) });
    } else if (k === 'shock' && p.team === 'hunter' && this.phase === 'hunt' && t >= p.cd.shock && p.quackUntil <= t) {
      p.cd.shock = t + CFG.CD_SHOCK; p.cdDirty = true;
      this.broadcast({ t: 'ev', k: 'shock', by: p.id, x: r2(b.x), y: r2(b.y), z: r2(b.z) });
      for (const q of this.players.values()) {
        if (q.team !== 'prop' || !q.alive) continue;
        const dx = q.body.x - b.x, dz = q.body.z - b.z, d = Math.hypot(dx, dz);
        if (d > CFG.SHOCK_RADIUS || Math.abs(q.body.y - b.y) > 3) continue;
        // real props get launched; innocent toys never flinch
        q.body.vy = 7.5; q.body.ground = false;
        const k2 = 4 / Math.max(0.5, d);
        q.body.vx += dx * k2; q.body.vz += dz * k2;
        q.lastMovedAt = t; q.ghostUntil = 0;
        q.revealUntil = Math.max(q.revealUntil, t + 1200);
      }
      for (const d of this.decoys.slice()) if (Math.hypot(d.x - b.x, d.z - b.z) <= CFG.SHOCK_RADIUS) this.popDecoy(d, null);
    }
  }

  taunt(p: Player, i: number) {
    const t = this.now;
    if (p.team !== 'prop' || !p.alive || t < p.cd.taunt) return;
    p.cd.taunt = t + CFG.CD_TAUNT;
    p.cd.decoy = Math.max(t, p.cd.decoy - 3000); p.cd.ghost = Math.max(t, p.cd.ghost - 3000); p.cdDirty = true;
    const b = p.body;
    let pts = 0;
    if (this.phase === 'hunt') {
      let near = 1e9;
      for (const h of this.players.values()) if (h.team === 'hunter' && h.alive) near = Math.min(near, Math.hypot(h.body.x - b.x, h.body.z - b.z));
      pts = Math.round(SCORE.tauntMin + (SCORE.tauntMax - SCORE.tauntMin) * Math.max(0, 1 - near / TAUNT_RANGE));
      p.stats.taunts++;
      this.points(p, pts, near < TAUNT_RANGE ? 'Risky taunt!' : 'Taunt');
      this.chaos = Math.min(100, this.chaos + CFG.CHAOS_TAUNT);
    }
    // a taunt is meant to be heard by hunters, but not while the props are still hiding
    this.broadcast({ t: 'ev', k: 'taunt', who: p.id, i: ((i % TAUNTS.length) + TAUNTS.length) % TAUNTS.length, x: r2(b.x), y: r2(b.y), z: r2(b.z), pts }, (q) => !(this.phase === 'hiding' && this.hunting(q)));
  }

  // ================================================================ chaos
  private triggerChaos() {
    const t = this.now;
    this.chaos = 0;
    const on = Object.keys(CHAOS_WEIGHTS).filter((k) => CHAOS_WEIGHTS[k] > 0);
    const kinds = on.length > 1 ? on.filter((k) => k !== this.lastEventKind) : on;
    if (!kinds.length) return;
    let roll = Math.random() * kinds.reduce((sum, k) => sum + CHAOS_WEIGHTS[k], 0), kind = kinds[0];
    for (const k of kinds) { roll -= CHAOS_WEIGHTS[k]; if (roll < 0) { kind = k; break; } }
    this.lastEventKind = kind;
    let ms = 0;
    if (kind === 'blackout') ms = CFG.BLACKOUT_MS;
    else if (kind === 'poltergeist') ms = CFG.POLTERGEIST_MS;
    else if (kind === 'moon') { ms = CFG.MOON_MS; this.world.gravScale = 0.3; }
    else if (kind === 'sneeze') {
      // the one chaos event that favours hunters: every real prop sneezes itself into the air
      ms = 2500;
      const pts: number[][] = [];
      for (const p of this.players.values()) {
        if (p.team !== 'prop' || !p.alive) continue;
        p.body.vy = 6.2; p.body.ground = false; p.lastMovedAt = t; p.ghostUntil = 0;
        pts.push([p.id, r2(p.body.x), r2(p.body.y), r2(p.body.z)]);
      }
      for (const d of this.decoys) { d.hopUntil = t + 700; this.broadcast({ t: 'ev', k: 'decoyHop', id: d.id }, (q) => this.knowsDecoy(q, d.id)); pts.push([0, d.x, d.y, d.z]); }
      this.broadcast({ t: 'ev', k: 'sneeze', pts });
    }
    else {
      ms = 3000;
      const pool = [...new Set(this.map.decor.map((d) => d.type))].filter((i) => PROPS[i].h <= 1.4);
      for (const p of this.players.values()) {
        if (p.team !== 'prop' || !p.alive) continue;
        for (let i = 0; i < 8; i++) {
          const type = pickOf(pool);
          if (type === p.disguise) continue;
          const nb = propBody(PROPS[type]);
          if (this.resize(p, nb.hw, nb.h, false)) { p.disguise = type; break; }
        }
        p.boostUntil = t + 3500;
        this.emitAt(p, { t: 'ev', k: 'poof', x: r2(p.body.x), y: r2(p.body.y), z: r2(p.body.z) });
      }
      this.rosterDirty = true;
    }
    this.event = { kind, until: t + ms };
    this.broadcast({ t: 'ev', k: 'chaos', kind, ms, seed: Math.floor(Math.random() * 1e6) });
  }

  // ================================================================ tick
  tick() {
    const t = (this.now = now());
    const dt = Math.min(0.2, (t - this.lastTick) / 1000);
    this.lastTick = t;

    // seats are held through a refresh or a network blip; much longer mid-round than in the lobby
    // safety net: nobody stays wedged inside a wall or an object (a disguise that grew, a shuffled layout)
    if (++this.unstickN % 8 === 0) for (const p of this.players.values()) {
      if (!p.alive || p.team === 'spec') continue;
      const b = p.body;
      if (this.world.fits(b.x, b.y + 0.02, b.z, b.hw - 0.02, b.h - 0.04)) { p.stuckN = 0; continue; }
      if (++p.stuckN >= 2) { this.resize(p, b.hw, b.h, true); b.vx = b.vy = b.vz = 0; p.stuckN = 0; }
    }
    const grace = this.phase === 'lobby' ? 15_000 : DC_GRACE_MS;
    for (const p of [...this.players.values()]) if (p.human && !p.connected && t - p.dcAt > grace) this.removePlayer(p);
    // public rooms: a seat that has sent no input at all for four minutes (longer than a whole round) is given back
    if (this.isPublic) for (const p of [...this.players.values()]) {
      if (!p.human || !p.connected || t - p.lastInputAt < AFK_MS) continue;
      this.send(p, { t: 'err', msg: 'You were removed for being idle.' });
      try { p.ws?.close(4001, 'idle'); } catch { /* ignore */ }
      p.ws = null; p.connected = false;
      this.removePlayer(p);
    }
    // a hunter who has dropped out, or (in a public room) stopped playing, hands the job to a bot rather than waste the round
    if (this.phase === 'hiding' || this.phase === 'hunt') for (const p of [...this.players.values()]) {
      if (p.team !== 'hunter' || !p.human) continue;
      const gone = !p.connected && t - p.dcAt > CFG.HUNTER_DC_MS;
      const idle = this.isPublic && this.phase === 'hunt' && p.connected && t - Math.max(p.lastInputAt, this.huntAt) > CFG.HUNTER_AFK_MS;
      if (gone || idle) this.benchHunter(p, idle);
    }
    if (this.humans === 0) { if (!this.emptySince) this.emptySince = t; } else this.emptySince = 0;
    if (this.emptySince && t - this.emptySince > (this.humanSlots ? grace + 2000 : 3000)) { this.closed = true; return; }

    switch (this.phase) {
      case 'lobby': {
        if (this.isPublic && this.humans >= 1 && this.players.size >= 2) {
          if (!this.countdownAt) { this.countdownAt = t + CFG.LOBBY_COUNTDOWN_MS; this.sendLobby(); }
          else if (t >= this.countdownAt) this.startRound();
        } else if (this.countdownAt) { this.countdownAt = 0; this.sendLobby(); }
        if (t - this.lastLobbyMsg > 1000) { this.lastLobbyMsg = t; this.sendLobby(); }
        break;
      }
      case 'hiding':
        if (t >= this.phaseEnds) { this.nextRoll = t + CFG.ROLLCALL_MS; this.huntAt = t; this.setPhase('hunt', CFG.HUNT_MS); }
        break;
      case 'hunt': this.tickHunt(t, dt); break;
      case 'end':
        // between rounds the game rolls straight on; after the last one everybody goes back to the lobby
        if (t >= this.phaseEnds) { if (this.humans >= 1 && this.round < this.rounds) this.startRound(); else this.toLobby(); }
        break;
    }
    if (this.closed) return;

    for (const p of this.players.values()) {
      if (p.bot) p.bot.update(this, p, t, dt);
      if (!p.alive) continue;
      p.hist.push([t, p.body.x, p.body.y, p.body.z, p.facing]);
      if (p.hist.length > 14) p.hist.shift();
      if (p.team === 'hunter') {
        if (p.quackUntil && p.quackUntil <= t) {
          p.quackUntil = 0; p.focus = 60;
          this.resize(p, CFG.HUNTER_HW, CFG.HUNTER_H, true);
          this.broadcast({ t: 'ev', k: 'quack', who: p.id, on: false });
          this.rosterDirty = true;
        }
        if (!p.quackUntil && t - p.lastShotAt > 2000 && p.focus < CFG.FOCUS_MAX) p.focus = Math.min(CFG.FOCUS_MAX, p.focus + CFG.FOCUS_REGEN * dt);
      }
    }

    // decoys twitch now and then so they read as "a player who couldn't sit still"
    for (const d of this.decoys) if (t >= d.nextHop) {
      d.nextHop = t + 5000 + Math.random() * 7000; d.hopUntil = t + 700;
      this.broadcast({ t: 'ev', k: 'decoyHop', id: d.id }, (q) => this.knowsDecoy(q, d.id));
    }
    if (this.haunted.size) for (const [id, h] of this.haunted) if (h.until <= t) this.haunted.delete(id);

    if (this.rosterDirty) { this.rosterDirty = false; this.sendRoster(); }
    this.snapshot(t);
  }

  private tickHunt(t: number, dt: number) {
    let propsAlive = 0, hunters = 0;
    for (const p of this.players.values()) {
      if (p.team === 'prop' && p.alive) propsAlive++;
      if (p.team === 'hunter') hunters++; // one whose connection has dropped still counts: a stand-in takes over if they stay away (benchHunter)
    }
    if (propsAlive === 0) return this.endRound('hunters');
    if (hunters === 0 || t >= this.phaseEnds) return this.endRound('props');

    if (!this.panic && this.phaseEnds - t <= CFG.PANIC_MS) {
      this.panic = true;
      this.nextRoll = Math.min(this.nextRoll, t + 2500);
      this.broadcast({ t: 'ev', k: 'panic' });
    }
    if (t >= this.nextRoll) {
      this.nextRoll = t + (this.panic ? CFG.ROLLCALL_PANIC_MS : this.lastProp ? CFG.ROLLCALL_LAST_MS : CFG.ROLLCALL_MS);
      const pts: number[][] = [];
      for (const p of this.players.values()) if (p.team === 'prop' && p.alive) pts.push([r2(p.body.x), r2(p.body.y), r2(p.body.z)]);
      for (const d of this.decoys) pts.push([d.x, d.y, d.z]);
      this.broadcast({ t: 'ev', k: 'roll', pts });
    }

    // chaos meter
    this.chaos = Math.min(100, this.chaos + CFG.CHAOS_PASSIVE * dt);
    if (this.event && t >= this.event.until) {
      if (this.event.kind === 'moon') this.world.gravScale = 1;
      this.broadcast({ t: 'ev', k: 'chaosEnd', kind: this.event.kind });
      this.event = null;
    }
    if (this.chaos >= 100 && !this.event && this.phaseEnds - t > 8000) this.triggerChaos();

    // scanner pulses catch anything that moves while the ring is over it
    for (const pulse of this.pulses) {
      const age = t - pulse.t0;
      if (age < CFG.PULSE_GRACE_MS) continue;
      const r = Math.min(CFG.PULSE_RADIUS, (age / 1000) * CFG.PULSE_SPEED);
      for (const p of this.players.values()) {
        if (p.team !== 'prop' || !p.alive || pulse.seen.has(p.id)) continue;
        if (Math.hypot(p.body.x - pulse.x, p.body.z - pulse.z) > r || t - p.lastMovedAt > 110) continue;
        pulse.seen.add(p.id);
        p.revealUntil = t + CFG.REVEAL_MS; p.ghostUntil = 0;
        const ev = { t: 'ev', k: 'reveal', who: p.id, ms: CFG.REVEAL_MS, x: r2(p.body.x), y: r2(p.body.y), z: r2(p.body.z) };
        this.broadcast(ev, (q) => q.team === 'hunter' || q === p || !q.alive);
      }
      for (const d of this.decoys) {
        if (pulse.seen.has(d.id) || d.hopUntil < t || Math.hypot(d.x - pulse.x, d.z - pulse.z) > r) continue;
        pulse.seen.add(d.id);
        this.broadcast({ t: 'ev', k: 'reveal', who: d.id, ms: CFG.REVEAL_MS, x: d.x, y: d.y, z: d.z }, (q) => q.team === 'hunter'); // looks exactly like a real prop's ping
      }
    }
    this.pulses = this.pulses.filter((p) => t - p.t0 < 1900);

    // last prop standing: a showdown, with a little help for the survivor
    this.roundProps = Math.max(this.roundProps, propsAlive + (this.firstDeath ? 1 : 0));
    if (propsAlive === 1 && !this.lastProp && this.roundProps >= 2) {
      this.lastProp = true;
      const last = [...this.players.values()].find((p) => p.team === 'prop' && p.alive)!;
      last.cd.ghost = t; last.cd.decoy = t; last.cdDirty = true; last.body.dashCd = 0;
      this.points(last, SCORE.lastProp, 'Last prop standing');
      this.nextRoll = Math.min(this.nextRoll, t + 9000);
      this.broadcast({ t: 'ev', k: 'last', who: last.id });
    }

    // head bonks: a prop that drops onto a hunter's head leaves them seeing stars
    for (const q of this.players.values()) {
      if (q.team !== 'prop' || !q.alive) continue;
      if (q.escapeAt && t >= q.escapeAt) { q.escapeAt = 0; q.stats.escapes++; this.points(q, SCORE.escape, 'Great escape!'); }
      if (q.body.vy > -1.5 || t < q.nextBonkAt) continue;
      for (const h of this.players.values()) {
        if (h.team !== 'hunter' || !h.alive || h.quackUntil > t || h.bonkUntil > t) continue;
        const top = h.body.y + CFG.HUNTER_H;
        if (q.body.y > top + 0.3 || q.body.y < top - 0.6 || Math.hypot(q.body.x - h.body.x, q.body.z - h.body.z) > h.body.hw + q.body.hw + 0.12) continue;
        h.bonkUntil = t + CFG.BONK_MS;
        q.nextBonkAt = t + CFG.BONK_CD; q.body.vy = 8.5; q.body.ground = false; q.stats.bonks++;
        this.points(q, SCORE.bonk, 'BONK!');
        this.chaos = Math.min(100, this.chaos + CFG.CHAOS_TAUNT);
        this.broadcast({ t: 'ev', k: 'bonk', who: q.id, on: h.id, x: r2(h.body.x), y: r2(top), z: r2(h.body.z) });
        break;
      }
    }

    // survival + nerve scoring
    for (const p of this.players.values()) {
      if (p.team !== 'prop' || !p.alive) continue;
      p.stats.pts += SCORE.survivePerSec * dt;
      let near = false;
      for (const h of this.players.values()) if (h.team === 'hunter' && h.alive && Math.hypot(h.body.x - p.body.x, h.body.z - p.body.z) < NEAR_RANGE && Math.abs(h.body.y - p.body.y) < 2.5) near = true;
      if (near) { p.stats.near += dt; p.stats.pts += SCORE.nearPerSec * dt; }
    }
  }

  /** Is prop `q` in hunter `h`'s view? Re-tested about ten times a second per pair, and sticky for a moment so nothing flickers at an edge. */
  private inView(h: Player, q: Player, t: number): boolean {
    let s = h.sight.get(q.id);
    if (!s) h.sight.set(q.id, (s = { until: 0, next: 0 }));
    if (t >= s.next) { s.next = t + 90; if (this.canSee(h, q, t)) s.until = t + 650; }
    return t < s.until;
  }

  /**
   * Conservative line of sight against walls and fixtures only (loose objects never hide anything from
   * this test). Rays run from the hunter's eye, now and a quarter of a second ahead, to nine points on
   * the prop. Erring towards "visible" costs nothing; a false "hidden" would make a prop pop into view.
   */
  private canSee(h: Player, q: Player, t: number): boolean {
    if (q.revealUntil > t) return true; // scanner pings show through walls by design
    return this.seesBox(h, q.body.x, q.body.y, q.body.z, q.body.vx, q.body.vz, PROPS[q.disguise]);
  }

  /** The sight test itself, for anything shaped like a prop: a player in disguise, or a decoy (which never moves). */
  private seesBox(h: Player, x: number, y: number, z: number, vx: number, vz: number, def: PropDef): boolean {
    const hb = h.body;
    const dx = x - hb.x, dz = z - hb.z, d2 = dx * dx + dz * dz;
    if (d2 < 12) return true; // within arm's reach of a corner
    const hw = Math.max(def.w, def.d) / 2 + 0.05, top = y + Math.max(0.15, def.h) - 0.03, mid = y + Math.max(0.15, def.h) / 2;
    const ey = hb.y + CFG.HUNTER_EYE;
    for (const lead of [0, 0.25]) {
      const ex = hb.x + hb.vx * lead, ez = hb.z + hb.vz * lead;
      if (lead && !this.world.sightClear(hb.x, ey, hb.z, ex, ey, ez)) continue; // the hunter cannot get there
      const qx = x + vx * lead, qz = z + vz * lead;
      if (this.world.sightClear(ex, ey, ez, qx, mid, qz) || this.world.sightClear(ex, ey, ez, qx, top, qz)) return true;
      for (const sx of [-hw, hw]) for (const sz of [-hw, hw]) {
        if (this.world.sightClear(ex, ey, ez, qx + sx, top, qz + sz) || this.world.sightClear(ex, ey, ez, qx + sx, y + 0.06, qz + sz)) return true;
      }
    }
    return false;
  }

  /** Has hunter `h` got decoy `d` in view? Tested a few times a second per pair, like players. */
  private decoyInView(h: Player, d: Decoy, t: number): boolean {
    let s = h.sight.get(d.id);
    if (!s) h.sight.set(d.id, (s = { until: 0, next: 0 }));
    if (t >= s.next) { s.next = t + 150; if (this.seesBox(h, d.x, d.y, d.z, 0, 0, PROPS[d.type])) s.until = t + 650; }
    return t < s.until;
  }

  /**
   * Stand a hunter down and hand the blaster to a bot (one that has already been caught, if there is one, so
   * nobody loses a hiding place). With no bot to take over and no other hunter, the round ends for the props.
   */
  private benchHunter(p: Player, idle: boolean) {
    p.team = 'spec'; p.alive = false; p.quackUntil = 0; p.bonkUntil = 0;
    let hiding = 0;
    for (const q of this.players.values()) if (q.team === 'prop' && q.alive) hiding++;
    // never the last prop still hiding: that would end the round on the spot
    const sub = [...this.players.values()].filter((q) => q.bot && q.team === 'prop' && (!q.alive || hiding > 1)).sort((a, b) => Number(a.alive) - Number(b.alive))[0];
    if (sub) {
      for (const d of this.decoys.filter((o) => o.owner === sub.id)) this.popDecoy(d, null);
      sub.playing = true; sub.hunterTurns++;
      this.spawnHunter(sub);
    }
    this.broadcast({ t: 'ev', k: 'sub', from: p.id, to: sub ? sub.id : 0 });
    if (idle) this.toast(p, 'You were idle, so a bot took over the hunt. You are back in next round.');
    this.rosterDirty = true;
  }

  private snapshot(t: number) {
    const rows: { p: Player; row: number[] }[] = [];
    const flagsOf = new Map<Player, number>();
    for (const p of this.players.values()) {
      if (!p.alive || p.team === 'spec') continue;
      let f = F.ALIVE;
      if (p.panicUntil > t) f |= F.PANIC;
      if (p.quackUntil > t) f |= F.QUACK;
      if (p.ghostUntil > t) f |= F.GHOST;
      if (p.body.dashLeft > 0) f |= F.DASH;
      if (p.revealUntil > t) f |= F.REVEAL;
      if (p.bonkUntil > t) f |= F.DIZZY;
      flagsOf.set(p, f);
      rows.push({ p, row: [p.id, r2(p.body.x), r2(p.body.y), r2(p.body.z), r2(p.facing), r2(p.pitch), f, p.team === 'prop' ? p.disguise : -1] });
    }
    const st = Math.round(t), ch = Math.round(this.chaos);
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) continue;
      const isHunter = p.team === 'hunter' && p.alive;
      const list: number[][] = [];
      for (const r of rows) {
        if (r.p === p) continue;
        // hunters get no data about props while blindfolded, nor about ghosted props,
        // nor about any prop they have no line of sight to (so a hacked client cannot see through walls)
        if (isHunter && r.p.team === 'prop') {
          if (this.phase === 'hiding' || r.p.ghostUntil > t) continue;
          if (this.phase === 'hunt' && !this.inView(p, r.p, t)) continue;
        }
        list.push(r.row);
      }
      // a decoy is first mentioned to a hunter when it comes into view; after that it is just an object that sits there
      if (isHunter && this.phase === 'hunt') for (const d of this.decoys) {
        if (p.knownDecoys.has(d.id) || !this.decoyInView(p, d, t)) continue;
        p.knownDecoys.add(d.id);
        this.send(p, { t: 'ev', k: 'decoy', ...this.decoyView(d, p) });
      }
      const b = p.body;
      const me = p.alive && p.team !== 'spec'
        ? [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.ground ? 1 : 0, b.dashLeft, b.dashCd, this.speedOf(p, t), this.jumpOf(p, t), p.hp, Math.round(p.focus), b.hw, b.h, this.world.gravScale, this.canMove(p) ? 1 : 0, flagsOf.get(p) ?? 0, b.air]
        : null;
      this.out(p, JSON.stringify({ t: 's', st, ack: p.ack, me, p: list, ch }), true);
      if (p.cdDirty) { p.cdDirty = false; this.send(p, { t: 'cd', ...p.cd }); }
    }
  }
}
