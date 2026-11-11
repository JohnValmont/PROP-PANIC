/**
 * Tumbleton's Toy Emporium — the launch map.
 *
 * The architecture (walls, shelving, castle, ball pit...) is fixed, but every loose toy is laid out
 * from a seed, so each round the store has been "restocked" differently. Server and client both call
 * buildMap(seed) and get byte-identical results.
 */
import { MEADOW_STARTERS, PROPS, PROP_INDEX, STARTER_PROPS, footprint } from './props';
import { rng } from './rng';

export interface Box {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  /** Hex colour. */
  c: number;
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

export const MAP_NAMES = ["Tumbleton's Toy Emporium", 'Sunny Meadow'];

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
  { name: 'Plush Corner', x0: -24, z0: -17, x1: -10.5, z1: -2, color: '#ffd0e4' },
  { name: 'Arcade', x0: -24, z0: -2, x1: -10.5, z1: 17, color: '#4b3f8f' },
  { name: 'Block Castle', x0: 10.5, z0: -17, x1: 24, z1: -1, color: '#c8f0d0' },
  { name: 'Ball Pit', x0: 10.5, z0: -1, x1: 24, z1: 17, color: '#bfe6ff' },
];

const HALF_PI = Math.PI / 2;
const BLOCK_COLORS = [0xef476f, 0x118ab2, 0xffd166, 0x06d6a0, 0x9b5de5, 0xf78c2b];
const SHELF_COLORS = [0xffd166, 0x4ecdc4, 0xff8fab, 0xf78c2b, 0x9b5de5, 0x06d6a0, 0xef476f, 0x48cae4];

const SHELF_LOW = ['duck', 'ball', 'blockA', 'blockB', 'car', 'drum', 'boxS', 'rings', 'train', 'ufo', 'gift', 'basket'];
const SHELF_TOP = ['teddy', 'robot', 'dino', 'duck', 'ball', 'blockA', 'gift', 'drum', 'rings', 'boxS'];

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
  const sb = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, hidden = false) =>
    statics.push({ x0, y0, z0, x1, y1, z1, c, hidden: hidden || undefined });
  const vb = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number) =>
    visuals.push({ x0, y0, z0, x1, y1, z1, c });
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
 * market stalls, a pumpkin patch, a hay-bale maze and a play fort. Long sight lines, little cover:
 * it plays faster and riskier than the store.
 */
