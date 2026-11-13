/**
 * Sound and music. Nothing is downloaded: every instrument, drum and sound effect is synthesised in code (see
 * sound/dsp.ts) into small sample buffers, and the soundtrack is written out note by note (sound/songs.ts).
 *
 * Signal path:  music tracks -> per-track gain / pan / reverb send -> music bus -> ducker --+
 *               sound effects -> 3D panner (+ room reverb send) -> effects bus ---------+-> master -> compressor -> limiter
 * The engine runs on a live AudioContext in the game and on an OfflineAudioContext for renders and tests.
 */
import { INSTRUMENTS, SFX, SR, rnd } from './sound/dsp';
import { SONGS, STINGS, compile, type Compiled } from './sound/songs';

type Pos = [number, number, number] | undefined;

/** Sounds that are notes in a key: never detune them at random. */
const TUNED = new Set(['count', 'reveal', 'points', 'ready', 'go', 'chaos', 'lose', 'kill', 'spook']);
/** Sounds with a few renders to rotate through, so repeats do not sound mechanical. */
const VARIANTS: Record<string, number> = { squeak: 3, step: 3, stepSoft: 3, bonk: 3, shoot: 2, hit: 2, taunt0: 2, taunt4: 2, land: 2 };
/** Sounds that pull the music down for a moment so they are heard (the multiplier the music drops to). */
const DUCK: Record<string, number> = { squeak: 0.45, taunt0: 0.5, taunt1: 0.5, taunt2: 0.5, taunt3: 0.5, taunt4: 0.5, kill: 0.5, spook: 0.45, alarm: 0.4, go: 0.6, haunt: 0.6, lose: 0.35, win: 0.3 };
/** Level trims, from measuring every effect (`npm run audio:render`): frequent sounds sit lower, key moments higher. */
const LEVEL: Record<string, number> = { shoot: 2.4, hit: 1.6, squeak: 1.6, taunt3: 1.7, thud: 1.2, tick: 2, hover: 0.5, deny: 0.55, ready: 0.6, count: 0.8, click: 1.2, tock: 1.4, points: 0.45, heart: 0.8 };
const PITCHED = new Set(['marimba', 'glock', 'bell', 'epiano', 'pizz', 'harp', 'dbass', 'pbass', 'reed', 'brass', 'pad', 'lead']);

/** A generated reverb tail (at the context's own rate: a convolver insists on it). */
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, damp: number, seed: number): AudioBuffer {
  const rate = ctx.sampleRate, n = Math.ceil(seconds * rate), b = ctx.createBuffer(2, n, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch), R = rnd(seed + ch * 101);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate, bright = 0.08 + 0.85 * Math.exp(-t * damp);
      lp += bright * (R() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t * decay) * Math.min(1, t / 0.004);
    }
    for (let k = 0; k < 9; k++) { const at = Math.floor((0.006 + R() * 0.06) * rate); d[at] += (R() < 0.5 ? -1 : 1) * 0.5 * (1 - k / 10); }
  }
  return b;
}

interface Voice { src: AudioBufferSourceNode; g: GainNode; end: number; }

/** One song (or sting) being played: schedules its notes a little ahead of time, and can fade away. */
class Player {
  private cursor = 0; private offset = 0; private done = false;
  private chans: { g: GainNode; layer: number }[] = [];
  private group: GainNode;
  private voices = new Set<Voice>();
  private mono = new Map<number, Voice>();

  constructor(private e: AudioEngine, private c: Compiled, private t0: number, dest: AudioNode, private loop: boolean) {
    const ctx = e.ctx;
    this.group = ctx.createGain();
    this.group.connect(dest);
    for (const tr of c.song.tracks) {
      const g = ctx.createGain(), pan = ctx.createStereoPanner();
      g.gain.value = (tr.layer ?? 0) > 0 ? 0 : 1;
      pan.pan.value = tr.pan ?? 0;
      if (tr.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = tr.hp; f.Q.value = 0.6; g.connect(f); f.connect(pan); }
      else g.connect(pan);
      pan.connect(this.group);
      if (tr.verb) { const s = ctx.createGain(); s.gain.value = tr.verb; pan.connect(s); s.connect(e.musicVerb); }
      this.chans.push({ g, layer: tr.layer ?? 0 });
    }
  }

