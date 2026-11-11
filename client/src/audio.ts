/**
 * All sound is synthesised with WebAudio at runtime: no audio files to download, and every
 * squeak, honk and pew can be positioned in 3D so hunters can track props by ear.
 */
type Pos = [number, number, number] | undefined;

interface ToneOpts { type?: OscillatorType; f0: number; f1?: number; f2?: number; dur: number; gain?: number; at?: number; attack?: number; vib?: number; vibHz?: number; }
interface NoiseOpts { dur: number; gain?: number; freq?: number; f1?: number; q?: number; kind?: BiquadFilterType; at?: number; }

export class Sfx {
  ctx: AudioContext | null = null;
  muted = false;
  private master!: GainNode;
  private musicGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private musicMode = 'none';
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.musicMode !== 'none') { const m = this.musicMode; this.musicMode = 'none'; this.music(m); }
  }

  volume = 0.8;
  setVolume(v: number) { this.volume = v; if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
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

  private out(pos: Pos, dest?: AudioNode): AudioNode {
    const ctx = this.ctx!;
    if (!pos) return dest ?? this.master;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = 3.5; p.maxDistance = 70; p.rolloffFactor = 1.5;
    p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2];
    p.connect(this.master);
    return p;
  }

  private tone(o: ToneOpts, dest: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.f2 !== undefined ? o.dur * 0.5 : o.dur));
    if (o.f2 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t + o.dur);
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vibHz ?? 18; lg.gain.value = o.vib;
      l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + o.dur + 0.05);
    }
    const peak = o.gain ?? 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack ?? 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + o.dur + 0.05);
  }

  private noise(o: NoiseOpts, dest: AudioNode) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.at ?? 0);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf; src.loop = true;
    f.type = o.kind ?? 'lowpass'; f.frequency.setValueAtTime(o.freq ?? 1200, t); f.Q.value = o.q ?? 0.8;
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + o.dur);
    g.gain.setValueAtTime(o.gain ?? 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + o.dur + 0.05);
  }

  play(name: string, pos?: Pos, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const d = this.out(pos);
    const T = (o: ToneOpts) => this.tone({ ...o, gain: (o.gain ?? 0.2) * vol }, d);
    const N = (o: NoiseOpts) => this.noise({ ...o, gain: (o.gain ?? 0.2) * vol }, d);
    switch (name) {
      case 'shoot': T({ type: 'square', f0: 980, f1: 180, dur: 0.13, gain: 0.16 }); N({ dur: 0.07, freq: 5000, kind: 'highpass', gain: 0.12 }); break;
      case 'hit': T({ type: 'triangle', f0: 880, dur: 0.09, gain: 0.3 }); T({ type: 'triangle', f0: 1320, dur: 0.14, gain: 0.3, at: 0.06 }); break;
      case 'bonk': T({ type: 'sine', f0: 190, f1: 70, dur: 0.2, gain: 0.5 }); N({ dur: 0.06, freq: 900, gain: 0.25 }); break;
      case 'bonkHead': T({ type: 'sine', f0: 140, f1: 520, dur: 0.32, gain: 0.5, vib: 50, vibHz: 26 }); N({ dur: 0.07, freq: 700, gain: 0.4 }); T({ type: 'triangle', f0: 1568, dur: 0.1, gain: 0.2, at: 0.12 }); T({ type: 'triangle', f0: 2093, dur: 0.14, gain: 0.2, at: 0.22 }); break;
      case 'sneeze': N({ dur: 0.18, freq: 900, f1: 3800, kind: 'bandpass', gain: 0.15 }); N({ dur: 0.22, freq: 4200, f1: 600, kind: 'bandpass', gain: 0.5, at: 0.2 }); T({ type: 'sawtooth', f0: 700, f1: 260, dur: 0.2, gain: 0.25, at: 0.2 }); break;
      case 'levelup': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => T({ type: 'triangle', f0: f, dur: 0.2, gain: 0.22, at: i * 0.08 })); break;
      case 'thud': N({ dur: 0.08, freq: 500, gain: 0.2 }); break;
      case 'kill': N({ dur: 0.25, freq: 3000, f1: 400, gain: 0.3 }); [523, 659, 784, 1047].forEach((f, i) => T({ type: 'triangle', f0: f, dur: 0.16, gain: 0.25, at: i * 0.07 })); break;
      case 'pop': T({ type: 'sine', f0: 500, f1: 1400, dur: 0.07, gain: 0.35 }); N({ dur: 0.12, freq: 2500, kind: 'bandpass', gain: 0.3 }); break;
      case 'poof': N({ dur: 0.3, freq: 700, f1: 2600, kind: 'bandpass', gain: 0.25 }); T({ type: 'sine', f0: 300, f1: 900, dur: 0.18, gain: 0.15 }); break;
      case 'taunt0': T({ type: 'sine', f0: 900, f1: 1900, f2: 800, dur: 0.22, gain: 0.4 }); T({ type: 'sine', f0: 1000, f1: 2100, f2: 900, dur: 0.2, gain: 0.35, at: 0.26 }); break; // squeak
      case 'taunt1': T({ type: 'sawtooth', f0: 233, dur: 0.18, gain: 0.3 }); T({ type: 'sawtooth', f0: 311, dur: 0.18, gain: 0.25 }); T({ type: 'sawtooth', f0: 233, dur: 0.3, gain: 0.3, at: 0.22 }); T({ type: 'sawtooth', f0: 311, dur: 0.3, gain: 0.25, at: 0.22 }); break; // honk
      case 'taunt2': T({ type: 'sine', f0: 160, f1: 620, dur: 0.5, gain: 0.45, vib: 40, vibHz: 22 }); break; // boing
      case 'taunt3': T({ type: 'sawtooth', f0: 95, f1: 60, dur: 0.55, gain: 0.35, vib: 30, vibHz: 34 }); N({ dur: 0.5, freq: 400, gain: 0.2 }); break; // raspberry
      case 'taunt4': T({ type: 'sawtooth', f0: 620, f1: 380, dur: 0.14, gain: 0.3 }); T({ type: 'sawtooth', f0: 560, f1: 340, dur: 0.2, gain: 0.3, at: 0.17 }); break; // quack
      case 'squeak': T({ type: 'sine', f0: 1300, f1: 2300, f2: 1100, dur: 0.16, gain: 0.5 }); break;
      case 'pulse': T({ type: 'sine', f0: 320, f1: 1500, dur: 0.7, gain: 0.3 }); T({ type: 'sine', f0: 640, f1: 3000, dur: 0.7, gain: 0.12, at: 0.05 }); break;
      case 'shock': T({ type: 'sine', f0: 220, f1: 40, dur: 0.5, gain: 0.6 }); N({ dur: 0.45, freq: 2200, f1: 200, gain: 0.4 }); break;
      case 'tick': T({ type: 'square', f0: 1000, dur: 0.04, gain: 0.1 }); break;
      case 'tock': T({ type: 'square', f0: 660, dur: 0.07, gain: 0.18 }); break;
      case 'beep': T({ type: 'sine', f0: 1500, dur: 0.05, gain: 0.12 }); break;
      case 'go': [392, 523, 659, 784].forEach((f, i) => T({ type: 'sawtooth', f0: f, dur: i === 3 ? 0.5 : 0.13, gain: 0.2, at: i * 0.11 })); break;
      case 'hide': [659, 523, 392].forEach((f, i) => T({ type: 'triangle', f0: f, dur: 0.2, gain: 0.25, at: i * 0.13 })); break;
      case 'alarm': for (let i = 0; i < 4; i++) T({ type: 'square', f0: 620, f1: 930, dur: 0.24, gain: 0.16, at: i * 0.26 }); break;
      case 'win': [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => T({ type: 'triangle', f0: f, dur: 0.22, gain: 0.25, at: i * 0.11 })); break;
      case 'lose': [392, 370, 349, 262].forEach((f, i) => T({ type: 'sawtooth', f0: f, dur: 0.35, gain: 0.14, at: i * 0.22 })); break;
      case 'quacked': for (let i = 0; i < 3; i++) { T({ type: 'sawtooth', f0: 640 - i * 40, f1: 360, dur: 0.15, gain: 0.3, at: i * 0.17 }); } break;
      case 'blackout': T({ type: 'sawtooth', f0: 400, f1: 30, dur: 0.9, gain: 0.3 }); break;
      case 'lightsOn': T({ type: 'sine', f0: 200, f1: 900, dur: 0.4, gain: 0.25 }); break;
      case 'chaos': for (let i = 0; i < 6; i++) T({ type: 'square', f0: 300 + i * 120, dur: 0.07, gain: 0.14, at: i * 0.05 }); break;
      case 'hurt': T({ type: 'sawtooth', f0: 300, f1: 120, dur: 0.25, gain: 0.35 }); N({ dur: 0.15, freq: 1500, gain: 0.3 }); break;
      case 'heart': T({ type: 'sine', f0: 70, f1: 45, dur: 0.14, gain: 0.7 }); T({ type: 'sine', f0: 62, f1: 40, dur: 0.16, gain: 0.5, at: 0.17 }); break;
      case 'step': N({ dur: 0.07, freq: 420, gain: 0.5 }); T({ type: 'sine', f0: 110, f1: 60, dur: 0.07, gain: 0.35 }); break;
      case 'click': T({ type: 'triangle', f0: 700, f1: 1000, dur: 0.05, gain: 0.15 }); break;
      case 'deny': T({ type: 'square', f0: 180, dur: 0.12, gain: 0.12 }); break;
      case 'ready': T({ type: 'triangle', f0: 880, f1: 1320, dur: 0.1, gain: 0.1 }); break;
      case 'dash': N({ dur: 0.25, freq: 800, f1: 3500, kind: 'bandpass', gain: 0.25 }); break;
      case 'points': T({ type: 'triangle', f0: 1175, dur: 0.06, gain: 0.12 }); T({ type: 'triangle', f0: 1568, dur: 0.1, gain: 0.12, at: 0.06 }); break;
      case 'freeze': T({ type: 'square', f0: 1400, dur: 0.06, gain: 0.14 }); T({ type: 'square', f0: 1400, dur: 0.06, gain: 0.14, at: 0.1 }); T({ type: 'square', f0: 1400, dur: 0.06, gain: 0.14, at: 0.2 }); break;
    }
  }

  // ---------------------------------------------------------------- tiny step sequencer for mood music
  music(mode: string) {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    if (this.musicTimer !== null) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (!this.ctx || mode === 'none') return;
    this.step = 0;
    this.nextNote = this.ctx.currentTime + 0.08;
    this.musicTimer = window.setInterval(() => this.schedule(), 60);
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const mode = this.musicMode;
    const stepLen = mode === 'panic' ? 0.095 : mode === 'sneak' ? 0.16 : 0.2;
    while (this.nextNote < ctx.currentTime + 0.2) {
      const at = this.nextNote - ctx.currentTime, s = this.step++;
      const d = this.musicGain;
      const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
      if (mode === 'sneak') {
        const bass = [45, 0, 48, 0, 52, 0, 51, 0, 45, 0, 48, 0, 53, 52, 48, 0][s % 16];
        if (bass) this.tone({ type: 'triangle', f0: hz(bass), dur: 0.14, gain: 0.3, at }, d);
        if (s % 4 === 2) this.noise({ dur: 0.03, freq: 6000, kind: 'highpass', gain: 0.05, at }, d);
        if (s % 32 === 28) this.tone({ type: 'sine', f0: hz(76), f1: hz(72), dur: 0.3, gain: 0.08, at }, d);
      } else if (mode === 'panic') {
        const k = Math.floor(s / 32) % 2;
        const arp = [57, 60, 64, 69, 64, 60, 57, 60, 58, 61, 65, 70, 65, 61, 58, 61][s % 16] + (k ? 2 : 0);
        this.tone({ type: 'square', f0: hz(arp + 12), dur: 0.08, gain: 0.07, at }, d);
        if (s % 4 === 0) { this.tone({ type: 'sine', f0: 120, f1: 45, dur: 0.12, gain: 0.5, at }, d); this.tone({ type: 'sawtooth', f0: hz(k ? 35 : 33), dur: 0.3, gain: 0.14, at }, d); }
        if (s % 4 === 2) this.noise({ dur: 0.05, freq: 5000, kind: 'highpass', gain: 0.08, at }, d);
      } else if (mode === 'lobby') {
        const mel = [72, 76, 79, 83, 79, 76, 74, 77, 81, 84, 81, 77, 71, 74, 79, 83][s % 16];
        if (s % 2 === 0) this.tone({ type: 'sine', f0: hz(mel), dur: 0.5, gain: 0.07, at }, d);
        if (s % 8 === 0) this.tone({ type: 'triangle', f0: hz([48, 50, 43, 45][Math.floor(s / 8) % 4]), dur: 1.2, gain: 0.12, at }, d);
      }
      this.nextNote += stepLen;
    }
  }
}
