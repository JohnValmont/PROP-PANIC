/**
 * Progression: level and rank, coins and the wardrobe, the Catalogue, feats (wearable titles) and odd jobs.
 *
 * Everything here is plain data and pure functions. The client banks each round with `bankRound` and keeps
 * the profile in the browser; the server only validates what a player wears (`cleanKit`). Keeping the rules
 * in one shared, side-effect-free module means they can move behind a login on the server later without a
 * rewrite, and that `test/progress.ts` can check them directly.
 *
 * The one-line pitch, as the profile screen tells it:
 *   play rounds → XP raises your level and price tag; coins buy looks in the wardrobe;
 *   the Catalogue stamps every object you hide as and every one you catch; feats earn titles;
 *   three odd jobs a day pay extra.
 */
import { PROPS } from './props';
import { rng } from './rng';

// ============================================================================ level and rank

/**
 * XP from level n to n+1 grows by 300 a level up to level 10, then stays at 3,000 (about four games).
 * Up to level 11 this is exactly the 2.4 curve, so nobody's level drops on upgrade.
 */
export const levelStep = (n: number) => Math.min(3000, 150 * (2 * n - 1));
const CAP_LEVEL = 11, CAP_XP = 150 * (CAP_LEVEL - 1) * (CAP_LEVEL - 1); // 15,000
export const levelXp = (level: number) => level <= CAP_LEVEL ? 150 * (level - 1) * (level - 1) : CAP_XP + 3000 * (level - CAP_LEVEL);
export function xpLevel(xp: number): number {
  const x = Math.max(0, xp);
  return x < CAP_XP ? Math.floor(Math.sqrt(x / 150)) + 1 : CAP_LEVEL + Math.floor((x - CAP_XP) / 3000);
}
/** Coins paid on reaching a level. */
export const levelCoins = (level: number) => Math.min(150, 20 + 5 * level);

/** Your price tag: what Tumbleton's Emporium would ask for you. A new name every few levels. */
export const RANKS: [from: number, name: string][] = [
  [1, 'Bargain Bin'], [5, 'Knick-Knack'], [10, 'Curio'], [15, 'Collectible'], [20, 'Antique'], [30, 'Heirloom'], [40, 'Priceless'],
];
export function rankOf(level: number): { name: string; next: string; nextAt: number } {
  let i = 0;
  while (i + 1 < RANKS.length && level >= RANKS[i + 1][0]) i++;
  const nx = RANKS[i + 1];
  return { name: RANKS[i][1], next: nx ? nx[1] : '', nextAt: nx ? nx[0] : 0 };
}

// ============================================================================ cosmetics

/**
 * Seven slots, none of which can give a hiding prop away or change how a round plays:
 * - the hunter's look (the Characters tab and the Hunter locker): character, blaster, zap trail, hat and
 *   paint. A hunter is in plain view anyway, and every blaster fires the same shot with the same rules;
 * - the prop's (the Prop wardrobe): eyes, the googly eyes that pop out of a prop only when it has already
 *   given itself away (taunt, panic, scanner), and pop, the burst when you are caught.
 */
export type Slot = 'char' | 'gun' | 'trail' | 'paint' | 'hat' | 'eyes' | 'pop';
export type Unlock = { free: true } | { level: number } | { price: number } | { feat: string };
export interface Item { id: string; name: string; slot: Slot; how: Unlock; }
export interface Paint extends Item { hex: number; metal: number; rough: number; iri?: number; }
export interface Pop extends Item { colors: number[]; n: number; speed: number; up: number; size: number; life: number; grav: number; }
/** Rarity is only a label (and a frame colour): it changes nothing in play. */
export type Tier = 'common' | 'rare' | 'epic' | 'legendary';
export interface Char extends Item { tier: Tier; blurb: string; }
/** `two`: held in both hands. `flash`: muzzle flash colour. `sfx`: an extra local sound on your own shot (everyone still hears the same zap). */
export interface Gun extends Item { tier: Tier; blurb: string; two?: boolean; flash: number; sfx?: string; }
/** A zap trail: the tracer colours (cycled shot to shot) and, optionally, sparks left along the line. */
export interface Trail extends Item { colors: number[]; spark?: number[]; width: number; }

const free = { free: true } as const;
const lv = (level: number) => ({ level });
const buy = (price: number) => ({ price });
const feat = (id: string) => ({ feat: id });

/** Wire order matters: a kit is sent as indices into these lists, so only ever append. */
export const PAINTS: Paint[] = ([
  ['tangerine', 'Tangerine', 0xff6b35], ['teal', 'Teal', 0x2ec4b6], ['watermelon', 'Watermelon', 0xef476f], ['grape', 'Grape', 0x9b5de5],
  ['sunflower', 'Sunflower', 0xffd166], ['ocean', 'Ocean', 0x118ab2], ['mint', 'Mint', 0x06d6a0], ['graphite', 'Graphite', 0x495057],
] as const).map(([id, name, hex]) => ({ id: `paint.${id}`, name, slot: 'paint' as const, how: free, hex, metal: 0.08, rough: 0.36 }));
PAINTS.push(
  { id: 'paint.pearl', name: 'Pearl', slot: 'paint', how: lv(10), hex: 0xf4efe6, metal: 0.1, rough: 0.22, iri: 0.7 },
  { id: 'paint.midnight', name: 'Midnight', slot: 'paint', how: buy(500), hex: 0x171b30, metal: 0.3, rough: 0.5 },
  { id: 'paint.chrome', name: 'Chrome', slot: 'paint', how: buy(800), hex: 0xdfe3e8, metal: 1, rough: 0.08 },
  { id: 'paint.opal', name: 'Opal', slot: 'paint', how: lv(30), hex: 0xc6e6ff, metal: 0.15, rough: 0.18, iri: 1 },
  { id: 'paint.gilded', name: 'Gilded', slot: 'paint', how: feat('heir'), hex: 0xffc64a, metal: 1, rough: 0.2 },
);