  /** 0..1: brings in the tracks whose layer threshold it reaches, over about a second. */
  setIntensity(v: number, at = this.e.ctx.currentTime) {
    for (const ch of this.chans) if (ch.layer > 0) ch.g.gain.setTargetAtTime(v >= ch.layer ? 1 : 0, at, 0.3);
  }

  /** Schedule every note that starts before `until` (seconds on the context clock). */
  pump(until: number) {
    if (this.done) return;
    const { events, spb, endBeat, loopBeat } = this.c;
    const now = this.e.ctx.currentTime;
    for (;;) {
      if (this.cursor >= events.length) {
        if (!this.loop) { this.done = true; return; }
        this.offset += endBeat - loopBeat;
        this.cursor = events.findIndex((ev) => ev.beat >= loopBeat);
        if (this.cursor < 0) { this.done = true; return; }
      }
      const ev = events[this.cursor];
      const at = this.t0 + (ev.beat + this.offset) * spb;
      if (at > until) return;
      this.cursor++;
      if (at < now - 0.05) continue; // fell behind (a hitch): skip rather than pile notes up
      this.note(ev.track, ev.midi, Math.max(at + (Math.random() - 0.5) * 0.004, now), ev.dur * spb, ev.vel * (0.94 + Math.random() * 0.12));
    }
  }

  private note(ti: number, midi: number, at: number, dur: number, vel: number) {
    const tr = this.c.song.tracks[ti], spec = INSTRUMENTS[tr.inst], ctx = this.e.ctx;
    if (!spec) return;
    const { buffer, rate } = this.e.sample(tr.inst, midi);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffer; src.playbackRate.value = rate;
    g.gain.value = tr.gain * vel;
    src.connect(g); g.connect(this.chans[ti].g);
    let end = at + buffer.duration / rate;
    if (spec.sustain) {
      const rel = spec.release ?? 0.1, off = at + dur;
      g.gain.setValueAtTime(tr.gain * vel, off);
      g.gain.setTargetAtTime(0, off, rel / 3);
      end = Math.min(end, off + rel * 2.5);
    }
    if (spec.mono) {
      const prev = this.mono.get(ti);
      if (prev && prev.end > at) { prev.g.gain.setTargetAtTime(0, at, 0.012); try { prev.src.stop(at + 0.06); } catch { /* already stopped */ } }
    }
    src.start(at); src.stop(end);
    const v: Voice = { src, g, end };
    this.voices.add(v);
    if (spec.mono) this.mono.set(ti, v);
    src.onended = () => this.voices.delete(v);
  }

  /** Fade out over `secs` and silence everything already scheduled. */
  stop(secs = 0.6) {
    const now = this.e.ctx.currentTime;
    this.done = true;
    this.group.gain.setTargetAtTime(0, now, secs / 3);
    for (const v of this.voices) { try { v.src.stop(now + secs * 1.5); } catch { /* ended */ } }
    setTimeout(() => { try { this.group.disconnect(); } catch { /* gone */ } }, secs * 2000 + 200);
  }
}

/** The audio graph and the sample bank. Context-agnostic: live or offline. */
export class AudioEngine {
  master: GainNode; musicBus: GainNode; duck: GainNode; sfxBus: GainNode; musicVerb: ConvolverNode; roomVerb: ConvolverNode; roomSend: GainNode;
  private bank = new Map<string, AudioBuffer>();
  private compiled = new Map<string, Compiled>();

