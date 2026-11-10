/** Tunable gameplay constants shared by server and client. */
export const CFG = {
  TICK: 20,
  MAX_PLAYERS: 12,

  HIDE_MS: 25_000,
  HUNT_MS: 180_000,
  END_MS: 13_000,
  PANIC_MS: 30_000,
  LOBBY_COUNTDOWN_MS: 8_000,

  GRAVITY: 22,
  STEP: 0.36,

  HUNTER_HW: 0.32,
  HUNTER_H: 1.75,
  HUNTER_EYE: 1.58,
  HUNTER_SPEED: 6.3,
  HUNTER_JUMP: 7.4,
  QUACK_SPEED: 3.4,

  PROP_SPEED: 5.5,
  PROP_JUMP: 7.8,
  PROP_HP: 100,

  DASH_TIME: 1.4,
  DASH_CD: 9,
  DASH_MUL: 1.75,

  FIRE_MS: 300,
  DMG: 34,
  RANGE: 60,
  PANIC_BURST_MS: 1800,
  PANIC_BURST_MUL: 1.5,
  PANIC_TIME_MUL: 1.2,

  FOCUS_MAX: 100,
  FOCUS_MISS: 8,
  FOCUS_DECOY: 16,
  FOCUS_HIT: 6,
  FOCUS_KILL: 30,
  FOCUS_REGEN: 3,
  QUACK_MS: 6000,

  CD_DECOY: 20_000,
  CD_GHOST: 35_000,
  CD_TAUNT: 4_000,
  CD_PULSE: 18_000,
  CD_SHOCK: 25_000,
  CD_TRANSFORM: 800,
  GHOST_MS: 3000,
  TRANSFORM_RANGE: 5,

  PULSE_RADIUS: 14,
  PULSE_SPEED: 10,
  PULSE_GRACE_MS: 450,
  REVEAL_MS: 4000,
  SHOCK_RADIUS: 4.5,

  ROLLCALL_MS: 30_000,
  ROLLCALL_PANIC_MS: 7_000,

  CHAOS_MISS: 7,
  CHAOS_TAUNT: 4,
  CHAOS_DECOY: 12,
  CHAOS_PASSIVE: 0.45,
  BLACKOUT_MS: 14_000,
  POLTERGEIST_MS: 12_000,
  MOON_MS: 12_000,
};

export type Phase = 'lobby' | 'hiding' | 'hunt' | 'end';
export type Team = 'prop' | 'hunter' | 'spec';

/** Entity flag bits used in snapshots. */
export const F = { ALIVE: 1, PANIC: 2, QUACK: 4, GHOST: 8, DASH: 16, REVEAL: 32 };

export const TAUNTS = ['Squeak', 'Honk', 'Boing', 'Raspberry', 'Quack'];

export const QUICK_CHAT = [
  'Nothing to see here.',
  'I am a totally normal object.',
  'Over here! (not really)',
  'That was TOO close.',
  'Nice shot!',
  'You shot a chair. Proud?',
  'gg',
  'One more round!',
];
