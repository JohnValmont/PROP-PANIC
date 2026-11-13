/**
 * Sound synthesis by hand, sample by sample: no audio files. Everything here is a pure function from parameters to a
 * Float32Array of samples, so it runs the same in the browser and in Node (tests, offline renders).
 *
 * Instruments are physical or classic studio models rather than bare oscillators: plucked strings (Karplus-Strong),
 * struck bars and bells (sums of decaying modes), an FM electric piano, filtered band-limited saws for bass and brass.
 */
export const SR = 32_000;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- basics
/** Small seeded generator, so a sound renders identically every time. */
export function rnd(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const len = (s: number) => Math.max(1, Math.ceil(s * SR));
export function buf(seconds: number): Float32Array { return new Float32Array(len(seconds)); }

/** Mix `src` into `dst` at `at` seconds. */
export function mix(dst: Float32Array, src: Float32Array, at = 0, gain = 1): Float32Array {
  const o = Math.round(at * SR);
  const n = Math.min(src.length, dst.length - o);
  for (let i = Math.max(0, -o); i < n; i++) dst[i + o] += src[i] * gain;
  return dst;
}
export function gain(b: Float32Array, g: number): Float32Array { for (let i = 0; i < b.length; i++) b[i] *= g; return b; }
export function normalize(b: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  return m > 1e-6 ? gain(b, peak / m) : b;
}
export function softclip(b: Float32Array, drive = 1.5): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / k;
  return b;
}
/** Remove any DC offset and sub-audible rumble (a one-pole high-pass at about 25 Hz). */
export function dcBlock(b: Float32Array): Float32Array {
  const R = 1 - (TAU * 25) / SR;
  let x1 = 0, y1 = 0;
  for (let i = 0; i < b.length; i++) { const x = b[i], y = x - x1 + R * y1; x1 = x; y1 = y; b[i] = y; }
  return b;
}
/** DC blocked, linear fades at both ends (no clicks), then the silent tail cut. */
export function finish(b: Float32Array, fadeIn = 0.001, fadeOut = 0.01): Float32Array {
  dcBlock(b);
  const fi = len(fadeIn), fo = len(fadeOut);
  for (let i = 0; i < fi && i < b.length; i++) b[i] *= i / fi;
  for (let i = 0; i < fo && i < b.length; i++) b[b.length - 1 - i] *= i / fo;
  return trim(b);
}
/** Drop the tail once it is below -70 dB of the peak. */
export function trim(b: Float32Array): Float32Array {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  const floor = m * 3e-4;
  let end = b.length;
  while (end > 1 && Math.abs(b[end - 1]) < floor) end--;
  return end < b.length - 64 ? b.slice(0, Math.min(b.length, end + 64)) : b;
}

/** Attack / decay envelope value at time t: linear attack, exponential decay with time constant `d`. */
export const ad = (t: number, a: number, d: number) => (t < a ? t / a : Math.exp(-(t - a) / d));
/** Attack / hold-with-sag envelope for sustained instruments. */
export const ads = (t: number, a: number, d: number, s: number) => (t < a ? t / a : s + (1 - s) * Math.exp(-(t - a) / d));

