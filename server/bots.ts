/**
 * Optional AI players. Bots are clearly labelled in the UI and exist so a lone player (or a small
 * group) always has a full round to play. They go through the same movement, hit and ability rules
 * as humans — no hidden information is used beyond what a hunter could plausibly see.
 */
import { CFG } from '../shared/constants';
import { BOUNDS } from '../shared/map';
import type { World, Cmd } from '../shared/physics';
import { PROPS } from '../shared/props';
import type { Player, Room } from './room';

const CELL = 0.5;

export class NavGrid {
  nx: number; nz: number;
  free: Uint8Array;
  private g: Float32Array;
  private from: Int32Array;
  private mark: Int32Array;
  private gen = 0;
  private freeList: number[] = [];

  constructor(world: World) {
    this.nx = Math.round((BOUNDS.x1 - BOUNDS.x0) / CELL);
    this.nz = Math.round((BOUNDS.z1 - BOUNDS.z0) / CELL);
    const n = this.nx * this.nz;
    this.free = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.from = new Int32Array(n);
    this.mark = new Int32Array(n);
    for (let iz = 0; iz < this.nz; iz++) for (let ix = 0; ix < this.nx; ix++) {
      const x = BOUNDS.x0 + (ix + 0.5) * CELL, z = BOUNDS.z0 + (iz + 0.5) * CELL;
      const ok = !world.overlaps(x - 0.36, 0.37, z - 0.36, x + 0.36, 1.74, z + 0.36);
      const i = iz * this.nx + ix;
      this.free[i] = ok ? 1 : 0;
      if (ok) this.freeList.push(i);
    }
  }

  cell(x: number, z: number): number {
    const ix = Math.floor((x - BOUNDS.x0) / CELL), iz = Math.floor((z - BOUNDS.z0) / CELL);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return iz * this.nx + ix;
  }
  center(i: number): [number, number] {
    return [BOUNDS.x0 + ((i % this.nx) + 0.5) * CELL, BOUNDS.z0 + (Math.floor(i / this.nx) + 0.5) * CELL];
  }
  isFree(x: number, z: number): boolean { const c = this.cell(x, z); return c >= 0 && this.free[c] === 1; }
  randomFree(): [number, number] { return this.center(this.freeList[Math.floor(Math.random() * this.freeList.length)]); }

