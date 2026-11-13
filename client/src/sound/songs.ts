/**
 * The soundtrack, written out note by note, and the little compiler that turns it into timed note events.
 *
 * Notation. A song has sections (an intro, A, B...), each with a chord chart: bars separated by `|`, and two chords in
 * one bar split it in half. Every track has a pattern per section, also in bars separated by `|`. Each bar is a run of
 * space-separated steps; the number of steps sets the grid (16 = sixteenth notes, 8 = eighths, 1 = the whole bar).
 * A pattern shorter than its section repeats.
 *
 *   .        rest (and the end of any held note)        -      hold the previous note
 *   C5 Bb3   an absolute note                          1 3 5 7  a tone of the current chord (7 = the octave if no seventh)
 *   ^ _      before a chord tone: an octave up / down    C       the whole chord, voiced close to the track's centre
 *   x X o    a drum hit, accented, soft                  ! ?     after a note: accented, soft
 */

export interface Track {
  inst: string;
  gain: number;
  pan?: number;
  /** Reverb send, 0..1. */
  verb?: number;
  /** Octave of the chord root for chord-tone steps (4 puts C at midi 60). */
  oct?: number;
  /** Centre (midi) around which `C` chords are voiced. */
  center?: number;
  /** Plays only once the music's intensity reaches this (0..1). Adaptive hunt music uses it. */
  layer?: number;
  /** Semitones added to absolute notes. */
  trans?: number;
  /** High-pass cutoff in Hz: keeps chords and melodies out of the bass's way. */
  hp?: number;
  notes: Record<string, string>;
}
export interface Song { bpm: number; swing?: number; chords: Record<string, string>; order: string[]; loop: number; tracks: Track[]; }
export interface NoteEv { beat: number; dur: number; track: number; midi: number; vel: number; }
export interface Compiled { song: Song; events: NoteEv[]; loopBeat: number; endBeat: number; spb: number; }