// ---------------------------------------------------------------- oscillators (band-limited)
function blep(t: number, dt: number): number {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
export const saw = (p: number, dt: number) => 2 * p - 1 - blep(p, dt);
export const square = (p: number, dt: number, pw = 0.5) => (p < pw ? 1 : -1) + blep(p, dt) - blep((p - pw + 1) % 1, dt);

// ---------------------------------------------------------------- filters
/** Zero-delay state-variable filter (Zavalishin). Cutoff may change per sample; coefficients refresh every 8. */
export class SVF {
  private ic1 = 0; private ic2 = 0; private a1 = 0; private a2 = 0; private a3 = 0; private k = 1; private n = 0; private fc = -1;
  constructor(public mode: 'lp' | 'bp' | 'hp' | 'notch' = 'lp', fc = 1000, public q = 0.7) { this.set(fc, q); }
  set(fc: number, q = this.q) {
    fc = Math.min(SR * 0.45, Math.max(20, fc));
    if (fc === this.fc && q === this.q) return;
    this.fc = fc; this.q = q;
    const g = Math.tan((Math.PI * fc) / SR);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  run(x: number, fc?: number): number {
    if (fc !== undefined && (this.n++ & 7) === 0) this.set(fc);
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    switch (this.mode) { case 'lp': return v2; case 'bp': return v1; case 'hp': return x - this.k * v1 - v2; default: return x - this.k * v1; }
  }
}
export function filter(b: Float32Array, mode: SVF['mode'], fc: number | ((t: number) => number), q = 0.7): Float32Array {
  const f = new SVF(mode, typeof fc === 'number' ? fc : fc(0), q);
  for (let i = 0; i < b.length; i++) b[i] = typeof fc === 'number' ? f.run(b[i]) : f.run(b[i], fc(i / SR));
  return b;
}
/** Parallel band-pass resonances: turns a buzzy source into a vowel, a horn, a body. */
export function formants(b: Float32Array, list: [number, number, number][]): Float32Array {
  const fs = list.map(([f, q]) => new SVF('bp', f, q));
  for (let i = 0; i < b.length; i++) { let y = 0; for (let k = 0; k < fs.length; k++) y += fs[k].run(b[i]) * list[k][2]; b[i] = y; }
  return b;
}

// ---------------------------------------------------------------- generators
export interface ToneOpts {
  f0: number; f1?: number; dur: number;
  /** 'exp' (default) glides geometrically, 'lin' linearly. */
  glide?: 'exp' | 'lin';
  wave?: 'sine' | 'tri' | 'saw' | 'square';
  pw?: number;
  a?: number; d?: number; s?: number;
  vib?: number; vibHz?: number; vibDelay?: number;
  /** FM: modulator at f * ratio, index decaying with time constant `fmD` (seconds). */
  fm?: { ratio: number; index: number; d?: number };
  amp?: number;
}
export function tone(o: ToneOpts): Float32Array {
  const b = buf(o.dur), n = b.length;
  let p = 0, mp = 0;
  const a = o.a ?? 0.004, d = o.d ?? o.dur / 3, s = o.s ?? 0, amp = o.amp ?? 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR, k = t / o.dur;
    let f = o.f1 === undefined ? o.f0 : o.glide === 'lin' ? o.f0 + (o.f1 - o.f0) * k : o.f0 * Math.pow(o.f1 / o.f0, k);
    if (o.vib) f *= 1 + o.vib * Math.sin(TAU * (o.vibHz ?? 5.5) * t) * Math.min(1, Math.max(0, (t - (o.vibDelay ?? 0)) / 0.15));
    let ph = p;
    if (o.fm) { mp = (mp + (f * o.fm.ratio) / SR) % 1; ph = (p + (o.fm.index * Math.exp(-t / (o.fm.d ?? 1e9)) * Math.sin(TAU * mp)) / TAU + 1) % 1; }
    const dt = f / SR;
    let v: number;
    switch (o.wave ?? 'sine') {
      case 'saw': v = saw(ph, dt); break;
      case 'square': v = square(ph, dt, o.pw); break;
      case 'tri': v = 1 - 4 * Math.abs(ph - 0.5); break;
      default: v = Math.sin(TAU * ph);
    }
    b[i] = v * ads(t, a, d, s) * amp;
    p = (p + dt) % 1;
  }
  return b;
}

export interface NoiseOpts { dur: number; a?: number; d?: number; mode?: SVF['mode']; f0?: number; f1?: number; q?: number; amp?: number; seed?: number; }
export function noise(o: NoiseOpts): Float32Array {
  const b = buf(o.dur), R = rnd(o.seed ?? 7), a = o.a ?? 0.001, d = o.d ?? o.dur / 3, amp = o.amp ?? 1;
  const f = o.mode ? new SVF(o.mode, o.f0 ?? 1000, o.q ?? 0.7) : null;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    let v = R() * 2 - 1;
    if (f) v = f.run(v, o.f1 !== undefined ? (o.f0 ?? 1000) * Math.pow(o.f1 / (o.f0 ?? 1000), t / o.dur) : undefined);
    b[i] = v * ad(t, a, d) * amp;
  }
  return b;
}

/** A struck resonant body: a sum of exponentially decaying partials [ratio, amplitude, decay seconds]. */
export function modal(f: number, partials: [number, number, number][], dur: number, seed = 1, click = 0.3): Float32Array {
  const b = buf(dur), R = rnd(seed);
  for (const [r, amp, d] of partials) {
    const w = (TAU * f * r) / SR, ph = R() * TAU;
    if (f * r > SR * 0.45) continue;
    for (let i = 0; i < b.length; i++) b[i] += Math.sin(w * i + ph) * amp * Math.exp(-i / (d * SR));
  }
  if (click) mix(b, noise({ dur: 0.012, d: 0.002, mode: 'bp', f0: Math.min(9000, f * 4), q: 1.2, seed }), 0, click);
  return b;
}

/** Plucked string (Karplus-Strong) with fractional-delay tuning. `bright` 0..1 shapes the pluck, `decay` the ring time. */
export function pluck(f: number, dur: number, bright = 0.5, decay = 0.996, seed = 3): Float32Array {
  const b = buf(dur), R = rnd(seed);
  const L = SR / f - 0.5, N = Math.max(2, Math.floor(L)), frac = L - N, C = (1 - frac) / (1 + frac);
  const line = new Float32Array(N);
  const lp = new SVF('lp', 300 + bright * 9000, 0.6);
  for (let i = 0; i < N; i++) line[i] = lp.run(R() * 2 - 1);
  // a plucked string carries the average of its excitation for ever: start from zero mean, or it is a DC offset
  let mean = 0;
  for (let i = 0; i < N; i++) mean += line[i];
  mean /= N;
  for (let i = 0; i < N; i++) line[i] -= mean;
  let idx = 0, ax = 0, ay = 0;
  for (let i = 0; i < b.length; i++) {
    const y = line[idx], nx = line[(idx + 1) % N];
    const avg = decay * 0.5 * (y + nx);
    const ap = C * avg + ax - C * ay; ax = avg; ay = ap; // all-pass: fine tuning
    line[idx] = ap;
    b[i] = y;
    idx = (idx + 1) % N;
  }
  return b;
}

