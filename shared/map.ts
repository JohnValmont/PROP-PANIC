/**
 * Tumbleton's Toy Emporium — the launch map.
 *
 * The architecture (walls, shelving, castle, ball pit...) is fixed, but every loose toy is laid out
 * from a seed, so each round the store has been "restocked" differently. Server and client both call
 * buildMap(seed) and get byte-identical results.
 */
import { PROPS, PROP_INDEX, footprint } from './props';
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

export interface GameMap {
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

export function buildMap(seed: number): GameMap {
  const R = rng(seed);
  const statics: Box[] = [];
  const visuals: Box[] = [];
  const decor: Decor[] = [];
  const dboxes: number[][] = [];
  // Floor areas loose toys must not block: spawn lanes and doorways.
  const keep: number[][] = [
    [-0.9, -10, 0.9, 6.2], // central cross aisle (prop spawns)
    [-4.2, 13.2, 4.2, 16.8], // entrance (hunter spawns)
    [-11.6, -8.3, -9.4, -4.7], [-11.6, 1.7, -9.4, 5.3], [-11.6, 10.7, -9.4, 14.3], // west doorways
    [9.4, -9.3, 11.6, -5.7], [9.4, 0.7, 11.6, 4.3], [9.4, 9.7, 11.6, 13.3], // east doorways
    [-8.3, -11.6, -5.7, -9.4], [5.7, -11.6, 8.3, -9.4], // stock room doorways
    [-19.3, -3.1, -15.7, -0.9], [15.7, -2.1, 19.3, 0.1], // wing doorways
    [12.5, 7.2, 14.6, 9.8], // ball pit entry
    [14.8, -15.8, 17.2, -13.2], // castle stairs approach
  ];

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
        for (const [y, pool, empty] of [[0.2, SHELF_LOW, 0.42], [0.95, SHELF_LOW, 0.45], [1.65, SHELF_TOP, 0.55]] as [number, string[], number][]) {
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
      if (R() < 0.35) continue;
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

  const hunterSpawns: [number, number][] = [[-3, 15], [-1, 15], [1, 15], [3, 15], [-2, 14], [2, 14]];
  const propSpawns: [number, number][] = [];
  for (let z = -9.2; z <= 5.8; z += 1.25) propSpawns.push([-0.35, z], [0.35, z + 0.6]);

  return { seed, statics, visuals, decor, hunterSpawns, propSpawns };
}

function round3(v: number): number { return Math.round(v * 1000) / 1000; }
