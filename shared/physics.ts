/**
 * Deterministic character physics shared by the server (authority) and the client (prediction).
 * Everything is axis-aligned boxes: cheap, exact, and identical on both sides.
 */
import { CFG } from './constants';
import type { GameMap } from './map';
import { PROPS, footprint } from './props';

export interface AABB { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; decor: number; }

export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  hw: number; h: number;
  ground: boolean;
  dashLeft: number;
  dashCd: number;
  /** Seconds since last on the ground (for coyote-time jumps). */
  air: number;
}

export interface Cmd {
  dt: number;
  /** strafe (-1..1) and forward (-1..1) */
  mx: number; mz: number;
  yaw: number;
  jump: boolean;
  dash: boolean;
}

export function newBody(hw: number, h: number): Body {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hw, h, ground: false, dashLeft: 0, dashCd: 0, air: 0 };
}

const E = 1e-4;
const CELL = 2;

export class World {
  boxes: AABB[] = [];
  gravScale = 1;
  /** Uniform grid over the map's footprint, CELL metres square, row-major in x: box indices per cell (null = empty). */
  private grid: (number[] | null)[] = [];
  private gx0 = 0; private gz0 = 0; private gw = 0; private gh = 0;
  private stamp: Int32Array;
  private stampV = 0;
  private scratch: number[] = [];
  /** moveH's own copy of a query result: the step-up test inside its loop runs another query. */
  private scratchH: number[] = [];
  /** Walls and fixtures only (no loose objects): all that a sight line has to be tested against. */
  private walls: AABB[] = [];

