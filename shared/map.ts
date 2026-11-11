/**
 * Tumbleton's Emporium and Sunny Meadow.
 *
 * The architecture (walls, shelving, crate fort, barn...) is fixed, but every loose object is laid out
 * from a seed, so each round the map has been "restocked" differently. Server and client both call
 * buildMap(seed) and get byte-identical results.
 */
import { MEADOW_STARTERS, PROPS, PROP_INDEX, STARTER_PROPS, footprint } from './props';
import { rng } from './rng';

export interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  /** Hex tint. */
  c: number;
  /** Surface material (a texture set in client/public/art/tex); plain paint when absent. */
  m?: string;
  /** Collides but is not drawn as a plain box (floor, ceiling). */
  hidden?: boolean;
}

export interface Decor {
  id: number;
  type: number;
  x: number; y: number; z: number;
  yaw: number;
}

export interface Zone { name: string; x0: number; z0: number; x1: number; z1: number; color: string; }

/** Client-only set dressing with a shape boxes can't describe (trees, pond, roofs...). */
export interface Feature { kind: string; x: number; z: number; s: number; yaw: number; }

export const MAP_NAMES = ["Tumbleton's Emporium", 'Sunny Meadow'];

export interface GameMap {
  id: number;
  name: string;
  /** Disguises handed out at spawn on this map. */
  starters: number[];
  features: Feature[];
  seed: number;
  statics: Box[];
  /** Drawn only, never collided with. */
  visuals: Box[];
  decor: Decor[];
  hunterSpawns: [number, number][];
  propSpawns: [number, number][];
}

export const BOUNDS = { x0: -24, x1: 24, z0: -17, z1: 17, wallH: 4.5 };

export const ZONES: Zone[] = [
  { name: 'Main Aisles', x0: -10.5, z0: -10.5, x1: 10.5, z1: 8, color: '#f4ead5' },
  { name: 'Checkout', x0: -10.5, z0: 8, x1: 10.5, z1: 17, color: '#ffe3b3' },
  { name: 'Stock Room', x0: -10.5, z0: -17, x1: 10.5, z1: -10.5, color: '#b9b4a8' },
  { name: 'Furniture Hall', x0: -24, z0: -17, x1: -10.5, z1: -2, color: '#ffd0e4' },
  { name: 'Curiosities', x0: -24, z0: -2, x1: -10.5, z1: 17, color: '#4b3f8f' },
  { name: 'Crate Fort', x0: 10.5, z0: -17, x1: 24, z1: -1, color: '#c8f0d0' },
  { name: 'Bargain Pen', x0: 10.5, z0: -1, x1: 24, z1: 17, color: '#bfe6ff' },
];

const HALF_PI = Math.PI / 2;
const SHELF_LOW = ['duck', 'pot', 'basket', 'boombox', 'tv', 'jerrycan', 'football', 'alarmclock', 'megaphone', 'croissant', 'plasticcrate', 'claypot', 'cat', 'hamper', 'box', 'bucket'];
const SHELF_TOP = ['vase', 'urn', 'brassvase', 'bust', 'gnome', 'horse', 'oillamp', 'extinguisher', 'duck', 'pot', 'tv', 'cat', 'alarmclock', 'lantern'];

export function buildMap(seed: number, id = 0): GameMap {
  return id === 1 ? buildMeadow(seed) : buildStore(seed);
}

/** Shared placement helpers. `keep` lists floor rectangles loose props must never block. */
function builder(seed: number, keep: number[][], density: number) {
  const R = rng(seed);
  const statics: Box[] = [];
  const visuals: Box[] = [];
  const decor: Decor[] = [];
  const dboxes: number[][] = [];
  /** `c` is a paint colour, or a material name with an optional tint: 'oak', 'planks#c8553d'. */
  const surf = (c: number | string): { c: number; m?: string } => {
    if (typeof c === 'number') return { c };
    const [m, tint] = c.split('#');
    return { c: tint ? parseInt(tint, 16) : 0xffffff, m };
  };
  const sb = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number | string, hidden = false) =>
    statics.push({ x0, y0, z0, x1, y1, z1, ...surf(c), hidden: hidden || undefined });
  const vb = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number | string) =>
    visuals.push({ x0, y0, z0, x1, y1, z1, ...surf(c) });
  const hit = (a: number[], b: number[]) => a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];

  function place(id: string, x: number, y: number, z: number, yaw: number, margin = 0): boolean {
    const ti = PROP_INDEX[id];
    const def = PROPS[ti];
    const [hx, hz] = footprint(def, yaw);
    const a = [x - hx - margin, y + 0.01, z - hz - margin, x + hx + margin, y + def.h - 0.01, z + hz + margin];
    for (const s of statics) if (hit(a, [s.x0, s.y0, s.z0, s.x1, s.y1, s.z1])) return false;
    for (const d of dboxes) if (hit(a, d)) return false;
    decor.push({ id: decor.length, type: ti, x: round3(x), y: round3(y), z: round3(z), yaw: round3(yaw) });
    dboxes.push([x - hx, y, z - hz, x + hx, y + def.h, z + hz]);
    return true;
  }

  function scatter(id: string, n: number, x0: number, z0: number, x1: number, z1: number, y = 0, margin = 0.18) {
    const def = PROPS[PROP_INDEX[id]];
    n = Math.max(1, Math.round(n * density));
    let placed = 0;
    for (let i = 0; i < n * 12 && placed < n; i++) {
      const x = x0 + R() * (x1 - x0);
      const z = z0 + R() * (z1 - z0);
      const yaw = def.round ? R() * Math.PI * 2 : Math.floor(R() * 4) * HALF_PI;
      if (y === 0) {
        const [hx, hz] = footprint(def, yaw);
        let blocked = false;
        for (const k of keep) if (x + hx > k[0] && x - hx < k[2] && z + hz > k[1] && z - hz < k[3]) { blocked = true; break; }
        if (blocked) continue;
      }
      if (place(id, x, y, z, yaw, margin)) placed++;
    }
  }

  const pick = <T>(arr: T[]): T => arr[Math.floor(R() * arr.length)];
  return { R, statics, visuals, decor, sb, vb, place, scatter, pick };
}