export const HATS: Item[] = ([
  ['cap', 'Cap', free], ['hardhat', 'Hard Hat', free], ['party', 'Party Hat', lv(2)], ['propeller', 'Propeller', lv(3)],
  ['tophat', 'Top Hat', lv(5)], ['crown', 'Crown', lv(20)], ['beanie', 'Beanie', buy(150)], ['cone', 'Traffic Cone', buy(250)],
  ['chef', "Chef's Hat", buy(400)], ['cowboy', 'Cowboy Hat', buy(600)], ['wizard', 'Wizard Hat', buy(900)], ['viking', 'Viking Helmet', buy(1200)],
  ['lampshade', 'Lampshade', feat('interior')], ['duck', 'Duck Hat', feat('quack')], ['halo', 'Halo', feat('poltergeist')],
] as [string, string, Unlock][]).map(([id, name, how]) => ({ id: `hat.${id}`, name, slot: 'hat' as const, how }));

export const EYES: Item[] = ([
  ['classic', 'Classic', free], ['wide', 'Wide', lv(4)], ['beady', 'Beady', buy(150)], ['angry', 'Angry', buy(300)],
  ['sleepy', 'Sleepy', buy(300)], ['lashes', 'Lashes', buy(450)], ['love', 'Lovestruck', buy(500)], ['shades', 'Shades', buy(700)],
  ['cyclops', 'Cyclops', buy(900)], ['monocle', 'Monocle', feat('antiquarian')],
] as [string, string, Unlock][]).map(([id, name, how]) => ({ id: `eyes.${id}`, name, slot: 'eyes' as const, how }));

const CONFETTI = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf78c2b, 0xffffff];
export const POPS: Pop[] = ([
  // id, name, unlock, colours, count, speed, up, size, life, gravity
  ['confetti', 'Confetti', free, CONFETTI, 70, 6, 7, 1.3, 1.7, 12],
  ['feathers', 'Feathers', lv(7), [0xffffff, 0xf3efe6, 0xe6dccb], 45, 2.4, 3, 1.3, 2.8, 2.2],
  ['bubbles', 'Bubbles', buy(350), [0xbfe9ff, 0x8fd3ff, 0xe8f8ff], 50, 2, 2, 1.4, 2.4, -1.6],
  ['coins', 'Coin Shower', buy(600), [0xffd166, 0xffc64a, 0xe09f1f], 55, 3.5, 7, 1, 1.7, 14],
  ['glitter', 'Glitter', buy(1000), [0xffd6f5, 0xffffff, 0xffe08a, 0xc8b6ff], 120, 5, 4, 0.5, 1.7, 6],
  ['rainbow', 'Rainbow', lv(15), [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93], 85, 5, 6, 1.1, 1.7, 10],
  ['leaves', 'Leaves', feat('greenthumb'), [0x6a994e, 0xa7c957, 0xf4a259, 0xbc4b51], 50, 2.6, 3.4, 1.2, 2.6, 3],
  ['sparks', 'Sparks', feat('gadgeteer'), [0xbffcff, 0x5ce1ff, 0xffffff], 80, 8, 4, 0.55, 0.8, 16],
  ['sawdust', 'Sawdust', feat('stocktaker'), [0xd4a373, 0xe9c46a, 0xa47148], 70, 3.4, 4, 0.75, 1.4, 12],
] as [string, string, Unlock, number[], number, number, number, number, number, number][])
  .map(([id, name, how, colors, n, speed, up, size, life, grav]) => ({ id: `pop.${id}`, name, slot: 'pop' as const, how, colors, n, speed, up, size, life, grav }));

/** Hunter characters. Index 0 is what an older client (which sends no character) shows as. */
export const CHARS: Char[] = ([
  ['guard', 'Night Guard', free, 'common', 'Twelve years on the night shift. Has never once found the gnome.'],
  ['robot', 'Securibot 3000', free, 'common', 'The original. Runs on batteries and suspicion.'],
  ['granny', 'Granny Tumbleton', lv(6), 'rare', 'Founded the Emporium in 1952. Knows exactly where everything should be.'],
  ['janitor', 'The Janitor', buy(800), 'rare', 'Has mopped every aisle. Notices when a bucket is one bucket too many.'],
  ['exterminator', 'Pest Control', buy(1500), 'epic', 'Was called about a rodent. Found a chair with legs that move.'],
  ['detective', 'Inspector Gumshoe', buy(2000), 'epic', 'Follows the clues. The clues are usually a lamp.'],
  ['agent', 'Agent Zero', feat('bloodhound'), 'epic', 'Classified. The sunglasses stay on. Indoors. At night.'],
  ['santa', 'Mall Santa', buy(2500), 'legendary', 'Has a list. Is checking it twice. You are on it.'],
  ['mascot', 'Barnaby Bear', buy(4000), 'legendary', 'The store mascot. Nobody knows who is inside. Nobody asks.'],
] as [string, string, Unlock, Tier, string][]).map(([id, name, how, tier, blurb]) => ({ id: `char.${id}`, name, slot: 'char' as const, how, tier, blurb }));

