/**
 * A virtual clock for the server process, installed before any game code loads. Time only moves when
 * the capture script says so (advance), so a frame that takes the software renderer ten seconds still
 * covers exactly 1/30 s of game time on both sides of the socket.
 */
type Timer = { id: number; at: number; every: number; cb: (...a: unknown[]) => void; args: unknown[] };

let vt = 0;
const epoch = Date.now();
const timers = new Map<number, Timer>();
let nextId = 1;

class Handle {
  constructor(public id: number) {}
  unref() { return this; }
  ref() { return this; }
  hasRef() { return true; }
  refresh() { const t = timers.get(this.id); if (t) t.at = vt + (t.every || 0); return this; }
  [Symbol.toPrimitive]() { return this.id; }
}

function add(cb: (...a: unknown[]) => void, ms: unknown, every: boolean, args: unknown[]) {
  const id = nextId++;
  const d = Math.max(every ? 1 : 0, Number(ms) || 0);
  timers.set(id, { id, at: vt + d, every: every ? d : 0, cb, args });
  return new Handle(id);
}
const clear = (h: unknown) => { if (h != null) timers.delete(Number(h)); };

const g = globalThis as any;
g.setTimeout = (cb: any, ms?: number, ...a: unknown[]) => add(cb, ms, false, a);
g.setInterval = (cb: any, ms?: number, ...a: unknown[]) => add(cb, ms, true, a);
g.clearTimeout = clear;
g.clearInterval = clear;
Date.now = () => epoch + vt;
// seeded randomness: the preview run and the final run of a shot play out the same way
let seed = (Number(process.env.TRAILER_SEED) || 7) >>> 0;
Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
export const reseed = (n: number) => { seed = n >>> 0; };
performance.now = () => vt;

/** Move virtual time forward by ms, firing every timer that falls due, in order. */
export function advance(ms: number) {
  const end = vt + ms;
  for (;;) {
    let next: Timer | null = null;
    for (const t of timers.values()) if (t.at <= end && (!next || t.at < next.at)) next = t;
    if (!next) break;
    vt = Math.max(vt, next.at);
    if (next.every) next.at += next.every; else timers.delete(next.id);
    try { next.cb(...next.args); } catch (e) { console.error('[clock] timer failed', e); }
  }
  vt = end;
}
export const clockNow = () => vt;