  constructor(public ctx: BaseAudioContext) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.12;
    // a gentle high-pass first: nothing below about 35 Hz is audible on laptop or phone speakers, it only eats headroom
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 35; hp.Q.value = 0.7;
    this.master = ctx.createGain();
    this.master.connect(hp); hp.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
    this.duck = ctx.createGain(); this.duck.connect(this.master);
    // a little air on top: the synthesised instruments are warm, a real mix has more above 4 kHz
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 4500; air.gain.value = 5;
    air.connect(this.duck);
    this.musicBus = ctx.createGain(); this.musicBus.connect(air);
    this.musicVerb = ctx.createConvolver();
    // reverb returns are high-passed, as on a mixing desk, so the low end stays tight
    const mvHp = ctx.createBiquadFilter(); mvHp.type = 'highpass'; mvHp.frequency.value = 220;
    const mv = ctx.createGain(); mv.gain.value = 0.55; this.musicVerb.connect(mvHp); mvHp.connect(mv); mv.connect(this.musicBus);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.master);
    this.roomVerb = ctx.createConvolver();
    this.roomSend = ctx.createGain(); this.roomSend.gain.value = 0.28;
    const rvHp = ctx.createBiquadFilter(); rvHp.type = 'highpass'; rvHp.frequency.value = 160;
    this.roomSend.connect(this.roomVerb); this.roomVerb.connect(rvHp); rvHp.connect(this.sfxBus);
  }

  /** Indoors a room, outdoors almost nothing comes back. */
  room(kind: 'store' | 'meadow') {
    this.roomVerb.buffer = kind === 'meadow' ? impulse(this.ctx, 0.6, 9, 9, 31) : impulse(this.ctx, 1.3, 4.5, 7, 23);
    this.roomSend.gain.value = kind === 'meadow' ? 0.12 : 0.28;
  }

  private make(key: string, render: () => Float32Array): AudioBuffer {
    let b = this.bank.get(key);
    if (!b) {
      const data = render();
      b = this.ctx.createBuffer(1, data.length, SR);
      b.getChannelData(0).set(data);
      this.bank.set(key, b);
    }
    return b;
  }

  /** An instrument note: rendered at the nearest of every third semitone and pitched the rest of the way. */
  sample(inst: string, midi: number): { buffer: AudioBuffer; rate: number } {
    const base = PITCHED.has(inst) ? Math.round(midi / 3) * 3 : 60;
    return { buffer: this.make(`${inst}:${base}`, () => INSTRUMENTS[inst].make(base, base * 7 + 1)), rate: PITCHED.has(inst) ? Math.pow(2, (midi - base) / 12) : 1 };
  }

  sfxBuffer(name: string, variant: number): AudioBuffer | null {
    const gen = SFX[name];
    return gen ? this.make(`sfx:${name}:${variant}`, () => gen(variant * 13 + 5)) : null;
  }

  private compiledSong(name: string): Compiled | null {
    const def = SONGS[name] ?? STINGS[name];
    if (!def) return null;
    let c = this.compiled.get(name);
    if (!c) this.compiled.set(name, (c = compile(def)));
    return c;
  }

  song(name: string, at: number, intensity = 0): Player | null {
    const c = this.compiledSong(name);
    if (!c) return null;
    const p = new Player(this, c, at, SONGS[name] ? this.musicBus : this.sfxBus, !!SONGS[name]);
    p.setIntensity(intensity, at);
    return p;
  }

  /** Render the notes a song will need (up to `beats` into it), a few milliseconds at a time. True once all are ready. */
  warm(name: string, budgetMs = 6, beats = Infinity): boolean {
    const c = this.compiledSong(name);
    if (!c) return true;
    const t0 = performance.now();
    for (const ev of c.events) {
      if (ev.beat > beats) break;
      this.sample(c.song.tracks[ev.track].inst, ev.midi);
      if (performance.now() - t0 > budgetMs) return false;
    }
    return true;
  }
  /** Fill in the reverbs (they are silent until then): kept out of whatever created the engine, as they take a moment. */
  verbs() {
    this.musicVerb.buffer = impulse(this.ctx, 1.8, 3.2, 5, 11);
    this.room('store');
  }

  /** Pull the music down for a moment (to `level` of its volume, for `secs`). */
  duckFor(level: number, secs: number, at = this.ctx.currentTime) {
    const g = this.duck.gain;
    g.cancelScheduledValues(at);
    g.setTargetAtTime(level, at, 0.03);
    g.setTargetAtTime(1, at + secs, 0.35);
  }

  /** Fire a sound effect (or a sting) at `at`, optionally from a point in the world. */
  fire(name: string, at: number, vol = 1, pos?: Pos, rate = 1): boolean {
    if (STINGS[name]) { this.song(name, at)?.pump(at + 30); if (DUCK[name]) this.duckFor(DUCK[name], 2.5, at); return true; }
    const n = VARIANTS[name] ?? 1;
    const b = this.sfxBuffer(name, Math.floor(Math.random() * n));
    if (!b) return false;
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = b;
    src.playbackRate.value = rate;
    g.gain.value = vol * (LEVEL[name] ?? 1);
    src.connect(g);
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3.5; p.maxDistance = 70; p.rolloffFactor = 1.4;
      p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2];
      g.connect(p); p.connect(this.sfxBus); p.connect(this.roomSend);
    } else { g.connect(this.sfxBus); g.connect(this.roomSend); }
    src.start(at);
    if (DUCK[name] !== undefined) this.duckFor(DUCK[name], Math.min(1.2, b.duration + 0.15), at);
    return true;
  }
}