// ---------------------------------------------------------------- harmony
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY: Record<string, number[]> = {
  '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], '9': [0, 4, 7, 10, 14], add9: [0, 4, 7, 14],
};
function chord(sym: string): { root: number; iv: number[] } {
  const m = /^([A-G])(#|b)?(.*)$/.exec(sym);
  if (!m || !(m[3] in QUALITY)) throw new Error(`bad chord ${sym}`);
  return { root: (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, iv: QUALITY[m[3]] };
}
function note(tok: string): number | null {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(tok);
  return m ? PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12 * (Number(m[3]) + 1) : null;
}
/** Close voicing of a chord nearest `center`, moving as little as possible from the last one. */
function voice(c: { root: number; iv: number[] }, center: number, prev: number[] | null): number[] {
  const tones = c.iv.slice(0, 4).map((i) => (c.root + i) % 12);
  let best: number[] = [], bs = Infinity;
  for (let inv = 0; inv < tones.length; inv++) for (let oct = 2; oct <= 6; oct++) {
    const v: number[] = [];
    let last = -1;
    for (let k = 0; k < tones.length; k++) { let n = tones[(inv + k) % tones.length] + 12 * oct; while (n <= last) n += 12; v.push(n); last = n; }
    const mid = (v[0] + v[v.length - 1]) / 2;
    let score = Math.abs(mid - center);
    if (prev) score += 0.5 * v.reduce((s, n, i) => s + Math.abs(n - (prev[i] ?? prev[prev.length - 1])), 0) / v.length;
    if (score < bs) { bs = score; best = v; }
  }
  return best;
}

// ---------------------------------------------------------------- compiler
export function compile(song: Song): Compiled {
  const events: NoteEv[] = [];
  const bars = (s: string) => s.split('|').map((b) => b.trim());
  let beat = 0, loopBeat = 0;
  const voiced: (number[] | null)[] = song.tracks.map(() => null);
  song.order.forEach((sec, oi) => {
    if (oi === song.loop) loopBeat = beat;
    const chart = bars(song.chords[sec]).map((b) => b.split(/\s+/).map(chord));
    const nBars = chart.length;
    const chordAt = (barIdx: number, frac: number) => { const cs = chart[barIdx]; return cs[Math.min(cs.length - 1, Math.floor(frac * cs.length))]; };
    song.tracks.forEach((tr, ti) => {
      const src = tr.notes[sec];
      if (!src) return;
      const pat = bars(src);
      const held: { ev: NoteEv[] } = { ev: [] };
      for (let bi = 0; bi < nBars; bi++) {
        const toks = pat[bi % pat.length].split(/\s+/);
        const steps = toks.length, stepBeats = 4 / steps;
        toks.forEach((tok, si) => {
          const frac = si / steps;
          let at = beat + bi * 4 + si * stepBeats;
          if (song.swing && si % 2 === 1 && steps >= 8) at += song.swing * stepBeats;
          if (tok === '-') { for (const e of held.ev) e.dur += stepBeats; return; }
          held.ev = [];
          if (tok === '.') return;
          let vel = 1, t = tok;
          if (t.endsWith('!')) { vel = 1.3; t = t.slice(0, -1); } else if (t.endsWith('?')) { vel = 0.6; t = t.slice(0, -1); }
          const push = (midi: number) => { const e = { beat: at, dur: stepBeats, track: ti, midi, vel }; events.push(e); held.ev.push(e); };
          if (t === 'x' || t === 'X' || t === 'o') { vel = t === 'X' ? 1.3 : t === 'o' ? 0.5 : 1; push(60); return; }
          const abs = note(t);
          if (abs !== null) { push(abs + (tr.trans ?? 0)); return; }
          const c = chordAt(bi, frac);
          if (t === 'C') { const v = voice(c, tr.center ?? 64, voiced[ti]); voiced[ti] = v; v.forEach(push); return; }
          const m = /^([\^_]*)([1357])$/.exec(t);
          if (!m) throw new Error(`bad step "${tok}" in ${sec}`);
          const shift = [...m[1]].reduce((s, ch) => s + (ch === '^' ? 12 : -12), 0);
          const idx = { '1': 0, '3': 1, '5': 2, '7': 3 }[m[2] as '1']!;
          const iv = idx < c.iv.length ? c.iv[idx] : 12;
          push(12 * ((tr.oct ?? 3) + 1) + c.root + iv + shift);
        });
      }
    });
    beat += nBars * 4;
  });
  events.sort((a, b) => a.beat - b.beat);
  return { song, events, loopBeat, endBeat: beat, spb: 60 / song.bpm };
}

// ================================================================ the soundtrack
const R8 = '. | . | . | . | . | . | . | .';

export const SONGS: Record<string, Song> = {
  /** Menu, lobby and results: "Tumbleton's Theme". Bouncy, F major, a little swing. */
  lobby: {
    bpm: 118, swing: 0.12, order: ['I', 'A', 'A2', 'B', 'A'], loop: 1,
    chords: {
      I: 'F | C7',
      A: 'F | Dm7 | Gm7 | C7 | F | Dm7 | Gm7 C7 | F',
      A2: 'F | Dm7 | Gm7 | C7 | F | Dm7 | Gm7 C7 | F',
      B: 'Bb | Bbm | F | D7 | Gm7 | C7 | F | C7',
    },
    tracks: [
      { inst: 'kick', gain: 0.495, notes: { I: 'x . . . . . . . x . . . . . . .', A: 'x . . . . . . x x . . . . . . .', A2: 'x . . . . . . x x . . . . . . .', B: 'x . . . . . . x x . . . . . . .' } },
      { inst: 'clap', gain: 0.32, pan: 0.05, verb: 0.25, notes: { I: '. . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . x x', A: '. . . . x . . . . . . . x . . .', A2: '. . . . x . . . . . . . x . . .', B: '. . . . x . . . . . . . x . . .' } },
      { inst: 'shaker', gain: 0.352, pan: 0.35, notes: { A: 'o o x o o o x o o o x o o o x o', A2: 'o o x o o o x o o o x o o o x o', B: 'o o x o o o x o o o x o o o x o' } },
      { inst: 'hat', gain: 0.288, pan: -0.3, notes: { I: '. x . x . x . x', A: '. x . x . x . x', A2: '. x . x . x . x', B: '. x . x . x . x' } },
      { inst: 'crash', gain: 0.264, pan: 0.2, verb: 0.3, notes: { A: 'x | . | . | . | . | . | . | .', A2: R8, B: 'x | . | . | . | . | . | . | .' } },
      { inst: 'dbass', gain: 0.508, oct: 2, notes: { I: '1 . . . 5 . . . 1 . . . _5 . . .', A: '1 . . 1 _5 . . . 1 . . . 5 . _5 .', A2: '1 . . 1 _5 . . . 1 . . . 5 . _5 .', B: '1 . . . 5 . . 3 1 . . . 5 . 3 .' } },
      { inst: 'epiano', hp: 180, gain: 0.3, pan: -0.15, verb: 0.3, center: 66, notes: { I: '. C . C . C . C', A: '. C . C . C . C', A2: '. C . C . C . C', B: 'C - - - - - . C . . C - - - . .' } },
      {
        inst: 'marimba', gain: 0.5, pan: 0.15, verb: 0.25,
        notes: {
          A: 'C5 . A4 . C5 . F5 . E5 . D5 . C5 . A4 . | D5 . . . F4 . A4 . C5 - - - . . . . | Bb4 . D5 . F5 . D5 . E5 . F5 . G5 - - - | G5 . . . E5 . C5 . Bb4 . G4 . E4 - . . | A4 . C5 . F5 . A5 . G5 . F5 . E5 . F5 . | D5 - - - C5 . A4 . F4 - - - . . . . | G4 . Bb4 . D5 . F5 . E5 . G5 . Bb5 . G5 . | F5 - - - . . C5 . F4 - - - . . . .',
          A2: 'C5 . A4 . C5 . F5 . E5 . D5 . C5 . A4 . | D5 . . . F4 . A4 . C5 - - - . . . . | Bb4 . D5 . F5 . D5 . E5 . F5 . G5 - - - | G5 . . . E5 . C5 . Bb4 . G4 . E4 - . . | A4 . C5 . F5 . A5 . G5 . F5 . E5 . F5 . | D5 - - - C5 . A4 . F4 - - - . . . . | G4 . Bb4 . D5 . F5 . E5 . G5 . Bb5 . G5 . | F5 . C5 . A4 . C5 . F5 - - - . . . .',
          B: 'D5 - - - F5 - - - Bb5 - - - A5 - G5 - | F5 - - - Db5 - - - Bb4 - - - . . . . | C5 . . . A4 . C5 . F5 - - - E5 . F5 . | F#5 - - - A5 - - - D6 - - - C6 . A5 . | Bb5 - - - G5 - - - D5 - - - F5 . G5 . | E5 - - - G5 - - - Bb5 - A5 - G5 - E5 - | F5 - - - A5 - - - C6 - - - A5 . F5 . | G5 . E5 . C5 . Bb4 . G4 . A4 . Bb4 . B4 .',
        },
      },
      { inst: 'glock', hp: 300, gain: 0.2, pan: 0.35, verb: 0.45, trans: 12, notes: { A2: '. | . | . | . | A4 . C5 . F5 . A5 . G5 . F5 . E5 . F5 . | . | . | F5 - - - . . . . . . . . . . . .', B: 'D5 - - - F5 - - - Bb5 - - - A5 - G5 - | F5 - - - Db5 - - - Bb4 - - - . . . . | . | F#5 - - - A5 - - - D6 - - - C6 . A5 . | . | . | F5 - - - A5 - - - C6 - - - A5 . F5 . | .' } },
    ],
  },

  /** Hiding phase: "Tiptoe". Pizzicato and a sneaky reed, D minor, swung. */
  sneak: {
    bpm: 104, swing: 0.22, order: ['A', 'B'], loop: 0,
    chords: { A: 'Dm | Dm | Gm | A7 | Dm | Bb | Gm | A7', B: 'Bb | A7 | Dm | Dm | Gm | Dm | E7 | A7' },
    tracks: [
      { inst: 'dbass', gain: 0.574, oct: 2, notes: { A: '1 . . . _5 . . . 1 . . . _5 . . .', B: '1 . . . _5 . . . 1 . . . 3 . . .' } },
      { inst: 'snap', gain: 0.3, pan: 0.3, verb: 0.35, notes: { A: '. . . . x . . . . . . . x . . .', B: '. . . . x . . . . . . . x . . .' } },
      { inst: 'brush', gain: 0.33, pan: -0.3, notes: { A: 'o . o . o . o . o . o . o . o .', B: 'o . o . o . o . o . o . o . o .' } },
      { inst: 'pizz', hp: 160, gain: 0.32, pan: -0.25, verb: 0.2, center: 62, notes: { A: '. . C . . . . . . . C . . . . .', B: '. . C . . . C . . . C . . . . .' } },
      {
        inst: 'reed', gain: 0.42, pan: 0.15, verb: 0.3,
        notes: {
          A: 'D4 . E4 F4 . . A4 . . . . . . . . . | G#4 . A4 . . . F4 . D4 . . . . . . . | G4 . A4 Bb4 . . D5 . . . . . . . . . | C#5 . D5 . . . A4 . E4 . . . C#4 . . . | D4 . E4 F4 . . A4 . . . D5 . . . . . | D5 . C5 Bb4 . . F4 . . . D4 . . . . . | Bb4 . A4 G4 . . E4 . . . G4 . . . . . | A4 . . . G4 . . . E4 . C#4 . A3 . . .',
          B: 'D4 - - - - - - - F4 - - - - - - - | E4 - - - - - - - C#4 - - - - - - - | D4 - - - - - - - . . . . . . . . | . | Bb3 - - - - - - - D4 - - - - - - - | F4 - - - - - - - . . . . . . . . | D4 - - - - - - - B3 - - - - - - - | C#4 - - - - - - - . . . . . . . .',
        },
      },
      { inst: 'pizz', gain: 0.5, pan: 0.2, verb: 0.25, notes: { B: 'F5 . F5 . D5 . . . Bb4 . . . D5 . F5 . | E5 . E5 . C#5 . . . A4 . . . C#5 . E5 . | D5 . F5 . A5 . . . F5 . D5 . A4 . . . | D5 . . . . . . . . . . . . . . . | G4 . Bb4 . D5 . . . G5 . . . F5 . D5 . | F5 . . . E5 . D5 . A4 . . . . . . . | G#4 . B4 . D5 . . . E5 . . . D5 . B4 . | C#5 . . . E5 . . . A5 . . . . . . .' } },
    ],
  },

  /**
   * The hunt: "Searching". Quiet at heart, so squeaks and footsteps stay audible; layers come in as a hunter closes on a
   * prop (intensity rises) and as time runs low. A minor.
   */
  hunt: {
    bpm: 92, order: ['A', 'B'], loop: 0,
    chords: { A: 'Am | Am | F | F | Dm | Dm | E7 | E7', B: 'F | G | Em | Am | Dm | F | E7 | E7' },
    tracks: [
      { inst: 'pad', hp: 150, gain: 0.132, verb: 0.5, center: 60, notes: { A: 'C', B: 'C' } },
      { inst: 'pbass', gain: 0.234, oct: 2, notes: { A: '1 . . 1 . . . . 1 . . 1 . . . .', B: '1 . . 1 . . . . 1 . . 1 . . . .' } },
      { inst: 'rim', gain: 0.123, pan: 0.4, notes: { A: '. . o . . . o . . . o . . . o .', B: '. . o . . . o . . . o . . . o .' } },
      { inst: 'bell', hp: 250, gain: 0.088, pan: -0.35, verb: 0.6, notes: { A: R8, B: 'E5 - - - . . . . . . . . . . . . | . | D5 - - - . . . . C5 - - - . . . . | . | F5 - - - . . . . . . . . . . . . | . | E5 - - - . . . . . . . . G#4 - - - | .' } },
      { inst: 'marimba', hp: 120, gain: 0.132, pan: 0.25, verb: 0.3, oct: 4, layer: 0.35, notes: { A: '1 5 ^1 5 3 5 ^1 5 1 5 ^1 5 3 5 ^3 5', B: '1 5 ^1 5 3 5 ^1 5 1 5 ^1 5 3 5 ^3 5' } },
      { inst: 'kick', gain: 0.223, layer: 0.35, notes: { A: 'x . . . . . . . x . . . . . . .', B: 'x . . . . . . . x . . . . . . .' } },
      { inst: 'shaker', gain: 0.141, pan: -0.4, layer: 0.35, notes: { A: 'o o x o o o x o o o x o o o x o', B: 'o o x o o o x o o o x o o o x o' } },
      { inst: 'tom', gain: 0.165, pan: 0.1, layer: 0.35, verb: 0.3, notes: { A: '. | . . . . . . . . . . . . . . x .', B: '. | . . . . . . . . . . . . . . x .' } },
      { inst: 'pizz', gain: 0.165, pan: -0.2, oct: 4, layer: 0.7, notes: { A: '1 . 1 . 5 . 5 . 3 . 3 . 5 . 5 .', B: '1 . 1 . 5 . 5 . 3 . 3 . 5 . 5 .' } },
      { inst: 'snare', gain: 0.121, pan: 0.1, layer: 0.7, notes: { A: '. . o . x . . o . . o . x . . o', B: '. . o . x . . o . . o . x . . o' } },
    ],
  },

  /** The last 30 seconds: "Panic!". A cartoon chase, A minor, fast. */
  panic: {
    bpm: 168, order: ['A', 'B'], loop: 0,
    chords: { A: 'Am | Am | F | F | G | G | E7 | E7', B: 'Dm | Am | Bb | E7 | Dm | Am | Bb | E7' },
    tracks: [
      { inst: 'kick', gain: 0.54, notes: { A: 'x . . . x . . . x . . . x . . .', B: 'x . . . x . . . x . . . x . . .' } },
      { inst: 'snare', gain: 0.42, pan: 0.05, verb: 0.15, notes: { A: '. . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . x . x x X x X x', B: '. . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . x . x . x . x . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | . . . . x . . . . . . . x . . . | x x x x x x x x X x X x X X X X' } },
      { inst: 'hat', gain: 0.272, pan: -0.3, notes: { A: 'x o x o x o x o x o x o x o x o', B: 'x o x o x o x o x o x o x o x o' } },
      { inst: 'ohat', gain: 0.21, pan: 0.3, notes: { A: '. . x . . . x . . . x . . . x .', B: '. . x . . . x . . . x . . . x .' } },
      { inst: 'crash', gain: 0.288, pan: -0.2, verb: 0.3, notes: { A: 'x | . | . | . | x | . | . | .', B: 'x | . | . | . | x | . | . | .' } },
      { inst: 'pbass', gain: 0.468, oct: 2, notes: { A: '1 ^1 1 ^1 1 ^1 1 ^1', B: '1 ^1 1 ^1 1 ^1 1 ^1' } },
      { inst: 'brass', hp: 140, gain: 0.3, pan: -0.1, verb: 0.25, center: 63, notes: { A: 'C . . C . . C . . . C . C . . .', B: 'C - - - - - - - C - - - . . C .' } },
      { inst: 'marimba', hp: 120, gain: 0.22, pan: 0.3, oct: 4, notes: { A: '1 3 5 ^1 5 3 1 3 5 ^1 ^3 ^1 5 3 5 ^1', B: '1 3 5 ^1 5 3 1 3 5 ^1 ^3 ^1 5 3 5 ^1' } },
      {
        inst: 'lead', gain: 0.3, pan: 0.1, verb: 0.2,
        notes: {
          A: 'A4 . C5 . E5 . A5 . G5 . E5 . C5 . E5 . | A5 - - - G5 . E5 . D5 . E5 . C5 . . . | F5 . A5 . C6 . A5 . G5 . F5 . E5 . F5 . | A5 - - - G5 . F5 . E5 . C5 . A4 . . . | G4 . B4 . D5 . G5 . F5 . D5 . B4 . D5 . | G5 - - - F5 . D5 . C5 . D5 . B4 . . . | E5 . G#5 . B5 . G#5 . D5 . E5 . G#4 . B4 . | E5 - - - - - - - D5 . C5 . B4 . G#4 .',
          B: 'F5 - - - - - - - A5 - - - - - - - | E5 - - - - - - - C5 - - - - - - - | D5 - - - F5 - - - Bb5 - - - A5 - - - | G#5 - - - - - - - B5 - - - E6 - - - | F5 - - - - - - - A5 - - - - - - - | E5 - - - - - - - C5 - - - - - - - | D5 - - - F5 - - - Bb5 - - - A5 - - - | E6 . D6 . B5 . G#5 . E5 . D5 . B4 . G#4 .',
        },
      },
    ],
  },
};

/** One-shot flourishes, played through the sound effects (they ignore the music volume). */
export const STINGS: Record<string, Song> = {
  win: {
    bpm: 150, order: ['A'], loop: -1, chords: { A: 'C | C' },
    tracks: [
      { inst: 'brass', hp: 140, gain: 0.45, verb: 0.3, notes: { A: 'G4 . . C5 . . E5 . . G5 - - - - E5 . | G5 . . . C6 - - - - - - - - - - -' } },
      { inst: 'brass', hp: 140, gain: 0.3, verb: 0.3, notes: { A: 'E4 . . G4 . . C5 . . E5 - - - - C5 . | E5 . . . G5 - - - - - - - - - - -' } },
      { inst: 'glock', hp: 300, gain: 0.25, pan: 0.3, verb: 0.4, notes: { A: '. | . . . . C6 . E6 . G6 . C7 . . . . .' } },
      { inst: 'snare', gain: 0.35, notes: { A: 'o o o o o o o o o o o o x x x x | X . . . . . . . . . . . . . . .' } },
      { inst: 'kick', gain: 0.495, notes: { A: '. | x . . . . . . . . . . . . . . .' } },
      { inst: 'crash', gain: 0.42, verb: 0.3, notes: { A: '. | x' } },
      { inst: 'dbass', gain: 0.492, notes: { A: '. | C2 . . . . . . . . . . . . . . .' } },
    ],
  },
  levelup: {
    bpm: 150, order: ['A'], loop: -1, chords: { A: 'C' },
    tracks: [
      { inst: 'marimba', hp: 120, gain: 0.5, verb: 0.3, notes: { A: 'C5 E5 G5 C6 E6 G6 C7 - - - - - - - - -' } },
      { inst: 'glock', hp: 300, gain: 0.3, pan: 0.3, verb: 0.5, notes: { A: '. . . . . . C7 - - - - - - - - -' } },
    ],
  },
  roleProp: {
    bpm: 140, order: ['A'], loop: -1, chords: { A: 'C' },
    tracks: [
      { inst: 'marimba', hp: 120, gain: 0.55, verb: 0.3, notes: { A: 'G5 . E5 . C5 . G5 . C6 - - - . . . .' } },
      { inst: 'pizz', gain: 0.4, pan: -0.2, notes: { A: 'C4 . . . G3 . . . C4 . . . . . . .' } },
      { inst: 'glock', hp: 300, gain: 0.25, pan: 0.3, verb: 0.4, notes: { A: '. . . . . . . . C7 - - - . . . .' } },
    ],
  },
  roleHunter: {
    bpm: 96, order: ['A'], loop: -1, chords: { A: 'Dm | Dm' },
    tracks: [
      { inst: 'brass', hp: 140, gain: 0.5, verb: 0.35, notes: { A: 'D3 - . . D3 - . . Bb2 - - - - - - - | A2 - - - - - - - . . . . . . . .' } },
      { inst: 'brass', hp: 140, gain: 0.35, verb: 0.35, notes: { A: 'A3 - . . A3 - . . F3 - - - - - - - | E3 - - - - - - - . . . . . . . .' } },
      { inst: 'tom', gain: 0.5, verb: 0.3, notes: { A: 'x . . . x . . . X . . . . . . . | X . . . . . . . . . . . . . . .' } },
      { inst: 'kick', gain: 0.45, notes: { A: 'x . . . x . . . x . . . . . . . | x . . . . . . . . . . . . . . .' } },
    ],
  },
};