function buildMeadow(seed: number): GameMap {
  const { R, statics, visuals, decor, sb, vb, place, scatter, pick } = builder(seed, [
    [-0.9, -10, 0.9, 6.2], [-4.2, 13.2, 4.2, 16.8], // spawn lane, gate
    [-20, -8.8, -15, -6.2], [-13.4, -13.4, -11.4, -11.1], // barn doors
    [-3, -10.8, 3, -8.8], [4.6, 0.4, 6.6, 2.6], [-13.8, 0.6, -10.8, 3], // bandstand steps, fort stairs, dock
    [-22, -2, -13, 5], // pond
  ], 1);
  const features: Feature[] = [];
  const feat = (kind: string, x: number, z: number, s = 1, yaw = 0) => features.push({ kind, x, z, s, yaw });
  const WOOD = 0xc49a6c, WOOD2 = 0x8a6748, BARN = 0xc8553d, WHITE = 0xfff8ec;

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

  // ---------------------------------------------------------------- barn (north-west) with a hay loft
  sb(-22, 0, -15.5, -13, 3.2, -15.2, BARN); sb(-22, 0, -15.2, -21.7, 3.2, -8, BARN);
  sb(-13.3, 0, -15.2, -13, 3.2, -13, BARN); sb(-13.3, 0, -11.5, -13, 3.2, -8, BARN); sb(-13.3, 2.2, -13, -13, 3.2, -11.5, BARN);
  sb(-22, 0, -8.3, -19.5, 3.2, -8, BARN); sb(-15.5, 0, -8.3, -13, 3.2, -8, BARN); sb(-19.5, 2.6, -8.3, -15.5, 3.2, -8, BARN);
  sb(-22.3, 3.2, -15.8, -12.7, 3.45, -7.7, 0x6d4c41);
  for (const x of [-19.65, -15.5]) vb(x, 0, -8.34, x + 0.15, 2.6, -7.96, WHITE);
  vb(-19.65, 2.6, -8.34, -15.35, 2.75, -7.96, WHITE); vb(-22.02, 3.05, -8.34, -12.98, 3.2, -7.96, WHITE);
  feat('barnroof', -17.5, -11.75);
  sb(-21.7, 1.45, -15.2, -18.2, 1.6, -11.2, WOOD); sb(-18.45, 0, -11.45, -18.2, 1.45, -11.2, WOOD2);
  place('hay', -16.3, 0, -14.5, 0); place('hay', -17.55, 0, -14.5, 0); place('hay', -17.55, 0.75, -14.5, 0);
  scatter('hay', 2, -21.4, -14.9, -18.6, -11.6, 1.6, 0.05); scatter('crate', 1, -21.4, -14.9, -18.6, -11.6, 1.6, 0.05); scatter('lantern', 1, -21.4, -14.9, -18.6, -11.6, 1.6, 0.05);
  scatter('hay', 4, -21.3, -14.9, -13.7, -8.7); scatter('crate', 3, -21.3, -14.9, -13.7, -8.7); scatter('barrel', 3, -21.3, -14.9, -13.7, -8.7);
  scatter('wheelbarrow', 1, -21.3, -11, -13.7, -8.7); scatter('scarecrow', 1, -21.3, -11, -13.7, -8.7); scatter('watercan', 2, -21.3, -14.9, -13.7, -8.7);

  // ---------------------------------------------------------------- bandstand (north)
  const STAGE = 0xf2e9dc;
  sb(-2.6, 0, -14.6, 2.6, 0.5, -10.6, STAGE); sb(-1.4, 0, -10.6, 1.4, 0.25, -10.1, STAGE);
  for (const [x, z] of [[-2.6, -14.6], [2.4, -14.6], [-2.6, -10.8], [2.4, -10.8]]) sb(x, 0.5, z, x + 0.2, 2.9, z + 0.2, WHITE);
  sb(-3, 2.9, -15, 3, 3.08, -10.2, 0x4ecdc4);
  vb(-2.6, 1.25, -14.58, 2.6, 1.33, -14.5, WHITE); vb(-2.58, 1.25, -14.6, -2.5, 1.33, -10.8, WHITE); vb(2.5, 1.25, -14.6, 2.58, 1.33, -10.8, WHITE);
  feat('bandroof', 0, -12.6);
  scatter('drum', 2, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1); scatter('stool', 2, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1); scatter('lantern', 1, -2.2, -14.2, 2.2, -11.2, 0.5, 0.1);

  // ---------------------------------------------------------------- campsite (north-east)
  feat('campfire', 17, -10.5); sb(16.55, 0, -10.95, 17.45, 0.28, -10.05, 0x8d99ae, true);
  for (const [x, z, yaw] of [[13.6, -13.6, HALF_PI], [20.6, -14, 0], [21.2, -7.4, HALF_PI], [13.4, -7.2, 0]]) if (R() < 0.88) place('tent', x, 0, z, yaw);
  place('log', 17, 0, -8.5, HALF_PI); place('log', 17, 0, -12.5, HALF_PI); place('log', 15, 0, -10.5, 0); place('log', 19, 0, -10.5, 0);
  scatter('lantern', 4, 11.5, -16.3, 23.3, -5.5); scatter('cooler', 3, 11.5, -16.3, 23.3, -5.5); scatter('stump', 3, 11.5, -16.3, 23.3, -5.5);
  scatter('hamper', 2, 11.5, -16.3, 23.3, -5.5); scatter('tent', 1, 11.5, -16.3, 23.3, -5.5, 0, 0.5);

  // ---------------------------------------------------------------- picnic lawn (south-west)
  for (const [cx, cz] of [[-18, 9], [-12.5, 12.6], [-19.5, 14.2], [-7.5, 8.2]]) {
    sb(cx - 0.9, 0.72, cz - 0.4, cx + 0.9, 0.8, cz + 0.4, WOOD);
    sb(cx - 0.9, 0.38, cz - 0.86, cx + 0.9, 0.45, cz - 0.6, WOOD); sb(cx - 0.9, 0.38, cz + 0.6, cx + 0.9, 0.45, cz + 0.86, WOOD);
    sb(cx - 0.72, 0, cz - 0.8, cx - 0.62, 0.72, cz + 0.8, WOOD2); sb(cx + 0.62, 0, cz - 0.8, cx + 0.72, 0.72, cz + 0.8, WOOD2);
    for (const off of [-0.45, 0.45]) if (R() < 0.7) place(pick(['hamper', 'cooler', 'lantern', 'pumpkin', 'watercan']), cx + off, 0.8, cz, pick([0, HALF_PI]));
  }
  for (const [x, z, c] of [[-14.5, 8, 0xef476f], [-21.5, 11.2, 0x118ab2], [-9.5, 14.5, 0xffd166]]) {
    vb(x - 1.1, 0.004, z - 0.9, x + 1.1, 0.02, z + 0.9, c); vb(x - 0.75, 0.006, z - 0.55, x + 0.75, 0.024, z + 0.55, WHITE);
    place(pick(['hamper', 'cooler']), x + 0.3, 0, z - 0.2, 0);
  }
  scatter('ball', 4, -23.3, 6, -5, 16.3); scatter('hamper', 3, -23.3, 6, -5, 16.3); scatter('cooler', 2, -23.3, 6, -5, 16.3);
  scatter('bench', 2, -23.3, 6, -5, 16.3); scatter('bin', 2, -23.3, 6, -5, 16.3); scatter('plant', 3, -23.3, 6, -5, 16.3); scatter('gnome', 2, -23.3, 6, -5, 16.3);

  // ---------------------------------------------------------------- market stalls (south-east)
  [10.2, 15.2, 20.2].forEach((x, i) => {
    const z = 13.6, col = [0xef476f, 0x2ec4b6, 0xffd166][i];
    sb(x - 1.2, 0, z - 0.4, x + 1.2, 0.9, z + 0.4, WOOD);
    for (const [px, pz] of [[x - 1.36, z - 0.96], [x + 1.24, z - 0.96], [x - 1.36, z + 0.84], [x + 1.24, z + 0.84]]) sb(px, 0, pz, px + 0.12, 2.3, pz + 0.12, WOOD2);
    sb(x - 1.5, 2.3, z - 1.1, x + 1.5, 2.42, z + 1.1, col);
    for (let k = -1.2; k < 1.2; k += 0.6) vb(x + k, 2.05, z - 1.12, x + k + 0.3, 2.3, z - 1.09, WHITE);
    for (let k = -1.5; k < 1.5; k += 0.6) vb(x + k, 2.42, z - 1.1, x + k + 0.3, 2.44, z + 1.1, WHITE);
    for (const off of [-0.75, 0, 0.75]) if (R() < 0.72) place(pick(['pumpkin', 'hamper', 'gnome', 'lantern', 'mushroom', 'watercan']), x + off, 0.9, z, Math.PI);
  });
  scatter('crate', 4, 7.5, 9.4, 23.3, 16.4); scatter('barrel', 3, 7.5, 9.4, 23.3, 16.4); scatter('signpost', 1, 7.5, 9.4, 23.3, 12);

  // ---------------------------------------------------------------- pumpkin patch (east)
  sb(12.8, 0, -3.9, 22.8, 0.5, -3.76, WOOD); sb(12.8, 0, 4.76, 22.8, 0.5, 4.9, WOOD); sb(22.66, 0, -3.9, 22.8, 0.5, 4.9, WOOD);
  sb(12.8, 0, -3.9, 12.94, 0.5, -0.6, WOOD); sb(12.8, 0, 1.6, 12.94, 0.5, 4.9, WOOD);
  place('scarecrow', 17.8, 0, 0.4, Math.PI);
  for (const z of [-2.7, -1.1, 2.0, 3.6]) for (let x = 14; x <= 21.8; x += 1.2) if (R() < 0.5) place('pumpkin', x + (R() - 0.5) * 0.4, 0, z + (R() - 0.5) * 0.4, R() * 6.28);
  scatter('wheelbarrow', 1, 13.4, -3.3, 22.2, 4.3); scatter('watercan', 2, 13.4, -3.3, 22.2, 4.3); scatter('gnome', 2, 13.4, -3.3, 22.2, 4.3);

  // ---------------------------------------------------------------- pond (west) with a dock; the ducks are real toys
  feat('pond', -17.5, 1.5);
  sb(-13.6, 0.18, 0.9, -11.2, 0.3, 2.6, WOOD);
  for (let i = 0; i < 5; i++) { const a = R() * 6.28, r = Math.sqrt(R()) * 0.72; place('duck', -17.5 + Math.cos(a) * 4 * r, 0, 1.5 + Math.sin(a) * 3 * r, R() * 6.28); }
  for (let i = 0; i < 9; i++) if (R() < 0.6) { const a = (i / 9) * 6.28 + R() * 0.3; place('rock', -17.5 + Math.cos(a) * 4.9, 0, 1.5 + Math.sin(a) * 3.8, R() * 6.28); }

  // ---------------------------------------------------------------- hay-bale maze (centre-west)
  for (const z of [-6, -4, -2, 0]) for (let x = -11.6; x <= -3.8; x += 1.16) {
    if (R() < 0.42) continue;
    if (place('hay', x, 0, z, 0) && R() < 0.22) place('hay', x, 0.75, z, 0);
  }

  // ---------------------------------------------------------------- play fort (centre-east): two decks and a crawl space
  sb(6.5, 1.05, 0, 9.5, 1.2, 3, WOOD);
  for (const [x, z] of [[6.5, 0], [9.3, 0], [6.5, 2.8], [9.3, 2.8]]) sb(x, 0, z, x + 0.2, 1.05, z + 0.2, WOOD2);
  for (let i = 0; i < 4; i++) sb(5.3 + i * 0.3, 0, 1, 5.6 + i * 0.3, 0.3 * (i + 1), 2, WOOD2);
  sb(8.2, 2.1, -1.7, 9.9, 2.25, 0, WOOD);
  for (const [x, z] of [[8.2, -1.7], [9.7, -1.7], [8.2, -0.2], [9.7, -0.2]]) sb(x, 0, z, x + 0.2, 2.1, z + 0.2, WOOD2);
  sb(8.5, 1.2, 0.05, 9.3, 1.7, 0.7, BARN);
  vb(6.5, 1.9, 2.92, 9.5, 1.98, 3, WOOD2); vb(9.42, 1.9, 0, 9.5, 1.98, 3, WOOD2); vb(6.5, 1.2, 2.92, 6.58, 1.98, 3, WOOD2); vb(9.42, 1.2, 2.92, 9.5, 1.98, 3, WOOD2);
  feat('flag', 9.8, -1.6);
  scatter('crate', 1, 6.9, 0.4, 9.1, 2.6, 0, 0.05); scatter('ball', 1, 6.9, 0.4, 9.1, 2.6, 0, 0.05); scatter('barrel', 1, 4.5, -2.5, 11, 5);

  // ---------------------------------------------------------------- trees, lamp posts, and loose clutter everywhere
  for (const [x, z] of [[-9, 9.6], [-3.6, 11.4], [6, 8.2], [3.6, -5.6], [-6.6, -11.6], [9.4, -14.2], [22.4, 7.6], [-22.6, -4.2], [-10.2, 4.6], [11.4, -5.4], [-23, 16], [22.8, -16], [4.4, 14.6], [-12.4, -6.8]]) {
    feat('tree', x, z, 0.85 + R() * 0.45, R() * 6.28);
    sb(x - 0.26, 0, z - 0.26, x + 0.26, 3, z + 0.26, 0, true);
    scatter('mushroom', 1, x - 1.8, z - 1.8, x + 1.8, z + 1.8, 0, 0.1);
    if (R() < 0.6) scatter('bush', 1, x - 2, z - 2, x + 2, z + 2, 0, 0.1);
  }
  for (const z of [10.5, 2.5, -5.5]) for (const x of [-2, 2]) { feat('lamp', x, z); sb(x - 0.09, 0, z - 0.09, x + 0.09, 3, z + 0.09, 0, true); }
  feat('windmill', -34, -24, 1, 0.5);
  const A = [-23.3, -16.3, 23.3, 16.3] as const;
  scatter('bush', 12, ...A); scatter('rock', 10, ...A); scatter('stump', 6, ...A); scatter('log', 5, ...A); scatter('mushroom', 6, ...A);
  scatter('gnome', 4, ...A); scatter('signpost', 4, ...A); scatter('bench', 4, ...A); scatter('barrel', 3, ...A); scatter('lantern', 3, ...A);
  scatter('plant', 3, ...A); scatter('pumpkin', 4, ...A); scatter('crate', 3, ...A); scatter('watercan', 2, ...A); scatter('wheelbarrow', 1, ...A);
  scatter('scarecrow', 1, ...A); scatter('stool', 2, ...A); scatter('ball', 2, ...A);

  return { id: 1, name: MAP_NAMES[1], starters: MEADOW_STARTERS, features, seed, statics, visuals, decor, hunterSpawns: SPAWN_HUNTERS, propSpawns: spawnLane() };
}