// ---------------------------------------------------------------- instruments
export type Inst = (midi: number, seed: number) => Float32Array;

export const INSTRUMENTS: Record<string, { make: Inst; sustain?: boolean; release?: number; mono?: boolean }> = {
  /** Wooden bars over tubes: warm fundamental, a quick fourth-ish overtone, a knock. */
  marimba: { make: (m, s) => { const f = mtof(m), k = Math.min(1, 330 / f); return normalize(finish(modal(f, [[1, 1, 0.55 * k + 0.25], [3.93, 0.32, 0.12], [9.2, 0.1, 0.04], [0.5, 0.04, 0.2]], 1.6, s, 0.25)), 0.85); } },
  /** Glockenspiel: bright steel bars, long ring. */
  glock: { make: (m, s) => normalize(finish(modal(mtof(m), [[1, 1, 1.4], [2.76, 0.45, 0.5], [5.4, 0.22, 0.2], [8.93, 0.1, 0.1]], 2.4, s, 0.15)), 0.8) },
  /** Bell: FM with an inharmonic ratio. */
  bell: { make: (m) => normalize(finish(tone({ f0: mtof(m), dur: 2.6, a: 0.002, d: 0.9, fm: { ratio: 3.51, index: 3.2, d: 0.6 } })), 0.8) },
  /** Electric piano: two-operator FM with a bell-like tine on top. */
  epiano: {
    sustain: true, release: 0.3,
    make: (m) => {
      const f = mtof(m);
      const body = tone({ f0: f, dur: 2.8, a: 0.003, d: 1.1, s: 0.18, fm: { ratio: 1, index: 1.9, d: 0.35 } });
      mix(body, tone({ f0: f * 14, dur: 0.15, a: 0.001, d: 0.03, amp: 0.12 }));
      mix(body, tone({ f0: f * 2, dur: 2.8, a: 0.003, d: 0.6, amp: 0.15 }));
      return normalize(finish(body, 0.001, 0.05), 0.8);
    },
  },
  /** Pizzicato strings: a short bright pluck through a woody body. */
  pizz: { make: (m, s) => { const f = mtof(m), b = pluck(f, 0.9, 0.42, 0.9935, s); filter(b, 'lp', 3500); for (let i = 0; i < b.length; i++) b[i] *= Math.exp(-i / (0.32 * SR)); return normalize(finish(formants(b, [[f, 0.8, 1], [420, 2, 0.4], [1200, 2, 0.25]])), 0.85); } },
  /** Harp: brighter, longer pluck. */
  harp: { make: (m, s) => normalize(finish(filter(pluck(mtof(m), 1.8, 0.55, 0.998, s), 'lp', 5000)), 0.8) },
  /** Upright bass: low pluck, round, short. */
  dbass: { mono: true, make: (m, s) => { const f = mtof(m), b = pluck(f, 1.2, 0.3, 0.9975, s); filter(b, 'lp', 900); for (let i = 0; i < b.length; i++) b[i] *= Math.exp(-i / (0.5 * SR)); mix(b, tone({ f0: f, dur: 0.5, a: 0.005, d: 0.25, amp: 0.5 })); return normalize(finish(b), 0.9); } },
  /** Synth bass: band-limited saw plus a sub, through a filter that closes after the attack. */
  pbass: {
    mono: true,
    make: (m) => {
      const f = mtof(m), b = buf(0.9), flt = new SVF('lp', 2000, 1.4);
      let p = 0, q = 0;
      for (let i = 0; i < b.length; i++) {
        const t = i / SR;
        const v = saw(p, f / SR) * 0.6 + Math.sin(TAU * q) * 0.7;
        b[i] = flt.run(v, 220 + 2200 * Math.exp(-t / 0.07)) * ad(t, 0.003, 0.35);
        p = (p + f / SR) % 1; q = (q + f / SR) % 1;
      }
      return normalize(finish(softclip(b, 1.6), 0.002, 0.03), 0.9);
    },
  },
  /** Reed (bassoon / clarinet-ish): a narrow pulse through vowel-like resonances, with a vibrato that comes in late. */
  reed: {
    sustain: true, release: 0.07,
    make: (m) => {
      const f = mtof(m);
      const b = tone({ f0: f, dur: 2.5, wave: 'square', pw: 0.32, a: 0.035, d: 0.4, s: 0.75, vib: 0.006, vibHz: 5.2, vibDelay: 0.35 });
      filter(b, 'lp', Math.min(5000, f * 5), 0.8);
      formants(b, [[f * 1.5, 0.7, 0.9], [520, 3, 0.6], [1250, 4, 0.3]]);
      mix(b, noise({ dur: 2.5, a: 0.03, d: 0.15, mode: 'bp', f0: 1800, q: 2, amp: 0.05 }));
      return normalize(finish(b, 0.002, 0.05), 0.8);
    },
  },
  /** Brass section stab: two detuned saws, the filter blooms open on the attack. */
  brass: {
    sustain: true, release: 0.1,
    make: (m) => {
      const f = mtof(m), b = buf(2), flt = new SVF('lp', 600, 1.1);
      let p1 = 0, p2 = 0.3;
      for (let i = 0; i < b.length; i++) {
        const t = i / SR, fv = f * (1 + 0.004 * Math.sin(TAU * 5 * t) * Math.min(1, t / 0.4));
        const v = saw(p1, fv / SR) + saw(p2, (fv * 1.006) / SR);
        b[i] = flt.run(v, f * 1.5 + 3800 * (t < 0.05 ? t / 0.05 : 0.35 + 0.65 * Math.exp(-(t - 0.05) / 0.18))) * ads(t, 0.02, 0.3, 0.7);
        p1 = (p1 + fv / SR) % 1; p2 = (p2 + (fv * 1.006) / SR) % 1;
      }
      return normalize(finish(softclip(b, 1.3), 0.002, 0.05), 0.8);
    },
  },
  /** Warm pad: three detuned saws, slow attack, dark filter. */
  pad: {
    sustain: true, release: 0.8,
    make: (m) => {
      const f = mtof(m), b = buf(4.5), flt = new SVF('lp', 900, 0.8);
      const ps = [0, 0.33, 0.67], det = [1, 1.004, 0.9965];
      for (let i = 0; i < b.length; i++) {
        const t = i / SR;
        let v = 0;
        for (let k = 0; k < 3; k++) { v += saw(ps[k], (f * det[k]) / SR); ps[k] = (ps[k] + (f * det[k]) / SR) % 1; }
        b[i] = flt.run(v, 700 + 500 * Math.sin(TAU * 0.25 * t)) * ads(t, 0.5, 2, 0.6);
      }
      return normalize(finish(b, 0.01, 0.2), 0.7);
    },
  },
  /** Lead: square with a little saw, soft filter, vibrato. Chiptune heart, warmer body. */
  lead: {
    sustain: true, release: 0.06,
    make: (m) => {
      const f = mtof(m);
      const b = tone({ f0: f, dur: 2, wave: 'square', pw: 0.42, a: 0.008, d: 0.5, s: 0.65, vib: 0.008, vibHz: 6, vibDelay: 0.2 });
      mix(b, tone({ f0: f * 1.003, dur: 2, wave: 'saw', a: 0.008, d: 0.5, s: 0.65, amp: 0.4, vib: 0.008, vibHz: 6, vibDelay: 0.2 }));
      filter(b, 'lp', Math.min(7000, f * 6), 0.9);
      return normalize(finish(b, 0.002, 0.05), 0.75);
    },
  },
  // ---- drums (the note number is ignored, or used for small variations)
  kick: {
    make: () => {
      const b = buf(0.5);
      let p = 0;
      for (let i = 0; i < b.length; i++) { const t = i / SR, f = 46 + 110 * Math.exp(-t / 0.035); b[i] = Math.sin(TAU * p) * ad(t, 0.001, 0.2); p += f / SR; }
      mix(b, noise({ dur: 0.01, d: 0.002, mode: 'lp', f0: 4000, amp: 0.6 }));
      return normalize(finish(softclip(b, 2)), 0.95);
    },
  },
  snare: {
    make: (_, s) => {
      const b = tone({ f0: 210, f1: 170, dur: 0.18, a: 0.001, d: 0.05 });
      mix(b, tone({ f0: 340, dur: 0.12, a: 0.001, d: 0.03, amp: 0.5 }));
      mix(b, noise({ dur: 0.3, d: 0.075, mode: 'hp', f0: 1400, seed: s, amp: 1.2 }));
      return normalize(finish(b), 0.9);
    },
  },
  clap: {
    make: (_, s) => {
      const b = buf(0.4);
      for (let k = 0; k < 3; k++) mix(b, noise({ dur: 0.02, d: 0.004, mode: 'bp', f0: 1300, q: 1.2, seed: s + k }), k * 0.011);
      mix(b, noise({ dur: 0.35, a: 0.002, d: 0.08, mode: 'bp', f0: 1200, q: 1, seed: s + 9 }), 0.03, 0.8);
      return normalize(finish(b), 0.85);
    },
  },
  /** Hi-hat: six square waves at inharmonic ratios (the classic drum-machine recipe), high-passed. */
  hat: { make: (_, s) => metal(0.08, 0.025, s) },
  ohat: { make: (_, s) => metal(0.5, 0.17, s) },
  shaker: { make: (_, s) => normalize(finish(noise({ dur: 0.12, a: 0.012, d: 0.03, mode: 'bp', f0: 7000, q: 1, seed: s })), 0.6) },
  rim: { make: (_, s) => normalize(finish(modal(1750, [[1, 1, 0.025], [2.4, 0.4, 0.01]], 0.1, s, 0.5)), 0.7) },
  tom: { make: () => normalize(finish(tone({ f0: 150, f1: 95, dur: 0.45, a: 0.001, d: 0.15 })), 0.9) },
  crash: { make: (_, s) => { const b = metal(1.8, 0.6, s); mix(b, noise({ dur: 1.8, a: 0.002, d: 0.5, mode: 'hp', f0: 5000, seed: s, amp: 0.5 })); return normalize(finish(b), 0.7); } },
  snap: { make: (_, s) => normalize(finish(noise({ dur: 0.08, d: 0.012, mode: 'bp', f0: 2400, q: 2.5, seed: s })), 0.8) },
  brush: { make: (_, s) => normalize(finish(noise({ dur: 0.2, a: 0.02, d: 0.06, mode: 'bp', f0: 4500, q: 0.8, seed: s })), 0.6) },
};