/** The game's sound system on the live audio context. */
export class Sfx {
  ctx: AudioContext | null = null;
  muted = false;
  volume = 0.8;
  musicVol = 0.5;
  private e: AudioEngine | null = null;
  private musicMode = 'none';
  private player: Player | null = null;
  private pendingAt = 0;
  private intensity = 0;
  private ambMode = '';
  private ambSrc: AudioBufferSourceNode | null = null;
  private ambTimer: number | null = null;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    } catch { return; }
    this.e = new AudioEngine(this.ctx);
    const e = this.e;
    setTimeout(() => { e.verbs(); if (this.ambMode) e.room(this.ambMode === 'meadow' ? 'meadow' : 'store'); }, 120);
    this.e.master.gain.value = this.muted ? 0 : this.volume;
    this.e.musicBus.gain.value = this.musicVol;
    window.setInterval(() => { const c = this.ctx; if (c && c.state === 'running') this.player?.pump(c.currentTime + 0.3); }, 25);
    if (this.musicMode !== 'none') { const m = this.musicMode; this.musicMode = 'none'; this.music(m); }
    if (this.ambMode) { const a = this.ambMode; this.ambMode = ''; this.ambience(a); }
    // render the songs most likely to play next in the background, a few milliseconds at a time
    const queue = ['lobby', 'sneak', 'roleProp', 'roleHunter', 'hunt', 'panic', 'win', 'levelup'];
    const warm = () => { const name = queue[0]; if (!name || !this.e) return; if (this.e.warm(name)) queue.shift(); setTimeout(warm, 30); };
    setTimeout(warm, 200);
  }

  setMusicVolume(v: number) { this.musicVol = v; if (this.ctx && this.e) this.e.musicBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }
  setVolume(v: number) { this.volume = v; if (this.ctx && this.e && !this.muted) this.e.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }
  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx && this.e) this.e.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { (l as any).setPosition(x, y, z); (l as any).setOrientation(fx, fy, fz, 0, 1, 0); }
  }

  play(name: string, pos?: Pos, vol = 1) {
    if (!this.ctx || !this.e || this.ctx.state !== 'running') return;
    const rate = TUNED.has(name) || STINGS[name] ? 1 : 1 + (Math.random() - 0.5) * 0.07;
    this.e.fire(name, this.ctx.currentTime + 0.005, vol * 0.9, pos, rate);
  }

  /** Switch the soundtrack ('lobby', 'sneak', 'hunt', 'panic', 'none'), after `delay` seconds if given. */
  music(mode: string, delay = 0) {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    if (!this.ctx || !this.e) return;
    this.player?.stop(mode === 'panic' ? 0.25 : 0.8);
    this.player = null;
    if (!SONGS[mode]) return;
    // render the first bars a few milliseconds at a time (already done if the background warm-up got there), then start
    const e = this.e, ctx = this.ctx, asked = performance.now();
    const go = () => {
      if (this.musicMode !== mode || this.player) return;
      if (!e.warm(mode, 8, 16)) { setTimeout(go, 16); return; }
      const at = ctx.currentTime + 0.08 + Math.max(0, delay - (performance.now() - asked) / 1000);
      this.pendingAt = at;
      this.player = e.song(mode, at, this.intensity);
    };
    go();
  }
  /** The soundtrack playing now. */
  get current() { return this.musicMode; }

  /** 0..1, how tense things are right now. The hunt music brings in layers as it rises. */
  setIntensity(v: number) {
    v = Math.max(0, Math.min(1, v));
    if (Math.abs(v - this.intensity) < 0.04) return;
    this.intensity = v;
    if (this.player && this.ctx && this.ctx.currentTime >= this.pendingAt) this.player.setIntensity(v);
  }

  /** A quiet bed of room tone indoors, wind and birdsong outdoors; also sets how much the room echoes. */
  ambience(kind: string) {
    if (kind === this.ambMode) return;
    this.ambMode = kind;
    if (this.ambSrc) { try { this.ambSrc.stop(); } catch { /* already stopped */ } this.ambSrc = null; }
    if (this.ambTimer !== null) { clearInterval(this.ambTimer); this.ambTimer = null; }
    const ctx = this.ctx, e = this.e;
    if (!ctx || !e || !kind) return;
    e.room(kind === 'meadow' ? 'meadow' : 'store');
    const n = SR * 4, b = ctx.createBuffer(2, n, SR);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch), R = rnd(ch + 5); let lp = 0; for (let i = 0; i < n; i++) { lp += 0.02 * (R() * 2 - 1 - lp); d[i] = lp * 6; } }
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = b; src.loop = true;
    f.type = 'lowpass'; f.frequency.value = kind === 'meadow' ? 900 : 260;
    g.gain.value = kind === 'meadow' ? 0.05 : 0.03;
    src.connect(f); f.connect(g); g.connect(e.sfxBus);
    src.start();
    this.ambSrc = src;
    if (kind === 'meadow') this.ambTimer = window.setInterval(() => {
      if (ctx.state !== 'running' || Math.random() > 0.4) return;
      // a bird somewhere off to the side: a few quick chirps from a random direction
      const a = Math.random() * Math.PI * 2, r = 25 + Math.random() * 20;
      const chirp = ctx.createOscillator(), cg = ctx.createGain(), p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.positionX.value = Math.cos(a) * r; p.positionY.value = 6; p.positionZ.value = Math.sin(a) * r;
      const base = 2600 + Math.random() * 1800, t = ctx.currentTime, k = 2 + Math.floor(Math.random() * 4);
      cg.gain.setValueAtTime(0, t);
      for (let i = 0; i < k; i++) {
        const s = t + i * 0.11;
        chirp.frequency.setValueAtTime(base, s); chirp.frequency.exponentialRampToValueAtTime(base * 1.35, s + 0.05);
        cg.gain.setValueAtTime(0, s); cg.gain.linearRampToValueAtTime(0.05, s + 0.01); cg.gain.linearRampToValueAtTime(0, s + 0.07);
      }
      chirp.connect(cg); cg.connect(p); p.connect(e.sfxBus);
      chirp.start(t); chirp.stop(t + k * 0.11 + 0.1);
    }, 1300);
  }
}