/** Blasters. All of them fire the same shot: the look, the flash and a little extra sound are the only difference. */
export const GUNS: Gun[] = ([
  // id, name, unlock, tier, blurb, flash, two-handed, extra sound
  ['zapper', 'Zapper', free, 'common', 'Standard issue. Reliable. Beige.', 0xffe08a],
  ['soaker', 'Super Soaker', lv(2), 'common', 'Pressurised. Mostly with confidence.', 0x9ad8ff, true, 'pop'],
  ['plunger', 'Plunger Popper', lv(4), 'common', 'Fires suction. Unclogs mysteries.', 0xffb46b, false, 'pop'],
  ['banana', 'Banana', buy(300), 'rare', 'Point it like you mean it.', 0xfff27a],
  ['dryer', 'Hair Dryer', buy(500), 'rare', 'Hot air, aimed at furniture.', 0xff9ad5, false, 'dash'],
  ['baguette', 'Baguette', buy(650), 'rare', 'Day-old. Rock hard. Very French.', 0xffd08a],
  ['raygun', 'Retro Raygun', buy(800), 'epic', 'Straight out of a 1950s comic book.', 0x8affc1],
  ['duck', 'Duck Cannon', buy(1100), 'epic', 'The duck is load-bearing.', 0xffe14d, true, 'squeak'],
  ['blower', 'Leaf Blower', buy(1300), 'epic', 'For leaves. And for people pretending to be leaves.', 0xc8ffb0, true, 'dash'],
  ['fish', 'Wet Fish', buy(1600), 'epic', 'Slippery. Smells like the stock room.', 0x9ae6ff, false, 'squeak'],
  ['remote', 'TV Remote', feat('sharpshooter'), 'epic', 'Pause. Rewind. Caught.', 0xff6b6b],
  ['fingers', 'Finger Guns', buy(2500), 'legendary', 'Pew pew. No blaster required.', 0xffffff],
  ['golden', 'Golden Zapper', feat('champion'), 'legendary', 'Awarded to champions. Polished nightly.', 0xffd166],
] as [string, string, Unlock, Tier, string, number, boolean?, string?][]).map(([id, name, how, tier, blurb, flash, two, sfx]) => ({ id: `gun.${id}`, name, slot: 'gun' as const, how, tier, blurb, flash, two, sfx }));

export const TRAILS: Trail[] = ([
  ['zap', 'Zap', free, [0xfff27a], undefined, 1],
  ['laser', 'Laser Red', lv(3), [0xff3b3b], undefined, 0.75],
  ['plasma', 'Plasma Blue', buy(250), [0x4fd6ff], [0xbff4ff], 1.2],
  ['toxic', 'Toxic Green', buy(350), [0x7dff4f], [0xc6ff8a, 0x4caf50], 1.2],
  ['bubbles', 'Bubbles', buy(500), [0xbfe9ff], [0xbfe9ff, 0xe8f8ff, 0x8fd3ff], 0.8],
  ['confetti', 'Confetti', buy(700), [0xffffff], CONFETTI, 0.8],
  ['rainbow', 'Rainbow', lv(12), [0xff595e, 0xffca3a, 0x8ac926, 0x1982c4, 0x6a4c93], undefined, 1.1],
  ['gold', 'Gold Rush', feat('collector'), [0xffd166], [0xffc64a, 0xfff3b0], 1.1],
] as [string, string, Unlock, number[], number[] | undefined, number][]).map(([id, name, how, colors, spark, width]) => ({ id: `trail.${id}`, name, slot: 'trail' as const, how, colors, spark, width }));

export const SLOTS: Record<Slot, Item[]> = { char: CHARS, gun: GUNS, trail: TRAILS, paint: PAINTS, hat: HATS, eyes: EYES, pop: POPS };
/** Slot order in the kit; the wire kit is [paint, hat, eyes, pop, title, char, gun, trail]. */
const KIT_SLOTS: Slot[] = ['char', 'gun', 'trail', 'paint', 'hat', 'eyes', 'pop'];
export const ITEMS: Record<string, Item> = {};
for (const list of Object.values(SLOTS)) for (const it of list) ITEMS[it.id] = it;

// ============================================================================ the Catalogue

