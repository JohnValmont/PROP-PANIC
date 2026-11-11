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
  private grid = new Map<number, number[]>();
  private stamp: Int32Array;
  private stampV = 0;
  private scratch: number[] = [];

  constructor(public map: GameMap) {
    for (const s of map.statics) this.boxes.push({ x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1, decor: -1 });
    for (const d of map.decor) {
      const def = PROPS[d.type];
      const [hx, hz] = footprint(def, d.yaw);
      this.boxes.push({ x0: d.x - hx, y0: d.y, z0: d.z - hz, x1: d.x + hx, y1: d.y + def.h, z1: d.z + hz, decor: d.id });
    }
    this.stamp = new Int32Array(this.boxes.length);
    this.boxes.forEach((b, i) => {
      const ix0 = Math.floor(b.x0 / CELL), ix1 = Math.floor(b.x1 / CELL);
      const iz0 = Math.floor(b.z0 / CELL), iz1 = Math.floor(b.z1 / CELL);
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
        const k = (ix + 512) * 1024 + (iz + 512);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(i);
      }
    });
  }

  /** Candidate box indices overlapping the XZ rectangle (deduplicated). */
  private query(x0: number, z0: number, x1: number, z1: number): number[] {
    const out = this.scratch;
    out.length = 0;
    const sv = ++this.stampV;
    const ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
    const iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const cell = this.grid.get((ix + 512) * 1024 + (iz + 512));
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
    const c = this.query(b.x - b.hw, b.z - b.hw, b.x + b.hw, b.z + b.hw).slice();
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
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.decor >= 0) continue;
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