function metal(dur: number, d: number, seed: number): Float32Array {
  const b = buf(dur), ratios = [2, 3, 4.16, 5.43, 6.79, 8.21], base = 40 * (1 + (seed % 3) * 0.01);
  const ps = ratios.map(() => 0);
  for (let i = 0; i < b.length; i++) {
    let v = 0;
    for (let k = 0; k < 6; k++) { v += ps[k] < 0.5 ? 1 : -1; ps[k] = (ps[k] + (base * ratios[k] * 10) / SR) % 1; }
    b[i] = v * ad(i / SR, 0.001, d);
  }
  filter(b, 'hp', 7000, 0.7); filter(b, 'hp', 7000, 0.7);
  return normalize(finish(b), 0.6);
}

// ================================================================ sound effects
// Each returns a mono buffer at SR. `s` is a seed for small differences between plays.
const cat = (...parts: [Float32Array, number, number?][]) => { const total = Math.max(...parts.map(([b, at]) => at + b.length / SR)); const out = buf(total); for (const [b, at, g] of parts) mix(out, b, at, g ?? 1); return out; };

/** A rubber squeak: a buzzy source pushed through two vowel resonances, pitch rising then falling. */
function squeakToy(f0: number, dur: number, s: number): Float32Array {
  const b = tone({ f0, f1: f0 * 1.6, dur: dur * 0.45, wave: 'saw', a: 0.01, s: 1, d: 9 });
  const c = tone({ f0: f0 * 1.6, f1: f0 * 1.15, dur: dur * 0.55, wave: 'saw', a: 0.001, d: dur * 0.3 });
  const out = cat([b, 0], [c, dur * 0.45]);
  formants(out, [[f0 * 1.3, 6, 1], [2600, 5, 0.5]]);
  mix(out, noise({ dur, a: 0.01, d: dur / 2, mode: 'bp', f0: 3000, q: 3, seed: s, amp: 0.08 }));
  return out;
}
function knock(f: number, s: number): Float32Array { return modal(f, [[1, 1, 0.09], [2.32, 0.5, 0.05], [4.1, 0.25, 0.02]], 0.25, s, 0.8); }
function whoosh(dur: number, f0: number, f1: number, s: number, amp = 1): Float32Array { return noise({ dur, a: dur * 0.4, d: dur * 0.25, mode: 'bp', f0, f1, q: 1.4, seed: s, amp }); }
function chime(notes: number[], gap: number, s: number, inst = 'glock'): Float32Array {
  const out = buf(gap * notes.length + 1.6);
  notes.forEach((m, i) => mix(out, INSTRUMENTS[inst].make(m, s + i), i * gap, 0.6));
  return out;
}
/**
 * A whistle: an almost pure tone (a touch of second harmonic) with breath noise following the pitch. `parts` are
 * [from Hz, to Hz, seconds] glided smoothly; a part with 0 Hz is a gap. `glide` > 0 slurs between steady notes.
 */