/** Every disguise belongs to one department of the Emporium. Together they hold all 66 objects exactly once. */
export const DEPARTMENTS: { id: string; name: string; feat: string; props: string[] }[] = [
  { id: 'furniture', name: 'Furniture', feat: 'interior', props: ['stool', 'chair', 'schoolchair', 'monobloc', 'armchair', 'ottoman', 'pillows', 'nightstand', 'sidetable', 'cabinet', 'bench', 'clock'] },
  { id: 'ornaments', name: 'Ornaments', feat: 'antiquarian', props: ['vase', 'urn', 'brassvase', 'pot', 'bust', 'horse', 'cat', 'gnome', 'oillamp', 'lantern', 'chest'] },
  { id: 'novelties', name: 'Novelties', feat: 'gadgeteer', props: ['duck', 'football', 'croissant', 'alarmclock', 'megaphone', 'boombox', 'tv', 'register', 'chalkboard'] },
  { id: 'stockroom', name: 'Stock Room', feat: 'stocktaker', props: ['barrel', 'winebarrel', 'oildrum', 'crate', 'box', 'plasticcrate', 'cooler', 'jerrycan', 'propane', 'extinguisher', 'sign', 'toolchest', 'handtruck', 'trashbag', 'cement', 'tyre', 'bucket'] },
  { id: 'garden', name: 'Garden', feat: 'greenthumb', props: ['plant', 'tallplant', 'fern', 'planter', 'claypot', 'rock', 'stone', 'stump', 'log', 'watercan', 'tub', 'hydrant', 'compost', 'lifebuoy', 'hamper', 'boots', 'basket'] },
];
/** Two stamps per object: HID (survive a round disguised as it) and CAUGHT (catch a prop disguised as it). */
export const STAMP_SIDES = ['Hid', 'Caught'] as const;
export const STAMPS_MAX = PROPS.length * 2;
/** A stamp turns bronze, silver and gold at these counts. */
export const GRADES = [1, 3, 10];
export const GRADE_NAMES = ['', 'Bronze', 'Silver', 'Gold'];
export const gradeOf = (count: number) => (count >= GRADES[2] ? 3 : count >= GRADES[1] ? 2 : count >= GRADES[0] ? 1 : 0);
/** What reaching each grade pays. */
export const GRADE_REWARD = [{ xp: 0, coins: 0 }, { xp: 40, coins: 5 }, { xp: 40, coins: 10 }, { xp: 80, coins: 25 }];

// ============================================================================ the profile

export interface Life {
  rounds: number; games: number; wins: number; propRounds: number; hunterRounds: number;
  survived: number; untouched: number; catches: number; hits: number; shots: number; innocents: number; cleanHunts: number;
  escapes: number; bonks: number; decoys: number; spooks: number; haunts: number; near: number; taunts: number; ducks: number;
  points: number; best: number; podiums: number; champs: number;
}
const LIFE_KEYS: (keyof Life)[] = ['rounds', 'games', 'wins', 'propRounds', 'hunterRounds', 'survived', 'untouched', 'catches', 'hits', 'shots', 'innocents', 'cleanHunts',
  'escapes', 'bonks', 'decoys', 'spooks', 'haunts', 'near', 'taunts', 'ducks', 'points', 'best', 'podiums', 'champs'];

export interface Kit { char: string; gun: string; trail: string; paint: string; hat: string; eyes: string; pop: string; title: string; }
export interface Profile {
  v: 1;
  xp: number; coins: number;
  /** Items bought, or kept from an older version. Free, level and feat items are owned by meeting the condition (`owns`). */
  owned: string[];
  kit: Kit;
  /** Catalogue: prop id -> [times hid as it, times caught one]. */
  cat: Record<string, [number, number]>;
  life: Life;
  feats: string[];
  jobs: { day: string; have: number[]; done: boolean[]; shift: boolean };
  /** The last round banked (see Game: results can arrive twice after a reload). */
  paid: string;
  since: number;
}

export function newProfile(now = Date.now()): Profile {
  const life = {} as Life;
  for (const k of LIFE_KEYS) life[k] = 0;
  return {
    v: 1, xp: 0, coins: 0, owned: [], cat: {}, life, feats: [], paid: '', since: now,
    kit: { char: CHARS[0].id, gun: GUNS[0].id, trail: TRAILS[0].id, paint: PAINTS[Math.floor(Math.random() * 8)].id, hat: HATS[0].id, eyes: EYES[0].id, pop: POPS[0].id, title: '' },
    jobs: { day: '', have: [0, 0, 0], done: [false, false, false], shift: false },
  };
}

const num = (v: unknown, max = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0);