function buildStore(seed: number): GameMap {
  const { R, statics, visuals, decor, sb, vb, place, scatter, pick } = builder(seed, [
    [-0.9, -10, 0.9, 6.2], // central cross aisle (prop spawns)
    [-4.2, 13.2, 4.2, 16.8], // entrance (hunter spawns)
    [-11.6, -8.3, -9.4, -4.7], [-11.6, 1.7, -9.4, 5.3], [-11.6, 10.7, -9.4, 14.3], // west doorways
    [9.4, -9.3, 11.6, -5.7], [9.4, 0.7, 11.6, 4.3], [9.4, 9.7, 11.6, 13.3], // east doorways
    [-8.3, -11.6, -5.7, -9.4], [5.7, -11.6, 8.3, -9.4], // stock room doorways
    [-19.3, -3.1, -15.7, -0.9], [15.7, -2.1, 19.3, 0.1], // wing doorways
    [12.5, 7.2, 14.6, 9.8], // ball pit entry
    [14.8, -15.8, 17.2, -13.2], // castle stairs approach
  ], 0.55);

  // ---------------------------------------------------------------- shell
  sb(-24.5, -1, -17.5, 24.5, 0, 17.5, 0xf4ead5, true); // floor
  sb(-24.5, 4.5, -17.5, 24.5, 5, 17.5, 0x1b2a4a, true); // ceiling
  const WALL = 0xfff1d6;
  sb(-24.5, 0, -17.5, 24.5, 4.5, -17, WALL);
  sb(-24.5, 0, 17, 24.5, 4.5, 17.5, WALL);
  sb(-24.5, 0, -17, -24, 4.5, 17, WALL);
  sb(24, 0, -17, 24.5, 4.5, 17, WALL);
  // candy-stripe trim around the outer wall
  const TRIM = 0xff6b6b;
  vb(-24, 0, -17.0, 24, 0.22, -16.96, TRIM); vb(-24, 0, 16.96, 24, 0.22, 17, TRIM);
  vb(-24, 0, -17, -23.96, 0.22, 17, TRIM); vb(23.96, 0, -17, 24, 0.22, 17, TRIM);
  vb(-24, 2.9, -17.0, 24, 3.15, -16.96, 0x4ecdc4); vb(-24, 2.9, 16.96, 24, 3.15, 17, 0x4ecdc4);
  vb(-24, 2.9, -17, -23.96, 3.15, 17, 0x4ecdc4); vb(23.96, 2.9, -17, 24, 3.15, 17, 0x4ecdc4);
  // entrance doors (visual) on the south wall
  vb(-2.2, 0, 16.93, -0.05, 2.8, 17, 0x9bdcff); vb(0.05, 0, 16.93, 2.2, 2.8, 17, 0x9bdcff);
  vb(-2.4, 2.8, 16.9, 2.4, 3.3, 17, 0x2ec4b6);

  // partitions (3 m tall) with wide openings
  const PART = 0x8fd3d6, PART2 = 0xffc8a2, PH = 3.0;
  const segZ = (x: number, segs: [number, number][], c: number) => { for (const [a, b] of segs) sb(x - 0.15, 0, a, x + 0.15, PH, b, c); };
  const segX = (z: number, segs: [number, number][], c: number) => { for (const [a, b] of segs) sb(a, 0, z - 0.15, b, PH, z + 0.15, c); };
  segZ(-10.5, [[-17, -8], [-5, 2], [5, 11], [14, 17]], PART);
  segZ(10.5, [[-17, -9], [-6, 1], [4, 10], [13, 17]], PART);
  segX(-10.5, [[-10.35, -8], [-6, 6], [8, 10.35]], 0xb8b2a7);
  segX(-2, [[-24, -19], [-16, -10.65]], PART2);
  segX(-1, [[10.65, 16], [19, 24]], PART2);

  // ---------------------------------------------------------------- main aisles: 8 double-sided shelf units
  const shelfRows = [-7, -3.2, 0.6, 4.4];
  const shelfCols: [number, number][] = [[-8.6, -1.6], [1.6, 8.6]];
  let unit = 0;
  for (const cz of shelfRows) {
    for (const [xa, xb] of shelfCols) {
      const col = SHELF_COLORS[unit++ % SHELF_COLORS.length];
      const FRAME = 0xfdfdfd;
      sb(xa, 0, cz - 0.05, xb, 2.15, cz + 0.05, FRAME); // back panel
      sb(xa - 0.08, 0, cz - 0.7, xa, 2.15, cz + 0.7, col); // end caps
      sb(xb, 0, cz - 0.7, xb + 0.08, 2.15, cz + 0.7, col);
      sb(xa, 0, cz - 0.7, xb, 0.2, cz + 0.7, FRAME); // plinth
      sb(xa, 0.89, cz - 0.7, xb, 0.95, cz + 0.7, col); // boards
      sb(xa, 1.59, cz - 0.7, xb, 1.65, cz + 0.7, col);
      for (const side of [1, -1]) {
        const z = cz + side * 0.375;
        const faceYaw = side === 1 ? 0 : Math.PI;
        for (const [y, pool, empty] of [[0.2, SHELF_LOW, 0.66], [0.95, SHELF_LOW, 0.7], [1.65, SHELF_TOP, 0.76]] as [number, string[], number][]) {
          let run = pick(pool);
          let runLeft = 1 + Math.floor(R() * 3);
          for (let x = xa + 0.5; x <= xb - 0.45; x += 0.875) {
            if (runLeft-- <= 0) { run = pick(pool); runLeft = 1 + Math.floor(R() * 3); }
            if (R() < empty) continue;
            const long = run === 'car' || run === 'train';
            const yaw = long ? HALF_PI * side : PROPS[PROP_INDEX[run]].round ? R() * 6.283 : faceYaw;
            place(run, x, y, z, yaw);
          }
        }
      }
    }
  }
  // promo tables between the aisles and checkout
  for (const tx of [-5.2, 5.2]) {
    sb(tx - 1.1, 0, 6.6, tx + 1.1, 0.8, 7.6, 0x8ecae6);
    vb(tx - 1.15, 0.8, 6.55, tx + 1.15, 0.84, 7.65, 0xffffff);
    for (let x = tx - 0.75; x <= tx + 0.8; x += 0.75) if (R() < 0.75) place(pick(['robot', 'rocket', 'dino', 'teddy', 'gumball']), x, 0.84, 7.1, R() < 0.5 ? 0 : Math.PI);
  }
  scatter('boxL', 2, -9.8, -9.6, 9.8, 6); scatter('boxS', 3, -9.8, -9.6, 9.8, 6);
  scatter('cone', 2, -9.8, -9.6, 9.8, 6); scatter('sign', 2, -9.8, -9.6, 9.8, 7.5);
  scatter('basket', 3, -9.8, -9.6, 9.8, 7.5); scatter('crate', 2, -9.8, -9.8, 9.8, -8.2);
  scatter('rocket', 2, -9.6, 5.6, 9.6, 6.3); scatter('barrel', 2, -9.8, -9.8, 9.8, 7.5);

  // ---------------------------------------------------------------- checkout
  for (const cx of [-5, 0, 5]) {
    sb(cx - 0.45, 0, 10, cx + 0.45, 0.95, 12.4, 0x6c5ce7);
    vb(cx - 0.5, 0.95, 9.95, cx + 0.5, 0.99, 12.45, 0x2d3436);
    place('register', cx, 0.99, 10.5, HALF_PI);
    if (R() < 0.6) place(pick(['gift', 'duck', 'basket', 'boxS']), cx, 0.99, 11.7, 0);
  }
  for (let i = 0; i < 4; i++) place('basket', -8.6, i * 0.35, 9.4, 0);
  for (let i = 0; i < 2 + Math.floor(R() * 2); i++) place('basket', -7.8, i * 0.35, 9.4, 0);
  place('gumball', -5.2, 0, 16.4, 0); place('gumball', 5.2, 0, 16.4, 0);
  if (R() < 0.7) place('gumball', 6.0, 0, 16.4, 0);
  place('plant', -9.6, 0, 16.3, 0); place('plant', 9.6, 0, 16.3, 0);
  scatter('bin', 2, -9.8, 8.6, 9.8, 16.4); scatter('sign', 1, -9, 8.6, 9, 16);
  scatter('cone', 2, -9.6, 8.6, 9.6, 16.4); scatter('stool', 3, -9.6, 12.6, 9.6, 16.4);
  scatter('boxS', 2, -9.6, 8.6, 9.6, 16.4); scatter('lamp', 1, -9.8, 8.6, 9.8, 16.5);

  // ---------------------------------------------------------------- stock room
  for (const rx of [-7.2, 0, 7.2]) {
    const xa = rx - 2, xb = rx + 2, za = -16.95, zb = -15.9;
    for (const ux of [xa, xb - 0.1]) { sb(ux, 0, za, ux + 0.1, 2.6, za + 0.1, 0x5c677d); sb(ux, 0, zb - 0.1, ux + 0.1, 2.6, zb, 0x5c677d); }
    sb(xa, 1.22, za, xb, 1.3, zb, 0xc9a66b);
    sb(xa, 2.42, za, xb, 2.5, zb, 0xc9a66b);
    for (const y of [0, 1.3, 2.5]) for (let x = xa + 0.75; x < xb - 0.6; x += 1.15) {
      if (R() < 0.55) continue;
      const id = pick(['boxL', 'boxS', 'crate', 'boxS', 'barrel']);
      place(id, x, y, -16.42, 0);
    }
  }
  for (let i = 0; i < 3; i++) { // climbable stacks
    const x = -9 + R() * 18, z = -14.6 + R() * 2.6;
    const base = pick(['boxL', 'crate']);
    if (Math.abs(x) > 5.5 && Math.abs(x) < 8.5 && z > -12.3) continue;
    if (place(base, x, 0, z, 0, 0.2)) place(pick(['boxS', 'boxS', 'crate']), x + (R() - 0.5) * 0.2, 0.9, z + (R() - 0.5) * 0.2, 0);
  }
  scatter('boxL', 4, -10, -15.6, 10, -11); scatter('boxS', 6, -10, -15.6, 10, -11);
  scatter('crate', 4, -10, -15.6, 10, -11); scatter('barrel', 4, -10, -15.6, 10, -11);
  scatter('cone', 2, -10, -15.6, 10, -11); scatter('bin', 1, -10, -15.6, 10, -11);
  scatter('sign', 1, -10, -15.6, 10, -11);

  // ---------------------------------------------------------------- plush corner (north-west)
  sb(-22.5, 0, -15.8, -19.3, 0.4, -12.6, 0xff9ecd);
  sb(-15.2, 0, -9.4, -12.4, 0.4, -6.6, 0xb5a4ff);
  place('bigteddy', -20.9, 0.4, -14.2, 0.5);
  place('bigteddy', -22.6, 0, -5.2, HALF_PI);
  if (R() < 0.8) place('bigteddy', -12.6, 0, -15.6, 0);
  scatter('teddy', 2, -15, -9.2, -12.6, -6.8, 0.4, 0.05);
  scatter('teddy', 7, -23.4, -16.4, -11.2, -2.8); scatter('beanbag', 6, -23.3, -16.3, -11.3, -2.9);
  scatter('horse', 3, -23.2, -16.2, -11.4, -3); scatter('lamp', 2, -23.5, -16.5, -11, -2.6);
  scatter('plant', 2, -23.5, -16.5, -11, -2.6); scatter('duck', 3, -23.4, -16.4, -11.2, -2.8);
  scatter('ball', 2, -23.4, -16.4, -11.2, -2.8); scatter('gift', 3, -23.4, -16.4, -11.2, -2.8);

  // ---------------------------------------------------------------- arcade (south-west)
  for (const z of [0.2, 1.6, 3.0, 4.4, 5.8, 7.2, 8.6]) if (R() < 0.8) place('arcade', -23.4, 0, z, HALF_PI);
  for (const x of [-22.2, -20.8, -19.4, -18.0]) if (R() < 0.75) place('arcade', x, 0, 16.4, Math.PI);
  for (const z of [6.4, 7.8, 9.2]) if (R() < 0.7) place('arcade', -11.2, 0, z, -HALF_PI);
  sb(-19.2, 0, 2.6, -16.6, 0.85, 4.2, 0x00d1ff); // air hockey table
  vb(-19.1, 0.85, 2.7, -16.7, 0.88, 4.1, 0xf8f9fa);
  sb(-17, 0, 11.6, -12.6, 1.0, 12.5, 0xff595e); // prize counter
  vb(-17.05, 1.0, 11.55, -12.55, 1.04, 12.55, 0xfff3b0);
  for (let x = -16.6; x <= -13; x += 0.72) if (R() < 0.7) place(pick(['gift', 'ufo', 'duck', 'rings', 'blockA']), x, 1.04, 12.05, R() * 6.28);
  scatter('stool', 6, -23, -1.2, -11.2, 16); scatter('gumball', 3, -22.8, -1.4, -11, 16.4);
  scatter('bin', 1, -23, -1.2, -11.2, 16); scatter('plant', 1, -23, -1.2, -11.2, 16.4);
  scatter('ufo', 2, -23, -1.2, -11.2, 16); scatter('beanbag', 2, -22.5, -1, -11.5, 16);
  scatter('lamp', 1, -23.4, -1.4, -11, 16.4);

  // ---------------------------------------------------------------- block castle (north-east)
  const B = 1.2;
  let bc = 0;
  const blockCol = () => BLOCK_COLORS[bc++ % BLOCK_COLORS.length];
  for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 3; iz++) {
    if (ix === 2) continue; // tunnel slot
    sb(17 + ix * B, 0, -16.6 + iz * B, 17 + (ix + 1) * B, 1.2, -16.6 + (iz + 1) * B, blockCol());
  }
  sb(19.4, 0.9, -16.6, 20.6, 1.2, -13, 0xffffff); // tunnel roof (0.9 m crawl space: props only)
  for (let i = 0; i < 4; i++) sb(15.8 + i * 0.3, 0, -15.4, 16.1 + i * 0.3, 0.3 * (i + 1), -13.6, BLOCK_COLORS[(i + 2) % 6]); // stairs
  sb(20.6, 1.2, -16.6, 21.8, 1.8, -15.4, blockCol());
  sb(21.8, 1.2, -16.6, 23, 2.4, -15.4, blockCol()); // tower
  sb(12.6, 0, -9, 13.8, 2.4, -7.8, blockCol()); sb(16.2, 0, -9, 17.4, 2.4, -7.8, blockCol());
  sb(12.6, 2.4, -9, 17.4, 3.0, -7.8, blockCol()); // arch
  sb(21.4, 0, -6.2, 22.6, 0.6, -5, blockCol()); sb(22.6, 0, -6.2, 23.8, 1.2, -5, blockCol()); sb(22.6, 0, -5, 23.8, 0.6, -3.8, blockCol());
  scatter('blockA', 2, 17.3, -16.3, 22.7, -13.3, 1.2, 0.05); scatter('blockB', 2, 17.3, -16.3, 22.7, -13.3, 1.2, 0.05);
  scatter('blockA', 5, 11.2, -16.4, 23.4, -1.8); scatter('blockB', 5, 11.2, -16.4, 23.4, -1.8);
  scatter('blockC', 5, 11.4, -16.2, 23.2, -2); scatter('rocket', 2, 11.4, -16.2, 23.2, -2);
  scatter('robot', 3, 11.4, -16.2, 23.2, -2); scatter('dino', 3, 11.6, -16, 23, -2.2);
  scatter('drum', 2, 11.4, -16.2, 23.2, -2); scatter('car', 2, 11.6, -16, 23, -2.2);
  scatter('rings', 2, 11.4, -16.2, 23.2, -2); scatter('plant', 1, 11.2, -16.5, 23.5, -1.7);

  // ---------------------------------------------------------------- ball pit + slide (south-east)
  const PIT = 0x48cae4;
  sb(14, 0, 4, 22.5, 0.55, 4.3, PIT); sb(14, 0, 12.7, 22.5, 0.55, 13, PIT);
  sb(22.2, 0, 4.3, 22.5, 0.55, 12.7, PIT);
  sb(14, 0, 4.3, 14.3, 0.55, 7.5, PIT); sb(14, 0, 9.5, 14.3, 0.55, 12.7, PIT);
  sb(18.6, 0, 14, 19.3, 0.5, 16.4, 0xf78c2b); sb(19.3, 0, 14, 20, 1.0, 16.4, 0xef476f);
  sb(20, 0, 14, 23.5, 1.5, 16.4, 0x9b5de5); // slide tower
  sb(21, 0, 13.4, 22.2, 1.2, 14, 0xffca3a); sb(21, 0, 12.4, 22.2, 0.85, 13.4, 0xffca3a); // chunky slide
  scatter('ball', 24, 14.7, 4.7, 21.8, 12.3, 0, 0.04);
  scatter('duck', 3, 14.7, 4.7, 21.8, 12.3, 0, 0.04);
  scatter('beanbag', 2, 11.2, -0.2, 23.4, 3.4); scatter('horse', 1, 11.4, -0.2, 23.2, 3.4);
  scatter('train', 2, 11.4, -0.2, 13.4, 16.2); scatter('cone', 2, 11.2, -0.4, 23.4, 16.4);
  scatter('plant', 1, 11.2, 13.4, 18, 16.5); scatter('bin', 1, 11.2, -0.4, 23.4, 3.6);
  scatter('sign', 1, 11.4, 0, 13.6, 16); scatter('ball', 3, 11.2, -0.4, 23.4, 3.6);
  scatter('stool', 2, 11.2, 13.4, 18, 16.4); scatter('gift', 2, 20.2, 14.2, 23.3, 16.2, 1.5, 0.05);
  scatter('car', 1, 11.4, 0, 23, 3.4); scatter('lamp', 1, 11.2, -0.4, 23.5, 16.5);

  return { id: 0, name: MAP_NAMES[0], starters: STARTER_PROPS, features: [], seed, statics, visuals, decor, hunterSpawns: SPAWN_HUNTERS, propSpawns: spawnLane() };
}

function round3(v: number): number { return Math.round(v * 1000) / 1000; }
