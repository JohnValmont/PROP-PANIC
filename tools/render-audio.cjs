/**
 * Render the soundtrack and every sound effect to audio files, through the game's own engine in a headless browser.
 *   npm run build && npm run audio:render [out-dir]      (default test/shots/audio; MP3s too if ffmpeg is installed)
 */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'test', 'shots', 'audio'));
const PORT = 8089;
const JOBS = [
  ['menu-theme', 'lobby', 72, 0], ['hiding', 'sneak', 40, 0], ['hunt-calm', 'hunt', 45, 0], ['hunt-close-call', 'hunt', 45, 1],
  ['panic-time', 'panic', 26, 0], ['all-sound-effects', 'sfx-all', 150, 0], ['taunts', 'sfx:taunt0,taunt1,taunt2,taunt3,taunt4', 6, 0],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, ['dist/server.cjs'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--mute-audio'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.goto(`http://localhost:${PORT}/?debug=1&noart=1`);
    await page.waitForFunction(() => window.__audio, null, { timeout: 30000 });
    let ffmpeg = true;
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }
    for (const [file, what, secs, intensity] of JOBS) {
      const t0 = Date.now();
      const r = await page.evaluate(async ([w, s, i]) => {
        const { wav, order } = await window.__audio.renderWav(w, s, i);
        let bin = '';
        for (let k = 0; k < wav.length; k += 0x8000) bin += String.fromCharCode.apply(null, wav.subarray(k, k + 0x8000));
        return { b64: btoa(bin), order };
      }, [what, secs, intensity]);
      const wavPath = path.join(OUT, `${file}.wav`);
      fs.writeFileSync(wavPath, Buffer.from(r.b64, 'base64'));
      if (r.order) fs.writeFileSync(path.join(OUT, `${file}.txt`), r.order.join('\n') + '\n');
      if (ffmpeg) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-q:a', '2', path.join(OUT, `${file}.mp3`)]);
      console.log(`${file}: ${secs} s rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    console.log('written to', OUT);
  } finally { await browser.close(); server.kill(); }
})().catch((e) => { console.error(e); process.exit(1); });