/** Rebuild a profile from anything (storage, a pasted save code), keeping only what is well formed and known. */
export function sanitizeProfile(raw: any): Profile {
  const p = newProfile(num(raw?.since, 1e13) || Date.now()); // a timestamp in ms: above the usual 1e9 clamp
  if (!raw || typeof raw !== 'object') return p;
  p.xp = Math.floor(num(raw.xp)); p.coins = Math.floor(num(raw.coins));
  if (Array.isArray(raw.owned)) p.owned = [...new Set(raw.owned.filter((id: unknown) => typeof id === 'string' && ITEMS[id]))] as string[];
  if (raw.cat && typeof raw.cat === 'object') for (const d of PROPS) {
    const c = raw.cat[d.id];
    if (Array.isArray(c) && (num(c[0]) || num(c[1]))) p.cat[d.id] = [Math.floor(num(c[0], 1e6)), Math.floor(num(c[1], 1e6))];
  }
  if (raw.life && typeof raw.life === 'object') for (const k of LIFE_KEYS) p.life[k] = num(raw.life[k]);
  if (Array.isArray(raw.feats)) p.feats = [...new Set(raw.feats.filter((id: unknown) => typeof id === 'string' && FEAT_INDEX[id] !== undefined))] as string[];
  const j = raw.jobs;
  if (j && typeof j.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(j.day) && Array.isArray(j.have) && Array.isArray(j.done)) {
    p.jobs = { day: j.day, have: [0, 1, 2].map((i) => num(j.have[i], 1e6)), done: [0, 1, 2].map((i) => j.done[i] === true), shift: j.shift === true };
  }
  if (typeof raw.paid === 'string') p.paid = raw.paid.slice(0, 80);
  const k = raw.kit ?? {};
  for (const slot of KIT_SLOTS) {
    const id = k[slot];
    if (typeof id === 'string' && ITEMS[id]?.slot === slot && owns(p, id)) p.kit[slot] = id;
  }
  if (typeof k.title === 'string' && p.feats.includes(k.title)) p.kit.title = k.title;
  return p;
}

/** The 2.4 profile (separate keys for XP, coins and a packed colour*8+hat look) as a 2.7 profile. */
export function migrateLegacy(xp: number, coins: number, look: number, paid: string): Profile {
  const p = newProfile();
  p.xp = Math.floor(num(xp)); p.coins = Math.floor(num(coins)); p.paid = paid.slice(0, 80);
  // the crown moved from level 8 to level 20: whoever already had it keeps it
  if (xpLevel(p.xp) >= 8) p.owned.push('hat.crown');
  const color = (look >> 3) & 7, hat = look & 7;
  p.kit.paint = PAINTS[color].id;
  if (HATS[hat] && owns(p, HATS[hat].id)) p.kit.hat = HATS[hat].id;
  return p;
}

export function owns(p: Profile, id: string): boolean {
  const it = ITEMS[id];
  if (!it) return false;
  const h = it.how;
  if ('free' in h) return true;
  if (p.owned.includes(id)) return true;
  if ('level' in h) return xpLevel(p.xp) >= h.level;
  if ('feat' in h) return p.feats.includes(h.feat);
  return false;
}

export function buyItem(p: Profile, id: string): { ok: boolean; why?: string } {
  const it = ITEMS[id];
  if (!it || !('price' in it.how)) return { ok: false, why: 'That is not for sale.' };
  if (owns(p, id)) return { ok: false, why: 'You already own it.' };
  if (p.coins < it.how.price) return { ok: false, why: `You need ${it.how.price - p.coins} more coins.` };
  p.coins -= it.how.price;
  p.owned.push(id);
  return { ok: true };
}

export function equip(p: Profile, id: string): boolean {
  const it = ITEMS[id];
  if (!it || !owns(p, id)) return false;
  p.kit[it.slot] = id;
  return true;
}

/** How to get an item, in a few words. */
export function unlockText(it: Item): string {
  const h = it.how;
  if ('free' in h) return 'Free';
  if ('level' in h) return `Level ${h.level}`;
  if ('price' in h) return `${h.price} coins`;
  return `Feat: ${FEATS[FEAT_INDEX[h.feat]]?.name ?? h.feat}`;
}

// ============================================================================ the kit on the wire

/**
 * [paint, hat, eyes, pop, title, char, gun, trail] as indices; title 0 is none, otherwise a feat index + 1.
 * The hunter fields were appended in 2.12: an older client sends five and gets the defaults for the rest.
 */
export type WireKit = number[];
export const KIT = { paint: 0, hat: 1, eyes: 2, pop: 3, title: 4, char: 5, gun: 6, trail: 7 } as const;
export const KIT_LIMITS = () => [PAINTS.length, HATS.length, EYES.length, POPS.length, FEATS.length + 1, CHARS.length, GUNS.length, TRAILS.length];

export function kitToWire(p: Profile): WireKit {
  const ix = (list: Item[], id: string) => Math.max(0, list.findIndex((it) => it.id === id && owns(p, id)));
  const t = p.feats.includes(p.kit.title) ? FEAT_INDEX[p.kit.title] + 1 : 0;
  return [ix(PAINTS, p.kit.paint), ix(HATS, p.kit.hat), ix(EYES, p.kit.eyes), ix(POPS, p.kit.pop), t, ix(CHARS, p.kit.char), ix(GUNS, p.kit.gun), ix(TRAILS, p.kit.trail)];
}

/** Server side: any value at all becomes a valid kit. Ownership cannot be checked without accounts (see SECURITY.md). */
export function cleanKit(raw: unknown): WireKit {
  const lim = KIT_LIMITS();
  const a = Array.isArray(raw) ? raw : [];
  return lim.map((n, i) => { const v = a[i]; return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(n - 1, Math.floor(v))) : 0; });
}
/** Bots dress at random, from everything: a lobby is also the shop window. */
export const randomKit = (r = Math.random): WireKit => [Math.floor(r() * 8), Math.floor(r() * HATS.length), Math.floor(r() * EYES.length), Math.floor(r() * POPS.length), 0,
  Math.floor(r() * CHARS.length), Math.floor(r() * GUNS.length), Math.floor(r() * TRAILS.length)];
