/** Every instrument, drum and sound effect renders clean audio; every song compiles.  Run: npm run test:audio */
import { INSTRUMENTS, SFX, SR } from '../client/src/sound/dsp';
import { SONGS, STINGS, compile } from '../client/src/sound/songs';

let failures = 0;
const ok = (c: unknown, label: string) => { if (c) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
function check(b: Float32Array) {
  let peak = 0, sum = 0, bad = 0;
  for (const v of b) { if (!Number.isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); sum += v; }
  return { bad, peak, dc: Math.abs(sum / b.length), secs: b.length / SR };
}

console.log('instruments');
const used = new Map<string, Set<number>>();
for (const s of [...Object.values(SONGS), ...Object.values(STINGS)]) for (const ev of compile(s).events) {
  const inst = s.tracks[ev.track].inst;
  if (!used.has(inst)) used.set(inst, new Set());
  used.get(inst)!.add(ev.midi);
}
for (const [inst, notes] of used) {
  ok(INSTRUMENTS[inst], `${inst} exists`);
  if (!INSTRUMENTS[inst]) continue;
  const lo = Math.min(...notes), hi = Math.max(...notes), probs: string[] = [];
  for (const m of new Set([lo, hi, Math.round((lo + hi) / 2)])) {
    const r = check(INSTRUMENTS[inst].make(Math.round(m / 3) * 3, 1));
    if (r.bad || r.peak > 1 || r.peak < 0.05 || r.dc > 0.01) probs.push(`midi ${m}: peak ${r.peak.toFixed(2)} dc ${r.dc.toFixed(4)} nan ${r.bad}`);
  }
  ok(!probs.length, `${inst} renders clean across its range (${lo}–${hi})${probs.length ? ': ' + probs.join('; ') : ''}`);
}

console.log('sound effects');
for (const [name, gen] of Object.entries(SFX)) {
  const r = check(gen(5));
  ok(!r.bad && r.peak <= 1.0001 && r.peak > 0.01 && r.dc < 0.02 && r.secs < 4, `${name}: ${r.secs.toFixed(2)} s, peak ${r.peak.toFixed(2)}${r.dc >= 0.02 ? `, DC ${r.dc.toFixed(3)}` : ''}`);
}

console.log('songs');
for (const [name, s] of Object.entries({ ...SONGS, ...STINGS })) {
  const c = compile(s);
  const loops = !!SONGS[name];
  ok(c.events.length > 5 && c.events.every((e) => Number.isFinite(e.beat) && e.dur > 0 && e.midi > 20 && e.midi < 110) && (!loops || c.loopBeat < c.endBeat),
    `${name}: ${c.events.length} notes, ${(c.endBeat * c.spb).toFixed(1)} s${loops ? `, loops from ${(c.loopBeat * c.spb).toFixed(1)} s` : ''}`);
}
const layered = SONGS.hunt.tracks.filter((t) => (t.layer ?? 0) > 0).length;
ok(layered >= 3, `the hunt music has ${layered} tracks that only come in as tension rises`);

console.log(failures ? `\n${failures} FAILED` : '\nAll audio checks passed.');
process.exit(failures ? 1 : 0);