function whistle(parts: [number, number, number][], seed: number, vib = 0.006, vibHz = 5.5, glide = 0): Float32Array {
  const total = parts.reduce((t, p) => t + p[2], 0) + 0.06;
  const out = buf(total), R = rnd(seed), breath = new SVF('bp', 1000, 7);
  let ph = 0, t0 = 0, prevF = parts[0][0];
  for (const [f0, f1, d] of parts) {
    const o = Math.round(t0 * SR), n = Math.round(d * SR);
    if (f0 > 0) for (let i = 0; i < n && o + i < out.length; i++) {
      const t = i / SR, k = t / d, e = k * k * (3 - 2 * k); // ease in and out
      let f = f0 * Math.pow(f1 / f0, e);
      if (glide && t < glide) f = prevF + (f - prevF) * (t / glide);
      f *= 1 + vib * Math.sin(TAU * vibHz * (t0 + t)) * Math.min(1, t / 0.12);
      const env = Math.min(1, t / 0.025) * Math.min(1, (d - t) / 0.04);
      const tone = Math.sin(TAU * ph) + 0.06 * Math.sin(2 * TAU * ph);
      out[o + i] = tone * env + breath.run(R() * 2 - 1, f) * env * 0.18; // just a breath of air: it should sound clear
      ph = (ph + f / SR) % 1;
    }
    if (f1 > 0) prevF = f1;
    t0 += d;
  }
  return out;
}
function quack(f0: number, s: number): Float32Array {
  const b = tone({ f0, f1: f0 * 0.7, dur: 0.16, wave: 'saw', a: 0.005, d: 0.08, s: 0.4 });
  formants(b, [[900, 5, 1], [1700, 6, 0.7], [2900, 6, 0.25]]);
  mix(b, noise({ dur: 0.16, d: 0.05, mode: 'bp', f0: 1500, q: 2, seed: s, amp: 0.05 }));
  return softclip(b, 2);
}