export const titleName = (wire: number) => (wire > 0 ? FEATS[wire - 1]?.name ?? '' : '');

// ============================================================================ feats: achievements you can wear as a title

export interface Feat { id: string; name: string; desc: string; goal: number; group: string; progress: (p: Profile) => number; reward: { coins?: number; item?: string }; }

export const stampCount = (p: Profile) => Object.values(p.cat).reduce((n, c) => n + (c[0] > 0 ? 1 : 0) + (c[1] > 0 ? 1 : 0), 0);
export const deptHid = (p: Profile, dept: string) => DEPARTMENTS.find((d) => d.id === dept)!.props.filter((id) => (p.cat[id]?.[0] ?? 0) > 0).length;
const deptFeat = (id: string, name: string, dept: string, item: string): Feat => {
  const d = DEPARTMENTS.find((x) => x.id === dept)!;
  return { id, name, group: 'Catalogue', desc: `Survive as every object in ${d.name} (${d.props.length})`, goal: d.props.length, progress: (p) => deptHid(p, dept), reward: { item } };
};
const life = (id: string, name: string, desc: string, key: keyof Life, goal: number, reward: Feat['reward'], group = 'Play'): Feat =>
  ({ id, name, desc, goal, group, progress: (p) => p.life[key], reward });

export const FEATS: Feat[] = [
  { id: 'shopper', name: 'Window Shopper', group: 'Catalogue', desc: 'Earn 10 catalogue stamps', goal: 10, progress: stampCount, reward: { coins: 50 } },
  { id: 'bargain', name: 'Bargain Hunter', group: 'Catalogue', desc: 'Earn 30 catalogue stamps', goal: 30, progress: stampCount, reward: { coins: 100 } },
  { id: 'collector', name: 'Collector', group: 'Catalogue', desc: 'Earn 60 catalogue stamps', goal: 60, progress: stampCount, reward: { coins: 250, item: 'trail.gold' } },
  { id: 'curator', name: 'Curator', group: 'Catalogue', desc: 'Earn 100 catalogue stamps', goal: 100, progress: stampCount, reward: { coins: 500 } },
  { id: 'heir', name: "Tumbleton's Heir", group: 'Catalogue', desc: `Earn every catalogue stamp (${STAMPS_MAX})`, goal: STAMPS_MAX, progress: stampCount, reward: { item: 'paint.gilded' } },
  deptFeat('interior', 'Interior Designer', 'furniture', 'hat.lampshade'),
  deptFeat('antiquarian', 'Antiquarian', 'ornaments', 'eyes.monocle'),
  deptFeat('gadgeteer', 'Gadgeteer', 'novelties', 'pop.sparks'),
  deptFeat('stocktaker', 'Stock Taker', 'stockroom', 'pop.sawdust'),
  deptFeat('greenthumb', 'Green Thumb', 'garden', 'pop.leaves'),
  life('survivor', 'Survivor', 'Survive 25 rounds as a prop', 'survived', 25, { coins: 100 }),
  life('untouchable', 'Untouchable', 'Survive 10 rounds without being hit once', 'untouched', 10, { coins: 150 }),
  life('escape', 'Escape Artist', 'Get hit and get away 20 times', 'escapes', 20, { coins: 100 }),
  life('bonker', 'Head Bonker', "Land on a hunter's head 15 times", 'bonks', 15, { coins: 100 }),
  life('bamboozler', 'Bamboozler', 'Fool hunters with decoys 20 times', 'decoys', 20, { coins: 100 }),
  life('daredevil', 'Daredevil', "Spend 10 minutes in all within arm's reach of a hunter", 'near', 600, { coins: 100 }),
  life('loudmouth', 'Loudmouth', 'Taunt 150 times', 'taunts', 150, { coins: 50 }),
  life('bloodhound', 'Bloodhound', 'Catch 50 props', 'catches', 50, { coins: 150, item: 'char.agent' }),
  life('sharpshooter', 'Sharpshooter', 'Catch 2 or more props in a round without zapping an innocent object, 5 times', 'cleanHunts', 5, { coins: 150, item: 'gun.remote' }),
  life('poltergeist', 'Poltergeist', 'Spook hunters 20 times as a ghost', 'spooks', 20, { item: 'hat.halo' }),
  life('quack', 'Quack Addict', 'Get turned into a duck 10 times', 'ducks', 10, { item: 'hat.duck' }),
  life('regular', 'Regular', 'Finish 50 games', 'games', 50, { coins: 200 }),
  life('champion', 'Champion', 'Win 10 games (first in the final standings)', 'champs', 10, { coins: 250, item: 'gun.golden' }),
  { id: 'priceless', name: 'Priceless', group: 'Play', desc: 'Reach level 40', goal: 40, progress: (p) => xpLevel(p.xp), reward: { coins: 500 } },
];
export const FEAT_INDEX: Record<string, number> = {};
FEATS.forEach((f, i) => (FEAT_INDEX[f.id] = i));

// ============================================================================ odd jobs: three a day