  constructor(public map: GameMap) {
    for (const s of map.statics) this.boxes.push({ x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1, decor: -1 });
    for (const d of map.decor) {
      const def = PROPS[d.type];
      const [hx, hz] = footprint(def, d.yaw);
      this.boxes.push({ x0: d.x - hx, y0: d.y, z0: d.z - hz, x1: d.x + hx, y1: d.y + def.h, z1: d.z + hz, decor: d.id });
    }
    this.walls = this.boxes.filter((b) => b.decor < 0);
    this.stamp = new Int32Array(this.boxes.length);
    // a flat array rather than a hash map: a query is a few array reads, and cells keep the same contents in the same order
    let gx0 = 0, gz0 = 0, gx1 = 0, gz1 = 0;
    this.boxes.forEach((b, i) => {
      const ix0 = Math.floor(b.x0 / CELL), ix1 = Math.floor(b.x1 / CELL), iz0 = Math.floor(b.z0 / CELL), iz1 = Math.floor(b.z1 / CELL);
      if (i === 0 || ix0 < gx0) gx0 = ix0;
      if (i === 0 || iz0 < gz0) gz0 = iz0;
      if (i === 0 || ix1 > gx1) gx1 = ix1;
      if (i === 0 || iz1 > gz1) gz1 = iz1;
    });
    this.gx0 = gx0; this.gz0 = gz0; this.gw = gx1 - gx0 + 1; this.gh = gz1 - gz0 + 1;
    this.grid = new Array(this.boxes.length ? this.gw * this.gh : 0).fill(null);
    this.boxes.forEach((b, i) => {
      const ix0 = Math.floor(b.x0 / CELL), ix1 = Math.floor(b.x1 / CELL);
      const iz0 = Math.floor(b.z0 / CELL), iz1 = Math.floor(b.z1 / CELL);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const k = (ix - gx0) * this.gh + (iz - gz0);
        (this.grid[k] ??= []).push(i);
      }
    });
  }

  /** Candidate box indices overlapping the XZ rectangle (deduplicated). */
  private query(x0: number, z0: number, x1: number, z1: number): number[] {
    const out = this.scratch;
    out.length = 0;
    const sv = ++this.stampV;
    // cells outside the grid hold nothing: clamp the range to it
    const ix0 = Math.max(Math.floor(x0 / CELL), this.gx0), ix1 = Math.min(Math.floor(x1 / CELL), this.gx0 + this.gw - 1);
    const iz0 = Math.max(Math.floor(z0 / CELL), this.gz0), iz1 = Math.min(Math.floor(z1 / CELL), this.gz0 + this.gh - 1);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const cell = this.grid[(ix - this.gx0) * this.gh + (iz - this.gz0)];
      if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        const bi = cell[i];
        if (this.stamp[bi] !== sv) { this.stamp[bi] = sv; out.push(bi); }
      }
    }
    return out;
  }

  overlaps(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const c = this.query(x0, z0, x1, z1);
    for (let i = 0; i < c.length; i++) {
      const b = this.boxes[c[i]];
      if (x1 > b.x0 + E && x0 < b.x1 - E && y1 > b.y0 + E && y0 < b.y1 - E && z1 > b.z0 + E && z0 < b.z1 - E) return true;
    }
    return false;
  }

  /** Would a body of this size fit with its feet at (x, y, z)? */
  fits(x: number, y: number, z: number, hw: number, h: number): boolean {
    return !this.overlaps(x - hw, y, z - hw, x + hw, y + h, z + hw);
  }

  private moveH(b: Body, d: number, axisX: boolean, wasGround: boolean) {
    if (d === 0) return;
    if (axisX) b.x += d; else b.z += d;
    const q = this.query(b.x - b.hw, b.z - b.hw, b.x + b.hw, b.z + b.hw), c = this.scratchH;
    c.length = q.length;
    for (let i = 0; i < q.length; i++) c[i] = q[i];
    for (let i = 0; i < c.length; i++) {
      const o = this.boxes[c[i]];
      if (!(b.x + b.hw > o.x0 + E && b.x - b.hw < o.x1 - E && b.y + b.h > o.y0 + E && b.y < o.y1 - E && b.z + b.hw > o.z0 + E && b.z - b.hw < o.z1 - E)) continue;
      // step up small ledges
      if (wasGround && o.y1 - b.y <= CFG.STEP + E && this.fits(b.x, o.y1, b.z, b.hw, b.h)) { b.y = o.y1; continue; }
      if (axisX) { b.x = d > 0 ? o.x0 - b.hw : o.x1 + b.hw; b.vx = 0; }
      else { b.z = d > 0 ? o.z0 - b.hw : o.z1 + b.hw; b.vz = 0; }
    }
  }

  private moveV(b: Body, d: number) {
    b.y += d;
    b.ground = false;
    const c = this.query(b.x - b.hw, b.z - b.hw, b.x + b.hw, b.z + b.hw);
    for (let i = 0; i < c.length; i++) {
      const o = this.boxes[c[i]];
      if (!(b.x + b.hw > o.x0 + E && b.x - b.hw < o.x1 - E && b.y + b.h > o.y0 + E && b.y < o.y1 - E && b.z + b.hw > o.z0 + E && b.z - b.hw < o.z1 - E)) continue;
      if (d < 0) { b.y = o.y1; b.ground = true; } else { b.y = o.y0 - b.h; }
      b.vy = 0;
    }
    // tiny time steps can fall inside the epsilon; probe so "grounded" never flickers
    if (!b.ground && b.vy <= 0 && this.overlaps(b.x - b.hw, b.y - 0.02, b.z - b.hw, b.x + b.hw, b.y + 0.02, b.z + b.hw)) b.ground = true;
  }

  /** Advance one body by one input command. This is THE movement rule; both sides must call it identically. */
  step(b: Body, c: Cmd, speed: number, jumpV: number, canDash: boolean) {
    const dt = c.dt;
    if (b.dashCd > 0) b.dashCd = Math.max(0, b.dashCd - dt);
    if (b.dashLeft > 0) b.dashLeft = Math.max(0, b.dashLeft - dt);
    if (c.dash && canDash && b.dashCd <= 0) { b.dashLeft = CFG.DASH_TIME; b.dashCd = CFG.DASH_CD; }
    const sp = speed * (b.dashLeft > 0 ? CFG.DASH_MUL : 1);

    let mx = c.mx, mz = c.mz;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    const sin = Math.sin(c.yaw), cos = Math.cos(c.yaw);
    const wx = (cos * mx - sin * mz) * sp;
    const wz = (-sin * mx - cos * mz) * sp;

    const accel = (b.ground ? 85 : 28) * dt;
    const dvx = wx - b.vx, dvz = wz - b.vz;
    const dv = Math.hypot(dvx, dvz);
    if (dv <= accel || dv === 0) { b.vx = wx; b.vz = wz; }
    else { b.vx += (dvx / dv) * accel; b.vz += (dvz / dv) * accel; }

    const wasGround = b.ground;
    b.vy -= CFG.GRAVITY * this.gravScale * dt;
    // coyote time: a jump still counts for a moment after walking off a ledge
    if (b.ground) b.air = 0; else b.air += dt;
    if (c.jump && (b.ground || (b.air < CFG.COYOTE && b.vy <= 0))) { b.vy = jumpV; b.air = 1; }
    if (b.vy < -40) b.vy = -40;

    // sub-step so fast bodies can never tunnel through thin walls, whatever dt the command carries
    const n = Math.max(1, Math.ceil((Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt) / 0.15));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const g = i === 0 ? wasGround : b.ground;
      this.moveH(b, b.vx * h, true, g);
      this.moveH(b, b.vz * h, false, g);
      this.moveV(b, b.vy * h);
    }
  }

  /** Nearest hit of a ray against the world. Returns distance (Infinity if none) and the decor id (-1 = architecture). */
  /** Is the straight segment between two points free of walls and fixtures? Loose props are ignored. */
  sightClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    // the segment's own bounding box rules out most walls with six comparisons, before any division-heavy slab test
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sy0 = Math.min(ay, by), sy1 = Math.max(ay, by), sz0 = Math.min(az, bz), sz1 = Math.max(az, bz);
    const boxes = this.walls;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.x0 > sx1 || b.x1 < sx0 || b.z0 > sz1 || b.z1 < sz0 || b.y0 > sy1 || b.y1 < sy0) continue;
      let t0 = (b.x0 - ax) * ix, t1 = (b.x1 - ax) * ix;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      t0 = (b.y0 - ay) * iy; t1 = (b.y1 - ay) * iy;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      t0 = (b.z0 - az) * iz; t1 = (b.z1 - az) * iz;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax >= Math.max(tmin, 0) && tmin < 1) return false;
    }
    return true;
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): { t: number; decor: number } {
    let best = maxT, decor = -1, found = false;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      let t0 = (b.x0 - ox) * ix, t1 = (b.x1 - ox) * ix;
      let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
      t0 = (b.y0 - oy) * iy; t1 = (b.y1 - oy) * iy;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      t0 = (b.z0 - oz) * iz; t1 = (b.z1 - oz) * iz;
      tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
      if (tmax >= Math.max(tmin, 0) && tmin < best && tmin >= 0) { best = tmin; decor = b.decor; found = true; }
    }
    return { t: found ? best : Infinity, decor };
  }
}

/** Ray vs. a yaw-rotated box standing at (cx, cy, cz) (feet centre). Returns distance or Infinity. */
export function rayOBB(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, w: number, h: number, d: number, yaw: number, pad = 0,
): number {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const rx = ox - cx, rz = oz - cz;
  const lx = rx * c - rz * s, lz = rx * s + rz * c;
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  const hx = w / 2 + pad, hz = d / 2 + pad;
  let t0 = (-hx - lx) / ldx, t1 = (hx - lx) / ldx;
  let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
  t0 = (cy - pad - oy) / dy; t1 = (cy + h + pad - oy) / dy;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  t0 = (-hz - lz) / ldz; t1 = (hz - lz) / ldz;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  if (tmax >= Math.max(tmin, 0)) return Math.max(tmin, 0);
  return Infinity;
}

export function aimDir(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}
