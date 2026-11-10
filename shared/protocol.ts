/**
 * Wire protocol (JSON over WebSocket). Messages are small objects tagged with `t`.
 * High-frequency messages use positional arrays to keep packets compact.
 */
import type { Phase, Team } from './constants';

// ------------------------------------------------------------------ client -> server
export type ClientMsg =
  | { t: 'hello'; name: string; mode: 'quick' | 'create' | 'join'; code?: string; token?: string }
  /** Batched movement commands: [seq, dt, mx, mz, yaw, pitch, buttons, facing]. buttons: 1 jump, 2 dash. */
  | { t: 'in'; c: number[][] }
  /** Fire the blaster. rt = server time the shooter was rendering other players at (lag compensation). */
  | { t: 'fire'; yaw: number; pitch: number; rt: number }
  | { t: 'tf'; d: number } // transform into decor id
  | { t: 'ab'; k: 'decoy' | 'ghost' | 'pulse' | 'shock' }
  | { t: 'taunt'; i: number }
  | { t: 'chat'; i: number }
  | { t: 'start' }
  | { t: 'bots'; n: number }
  | { t: 'ping'; c: number };

// ------------------------------------------------------------------ server -> client
export interface RosterEntry {
  id: number; name: string; team: Team; alive: boolean; bot: boolean; host: boolean;
  score: number; disguise: number; conn: boolean;
}

export interface Award { title: string; name: string; detail: string; }

export interface Results {
  winner: 'props' | 'hunters';
  awards: Award[];
  board: { id: number; name: string; team: Team; round: number; total: number; survived: boolean }[];
}

export interface PhaseMsg {
  t: 'phase'; phase: Phase; ends: number; round: number; seed: number; results?: Results; countdown?: number;
}

export interface WelcomeMsg {
  t: 'welcome'; id: number; token: string; code: string; pub: boolean; now: number;
}

/** Entity row: [id, x, y, z, facing, pitch, flags] */
export type EntRow = number[];

export interface SnapMsg {
  t: 's';
  st: number; // server time
  ack: number;
  /** [x,y,z,vx,vy,vz,ground,dashLeft,dashCd,speedMul,hp,focus,hw,h,grav] */
  me: number[] | null;
  p: EntRow[];
  ch: number; // chaos 0..100
}

/** One-shot game events. */
export type EvMsg =
  | { t: 'ev'; k: 'shot'; by: number; x: number; y: number; z: number; hit: 0 | 1 | 2 | 3 | 4; tg: number }
  | { t: 'ev'; k: 'kill'; by: number; who: number; x: number; y: number; z: number }
  | { t: 'ev'; k: 'taunt'; who: number; i: number; x: number; y: number; z: number; pts: number }
  | { t: 'ev'; k: 'roll'; pts: number[][] }
  | { t: 'ev'; k: 'poof'; x: number; y: number; z: number }
  | { t: 'ev'; k: 'pulse'; by: number; x: number; z: number }
  | { t: 'ev'; k: 'shock'; by: number; x: number; y: number; z: number }
  | { t: 'ev'; k: 'decoy'; id: number; type: number; x: number; y: number; z: number; yaw: number; owner: number }
  | { t: 'ev'; k: 'decoyHop'; id: number }
  | { t: 'ev'; k: 'decoyPop'; id: number; by: number }
  | { t: 'ev'; k: 'quack'; who: number; on: boolean }
  | { t: 'ev'; k: 'blind'; ms: number }
  | { t: 'ev'; k: 'chaos'; kind: 'blackout' | 'poltergeist' | 'shuffle' | 'moon'; ms: number; seed: number }
  | { t: 'ev'; k: 'chaosEnd'; kind: string }
  | { t: 'ev'; k: 'panic' }
  | { t: 'ev'; k: 'reveal'; who: number; ms: number; decoy?: boolean; x: number; y: number; z: number }
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
  | { t: 'cd'; decoy: number; ghost: number; taunt: number; pulse: number; shock: number }
  | { t: 'decoys'; d: { id: number; type: number; x: number; y: number; z: number; yaw: number; owner: number }[] }
  | { t: 'lobby'; bots: number; countdown: number; canStart: boolean }
  | { t: 'pong'; c: number; now: number }
  | { t: 'err'; msg: string };
