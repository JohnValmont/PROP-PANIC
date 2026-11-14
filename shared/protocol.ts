/**
 * Wire protocol (JSON over WebSocket). Messages are small objects tagged with `t`.
 * High-frequency messages use positional arrays to keep packets compact.
 */
import type { Phase, Team } from './constants';
import type { Profile, Report, RoundStats, WireKit } from './progress';

// ------------------------------------------------------------------ client -> server
export type ClientMsg =
  /** `kit` is what the player wears ([paint, hat, eyes, pop, title], see shared/progress.ts) and `lvl` their level. */
  /** `pass`: a seat the line reserved for this browser (see the 'ready' message and server/gate.ts). */
  /**
   * `auth`: a signed-in player's access token (server/accounts.ts). The server then takes the kit and level from the
   * profile it keeps rather than from `kit` and `lvl`, and banks every round into it. Without it the player is a guest.
   */
  | { t: 'hello'; name: string; mode: 'quick' | 'create' | 'join'; code?: string; token?: string; kit?: WireKit; lvl?: number; /** anonymous browser id, for the admin statistics only */ aid?: string; pass?: string; auth?: string }
  /** Someone waiting in line gives up their place. */
  | { t: 'leave' }
  /** Batched movement commands: [seq, dt, mx, mz, yaw, pitch, buttons, facing]. buttons: 1 jump, 2 dash. */
  | { t: 'in'; c: number[][] }
  /** Fire the blaster. rt = server time the shooter was rendering other players at (lag compensation). */
  | { t: 'fire'; yaw: number; pitch: number; rt: number }
  | { t: 'tf'; d: number } // transform into decor id
  | { t: 'ab'; k: 'decoy' | 'ghost' | 'pulse' | 'shock' }
  /** A ghost (caught prop, or a late joiner sitting the round out) rattles innocent object `d`. */
  | { t: 'haunt'; d: number }
  | { t: 'taunt'; i: number }
  | { t: 'chat'; i: number }
  | { t: 'start' }
  | { t: 'bots'; n: number }
  | { t: 'map'; m: number }
  /** Host of a private room: how many rounds the next game runs for (one of ROUND_CHOICES). */
  | { t: 'rounds'; n: number }
  | { t: 'ping'; c: number };

// ------------------------------------------------------------------ server -> client
export interface RosterEntry {
  id: number; name: string; team: Team; alive: boolean; bot: boolean; host: boolean;
  score: number; disguise: number; conn: boolean;
  /** Cosmetics: [paint, hat, eyes, pop, title] (shared/progress.ts). */
  kit: WireKit;
  /** Player level as the player's browser reports it; 0 for bots. */
  lvl: number;
  /** Round-trip time in ms (0 for bots). */
  ping: number;
  /** Hunter currently serving time as a rubber duck. */
  quack: boolean;
}

export interface Award { title: string; name: string; detail: string; }

export interface Results {
  winner: 'props' | 'hunters';
  awards: Award[];
  /** `coins` is what this round paid the player. */
  board: { id: number; name: string; team: Team; round: number; total: number; survived: boolean; coins: number; st: RoundStats }[];
  /** Counts every round the room has played, so a client can bank its rewards exactly once. */
  n: number;
  round: number; rounds: number;
  /** Only after the last round of a game: the final standings, best first. `coins` is the end-of-game bonus. */
  final?: { id: number; name: string; total: number; coins: number; bot: boolean }[];
}

export interface PhaseMsg {
  t: 'phase'; phase: Phase; ends: number; round: number; rounds: number; seed: number; map: number; next: number; results?: Results;
}

export interface WelcomeMsg {
  /** `acct`: 1 when this seat belongs to a signed-in player whose rounds the server banks into their account. */
  t: 'welcome'; id: number; token: string; code: string; pub: boolean; now: number; acct?: 0 | 1;
}

/** Entity row: [id, x, y, z, facing, pitch, flags] */
export type EntRow = number[];

export interface SnapMsg {
  t: 's';
  st: number; // server time
  ack: number;
  /** [x,y,z,vx,vy,vz,ground,dashLeft,dashCd,speed,jumpV,hp,focus,hw,h,grav,canMove,flags] */
  me: number[] | null;
  p: EntRow[];
  ch: number; // chaos 0..100
}

