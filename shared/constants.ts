/** Tunable gameplay constants shared by server and client. */
export const CFG = {
  TICK: 20,
  MAX_PLAYERS: 12,

  HIDE_MS: 25_000,
  HUNT_MS: 180_000,
  END_MS: 13_000,
  /** The final standings after the last round of a game stay up a little longer. */
  FINAL_MS: 20_000,
  PANIC_MS: 30_000,
  LOBBY_COUNTDOWN_MS: 8_000,
  /** Someone joining a hunt with less than this left sits it out as a ghost; with more, they play it as a prop. */
  LATE_JOIN_MS: 45_000,

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
  FOCUS_MISS: 6,
  FOCUS_DECOY: 16,
  FOCUS_HIT: 6,
  FOCUS_KILL: 30,
  FOCUS_REGEN: 3,
  QUACK_MS: 6000,

  CD_DECOY: 20_000,
  CD_GHOST: 35_000,
  CD_TAUNT: 4_000,
  CD_PULSE: 14_000,
  CD_SHOCK: 25_000,
  CD_TRANSFORM: 800,
  GHOST_MS: 3000,
  TRANSFORM_RANGE: 5,

  PULSE_RADIUS: 14,
  PULSE_SPEED: 10,
  PULSE_GRACE_MS: 450,
  REVEAL_MS: 4000,
  SHOCK_RADIUS: 4.5,

  BONK_MS: 1700,
  BONK_CD: 12_000,
  ESCAPE_MS: 6000,
  COYOTE: 0.1,
  ROLLCALL_LAST_MS: 15_000,

  ROLLCALL_MS: 22_000,
  ROLLCALL_PANIC_MS: 7_000,

  CHAOS_MISS: 7,
  CHAOS_TAUNT: 4,
  CHAOS_DECOY: 12,
  CHAOS_PASSIVE: 0.45,
  BLACKOUT_MS: 14_000,
  POLTERGEIST_MS: 12_000,
  MOON_MS: 12_000,

  // ---- 2.5: haunting. Caught props (and late joiners sitting a round out) rattle innocent objects to bait hunters.
  /** Master switch. Off: caught props only watch, exactly as in 2.4. */
  HAUNT_ON: true,
  /** Time between one ghost's haunts. */
  CD_HAUNT: 7_000,
  /** How long a haunted object stays "hot": a hunter who shoots it in this window has been spooked. */
  HAUNT_BAIT_MS: 9_000,
  /** Chaos added by every haunt, and by a hunter falling for one. */
  CHAOS_HAUNT: 3,
  CHAOS_SPOOK: 8,
  /** Focus a spooked hunter loses (an ordinary innocent object costs FOCUS_MISS). */
  FOCUS_SPOOK: 10,
  /** While the Poltergeist chaos event runs, ghosts haunt this much faster. */
  HAUNT_FRENZY: 0.35,
  /** Bots that have been caught haunt something near a hunter this often (ms, min and max). */
  HAUNT_BOT_MS: [14_000, 30_000],
  /** Chance that a bot hunter who sees an object being haunted shoots it. */
  HAUNT_BOT_FOOLED: 0.35,

  // ---- 2.5: room preview. While the props hide, hunters fly a camera around the room as it was stocked,
  // with no props in it, instead of staring at a blindfold. Anything that appears later is a fake.
  /** Master switch. Off: the 2.4 blindfold. */
  PREVIEW_ON: true,
  /** How fast the preview camera (and a ghost) flies, m/s. */
  FLY_SPEED: 10,

  // ---- 2.5: a hunter who drops out or goes idle hands the job to a bot, so one absent player cannot waste a round
  HUNTER_DC_MS: 12_000,
  HUNTER_AFK_MS: 45_000,

  // ---- 2.5: presentation timings (client only)
  /** The beat between the last second of a round and the results panel, while the survivors are shown off. */
  REVEAL_BEAT_MS: 3_000,
  ROLE_CARD_MS: 2_800,
};

/**
 * Every score in the game, in one place. Points decide the round board, the game standings and the coin payout,
 * so these are the first numbers to tune once real players have been watched (see docs/PLAYTEST.md).
 */
export const SCORE = {
  // hunters
  hit: 20,
  catch: 150,
  innocent: -5,
  sweep: 100, // every prop caught
  // props
  survivePerSec: 1,
  nearPerSec: 4, // extra, while within NEAR_RANGE of a hunter
  survived: 150,
  teamWin: 40, // caught, but the props still won
  tauntMin: 10,
  tauntMax: 50, // right next to a hunter; falls off to tauntMin at TAUNT_RANGE
  escape: 40,
  bonk: 50,
  bamboozle: 60, // a hunter shot your decoy
  lastProp: 50,
  // ghosts
  spook: 35, // a hunter shot an object you haunted
};
export const NEAR_RANGE = 4;
export const TAUNT_RANGE = 14;

/** Relative odds of each chaos event; 0 removes one from the draw. The same event never runs twice in a row. */
export const CHAOS_WEIGHTS: Record<string, number> = { blackout: 1, poltergeist: 1, shuffle: 1, moon: 1, sneeze: 1 };

/** A game is a set of rounds; scores run for the whole game. Private hosts choose from ROUND_CHOICES. */
export const ROUNDS_DEFAULT = 3;
export const ROUND_CHOICES = [1, 3, 5, 7, 10];

/**
 * Coins: the soft currency for cosmetics. The server works out every award and sends it with the results.
 * A round pays `round` for taking part, plus 1 per `perPoints` points scored (up to `roundCap` in all),
 * plus `win` for being on the winning side. The last round of a game adds `game` for seeing it through
 * and `place` for the podium (never for last place).
 */
export const COINS = { round: 5, perPoints: 20, roundCap: 40, win: 10, game: 15, place: [30, 20, 10] };

export type Phase = 'lobby' | 'hiding' | 'hunt' | 'end';
export type Team = 'prop' | 'hunter' | 'spec';

/** Entity flag bits used in snapshots. */
export const F = { ALIVE: 1, PANIC: 2, QUACK: 4, GHOST: 8, DASH: 16, REVEAL: 32, DIZZY: 64 };

/** Hunter cosmetics. A player's look is colour * 8 + hat. Hats unlock with player level (client-side, cosmetic only). */
export const HUNTER_COLORS = [0xff6b35, 0x2ec4b6, 0xef476f, 0x9b5de5, 0xffd166, 0x118ab2, 0x06d6a0, 0x495057];
export const HATS = ['Cap', 'Hard Hat', 'Party Hat', 'Propeller', 'Top Hat', 'Crown'];
export const HAT_LEVEL = [1, 1, 2, 3, 5, 8];
export const xpLevel = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 150)) + 1;
export const levelXp = (level: number) => (level - 1) * (level - 1) * 150;

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