  nearestFree(x: number, z: number, maxR = 8): number {
    const c0 = this.cell(Math.min(BOUNDS.x1 - 0.1, Math.max(BOUNDS.x0 + 0.1, x)), Math.min(BOUNDS.z1 - 0.1, Math.max(BOUNDS.z0 + 0.1, z)));
    if (c0 >= 0 && this.free[c0]) return c0;
    const cx = c0 % this.nx, cz = Math.floor(c0 / this.nx);
    for (let r = 1; r <= maxR; r++) {
      let best = -1, bd = 1e9;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
        const i = iz * this.nx + ix;
        if (!this.free[i]) continue;
        const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  lineFree(ax: number, az: number, bx: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(d / 0.2);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A* over the 8-connected grid. Returns waypoints (world coords) or null. */
  path(ax: number, az: number, bx: number, bz: number): [number, number][] | null {
    const start = this.nearestFree(ax, az), goal = this.nearestFree(bx, bz);
    if (start < 0 || goal < 0) return null;
    const gen = ++this.gen, nx = this.nx, nz = this.nz;
    const gx = goal % nx, gz = Math.floor(goal / nx);
    const heap: number[] = [], hf: number[] = [];
    const push = (i: number, f: number) => {
      let k = heap.length; heap.push(i); hf.push(f);
      while (k > 0) { const p = (k - 1) >> 1; if (hf[p] <= f) break; heap[k] = heap[p]; hf[k] = hf[p]; k = p; }
      heap[k] = i; hf[k] = f;
    };
    const pop = (): number => {
      const top = heap[0], li = heap.pop()!, lf = hf.pop()!;
      const n = heap.length;
      if (n > 0) {
        let k = 0;
        for (;;) {
          let c = 2 * k + 1; if (c >= n) break;
          if (c + 1 < n && hf[c + 1] < hf[c]) c++;
          if (hf[c] >= lf) break;
          heap[k] = heap[c]; hf[k] = hf[c]; k = c;
        }
        heap[k] = li; hf[k] = lf;
      }
      return top;
    };
    const h = (i: number) => { const dx = Math.abs((i % nx) - gx), dz = Math.abs(Math.floor(i / nx) - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    this.mark[start] = gen; this.g[start] = 0; this.from[start] = -1;
    push(start, h(start));
    let found = false;
    while (heap.length) {
      const cur = pop();
      if (cur === goal) { found = true; break; }
      const cx = cur % nx, cz = Math.floor(cur / nx), cg = this.g[cur];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const ix = cx + dx, iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
        const ni = iz * nx + ix;
        if (!this.free[ni]) continue;
        if (dx && dz && (!this.free[cz * nx + ix] || !this.free[iz * nx + cx])) continue;
        const ng = cg + (dx && dz ? 1.414 : 1);
        if (this.mark[ni] === gen && this.g[ni] <= ng) continue;
        this.mark[ni] = gen; this.g[ni] = ng; this.from[ni] = cur;
        push(ni, ng + h(ni));
      }
    }
    if (!found) return null;
    const out: [number, number][] = [];
    for (let i = goal; i !== -1; i = this.from[i]) out.push(this.center(i));
    out.reverse();
    return out;
  }
}

const BOT_NAMES = ['Wobbles', 'Pickle', 'Biscuit', 'Noodle', 'Sprocket', 'Mochi', 'Tater', 'Gizmo', 'Bongo', 'Waffles', 'Pebble', 'Zigzag', 'Dumpling', 'Clank'];
export function botName(taken: Set<string>): string {
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  const pool = free.length ? free : BOT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() + Math.random() - 2) / 1.15;
function angDiff(a: number, b: number): number { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

type State = 'idle' | 'toDecor' | 'toHide' | 'hidden' | 'flee' | 'wander' | 'patrol' | 'chase';

export class Bot {
  state: State = 'idle';
  private path: [number, number][] = [];
  private pi = 0;
  private yaw = Math.random() * 6.28;
  private pitch = 0;
  private wantJump = false;
  private wantDash = false;
  private stuckAt = 0; private sx = 0; private sz = 0; private stuckN = 0;
  private pauseUntil = 0;
  private nextThink = 0;
  private round = -1;
  private phase = '';
  // prop brain
  private decorTarget = -1;
  private nextTaunt = 0;
  private nextRelocate = 0;
  private freezeUntil = 0;
  private lastHp = 100;
  // hunter brain
  private targetId = -1; private targetDecoy = false;
  private targetSeenAt = 0;
  private nextShot = 0;
  private known = new Map<number, number>();
  private repathAt = 0;

  private setPath(room: Room, p: Player, x: number, z: number): boolean {
    const path = room.nav().path(p.body.x, p.body.z, x, z);
    if (!path || path.length < 1) { this.path = []; return false; }
    this.path = path; this.pi = 0; this.stuckN = 0; this.stuckAt = room.now + 700; this.sx = p.body.x; this.sz = p.body.z;
    return true;
  }

  /** Steer along the current path. Returns [mz, arrived]. */
  private follow(room: Room, p: Player, dt: number): [number, boolean] {
    if (this.pi >= this.path.length) return [0, true];
    const nav = room.nav(), b = p.body;
    if (this.pi + 1 < this.path.length && nav.lineFree(b.x, b.z, this.path[this.pi + 1][0], this.path[this.pi + 1][1])) this.pi++;
    const [tx, tz] = this.path[this.pi];
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d < 0.3) { this.pi++; return [1, this.pi >= this.path.length]; }
    const want = Math.atan2(-dx, -dz);
    const diff = angDiff(this.yaw, want);
    const maxTurn = 9 * dt;
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
    // stuck handling: hop, then give up on this path
    if (room.now > this.stuckAt) {
      if (Math.hypot(b.x - this.sx, b.z - this.sz) < 0.2) { this.wantJump = true; if (++this.stuckN >= 4) { this.path = []; return [0, true]; } }
      else this.stuckN = 0;
      this.sx = b.x; this.sz = b.z; this.stuckAt = room.now + 600;
    }
    return [Math.abs(diff) < 1.1 ? 1 : 0.25, false];
  }

  update(room: Room, p: Player, t: number, dt: number) {
    if (this.round !== room.round || this.phase !== room.phase) {
      const newRound = this.round !== room.round;
      this.round = room.round; this.phase = room.phase;
      this.path = []; this.targetId = -1; this.known.clear();
      if (newRound || room.phase === 'lobby') this.state = 'idle';
      if (room.phase === 'hunt' && p.team === 'hunter') this.state = 'patrol';
      this.nextTaunt = t + rand(12_000, 40_000); this.nextRelocate = t + rand(35_000, 80_000);
      this.lastHp = p.hp; this.pauseUntil = t + rand(200, 1200);
    }
    if (!p.alive) return;
    let mz = 0;
    if (room.phase === 'lobby' || room.phase === 'end') mz = this.lobby(room, p, t, dt);
    else if (p.team === 'prop') mz = this.propBrain(room, p, t, dt);
    else if (p.team === 'hunter') mz = this.hunterBrain(room, p, t, dt);

    const cmd: Cmd = { dt: dt / 2, mx: 0, mz, yaw: this.yaw, jump: this.wantJump, dash: this.wantDash };
    const facing = p.team === 'prop' && mz === 0 ? p.facing : this.yaw;
    room.applyCmd(p, cmd, this.pitch, facing, t);
    cmd.jump = false; cmd.dash = false;
    room.applyCmd(p, cmd, this.pitch, facing, t);
    this.wantJump = false; this.wantDash = false;
  }

  // ---------------------------------------------------------------- lobby / end: mill about being silly
  private lobby(room: Room, p: Player, t: number, dt: number): number {
    if (t < this.pauseUntil) return 0;
    if (this.state !== 'wander') {
      const [x, z] = room.nav().randomFree();
      if (Math.hypot(x - p.body.x, z - p.body.z) > 16 || !this.setPath(room, p, x, z)) { this.pauseUntil = t + 300; return 0; }
      this.state = 'wander';
    }
    const [mz, done] = this.follow(room, p, dt);
    if (done) {
      this.state = 'idle'; this.pauseUntil = t + rand(800, 4000);
      if (p.team === 'prop') {
        if (Math.random() < 0.5) { const d = this.nearDecor(room, p, 4); if (d >= 0) room.transform(p, d); }
        if (Math.random() < 0.35) room.taunt(p, Math.floor(Math.random() * 5));
      }
    }
    if (Math.random() < 0.004) this.wantJump = true;
    return mz;
  }

  private nearDecor(room: Room, p: Player, r: number): number {
    const c: number[] = [];
    for (const d of room.map.decor) if (Math.abs(d.x - p.body.x) < r && Math.abs(d.z - p.body.z) < r && d.y < 1.2) c.push(d.id);
    return c.length ? c[Math.floor(Math.random() * c.length)] : -1;
  }

  // ---------------------------------------------------------------- prop
  private propBrain(room: Room, p: Player, t: number, dt: number): number {
    const b = p.body;
    const hurt = p.hp < this.lastHp; this.lastHp = p.hp;
    let nearest = 1e9;
    for (const h of room.players.values()) if (h.team === 'hunter' && h.alive) nearest = Math.min(nearest, Math.hypot(h.body.x - b.x, h.body.z - b.z));

    if (room.phase === 'hunt' && (hurt || (this.state === 'hidden' && nearest < 2.2 && Math.random() < 0.01))) {
      // busted: run for it
      for (let i = 0; i < 8; i++) {
        const [x, z] = room.nav().randomFree();
        if (Math.hypot(x - b.x, z - b.z) > 9 && this.setPath(room, p, x, z)) { this.state = 'flee'; break; }
      }
      this.wantDash = true;
      if (Math.random() < 0.5) room.ability(p, 'decoy');
      if (p.hp <= 34 && Math.random() < 0.7) room.ability(p, 'ghost');
      this.freezeUntil = 0;
    }
    // a scanner pulse rewards holding still
    for (const pulse of room.pulses) if (t - pulse.t0 < 1700 && Math.hypot(pulse.x - b.x, pulse.z - b.z) < CFG.PULSE_RADIUS + 1 && this.state !== 'flee' && this.freezeUntil < pulse.t0) {
      this.freezeUntil = Math.random() < 0.75 ? pulse.t0 + 1800 : pulse.t0 + 1;
    }
    if (t < this.freezeUntil) return 0;

    switch (this.state) {
      case 'idle': {
        if (t < this.pauseUntil) return 0;
        // choose something on the floor to become
        const floor = room.map.decor.filter((d) => d.y === 0 && PROPS[d.type].h <= 1.4);
        for (let i = 0; i < 6; i++) {
          const d = floor[Math.floor(Math.random() * floor.length)];
          if (!d) break;
          if (Math.hypot(d.x - b.x, d.z - b.z) > 26) continue;
          const c = room.nav().nearestFree(d.x, d.z, 4);
          if (c < 0) continue;
          const [x, z] = room.nav().center(c);
          if (this.setPath(room, p, x, z)) { this.decorTarget = d.id; this.state = 'toDecor'; break; }
        }
        return 0;
      }
      case 'toDecor': {
        const [mz, done] = this.follow(room, p, dt);
        const d = room.map.decor[this.decorTarget];
        if (d && Math.hypot(d.x - b.x, d.z - b.z) < 2.6) {
          room.transform(p, d.id);
          // settle next to a twin of the same toy when possible
          const twins = room.map.decor.filter((o) => o.type === d.type && o.y === 0);
          const twin = twins[Math.floor(Math.random() * twins.length)] ?? d;
          let ok = false;
          for (let i = 0; i < 6 && !ok; i++) {
            const c = room.nav().nearestFree(twin.x + rand(-1.6, 1.6), twin.z + rand(-1.6, 1.6), 4);
            if (c >= 0) { const [x, z] = room.nav().center(c); ok = this.setPath(room, p, x, z); }
          }
          this.state = ok ? 'toHide' : 'hidden';
          return 0;
        }
        if (done) this.state = 'idle';
        return mz;
      }
      case 'toHide':
      case 'flee': {
        const [mz, done] = this.follow(room, p, dt);
        if (done) {
          this.state = 'hidden';
          p.facing = Math.round(this.yaw / (Math.PI / 2)) * (Math.PI / 2);
          this.nextRelocate = t + rand(40_000, 90_000);
        }
        return mz;
      }
      case 'hidden': {
        if (room.phase !== 'hunt') return 0;
        if (t > this.nextTaunt) {
          this.nextTaunt = t + rand(18_000, 45_000);
          if (nearest > 6) room.taunt(p, Math.floor(Math.random() * 5));
        }
        if (t > this.nextRelocate && nearest > 11) {
          this.nextRelocate = t + rand(40_000, 90_000);
          this.state = 'idle'; this.pauseUntil = 0;
        }
        return 0;
      }
    }
    return 0;
  }

  // ---------------------------------------------------------------- hunter
  private los(room: Room, p: Player, x: number, y: number, z: number): boolean {
    const ex = p.body.x, ey = p.body.y + CFG.HUNTER_EYE, ez = p.body.z;
    const dx = x - ex, dy = y - ey, dz = z - ez, d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return room.world.raycast(ex, ey, ez, dx / d, dy / d, dz / d, d).t >= d - 0.45;
  }

  private shootAt(room: Room, p: Player, x: number, y: number, z: number, t: number, sigma: number) {
    const ex = p.body.x, ey = p.body.y + CFG.HUNTER_EYE, ez = p.body.z;
    const dx = x - ex, dy = y - ey, dz = z - ez;
    const yaw = Math.atan2(-dx, -dz) + gauss() * sigma;
    const pitch = Math.atan2(dy, Math.hypot(dx, dz)) + gauss() * sigma;
    this.yaw = yaw; this.pitch = pitch;
    p.yaw = yaw; p.pitch = pitch; p.facing = yaw;
    room.fire(p, yaw, pitch, t);
    this.nextShot = t + rand(380, 560);
  }

  private hunterBrain(room: Room, p: Player, t: number, dt: number): number {
    if (room.phase !== 'hunt') return 0;
    const b = p.body;
    const quacked = p.quackUntil > t;

    if (t >= this.nextThink && !quacked) {
      this.nextThink = t + rand(300, 600);
      // what can I see?
      let hot: Player | null = null, hotD = 1e9;
      for (const q of room.players.values()) {
        if (q.team !== 'prop' || !q.alive || q.ghostUntil > t) continue;
        const d = Math.hypot(q.body.x - b.x, q.body.z - b.z);
        if (d > 20) continue;
        const cy = q.body.y + q.body.h / 2;
        if (!this.los(room, p, q.body.x, cy, q.body.z)) continue;
        const suspicious = t - q.lastMovedAt < 350 || q.panicUntil > t || q.revealUntil > t;
        if (suspicious) this.known.set(q.id, t + 4500);
        if ((this.known.get(q.id) ?? 0) > t) { if (d < hotD) { hot = q; hotD = d; } }
        else if (d < 7 && Math.random() < 0.035) { this.known.set(q.id, t + 2500); if (d < hotD) { hot = q; hotD = d; } }
      }
      if (hot) { this.targetId = hot.id; this.targetDecoy = false; this.targetSeenAt = t; this.state = 'chase'; }
      else {
        for (const d of room.decoys) {
          const dist = Math.hypot(d.x - b.x, d.z - b.z);
          if (dist > 14 || !this.los(room, p, d.x, d.y + 0.3, d.z)) continue;
          if (d.hopUntil > t - 600 || (dist < 7 && Math.random() < 0.03)) { this.targetId = d.id; this.targetDecoy = true; this.targetSeenAt = t; this.state = 'chase'; break; }
        }
      }
      // occasionally lose patience with a perfectly innocent toy
      if (this.state !== 'chase' && Math.random() < 0.014 && p.focus > 55) {
        const near = room.map.decor.filter((d) => Math.abs(d.x - b.x) < 6 && Math.abs(d.z - b.z) < 6);
        const d = near[Math.floor(Math.random() * near.length)];
        if (d && this.los(room, p, d.x, d.y + PROPS[d.type].h / 2, d.z)) this.shootAt(room, p, d.x, d.y + PROPS[d.type].h / 2, d.z, t, 0.01);
      }
      if (Math.random() < 0.03) room.ability(p, 'pulse');
      let close = false;
      for (const q of room.players.values()) if (q.team === 'prop' && q.alive && Math.hypot(q.body.x - b.x, q.body.z - b.z) < 4) close = true;
      if (Math.random() < (close ? 0.1 : 0.008)) room.ability(p, 'shock');
    }

    if (this.state === 'chase' && !quacked) {
      let tx = 0, ty = 0, tz = 0, ok = false, w = 0.5;
      if (this.targetDecoy) {
        const d = room.decoys.find((o) => o.id === this.targetId);
        if (d) { tx = d.x; ty = d.y + PROPS[d.type].h / 2; tz = d.z; ok = true; }
      } else {
        const q = room.players.get(this.targetId);
        if (q && q.alive && q.team === 'prop' && q.ghostUntil <= t) { tx = q.body.x; ty = q.body.y + q.body.h / 2; tz = q.body.z; ok = true; w = Math.min(PROPS[q.disguise].w, PROPS[q.disguise].h); }
      }
      if (!ok || t - this.targetSeenAt > 3500) { this.state = 'patrol'; this.path = []; this.targetId = -1; return 0; }
      const visible = this.los(room, p, tx, ty, tz);
      const dist = Math.hypot(tx - b.x, tz - b.z);
      // close in before firing: long shots mostly hit innocent toys and burn focus
      const far = dist > (w > 0.8 ? 12 : 8);
      if (visible) {
        this.targetSeenAt = t;
        if (!far && t >= this.nextShot) this.shootAt(room, p, tx, ty, tz, t, 0.012 + 0.0028 * dist);
        if (dist <= 4.5) {
          const want = Math.atan2(-(tx - b.x), -(tz - b.z));
          this.yaw += Math.max(-10 * dt, Math.min(10 * dt, angDiff(this.yaw, want)));
          return 0;
        }
      }
      if (this.path.length === 0 || this.pi >= this.path.length || t > this.repathAt) { this.repathAt = t + 1200; this.setPath(room, p, tx, tz); }
      return this.follow(room, p, dt)[0];
    }

    // patrol
    if (this.path.length === 0 || this.pi >= this.path.length) {
      if (t < this.pauseUntil) return 0;
      let x: number, z: number;
      const props = [...room.players.values()].filter((q) => q.team === 'prop' && q.alive);
      if (props.length && Math.random() < 0.45) {
        const q = props[Math.floor(Math.random() * props.length)];
        const c = room.nav().nearestFree(q.body.x + rand(-7, 7), q.body.z + rand(-7, 7));
        [x, z] = c >= 0 ? room.nav().center(c) : room.nav().randomFree();
      } else [x, z] = room.nav().randomFree();
      if (!this.setPath(room, p, x, z)) return 0;
    }
    const [mz, done] = this.follow(room, p, dt);
    if (done) { this.path = []; this.pauseUntil = t + rand(300, 1500); }
    this.pitch *= 0.9;
    return quacked ? mz * 0.9 : mz;
  }
}
