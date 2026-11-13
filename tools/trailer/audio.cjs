/**
 * The trailer soundtrack, rendered offline by the game's own audio engine (client/src/audio.ts): its
 * songs and its synthesised sound effects, scheduled on an OfflineAudioContext instead of the speakers.
 *   node audio.cjs <cues.json> <out-dir>      writes music.wav and sfx.wav (48 kHz stereo)
 * cues.json: { seconds, music: [{ t, mode }], sfx: [{ t, name, vol, d }] }
 *   music modes are the game's songs (lobby, sneak, hunt, panic) or 'none'; d is the distance from the
 *   camera (the game's own inverse distance model turns it into a level).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const [cuesFile, outDir] = process.argv.slice(2);

async function main() {
  const cues = JSON.parse(fs.readFileSync(cuesFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const bundle = require('esbuild').buildSync({ entryPoints: [path.join(ROOT, 'client/src/audio.ts')], bundle: true, format: 'iife', globalName: 'PPAudio', write: false, logLevel: 'warning' }).outputFiles[0].text;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({ content: bundle });
  for (const stem of ['music', 'sfx']) {
    const b64 = await page.evaluate(renderStem, { cues, stem });
    fs.writeFileSync(path.join(outDir, `${stem}.wav`), Buffer.from(b64, 'base64'));
    console.log('wrote', stem);
  }
  await browser.close();
  // mix: the game's music under its effects, then loudness-normalised for video platforms (-14 LUFS, two passes)
  const { execFileSync } = require('node:child_process');
  const mixIn = ['-i', path.join(outDir, 'music.wav'), '-i', path.join(outDir, 'sfx.wav')];
  // the music stem is far quieter than the effects (the game keeps its music under the gameplay); a trailer is the
  // other way round, so the music comes up and the effects' transients are tamed before they are summed
  const pre = `[0]volume=${process.env.MUSIC_VOL || 2.6}[m];[1]acompressor=threshold=-22dB:ratio=4:attack=2:release=120:makeup=4dB,volume=${process.env.SFX_VOL || 1.0}[s];[m][s]amix=inputs=2:normalize=0`;
  const target = 'I=-14:TP=-1.5:LRA=11'; // the measurement pass only
  const res = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', ...mixIn, '-filter_complex', `${pre},loudnorm=${target}:print_format=json`, '-t', String(cues.seconds), '-f', 'null', '-'], { encoding: 'utf8' });
  const m = JSON.parse(res.stderr.slice(res.stderr.lastIndexOf('{'), res.stderr.lastIndexOf('}') + 1));
  // make-up gain into a -2 dB ceiling (limited at 4x oversampling, so true peaks between samples are caught before AAC); the limiter eats some of it on a peaky mix, so measure and top up
  const outFile = path.join(outDir, 'mix.wav');
  const lufs = (f) => { const r = require('node:child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }); return Number(/I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.slice(r.stderr.lastIndexOf('Summary')))[1]); };
  let gain = -14 - Number(m.input_i);
  for (let pass = 0; pass < 4; pass++) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...mixIn, '-filter_complex', `${pre},volume=${gain.toFixed(2)}dB,aresample=192000,alimiter=limit=0.79:attack=1:release=80:level=false,aresample=48000`, '-t', String(cues.seconds), outFile]);
    const got = lufs(outFile);
    console.log(`pass ${pass + 1}: gain ${gain.toFixed(2)} dB -> ${got} LUFS`);
    if (Math.abs(got + 14) < 0.4) break;
    gain += -14 - got;
  }
  console.log('wrote mix');
}

/** Runs in the page. One Sfx instance per stem, so each gets the game's full chain (compressor, reverb). */
async function renderStem({ cues, stem }) {
  const SR = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (cues.seconds + 2)), SR);
  let now = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => now });
  Object.defineProperty(ctx, 'state', { get: () => 'running' });
  const Real = window.AudioContext;
  window.AudioContext = function () { return ctx; };
  const sfx = new PPAudio.Sfx();
  sfx.unlock();
  window.AudioContext = Real;
  window.setInterval = () => 0; // the song scheduler is driven by hand below
  sfx.volume = 0.8; sfx.master.gain.value = 0.8;
  sfx.musicGain.gain.value = 0.5;

  const events = stem === 'music'
    ? cues.music.map((m) => ({ t: m.t, run: () => sfx.music(m.mode) }))
    : cues.sfx.map((e) => ({ t: e.t, run: () => {
      // the game's inverse distance model: refDistance 3.5, rolloff 1.5
      const d = Math.max(3.5, e.d || 0), g = e.d ? 3.5 / (3.5 + 1.5 * (d - 3.5)) : 1;
      sfx.play(e.name, undefined, (e.vol ?? 1) * g);
    } }));
  events.sort((a, b) => a.t - b.t);
  let k = 0;
  for (now = 0; now < cues.seconds + 0.5; now += 0.025) {
    while (k < events.length && events[k].t <= now + 1e-6) { const t = now; now = events[k].t; events[k].run(); now = t; k++; }
    if (stem === 'music' && sfx.musicMode !== 'none') sfx.schedule();
  }
  const buf = await ctx.startRendering();
  // 16-bit PCM WAV
  const n = buf.length, ch = 2, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, SR, true); out.setUint32(28, SR * ch * 2, true);
  out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0, o = 44; i < n; i++, o += 4) {
    out.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    out.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  const bytes = new Uint8Array(out.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