const RAW_SFX: Record<string, (s: number) => Float32Array> = {
  // ---- the blaster
  shoot: (s) => cat(
    [tone({ f0: 2200, f1: 260, dur: 0.16, a: 0.001, d: 0.06, fm: { ratio: 0.5, index: 2.5, d: 0.05 } }), 0, 0.7],
    [noise({ dur: 0.05, d: 0.012, mode: 'hp', f0: 3000, seed: s }), 0, 0.45],
    [tone({ f0: 140, f1: 70, dur: 0.08, a: 0.001, d: 0.03 }), 0, 0.6],
  ),
  /** A prop got hit: a bright ding over a startled rubber "eep". */
  hit: (s) => cat([modal(1320, [[1, 1, 0.22], [2, 0.4, 0.1], [3, 0.2, 0.05]], 0.4, s, 0.2), 0], [squeakToy(900, 0.1, s), 0.01, 0.5]),
  /** An innocent object took the shot: a wooden knock with a rattle. */
  bonk: (s) => cat([knock(260 + (s % 5) * 18, s), 0], [knock(380, s + 1), 0.045, 0.35]),
  thud: (s) => cat([noise({ dur: 0.12, d: 0.03, mode: 'lp', f0: 500, seed: s }), 0], [tone({ f0: 95, f1: 60, dur: 0.1, d: 0.03 }), 0, 0.7]),
  /** Landing on a hunter's head: the cartoon "boyoyoing" and a couple of birds. */
  bonkHead: (s) => cat(
    [knock(220, s), 0],
    [tone({ f0: 180, f1: 520, dur: 0.5, a: 0.005, d: 0.25, vib: 0.18, vibHz: 24 }), 0.02, 0.6],
    [tone({ f0: 2600, f1: 3400, dur: 0.07, d: 0.03 }), 0.3, 0.25], [tone({ f0: 2900, f1: 3800, dur: 0.07, d: 0.03 }), 0.42, 0.25],
  ),
  /** Caught: a puff of smoke and a sparkly flourish. */
  kill: (s) => cat([whoosh(0.35, 800, 3500, s), 0, 0.6], [chime([84, 88, 91, 96], 0.06, s), 0.05, 0.9], [knock(180, s), 0, 0.5]),
  /** A decoy shot: a balloon pop. */
  pop: (s) => cat([noise({ dur: 0.06, a: 0.0005, d: 0.01, mode: 'hp', f0: 1500, seed: s }), 0, 1.2], [tone({ f0: 160, f1: 80, dur: 0.08, d: 0.03 }), 0, 0.6], [squeakToy(700, 0.12, s), 0.03, 0.25]),
  /** Changing shape: a soft puff and a few sparkles. */
  poof: (s) => { const R = rnd(s); return cat([whoosh(0.32, 500, 2800, s), 0, 0.8], ...[0, 1, 2].map((k) => [tone({ f0: 3000 + R() * 3000, dur: 0.12, d: 0.04 }), 0.08 + k * 0.05, 0.12] as [Float32Array, number, number])); },
  // ---- taunts
  // taunts: clear whistles, every one rising from low to high so a hunter learns the sound at once
  taunt0: (s) => whistle([[780, 2100, 0.55]], s, 0.006),                                          // a clean rising whistle
  taunt1: (s) => whistle([[880, 1500, 0.17], [0, 0, 0.07], [1050, 2250, 0.3]], s, 0.005),          // "fweet, FWEET"
  taunt2: (s) => whistle([[520, 2500, 0.95]], s, 0.012, 6.5),                                      // a long slide whistle
  taunt3: (s) => whistle([[784, 784, 0.1], [988, 988, 0.1], [1175, 1175, 0.1], [1568, 1568, 0.32]], s, 0.004, 0, 0.035), // a whistled arpeggio up
  taunt4: (s) => whistle([[700, 1850, 0.35], [1850, 1900, 0.4]], s, 0.016, 7),                     // up, then hold it with a wobble
  squeak: (s) => squeakToy(1050 + (s % 3) * 70, 0.17, s),
  // ---- hunter gadgets
  pulse: () => cat([tone({ f0: 620, f1: 1700, dur: 0.75, a: 0.01, d: 0.35, fm: { ratio: 2.01, index: 1.2, d: 0.2 } }), 0, 0.7], [tone({ f0: 1760, dur: 0.6, a: 0.002, d: 0.2 }), 0, 0.3]),
  shock: (s) => cat(
    [tone({ f0: 80, f1: 32, dur: 0.7, a: 0.002, d: 0.25 }), 0],
    [noise({ dur: 0.6, a: 0.003, d: 0.18, mode: 'lp', f0: 4000, f1: 200, seed: s }), 0, 0.9],
    [noise({ dur: 0.3, d: 0.05, mode: 'hp', f0: 3000, seed: s + 1 }), 0.02, 0.3],
  ),
  beep: () => tone({ f0: 1480, dur: 0.07, a: 0.003, d: 0.025 }),
  // ---- clock and signals
  tick: (s) => modal(2400, [[1, 1, 0.012], [2.7, 0.4, 0.006]], 0.05, s, 0.6),
  tock: (s) => modal(1500, [[1, 1, 0.02], [2.4, 0.5, 0.01]], 0.07, s, 0.6),
  /** Referee's pea whistle: a pure tone trilled by the pea, with breath. */
  go: (s) => { const b = tone({ f0: 2850, dur: 0.6, a: 0.02, d: 0.25, s: 0.7, vib: 0.045, vibHz: 38 }); mix(b, noise({ dur: 0.6, a: 0.02, d: 0.3, mode: 'bp', f0: 3000, q: 2, seed: s, amp: 0.25 })); return b; },
  /** Panic time: a comedy "awooga" horn, twice. */
  alarm: () => { const one = () => { const b = tone({ f0: 280, f1: 560, dur: 0.38, wave: 'saw', a: 0.02, d: 0.3, s: 0.8 }); formants(b, [[700, 2, 1], [1500, 3, 0.4]]); return softclip(b, 2); }; return cat([one(), 0], [one(), 0.45]); },
  freeze: () => cat(...[0, 0.1, 0.2].map((t) => [filter(tone({ f0: 1400, dur: 0.06, wave: 'square', a: 0.002, d: 0.03 }), 'lp', 3000), t, 0.5] as [Float32Array, number, number])),
  // ---- chaos
  blackout: (s) => cat([knock(120, s), 0, 0.8], [filter(tone({ f0: 220, f1: 28, dur: 1.1, wave: 'saw', a: 0.005, d: 0.5 }), 'lp', (t) => 2500 * Math.exp(-t * 3) + 100), 0.02, 0.7]),
  lightsOn: (s) => { const b = cat([knock(140, s), 0, 0.8], [tone({ f0: 100, dur: 0.7, wave: 'saw', a: 0.2, d: 0.4, amp: 0.25 }), 0.05]); filter(b, 'lp', 1800); return cat([b, 0], [tone({ f0: 300, f1: 900, dur: 0.4, a: 0.02, d: 0.2 }), 0.15, 0.4]); },
  chaos: (s) => { const out = buf(1.2); [0, 2, 4, 6, 8, 10, 12, 14, 16].forEach((st, i) => mix(out, INSTRUMENTS.harp.make(67 + st, s + i), i * 0.045, 0.45)); return mix(out, whoosh(0.6, 400, 4000, s), 0, 0.5); },
  sneeze: (s) => cat([noise({ dur: 0.35, a: 0.3, d: 0.1, mode: 'bp', f0: 900, f1: 2600, q: 3, seed: s, amp: 0.5 }), 0], [noise({ dur: 0.3, a: 0.002, d: 0.08, mode: 'bp', f0: 3800, f1: 900, q: 1.5, seed: s + 1 }), 0.38], [tone({ f0: 620, f1: 240, dur: 0.18, wave: 'saw', d: 0.06, amp: 0.3 }), 0.38]),
  // ---- props and hunters
  hurt: (s) => cat([knock(150, s), 0], [filter(tone({ f0: 420, f1: 140, dur: 0.25, wave: 'saw', d: 0.1 }), 'lp', 1500), 0, 0.5]),
  heart: () => cat([filter(tone({ f0: 62, f1: 45, dur: 0.15, d: 0.05 }), 'lp', 200), 0], [filter(tone({ f0: 55, f1: 40, dur: 0.17, d: 0.05 }), 'lp', 200), 0.16, 0.7]),
  /** Hunter robot footstep: a light metal clank over a thump. */
  step: (s) => cat([modal(420 + (s % 4) * 25, [[1, 0.5, 0.03], [2.63, 0.4, 0.02], [4.4, 0.25, 0.012]], 0.12, s, 0.3), 0], [noise({ dur: 0.08, d: 0.02, mode: 'lp', f0: 450, seed: s }), 0, 0.8]),
  stepSoft: (s) => noise({ dur: 0.07, d: 0.018, mode: 'lp', f0: 600, seed: s }),
  jump: (s) => whoosh(0.16, 450, 1600, s, 0.7),
  land: (s) => cat([noise({ dur: 0.1, d: 0.025, mode: 'lp', f0: 380, seed: s }), 0], [tone({ f0: 110, f1: 55, dur: 0.12, d: 0.04 }), 0, 0.8]),
  dash: (s) => whoosh(0.36, 600, 3500, s),
  quacked: (s) => cat([whoosh(0.3, 600, 3000, s), 0, 0.6], [quack(520, s), 0.15], [quack(470, s + 1), 0.35], [quack(400, s + 2), 0.55]),
  // ---- ghosts
  /** Something on the shelf moved by itself: two knocks from nowhere. */
  haunt: (s) => cat([knock(210, s), 0, 0.9], [knock(190, s + 1), 0.16, 0.7], [whoosh(0.5, 300, 900, s, 0.15), 0.05]),
  /** The hunter fell for it: a theremin "woooo" and a falling sparkle. */
  spook: (s) => { const b = tone({ f0: 420, f1: 330, dur: 1.1, a: 0.12, d: 0.6, s: 0.5, vib: 0.03, vibHz: 6 }); mix(b, tone({ f0: 840, f1: 660, dur: 1.1, a: 0.12, d: 0.6, s: 0.5, vib: 0.03, vibHz: 6, amp: 0.25 })); return cat([b, 0], [chime([91, 88, 84, 79], 0.07, s), 0.55, 0.6]); },
  // ---- interface
  click: (s) => modal(1300, [[1, 1, 0.02], [2.5, 0.3, 0.008]], 0.05, s, 0.4),
  hover: () => tone({ f0: 2200, dur: 0.025, a: 0.001, d: 0.008, amp: 0.4 }),
  /** "Nuh-uh": two soft low notes. */
  deny: () => cat([filter(tone({ f0: 196, dur: 0.09, wave: 'square', a: 0.003, d: 0.05, s: 0.3 }), 'lp', 900), 0], [filter(tone({ f0: 147, dur: 0.12, wave: 'square', a: 0.003, d: 0.06, s: 0.3 }), 'lp', 900), 0.09]),
  ready: (s) => chime([88, 95], 0.05, s),
  /** A coin: two notes, the second rings. */
  points: () => cat([filter(tone({ f0: 988, dur: 0.07, wave: 'square', a: 0.001, d: 0.05, s: 0.5 }), 'lp', 4000), 0, 0.35], [filter(tone({ f0: 1319, dur: 0.35, wave: 'square', a: 0.001, d: 0.12 }), 'lp', 4000), 0.07, 0.35]),
  count: (s) => INSTRUMENTS.marimba.make(81, s),
  reveal: (s) => cat([chime([79, 83, 86, 91, 95, 98], 0.07, s), 0], [whoosh(0.8, 2000, 6000, s, 0.2), 0]),
  /** Losing: the sad trombone. Four notes, each a plunger "wah", the last one wobbling. */
  lose: () => {
    const notes = [[58, 0.42], [57, 0.42], [56, 0.42], [55, 1.3]] as const, out = buf(2.7), flt = new SVF('lp', 600, 2);
    let p = 0, t0 = 0;
    for (const [m, d] of notes) {
      const n = len(d), o = Math.round(t0 * SR), last = m === 55;
      for (let i = 0; i < n && o + i < out.length; i++) {
        const t = i / SR, f = mtof(m) * (last ? 1 + 0.03 * Math.sin(TAU * 6 * t) * Math.min(1, t / 0.3) : 1) * (1 - 0.01 * Math.exp(-t / 0.04));
        const wah = 400 + 1600 * Math.sin(Math.min(1, t / (last ? 0.5 : 0.3)) * Math.PI * 0.5);
        out[o + i] = flt.run(saw(p, f / SR), wah) * ads(t, 0.03, 0.4, 0.8) * (1 - Math.max(0, (t - d + 0.08) / 0.08));
        p = (p + f / SR) % 1;
      }
      t0 += d;
    }
    return softclip(out, 1.6);
  },
};

/** Every effect leaves here DC-free and peaking just under full scale; loudness between them is set in audio.ts (LEVEL). */
export const SFX: Record<string, (s: number) => Float32Array> = Object.fromEntries(
  Object.entries(RAW_SFX).map(([name, gen]) => [name, (s: number) => normalize(finish(gen(s), 0.0005, 0.02), 0.9)]),
);