const SPAWN_HUNTERS: [number, number][] = [[-3, 15], [-1, 15], [1, 15], [3, 15], [-2, 14], [2, 14]];
function spawnLane(): [number, number][] {
  const out: [number, number][] = [];
  for (let z = -9.2; z <= 5.8; z += 1.25) out.push([-0.35, z], [0.35, z + 0.6]);
  return out;
}

/**
 * Sunny Meadow — the open-air map. A fenced fairground with a barn, a bandstand, a campsite, a pond,
 * market stalls, a kitchen garden, a barrel yard and a play fort. Long sight lines, little cover:
 * it plays faster and riskier than the store.
 */
function buildMeadow(seed: number): GameMap {
  const { R, statics, visuals, decor, sb, vb, place, scatter, pick } = builder(seed, [
    [-0.9, -10, 0.9, 6.2], [-4.2, 13.2, 4.2, 16.8], // spawn lane, gate
    [-20, -8.8, -15, -6.2], [-13.4, -13.4, -11.4, -11.1], // barn doors
    [-3, -10.8, 3, -8.8], [4.6, 0.4, 6.6, 2.6], [-13.8, 0.6, -10.8, 3], // bandstand steps, fort stairs, dock
    [-22, -2, -13, 5], // pond
  ], 0.8);
  const features: Feature[] = [];
  const feat = (kind: string, x: number, z: number, s = 1, yaw = 0) => features.push({ kind, x, z, s, yaw });
  const WOOD = 'oak', WOOD2 = 'walnut', BARN = 'planks#b9503c', WHITE = 'whitewood', DECK = 'deck';

  // shell: invisible walls tall enough that nothing escapes, with a picket fence drawn along them
  sb(-24.5, -1, -17.5, 24.5, 0, 17.5, 0x7cc36a, true);
  sb(-24.5, 12, -17.5, 24.5, 13, 17.5, 0, true);
  sb(-24.5, 0, -17.5, 24.5, 12, -17, 0, true); sb(-24.5, 0, 17, 24.5, 12, 17.5, 0, true);
  sb(-24.5, 0, -17, -24, 12, 17, 0, true); sb(24, 0, -17, 24.5, 12, 17, 0, true);
  for (let x = -24; x <= 24.01; x += 1.6) {
    vb(x - 0.07, 0, -17.08, x + 0.07, 1.15, -16.94, WHITE);
    if (Math.abs(x) > 2.9) vb(x - 0.07, 0, 16.94, x + 0.07, 1.15, 17.08, WHITE);
  }
  for (let z = -17; z <= 17.01; z += 1.7) { vb(-24.08, 0, z - 0.07, -23.94, 1.15, z + 0.07, WHITE); vb(23.94, 0, z - 0.07, 24.08, 1.15, z + 0.07, WHITE); }
  for (const y of [0.42, 0.86]) {
    vb(-24, y, -17.04, 24, y + 0.11, -16.98, WHITE); vb(-24, y, 16.98, -2.9, y + 0.11, 17.04, WHITE); vb(2.9, y, 16.98, 24, y + 0.11, 17.04, WHITE);
    vb(-24.04, y, -17, -23.98, y + 0.11, 17, WHITE); vb(23.98, y, -17, 24.04, y + 0.11, 17, WHITE);
  }
  // entrance gate
  sb(-2.9, 0, 16.75, -2.5, 3.1, 17.15, WOOD2); sb(2.5, 0, 16.75, 2.9, 3.1, 17.15, WOOD2); sb(-3.2, 3.1, 16.75, 3.2, 3.5, 17.15, WOOD2);
  feat('gatesign', 0, 16.7);

  // ---------------------------------------------------------------- barn (north-west) with a loft
  sb(-22, 0, -15.5, -13, 3.2, -15.2, BARN); sb(-22, 0, -15.2, -21.7, 3.2, -8, BARN);
  sb(-13.3, 0, -15.2, -13, 3.2, -13, BARN); sb(-13.3, 0, -11.5, -13, 3.2, -8, BARN); sb(-13.3, 2.2, -13, -13, 3.2, -11.5, BARN);
  sb(-22, 0, -8.3, -19.5, 3.2, -8, BARN); sb(-15.5, 0, -8.3, -13, 3.2, -8, BARN); sb(-19.5, 2.6, -8.3, -15.5, 3.2, -8, BARN);
  sb(-22.3, 3.2, -15.8, -12.7, 3.45, -7.7, 'planks#6d4c41');
  for (const x of [-19.65, -15.5]) vb(x, 0, -8.34, x + 0.15, 2.6, -7.96, WHITE);
  vb(-19.65, 2.6, -8.34, -15.35, 2.75, -7.96, WHITE); vb(-22.02, 3.05, -8.34, -12.98, 3.2, -7.96, WHITE);
  feat('barnroof', -17.5, -11.75);
  sb(-21.7, 1.45, -15.2, -18.2, 1.6, -11.2, DECK); sb(-18.45, 0, -11.45, -18.2, 1.45, -11.2, WOOD2);
  feat('ladder', -18.05, -13.2, 1, HALF_PI);
  place('winebarrel', -16.3, 0, -14.5, 0); place('winebarrel', -17.3, 0, -14.5, 0); place('crate', -15.2, 0, -14.6, HALF_PI);
  scatter('compost', 2, -21.4, -14.9, -18.6, -11.6, 1.6, 0.05); scatter('crate', 1, -21.4, -14.9, -18.6, -11.6, 1.6, 0.05);
  scatter('lantern', 1, -21.4, -14.9, -18.6, -11.6, 1.6, 0.05); scatter('bucket', 1, -21.4, -14.9, -18.6, -11.6, 1.6, 0.05);
  scatter('barrel', 3, -21.3, -14.9, -13.7, -8.7); scatter('oildrum', 2, -21.3, -14.9, -13.7, -8.7); scatter('crate', 2, -21.3, -14.9, -13.7, -8.7);
  scatter('compost', 3, -21.3, -14.9, -13.7, -8.7); scatter('handtruck', 1, -21.3, -11, -13.7, -8.7); scatter('watercan', 2, -21.3, -14.9, -13.7, -8.7);
  scatter('tub', 1, -21.3, -14.9, -13.7, -8.7); scatter('tyre', 2, -21.3, -14.9, -13.7, -8.7); scatter('cement', 2, -21.3, -14.9, -13.7, -8.7);

  // ---------------------------------------------------------------- bandstand (north)
  sb(-2.6, 0, -14.6, 2.6, 0.5, -10.6, DECK); sb(-1.4, 0, -10.6, 1.4, 0.25, -10.1, DECK);
  for (const [x, z] of [[-2.6, -14.6], [2.4, -14.6], [-2.6, -10.8], [2.4, -10.8]]) sb(x, 0.5, z, x + 0.2, 2.9, z + 0.2, WHITE);
  sb(-3, 2.9, -15, 3, 3.08, -10.2, 'roof#4ecdc4');
  vb(-2.6, 1.25, -14.58, 2.6, 1.33, -14.5, WHITE); vb(-2.58, 1.25, -14.6, -2.5, 1.33, -10.8, WHITE); vb(2.5, 1.25, -14.6, 2.58, 1.33, -10.8, WHITE);
  feat('bandroof', 0, -12.6);
  scatter('boombox', 1, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1); scatter('megaphone', 1, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1);
  scatter('stool', 2, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1); scatter('monobloc', 2, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1); scatter('lantern', 1, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1);

  // ---------------------------------------------------------------- campsite (north-east): a fire pit and thatched shelters
  feat('campfire', 17, -10.5); sb(16.45, 0, -11.05, 17.55, 0.26, -9.95, 0x8d99ae, true);
  for (const [x, z] of [[13.6, -13.8], [20.6, -14], [21.2, -7.4], [13.4, -7.2]]) {
    if (R() > 0.88) continue;
    for (const [px, pz] of [[x - 1.05, z - 0.95], [x + 0.93, z - 0.95], [x - 1.05, z + 0.83], [x + 0.93, z + 0.83]]) sb(px, 0, pz, px + 0.12, 1.75, pz + 0.12, WOOD2);
    sb(x - 1.3, 1.75, z - 1.2, x + 1.3, 1.95, z + 1.2, 'thatch');
    if (R() < 0.8) place(pick(['cooler', 'hamper', 'crate', 'compost']), x + (R() - 0.5) * 0.8, 0, z + (R() - 0.5) * 0.8, pick([0, HALF_PI]));
  }
  place('log', 17, 0, -8.5, 0); place('log', 17, 0, -12.5, 0); place('log', 15, 0, -10.5, HALF_PI); place('log', 19, 0, -10.5, HALF_PI);
  scatter('lantern', 3, 11.5, -16.3, 23.3, -5.5); scatter('cooler', 2, 11.5, -16.3, 23.3, -5.5); scatter('stump', 3, 11.5, -16.3, 23.3, -5.5);
  scatter('hamper', 2, 11.5, -16.3, 23.3, -5.5); scatter('propane', 2, 11.5, -16.3, 23.3, -5.5); scatter('jerrycan', 2, 11.5, -16.3, 23.3, -5.5);
  scatter('boots', 2, 11.5, -16.3, 23.3, -5.5); scatter('bucket', 2, 11.5, -16.3, 23.3, -5.5); scatter('monobloc', 3, 11.5, -16.3, 23.3, -5.5);

  // ---------------------------------------------------------------- picnic lawn (south-west)
  for (const [cx, cz] of [[-18, 9], [-12.5, 12.6], [-19.5, 14.2], [-7.5, 8.2]]) {
    feat('picnictable', cx, cz);
    sb(cx - 1.0, 0.66, cz - 0.42, cx + 1.0, 0.76, cz + 0.42, WOOD, true);
    sb(cx - 1.0, 0.36, cz - 0.84, cx + 1.0, 0.44, cz - 0.56, WOOD, true); sb(cx - 1.0, 0.36, cz + 0.56, cx + 1.0, 0.44, cz + 0.84, WOOD, true);
    sb(cx - 0.8, 0, cz - 0.8, cx - 0.68, 0.66, cz + 0.8, WOOD2, true); sb(cx + 0.68, 0, cz - 0.8, cx + 0.8, 0.66, cz + 0.8, WOOD2, true);
    for (const off of [-0.5, 0.5]) if (R() < 0.7) place(pick(['hamper', 'lantern', 'croissant', 'watercan', 'football', 'pot']), cx + off, 0.76, cz, pick([0, HALF_PI]));
  }
  for (const [x, z, c] of [[-14.5, 8, 0xc23b4e], [-21.5, 11.2, 0x2f6f9f], [-9.5, 14.5, 0xd9a93a]]) {
    vb(x - 1.1, 0.004, z - 0.9, x + 1.1, 0.02, z + 0.9, c); vb(x - 0.75, 0.006, z - 0.55, x + 0.75, 0.024, z + 0.55, 0xf4eee0);
    place(pick(['hamper', 'cooler']), x + 0.3, 0, z - 0.2, 0);
  }
  scatter('football', 4, -23.3, 6, -5, 16.3); scatter('hamper', 3, -23.3, 6, -5, 16.3); scatter('cooler', 2, -23.3, 6, -5, 16.3);
  scatter('bench', 2, -23.3, 6, -5, 16.3); scatter('trashbag', 2, -23.3, 6, -5, 16.3); scatter('fern', 3, -23.3, 6, -5, 16.3);
  scatter('gnome', 2, -23.3, 6, -5, 16.3); scatter('monobloc', 2, -23.3, 6, -5, 16.3); scatter('boots', 1, -23.3, 6, -5, 16.3);

  // ---------------------------------------------------------------- market stalls (south-east)
  [10.2, 15.2, 20.2].forEach((x, i) => {
    const z = 13.6, col = [0xb8423f, 0x2a8f86, 0xd9a93a][i];
    sb(x - 1.2, 0, z - 0.4, x + 1.2, 0.9, z + 0.4, WOOD);
    for (const [px, pz] of [[x - 1.36, z - 0.96], [x + 1.24, z - 0.96], [x - 1.36, z + 0.84], [x + 1.24, z + 0.84]]) sb(px, 0, pz, px + 0.12, 2.3, pz + 0.12, WOOD2);
    sb(x - 1.5, 2.3, z - 1.1, x + 1.5, 2.42, z + 1.1, col);
    for (let k = -1.2; k < 1.2; k += 0.6) vb(x + k, 2.05, z - 1.12, x + k + 0.3, 2.3, z - 1.09, 0xf4eee0);
    for (let k = -1.5; k < 1.5; k += 0.6) vb(x + k, 2.42, z - 1.1, x + k + 0.3, 2.44, z + 1.1, 0xf4eee0);
    for (const off of [-0.75, 0, 0.75]) if (R() < 0.72) place(pick(['claypot', 'hamper', 'gnome', 'lantern', 'croissant', 'watercan', 'pot', 'duck']), x + off, 0.9, z, Math.PI);
  });
  scatter('crate', 3, 7.5, 9.4, 23.3, 16.4); scatter('barrel', 2, 7.5, 9.4, 23.3, 16.4); scatter('winebarrel', 2, 7.5, 9.4, 23.3, 16.4);
  scatter('planter', 2, 7.5, 9.4, 23.3, 12); scatter('chalkboard', 1, 7.5, 9.4, 23.3, 12); scatter('basket', 2, 7.5, 9.4, 23.3, 16.4);

  // ---------------------------------------------------------------- kitchen garden (east)
  const RAIL = 'planks';
  sb(12.8, 0, -3.9, 22.8, 0.5, -3.76, RAIL); sb(12.8, 0, 4.76, 22.8, 0.5, 4.9, RAIL); sb(22.66, 0, -3.9, 22.8, 0.5, 4.9, RAIL);
  sb(12.8, 0, -3.9, 12.94, 0.5, -0.6, RAIL); sb(12.8, 0, 1.6, 12.94, 0.5, 4.9, RAIL);
  feat('gardenbed', 17.8, 0.5);
  place('gnome', 17.8, 0, 0.4, Math.PI);
  for (const z of [-2.7, -1.1, 2.0, 3.6]) for (let x = 14; x <= 21.8; x += 1.2) if (R() < 0.5) place(pick(['claypot', 'claypot', 'fern', 'tub', 'planter']), x + (R() - 0.5) * 0.3, 0, z + (R() - 0.5) * 0.3, pick([0, HALF_PI]));
  scatter('watercan', 2, 13.4, -3.3, 22.2, 4.3); scatter('gnome', 2, 13.4, -3.3, 22.2, 4.3); scatter('compost', 2, 13.4, -3.3, 22.2, 4.3);
  scatter('bucket', 1, 13.4, -3.3, 22.2, 4.3); scatter('boots', 1, 13.4, -3.3, 22.2, 4.3); scatter('hydrant', 1, 13.4, -3.3, 22.2, 4.3);

  // ---------------------------------------------------------------- pond (west) with a dock; the ducks are real disguises
  feat('pond', -17.5, 1.5);
  sb(-13.6, 0.18, 0.9, -11.2, 0.3, 2.6, DECK);
  for (let i = 0; i < 5; i++) { const a = R() * 6.28, r = Math.sqrt(R()) * 0.72; place('duck', -17.5 + Math.cos(a) * 4 * r, 0, 1.5 + Math.sin(a) * 3 * r, R() * 6.28); }
  for (let i = 0; i < 9; i++) if (R() < 0.6) { const a = (i / 9) * 6.28 + R() * 0.3; place(pick(['stone', 'stone', 'rock']), -17.5 + Math.cos(a) * 5.1, 0, 1.5 + Math.sin(a) * 4, pick([0, HALF_PI])); }
  place('lifebuoy', -12.2, 0.3, 1.3, 0); scatter('lifebuoy', 1, -13, -1.5, -10.5, 4.5);

  // ---------------------------------------------------------------- barrel yard (centre-west): a loose maze of casks
  for (const z of [-6, -4, -2, 0]) for (let x = -11.6; x <= -3.8; x += 1.16) {
    if (R() < 0.42) continue;
    const base = pick(['winebarrel', 'winebarrel', 'barrel', 'oildrum']);
    if (place(base, x, 0, z, R() * 6.28) && R() < 0.2) place(pick(['barrel', 'oildrum', 'bucket']), x, PROPS[PROP_INDEX[base]].h, z, R() * 6.28);
  }

  // ---------------------------------------------------------------- play fort (centre-east): two decks and a crawl space
  sb(6.5, 1.05, 0, 9.5, 1.2, 3, DECK);
  for (const [x, z] of [[6.5, 0], [9.3, 0], [6.5, 2.8], [9.3, 2.8]]) sb(x, 0, z, x + 0.2, 1.05, z + 0.2, WOOD2);
  for (let i = 0; i < 4; i++) sb(5.3 + i * 0.3, 0, 1, 5.6 + i * 0.3, 0.3 * (i + 1), 2, 'planks');
  sb(8.2, 2.1, -1.7, 9.9, 2.25, 0, DECK);
  for (const [x, z] of [[8.2, -1.7], [9.7, -1.7], [8.2, -0.2], [9.7, -0.2]]) sb(x, 0, z, x + 0.2, 2.1, z + 0.2, WOOD2);
  sb(8.5, 1.2, 0.05, 9.3, 1.7, 0.7, BARN);
  vb(6.5, 1.9, 2.92, 9.5, 1.98, 3, WOOD2); vb(9.42, 1.9, 0, 9.5, 1.98, 3, WOOD2); vb(6.5, 1.2, 2.92, 6.58, 1.98, 3, WOOD2); vb(9.42, 1.2, 2.92, 9.5, 1.98, 3, WOOD2);
  feat('flag', 9.8, -1.6);
  scatter('crate', 1, 6.9, 0.4, 9.1, 2.6, 0, 0.05); scatter('football', 1, 6.9, 0.4, 9.1, 2.6, 0, 0.05); scatter('barrel', 1, 4.5, -2.5, 11, 5);

  // ---------------------------------------------------------------- trees, lamp posts, and loose clutter everywhere
  for (const [x, z] of [[-9, 9.6], [-3.6, 11.4], [6, 8.2], [3.6, -5.6], [-6.6, -11.6], [9.4, -14.2], [22.4, 7.6], [-22.6, -4.2], [-10.2, 4.6], [11.4, -5.4], [-23, 16], [22.8, -16], [4.4, 14.6], [-12.4, -6.8]]) {
    feat('tree', x, z, 0.85 + R() * 0.45, R() * 6.28);
    sb(x - 0.26, 0, z - 0.26, x + 0.26, 3, z + 0.26, 0, true);
    scatter('stone', 1, x - 1.8, z - 1.8, x + 1.8, z + 1.8, 0, 0.1);
    if (R() < 0.6) scatter('fern', 1, x - 2, z - 2, x + 2, z + 2, 0, 0.1);
  }
  for (const z of [10.5, 2.5, -5.5]) for (const x of [-2, 2]) { feat('lamp', x, z, 1, x < 0 ? 0 : Math.PI); sb(x - 0.09, 0, z - 0.09, x + 0.09, 3, z + 0.09, 0, true); }
  feat('windmill', -34, -24, 1, 0.5);
  const A = [-23.3, -16.3, 23.3, 16.3] as const;
  scatter('fern', 10, ...A); scatter('stone', 8, ...A); scatter('rock', 5, ...A); scatter('stump', 6, ...A); scatter('log', 5, ...A);
  scatter('gnome', 4, ...A); scatter('bench', 4, ...A); scatter('barrel', 3, ...A); scatter('lantern', 3, ...A); scatter('planter', 3, ...A);
  scatter('claypot', 4, ...A); scatter('crate', 3, ...A); scatter('watercan', 2, ...A); scatter('hydrant', 2, ...A); scatter('tyre', 2, ...A);
  scatter('stool', 2, ...A); scatter('football', 2, ...A); scatter('oildrum', 2, ...A); scatter('tub', 2, ...A); scatter('cooler', 1, ...A);

  return { id: 1, name: MAP_NAMES[1], starters: MEADOW_STARTERS, features, seed, statics, visuals, decor, hunterSpawns: SPAWN_HUNTERS, propSpawns: spawnLane() };
}