/** One-shot game events. */
export type EvMsg =
  /** hit: 0 nothing, 1 wall, 2 innocent object, 3 prop, 4 decoy. `hp` is what a hit prop has left; `sp` marks a haunted object. */
  | { t: 'ev'; k: 'shot'; by: number; x: number; y: number; z: number; hit: 0 | 1 | 2 | 3 | 4; tg: number; hp?: number; sp?: 1 }
  | { t: 'ev'; k: 'kill'; by: number; who: number; ty: number; x: number; y: number; z: number }
  | { t: 'ev'; k: 'taunt'; who: number; i: number; x: number; y: number; z: number; pts: number }
  | { t: 'ev'; k: 'roll'; pts: number[][] }
  | { t: 'ev'; k: 'poof'; x: number; y: number; z: number }
  | { t: 'ev'; k: 'pulse'; by: number; x: number; z: number }
  | { t: 'ev'; k: 'shock'; by: number; x: number; y: number; z: number }
  /** `owner` is 0 for hunters: who planted a decoy is the props' business. */
  | { t: 'ev'; k: 'decoy'; id: number; type: number; x: number; y: number; z: number; yaw: number; owner: number }
  | { t: 'ev'; k: 'decoyHop'; id: number }
  | { t: 'ev'; k: 'decoyPop'; id: number; by: number }
  | { t: 'ev'; k: 'quack'; who: number; on: boolean }
  | { t: 'ev'; k: 'blind'; ms: number }
  | { t: 'ev'; k: 'chaos'; kind: 'blackout' | 'poltergeist' | 'shuffle' | 'moon'; ms: number; seed: number }
  | { t: 'ev'; k: 'chaosEnd'; kind: string }
  | { t: 'ev'; k: 'panic' }
  | { t: 'ev'; k: 'reveal'; who: number; ms: number; x: number; y: number; z: number }
  | { t: 'ev'; k: 'bonk'; who: number; on: number; x: number; y: number; z: number }
  | { t: 'ev'; k: 'last'; who: number }
  | { t: 'ev'; k: 'sneeze'; pts: number[][] }
  /** Ghost `by` rattled innocent object `d`. */
  | { t: 'ev'; k: 'haunt'; d: number; by: number }
  /** Hunter `by` shot object `d` while it was haunted by `ghost`. */
  | { t: 'ev'; k: 'spook'; d: number; by: number; ghost: number; x: number; y: number; z: number }
  /** A hunter dropped out or went idle: bot `to` (0 if there was none) has taken over from `from`. */
  | { t: 'ev'; k: 'sub'; from: number; to: number }
  | { t: 'ev'; k: 'hurt'; hp: number }
  | { t: 'ev'; k: 'chat'; who: number; i: number }
  | { t: 'ev'; k: 'pts'; n: number; why: string }
  | { t: 'ev'; k: 'toast'; msg: string };

export type ServerMsg =
  | WelcomeMsg
  | PhaseMsg
  | SnapMsg
  | EvMsg
  | { t: 'roster'; p: RosterEntry[] }
  | { t: 'cd'; decoy: number; ghost: number; taunt: number; pulse: number; shock: number; haunt: number }
  | { t: 'decoys'; d: { id: number; type: number; x: number; y: number; z: number; yaw: number; owner: number }[] }
  | { t: 'lobby'; bots: number; countdown: number; canStart: boolean; map: number; rounds: number }
  | { t: 'pong'; c: number; now: number }
  /** A signed-in player's round was banked into their account: the profile as the server now has it, and what changed. */
  | { t: 'acct'; p: Profile; rep: Report }
  /**
   * The server is full and this connection is waiting in line (server/gate.ts). Sent again whenever the position
   * changes. `eta` is a guess in seconds (0 = not enough history to guess); `hot` = the load brake is on.
   */
  | { t: 'line'; pos: number; size: number; eta: number; used: number; seats: number; hot: 0 | 1 }
  /** A seat is held for this person for `ms`: connect again with this pass in the hello to take it. */
  | { t: 'ready'; pass: string; ms: number }
  /** The pass ran out unused; the place in line is gone. */
  | { t: 'missed' }
  | { t: 'err'; msg: string };