/** What one round looked like for one player, from the server's results. */
export interface RoundStats {
  /** shots, hits, catches, innocent objects zapped, bonks, escapes, taunts, decoys fooled, seconds near a hunter, ducks, spooks, haunts */
  sh: number; hi: number; k: number; inn: number; bk: number; es: number; ta: number; bz: number; nr: number; qk: number; sp: number; hn: number;
  /** Disguise credited to the catalogue (survived, and held it long enough), or -1. */
  hid: number;
  /** Disguises of the props this player caught. */
  ct: number[];
  /** Survived without being hit once. */
  nh: 0 | 1;
}
export interface RoundInput {
  key: string; day: string;
  team: 'prop' | 'hunter' | 'spec';
  won: boolean; survived: boolean; pts: number;
  /** Coins the server paid for the round (and the game, on the last round). */
  coins: number;
  st: RoundStats;
  gameOver: boolean; place: number; players: number;
}
interface JobCtx { r: RoundInput; freshHid: boolean; newStamps: number; podium: boolean; }
export interface Job { id: string; side: 'prop' | 'hunter' | 'any'; text: string; goal: number; coins: number; measure: (c: JobCtx) => number; }

export const JOBS: Job[] = [
  { id: 'survive2', side: 'prop', text: 'Survive 2 rounds as a prop', goal: 2, coins: 60, measure: (c) => (c.r.survived ? 1 : 0) },
  { id: 'fresh', side: 'prop', text: 'Survive as an object you have no Hid stamp for', goal: 1, coins: 80, measure: (c) => (c.freshHid ? 1 : 0) },
  { id: 'escape', side: 'prop', text: 'Get hit, then get away, twice', goal: 2, coins: 60, measure: (c) => c.r.st.es },
  { id: 'bonk', side: 'prop', text: "Land on a hunter's head", goal: 1, coins: 70, measure: (c) => c.r.st.bk },
  { id: 'decoy', side: 'prop', text: 'Fool a hunter with a decoy', goal: 1, coins: 60, measure: (c) => c.r.st.bz },
  { id: 'near', side: 'prop', text: "Spend 30 s within arm's reach of a hunter", goal: 30, coins: 60, measure: (c) => c.r.st.nr },
  { id: 'taunt', side: 'prop', text: 'Taunt 8 times', goal: 8, coins: 40, measure: (c) => c.r.st.ta },
  { id: 'clean', side: 'prop', text: 'Survive a round without being hit', goal: 1, coins: 70, measure: (c) => (c.r.survived && c.r.st.nh ? 1 : 0) },
  { id: 'catch3', side: 'hunter', text: 'Catch 3 props', goal: 3, coins: 60, measure: (c) => c.r.st.k },
  { id: 'hits10', side: 'hunter', text: 'Land 10 hits on props', goal: 10, coins: 40, measure: (c) => c.r.st.hi },
  { id: 'tidy', side: 'hunter', text: 'Catch a prop without zapping an innocent object that round', goal: 1, coins: 70, measure: (c) => (c.r.st.k > 0 && c.r.st.inn === 0 ? 1 : 0) },
  { id: 'hwin', side: 'hunter', text: 'Win a round as a hunter', goal: 1, coins: 60, measure: (c) => (c.r.team === 'hunter' && c.r.won ? 1 : 0) },
  { id: 'double', side: 'hunter', text: 'Catch 2 props in one round', goal: 1, coins: 70, measure: (c) => (c.r.st.k >= 2 ? 1 : 0) },
  { id: 'rounds6', side: 'any', text: 'Play 6 rounds', goal: 6, coins: 50, measure: () => 1 },
  { id: 'games2', side: 'any', text: 'Finish 2 games', goal: 2, coins: 60, measure: (c) => (c.r.gameOver ? 1 : 0) },
  { id: 'spook', side: 'any', text: 'Spook a hunter as a ghost', goal: 1, coins: 60, measure: (c) => c.r.st.sp },
  { id: 'points', side: 'any', text: 'Score 1,000 points', goal: 1000, coins: 60, measure: (c) => Math.max(0, c.r.pts) },
  { id: 'podium', side: 'any', text: 'Finish a game in the top 3', goal: 1, coins: 70, measure: (c) => (c.podium ? 1 : 0) },
  { id: 'stamps2', side: 'any', text: 'Earn 2 new catalogue stamps', goal: 2, coins: 60, measure: (c) => c.newStamps },
];
export const JOB_XP = 60;
/** Finishing all three of a day's jobs. */
export const SHIFT_BONUS = { coins: 75, xp: 150 };

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
export const msToNextDay = (t = Date.now()) => 86_400_000 - (t % 86_400_000);

/** The same three jobs for everyone on a given (UTC) day: one as a prop, one as a hunter, one either way. */
export function jobsFor(day: string): Job[] {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619);
  const r = rng(h >>> 0);
  return (['prop', 'hunter', 'any'] as const).map((side) => { const pool = JOBS.filter((j) => j.side === side); return pool[Math.floor(r() * pool.length)]; });
}

/** Start a new day's board if the date has moved on. */
export function rollJobs(p: Profile, day: string) {
  if (p.jobs.day !== day) p.jobs = { day, have: [0, 0, 0], done: [false, false, false], shift: false };
}

// ============================================================================ banking a round