/**
 * Tumbleton's Emporium — a department store of oddities: shelving aisles, a checkout, a stock room,
 * a furniture hall, a curiosities gallery, a climbable crate fort and a bargain pen.
 */
function buildStore(seed: number): GameMap {
  const { R, statics, visuals, decor, sb, vb, place, scatter, pick } = builder(seed, [
    [-0.9, -10, 0.9, 6.2], // central cross aisle (prop spawns)
    [-4.2, 13.2, 4.2, 16.8], // entrance (hunter spawns)
    [-11.6, -8.3, -9.4, -4.7], [-11.6, 1.7, -9.4, 5.3], [-11.6, 10.7, -9.4, 14.3], // west doorways
    [9.4, -9.3, 11.6, -5.7], [9.4, 0.7, 11.6, 4.3], [9.4, 9.7, 11.6, 13.3], // east doorways
    [-8.3, -11.6, -5.7, -9.4], [5.7, -11.6, 8.3, -9.4], // stock room doorways
    [-19.3, -3.1, -15.7, -0.9], [15.7, -2.1, 19.3, 0.1], // wing doorways
    [12.5, 7.2, 14.6, 9.8], // bargain pen entry
    [14.8, -15.8, 17.2, -13.2], // fort stairs approach
  ], 0.45);
  const OAK = 'oak', WALNUT = 'walnut';
  const hOf = (id: string) => PROPS[PROP_INDEX[id]].h;

  // ---------------------------------------------------------------- shell
  sb(-24.5, -1, -17.5, 24.5, 0, 17.5, 0xf4ead5, true); // floor
  sb(-24.5, 4.5, -17.5, 24.5, 5, 17.5, 0x1b2a4a, true); // ceiling
  const WALL = 'plaster#f3ead8';
  sb(-24.5, 0, -17.5, 24.5, 4.5, -17, WALL);
  sb(-24.5, 0, 17, 24.5, 4.5, 17.5, WALL);
  sb(-24.5, 0, -17, -24, 4.5, 17, WALL);
  sb(24, 0, -17, 24.5, 4.5, 17, WALL);
  // skirting board and picture rail around the outer wall
  vb(-24, 0, -17.0, 24, 0.22, -16.95, WALNUT); vb(-24, 0, 16.95, 24, 0.22, 17, WALNUT);
  vb(-24, 0, -17, -23.95, 0.22, 17, WALNUT); vb(23.95, 0, -17, 24, 0.22, 17, WALNUT);
  vb(-24, 3.0, -17.0, 24, 3.12, -16.95, WALNUT); vb(-24, 3.0, 16.95, 24, 3.12, 17, WALNUT);
  vb(-24, 3.0, -17, -23.95, 3.12, 17, WALNUT); vb(23.95, 3.0, -17, 24, 3.12, 17, WALNUT);
  // entrance doors (visual) on the south wall
  vb(-2.2, 0, 16.93, -0.05, 2.8, 17, 0x9bdcff); vb(0.05, 0, 16.93, 2.2, 2.8, 17, 0x9bdcff);
  vb(-2.4, 2.8, 16.9, 2.4, 3.3, 17, WALNUT);

  // partitions (3 m tall) with wide openings
  const PART = 'brick', PART2 = 'plaster#d9cdb8', PH = 3.0;
  const segZ = (x: number, segs: [number, number][], c: string) => { for (const [a, b] of segs) sb(x - 0.15, 0, a, x + 0.15, PH, b, c); };
  const segX = (z: number, segs: [number, number][], c: string) => { for (const [a, b] of segs) sb(a, 0, z - 0.15, b, PH, z + 0.15, c); };
  segZ(-10.5, [[-17, -8], [-5, 2], [5, 11], [14, 17]], PART);
  segZ(10.5, [[-17, -9], [-6, 1], [4, 10], [13, 17]], PART);
  segX(-10.5, [[-10.35, -8], [-6, 6], [8, 10.35]], 'brick#c9c2b8');
  segX(-2, [[-24, -19], [-16, -10.65]], PART2);
  segX(-1, [[10.65, 16], [19, 24]], PART2);

  // ---------------------------------------------------------------- main aisles: 8 double-sided shelf units
  const shelfRows = [-7, -3.2, 0.6, 4.4];
  const shelfCols: [number, number][] = [[-8.6, -1.6], [1.6, 8.6]];
  for (const cz of shelfRows) {
    for (const [xa, xb] of shelfCols) {
      sb(xa, 0, cz - 0.05, xb, 2.15, cz + 0.05, OAK); // back panel
      sb(xa - 0.08, 0, cz - 0.7, xa, 2.15, cz + 0.7, WALNUT); // end caps
      sb(xb, 0, cz - 0.7, xb + 0.08, 2.15, cz + 0.7, WALNUT);
      sb(xa, 0, cz - 0.7, xb, 0.2, cz + 0.7, WALNUT); // plinth
      sb(xa, 0.89, cz - 0.7, xb, 0.95, cz + 0.7, OAK); // boards
      sb(xa, 1.59, cz - 0.7, xb, 1.65, cz + 0.7, OAK);
      for (const side of [1, -1]) {
        const z = cz + side * 0.375;
        const faceYaw = side === 1 ? 0 : Math.PI;
        for (const [y, pool, empty] of [[0.2, SHELF_LOW, 0.64], [0.95, SHELF_LOW, 0.68], [1.65, SHELF_TOP, 0.74]] as [number, string[], number][]) {
          let run = pick(pool);
          let runLeft = 1 + Math.floor(R() * 3);
          for (let x = xa + 0.5; x <= xb - 0.45; x += 0.875) {
            if (runLeft-- <= 0) { run = pick(pool); runLeft = 1 + Math.floor(R() * 3); }
            if (R() < empty) continue;
            place(run, x, y, z, PROPS[PROP_INDEX[run]].round ? R() * 6.283 : faceYaw);
          }
        }
      }
    }
  }
  // display tables between the aisles and checkout
  for (const tx of [-5.2, 5.2]) {
    sb(tx - 1.1, 0, 6.6, tx + 1.1, 0.8, 7.6, WALNUT);
    vb(tx - 1.15, 0.8, 6.55, tx + 1.15, 0.84, 7.65, OAK);
    for (let x = tx - 0.75; x <= tx + 0.8; x += 0.75) if (R() < 0.75) place(pick(['bust', 'horse', 'vase', 'brassvase', 'gnome', 'oillamp', 'cat']), x, 0.84, 7.1, R() < 0.5 ? 0 : Math.PI);
  }
  scatter('box', 4, -9.8, -9.6, 9.8, 6); scatter('crate', 2, -9.8, -9.8, 9.8, -8.2);
  scatter('sign', 2, -9.8, -9.6, 9.8, 7.5); scatter('basket', 2, -9.8, -9.6, 9.8, 7.5);
  scatter('barrel', 2, -9.8, -9.8, 9.8, 7.5); scatter('handtruck', 1, -9.8, -9.6, 9.8, 6);
  scatter('stool', 2, -9.8, -9.6, 9.8, 7.5); scatter('tallplant', 1, -9.6, 5.6, 9.6, 6.3); scatter('trashbag', 1, -9.8, -9.6, 9.8, 6);

  // ---------------------------------------------------------------- checkout
  for (const cx of [-5, 0, 5]) {
    sb(cx - 0.45, 0, 10, cx + 0.45, 0.95, 12.4, WALNUT);
    vb(cx - 0.5, 0.95, 9.95, cx + 0.5, 0.99, 12.45, OAK);
    place('register', cx, 0.99, 10.5, HALF_PI);
    if (R() < 0.6) place(pick(['duck', 'basket', 'pot', 'alarmclock']), cx, 0.99, 11.7, 0);
  }
  for (let i = 0; i < 4; i++) place('basket', -8.6, i * hOf('basket'), 9.4, 0);
  for (let i = 0; i < 2 + Math.floor(R() * 2); i++) place('basket', -7.7, i * hOf('basket'), 9.4, 0);
  place('extinguisher', -5.2, 0, 16.5, 0); place('extinguisher', 5.2, 0, 16.5, 0);
  place('tallplant', -9.6, 0, 16.3, 0); place('tallplant', 9.6, 0, 16.3, 0);
  scatter('trashbag', 2, -9.8, 8.6, 9.8, 16.4); scatter('sign', 1, -9, 8.6, 9, 16);
  scatter('stool', 3, -9.6, 12.6, 9.6, 16.4); scatter('box', 2, -9.6, 8.6, 9.6, 16.4);
  scatter('monobloc', 2, -9.6, 12.6, 9.6, 16.4); scatter('oillamp', 1, -9.8, 8.6, 9.8, 16.5);

  // ---------------------------------------------------------------- stock room
  for (const rx of [-7.2, 0, 7.2]) {
    const xa = rx - 2, xb = rx + 2, za = -16.95, zb = -15.9;
    for (const ux of [xa, xb - 0.1]) { sb(ux, 0, za, ux + 0.1, 2.6, za + 0.1, 'metal'); sb(ux, 0, zb - 0.1, ux + 0.1, 2.6, zb, 'metal'); }
    sb(xa, 1.22, za, xb, 1.3, zb, 'deck');
    sb(xa, 2.42, za, xb, 2.5, zb, 'deck');
    for (const y of [0, 1.3, 2.5]) for (let x = xa + 0.75; x < xb - 0.6; x += 1.15) {
      if (R() < 0.55) continue;
      const id = pick(['box', 'crate', 'barrel', 'box', 'jerrycan', 'propane', 'plasticcrate', 'cement', 'toolchest']);
      place(id, x, y, -16.42, id === 'crate' || id === 'cement' ? HALF_PI : 0);
    }
  }
  for (let i = 0; i < 3; i++) { // climbable stacks
    const x = -9 + R() * 18, z = -14.6 + R() * 2.6;
    const base = pick(['winebarrel', 'toolchest', 'cabinet']);
    if (Math.abs(x) > 5.5 && Math.abs(x) < 8.5 && z > -12.3) continue;
    if (place(base, x, 0, z, 0, 0.2)) place(pick(['box', 'box', 'plasticcrate']), x + (R() - 0.5) * 0.1, hOf(base), z + (R() - 0.5) * 0.1, 0);
  }
  scatter('box', 5, -10, -15.6, 10, -11); scatter('crate', 4, -10, -15.6, 10, -11);
  scatter('barrel', 4, -10, -15.6, 10, -11); scatter('winebarrel', 2, -10, -15.6, 10, -11);
  scatter('cement', 3, -10, -15.6, 10, -11); scatter('tyre', 3, -10, -15.6, 10, -11);
  scatter('jerrycan', 2, -10, -15.6, 10, -11); scatter('propane', 2, -10, -15.6, 10, -11);
  scatter('handtruck', 2, -10, -15.6, 10, -11); scatter('plasticcrate', 3, -10, -15.6, 10, -11);
  scatter('trashbag', 2, -10, -15.6, 10, -11); scatter('sign', 1, -10, -15.6, 10, -11);

  // ---------------------------------------------------------------- furniture hall (north-west)
  sb(-22.5, 0, -15.8, -19.3, 0.4, -12.6, OAK);
  sb(-15.2, 0, -9.4, -12.4, 0.4, -6.6, OAK);
  place('armchair', -21.5, 0.4, -14.2, 0.5); place('sidetable', -20.2, 0.4, -14.6, 0);
  place('cabinet', -23.4, 0, -5.2, HALF_PI); place('clock', -23.6, 0, -8.4, HALF_PI);
  if (R() < 0.8) place('cabinet', -12.8, 0, -16.5, 0);
  if (R() < 0.8) place('clock', -17.4, 0, -16.7, 0);
  scatter('ottoman', 1, -15, -9.2, -12.6, -6.8, 0.4, 0.05); scatter('pillows', 1, -15, -9.2, -12.6, -6.8, 0.4, 0.05);
  scatter('armchair', 5, -23.3, -16.3, -11.3, -2.9); scatter('ottoman', 4, -23.3, -16.3, -11.3, -2.9);
  scatter('pillows', 3, -23.3, -16.3, -11.3, -2.9); scatter('nightstand', 4, -23.4, -16.4, -11.2, -2.8);
  scatter('sidetable', 3, -23.4, -16.4, -11.2, -2.8); scatter('chair', 4, -23.4, -16.4, -11.2, -2.8);
  scatter('schoolchair', 2, -23.4, -16.4, -11.2, -2.8); scatter('tallplant', 2, -23.5, -16.5, -11, -2.6);
  scatter('plant', 3, -23.5, -16.5, -11, -2.6); scatter('oillamp', 2, -23.5, -16.5, -11, -2.6);
  scatter('tv', 2, -23.4, -16.4, -11.2, -2.8); scatter('stool', 2, -23.4, -16.4, -11.2, -2.8);

  // ---------------------------------------------------------------- curiosities (south-west)
  for (const z of [0.4, 2.0, 3.6, 5.2, 6.8, 8.4]) if (R() < 0.7) place(pick(['cabinet', 'clock', 'chalkboard', 'cabinet']), -23.4, 0, z, HALF_PI);
  for (const x of [-22.2, -20.6, -19.0, -17.4]) if (R() < 0.7) place(pick(['clock', 'cabinet', 'tallplant']), x, 0, 16.6, Math.PI);
  sb(-19.2, 0, 2.6, -16.6, 0.85, 4.2, WALNUT); // display table
  vb(-19.25, 0.85, 2.55, -16.55, 0.89, 4.25, OAK);
  for (let x = -18.8; x <= -17; x += 0.85) for (const z of [3.0, 3.8]) if (R() < 0.6) place(pick(['bust', 'vase', 'brassvase', 'horse', 'cat', 'alarmclock', 'urn']), x, 0.89, z, R() * 6.28);
  sb(-17, 0, 11.6, -12.6, 1.0, 12.5, WALNUT); // long counter
  vb(-17.05, 1.0, 11.55, -12.55, 1.04, 12.55, OAK);
  for (let x = -16.5; x <= -13; x += 0.85) if (R() < 0.7) place(pick(['boombox', 'tv', 'pot', 'duck', 'alarmclock', 'megaphone', 'croissant']), x, 1.04, 12.05, 0);
  scatter('stool', 4, -23, -1.2, -11.2, 16); scatter('chest', 3, -22.8, -1.4, -11, 16.4);
  scatter('bust', 3, -23, -1.2, -11.2, 16); scatter('vase', 3, -23, -1.2, -11.2, 16);
  scatter('brassvase', 2, -23, -1.2, -11.2, 16); scatter('urn', 2, -23, -1.2, -11.2, 16);
  scatter('horse', 2, -23, -1.2, -11.2, 16); scatter('cat', 2, -23, -1.2, -11.2, 16);
  scatter('tv', 2, -23, -1.2, -11.2, 16); scatter('boombox', 1, -23, -1.2, -11.2, 16);
  scatter('monobloc', 2, -23, -1.2, -11.2, 16); scatter('oillamp', 1, -23.4, -1.4, -11, 16.4); scatter('trashbag', 1, -23, -1.2, -11.2, 16);

  // ---------------------------------------------------------------- crate fort (north-east): shipping crates stacked into a climbable castle
  const B = 1.2;
  const TINTS = ['planks', 'planks#e6d2b0', 'planks#c9a877', 'planks#f1e4cc', 'planks#b98f62'];
  let bc = 0;
  const blockCol = () => TINTS[bc++ % TINTS.length];
  for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 3; iz++) {
    if (ix === 2) continue; // tunnel slot
    sb(17 + ix * B, 0, -16.6 + iz * B, 17 + (ix + 1) * B, 1.2, -16.6 + (iz + 1) * B, blockCol());
  }
  sb(19.4, 0.9, -16.6, 20.6, 1.2, -13, 'deck'); // tunnel roof (0.9 m crawl space: props only)
  for (let i = 0; i < 4; i++) sb(15.8 + i * 0.3, 0, -15.4, 16.1 + i * 0.3, 0.3 * (i + 1), -13.6, TINTS[(i + 2) % 5]); // stairs
  sb(20.6, 1.2, -16.6, 21.8, 1.8, -15.4, blockCol());
  sb(21.8, 1.2, -16.6, 23, 2.4, -15.4, blockCol()); // tower
  sb(12.6, 0, -9, 13.8, 2.4, -7.8, blockCol()); sb(16.2, 0, -9, 17.4, 2.4, -7.8, blockCol());
  sb(12.6, 2.4, -9, 17.4, 3.0, -7.8, blockCol()); // arch
  sb(21.4, 0, -6.2, 22.6, 0.6, -5, blockCol()); sb(22.6, 0, -6.2, 23.8, 1.2, -5, blockCol()); sb(22.6, 0, -5, 23.8, 0.6, -3.8, blockCol());
  scatter('claypot', 2, 17.3, -16.3, 22.7, -13.3, 1.2, 0.05); scatter('bucket', 2, 17.3, -16.3, 22.7, -13.3, 1.2, 0.05);
  scatter('barrel', 3, 11.2, -16.4, 23.4, -1.8); scatter('winebarrel', 2, 11.2, -16.4, 23.4, -1.8);
  scatter('crate', 4, 11.4, -16.2, 23.2, -2); scatter('gnome', 3, 11.4, -16.2, 23.2, -2);
  scatter('watercan', 2, 11.4, -16.2, 23.2, -2); scatter('bucket', 2, 11.6, -16, 23, -2.2);
  scatter('claypot', 3, 11.4, -16.2, 23.2, -2); scatter('planter', 2, 11.6, -16, 23, -2.2);
  scatter('lantern', 2, 11.4, -16.2, 23.2, -2); scatter('tub', 2, 11.4, -16.2, 23.2, -2);
  scatter('compost', 2, 11.4, -16.2, 23.2, -2); scatter('plant', 2, 11.2, -16.5, 23.5, -1.7);
  scatter('tyre', 2, 11.4, -16.2, 23.2, -2); scatter('handtruck', 1, 11.4, -16.2, 23.2, -2);

  // ---------------------------------------------------------------- bargain pen + stage (south-east)
  const PEN = 'whitewood';
  sb(14, 0, 4, 22.5, 0.55, 4.3, PEN); sb(14, 0, 12.7, 22.5, 0.55, 13, PEN);
  sb(22.2, 0, 4.3, 22.5, 0.55, 12.7, PEN);
  sb(14, 0, 4.3, 14.3, 0.55, 7.5, PEN); sb(14, 0, 9.5, 14.3, 0.55, 12.7, PEN);
  sb(18.6, 0, 14, 19.3, 0.5, 16.4, OAK); sb(19.3, 0, 14, 20, 1.0, 16.4, OAK);
  sb(20, 0, 14, 23.5, 1.5, 16.4, WALNUT); // stage
  sb(21, 0, 13.4, 22.2, 1.2, 14, OAK); sb(21, 0, 12.4, 22.2, 0.85, 13.4, OAK); // chunky steps
  scatter('football', 12, 14.7, 4.7, 21.8, 12.3, 0, 0.04); scatter('duck', 5, 14.7, 4.7, 21.8, 12.3, 0, 0.04);
  scatter('pillows', 3, 14.7, 4.7, 21.8, 12.3, 0, 0.04); scatter('basket', 3, 14.7, 4.7, 21.8, 12.3, 0, 0.04);
  scatter('box', 3, 14.7, 4.7, 21.8, 12.3, 0, 0.04); scatter('plasticcrate', 2, 14.7, 4.7, 21.8, 12.3, 0, 0.04);
  scatter('ottoman', 2, 11.2, -0.2, 23.4, 3.4); scatter('horse', 1, 11.4, -0.2, 23.2, 3.4);
  scatter('sign', 2, 11.4, 0, 13.6, 16); scatter('plant', 1, 11.2, 13.4, 18, 16.5);
  scatter('trashbag', 1, 11.2, -0.4, 23.4, 3.6); scatter('stool', 2, 11.2, 13.4, 18, 16.4);
  scatter('monobloc', 2, 11.2, -0.4, 23.4, 3.6); scatter('chest', 2, 20.2, 14.2, 23.3, 16.2, 1.5, 0.05);
  scatter('oillamp', 1, 11.2, -0.4, 23.5, 16.5); scatter('boombox', 1, 11.4, 0, 23, 3.4); scatter('megaphone', 1, 11.4, 0, 23, 3.4);

  return { id: 0, name: MAP_NAMES[0], starters: STARTER_PROPS, features: [], seed, statics, visuals, decor, hunterSpawns: SPAWN_HUNTERS, propSpawns: spawnLane() };
}

function round3(v: number): number { return Math.round(v * 1000) / 1000; }