// ================================================================ offline rendering (sound test files, automated checks)
/**
 * Render a song, a sting or a sound effect (or 'sfx-all': every effect in a row) to a 16-bit stereo WAV, using the
 * exact engine the game uses, on an OfflineAudioContext. `intensity` sets the hunt music's layers.
 */
export async function renderWav(what: string, seconds: number, intensity = 1): Promise<{ wav: Uint8Array; order?: string[] }> {
  const rate = 48_000;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
  const e = new AudioEngine(ctx);
  e.verbs();
  e.musicBus.gain.value = 1;
  let order: string[] | undefined;
  if (SONGS[what]) e.song(what, 0.05, intensity)!.pump(seconds);
  else if (what === 'sfx-all') {
    order = [];
    let t = 0.3;
    for (const name of [...Object.keys(SFX), ...Object.keys(STINGS)]) {
      if (t > seconds - 1) break;
      e.fire(name, t, 0.9);
      order.push(`${t.toFixed(3)} s  ${name}`);
      t += (STINGS[name] ? 3.4 : e.sfxBuffer(name, 0)?.duration ?? 1) + 0.5;
    }
  } else e.fire(what, 0.05, 0.9);
  const out = await ctx.startRendering();
  return { wav: encodeWav(out), order };
}

export function encodeWav(b: AudioBuffer): Uint8Array {
  const ch = b.numberOfChannels, n = b.length, bytes = 44 + n * ch * 2, v = new DataView(new ArrayBuffer(bytes));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, b.sampleRate, true); v.setUint32(28, b.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => b.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Uint8Array(v.buffer);
}