export interface Report {
  xp: number; coins: number; coinsPlay: number;
  levelFrom: number; levelTo: number;
  /** Items newly earned (level, feat). */
  unlocked: string[];
  stamps: { prop: number; side: 0 | 1; grade: number }[];
  jobs: { text: string; have: number; goal: number; coins: number; doneNow: boolean; done: boolean }[];
  shift: boolean;
  feats: string[];
}

/** Bank one round into the profile (mutating it) and say what changed. The caller makes sure a round is banked once. */
export function bankRound(p: Profile, r: RoundInput): Report {
  const rep: Report = { xp: 0, coins: 0, coinsPlay: Math.max(0, Math.floor(r.coins)), levelFrom: xpLevel(p.xp), levelTo: 0, unlocked: [], stamps: [], jobs: [], shift: false, feats: [] };
  const st = r.st, L = p.life;
  const ownedBefore = new Set(Object.keys(ITEMS).filter((id) => owns(p, id)));
  p.paid = r.key;

  // lifetime record
  L.rounds++;
  if (r.won) L.wins++;
  if (r.team === 'prop') L.propRounds++;
  if (r.team === 'hunter') L.hunterRounds++;
  if (r.survived) L.survived++;
  if (r.survived && st.nh) L.untouched++;
  if (r.team === 'hunter' && st.k >= 2 && st.inn === 0) L.cleanHunts++;
  L.catches += st.k; L.hits += st.hi; L.shots += st.sh; L.innocents += st.inn;
  L.escapes += st.es; L.bonks += st.bk; L.decoys += st.bz; L.spooks += st.sp; L.haunts += st.hn; L.near += st.nr; L.taunts += st.ta; L.ducks += st.qk;
  L.points += Math.max(0, r.pts); L.best = Math.max(L.best, r.pts);
  // the server pays a podium bonus to the top three, but never to last place: the same rule here
  const podium = r.gameOver && r.place >= 1 && r.place <= Math.min(3, r.players - 1);
  if (r.gameOver) { L.games++; if (podium) L.podiums++; if (podium && r.place === 1) L.champs++; }

  // catalogue
  let xp = Math.max(10, Math.round(r.pts)), coins = rep.coinsPlay, newStamps = 0;
  const stamp = (type: number, side: 0 | 1) => {
    const d = PROPS[type];
    if (!d) return;
    const c = (p.cat[d.id] ??= [0, 0]);
    const g0 = gradeOf(c[side]);
    c[side] = Math.min(1e6, c[side] + 1);
    const g1 = gradeOf(c[side]);
    if (g1 > g0) { rep.stamps.push({ prop: type, side, grade: g1 }); xp += GRADE_REWARD[g1].xp; coins += GRADE_REWARD[g1].coins; if (g0 === 0) newStamps++; }
  };
  const freshHid = st.hid >= 0 && !!PROPS[st.hid] && !(p.cat[PROPS[st.hid].id]?.[0] > 0);
  if (st.hid >= 0) stamp(st.hid, 0);
  for (const t of st.ct.slice(0, 16)) stamp(t, 1);

  // odd jobs
  rollJobs(p, r.day);
  const ctx: JobCtx = { r, freshHid, newStamps, podium };
  jobsFor(r.day).forEach((j, i) => {
    let doneNow = false;
    if (!p.jobs.done[i]) {
      p.jobs.have[i] = Math.min(j.goal, p.jobs.have[i] + Math.max(0, j.measure(ctx)));
      if (p.jobs.have[i] >= j.goal) { p.jobs.done[i] = doneNow = true; coins += j.coins; xp += JOB_XP; }
    }
    rep.jobs.push({ text: j.text, have: Math.floor(p.jobs.have[i]), goal: j.goal, coins: j.coins, doneNow, done: p.jobs.done[i] });
  });
  if (!p.jobs.shift && p.jobs.done.every(Boolean)) { p.jobs.shift = rep.shift = true; coins += SHIFT_BONUS.coins; xp += SHIFT_BONUS.xp; }

  // level
  p.xp += xp;
  rep.levelTo = xpLevel(p.xp);
  for (let l = rep.levelFrom + 1; l <= rep.levelTo; l++) coins += levelCoins(l);

  // feats, last: some depend on the level and the catalogue
  for (const f of FEATS) {
    if (p.feats.includes(f.id) || f.progress(p) < f.goal) continue;
    p.feats.push(f.id); rep.feats.push(f.id);
    coins += f.reward.coins ?? 0;
  }
  p.coins += coins;
  rep.xp = xp; rep.coins = coins;
  rep.unlocked = Object.keys(ITEMS).filter((id) => !ownedBefore.has(id) && owns(p, id));
  return rep;
}

// ============================================================================ save codes

/** A copy-and-paste backup of the profile, to move it to another browser. Not a security measure. */
export function exportCode(p: Profile): string {
  const json = JSON.stringify(p);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'PP1.' + btoa(bin);
}
export function importCode(code: string): Profile | null {
  const s = code.trim();
  if (!s.startsWith('PP1.') || s.length > 200_000) return null;
  try {
    const bin = atob(s.slice(4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    return raw && raw.v === 1 ? sanitizeProfile(raw) : null;
  } catch { return null; }
}
