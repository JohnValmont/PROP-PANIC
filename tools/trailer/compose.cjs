/**
 * Put the trailer together.
 *   node compose.cjs cues  <shots> <cues.json>                  sound cues for audio.cjs, from the shots' logs + the edit
 *   node compose.cjs video <shots> <out.mp4> [16x9|9x16] [audio-dir] [--from s --to s] [--half]
 * Frames are laid out by compose.html (the game's own stylesheet and font) and piped straight into ffmpeg.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const EDIT = require('./edit.cjs');

const ROOT = path.resolve(__dirname, '../..');
const [cmd, SHOTS, OUT, FORMAT = '16x9', AUDIO = '', ...rest] = process.argv.slice(2);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? Number(rest[i + 1]) : d; };
const HALF = rest.includes('--half');

// sounds the edit leaves out: footsteps and UI ticks pile up across cuts and muddy the mix
const SKIP = new Set(['step', 'stepSoft', 'hover', 'click', 'tick', 'beep']);

function cues() {
  const sfx = [];
  for (const c of EDIT.clips) {
    const f = path.join(SHOTS, c.shot, 'log.json');
    if (!fs.existsSync(f)) { console.warn('no log for', c.shot); continue; }
    const { log } = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const e of log) {
      if (e.k !== 'sfx' || SKIP.has(e.name)) continue;
      // keep what starts inside the clip's window (a sound that started just before a cut would be heard mid-note)
      const local = e.t - c.in;
      if (local < 0 || local >= c.dur - 0.05) continue;
      sfx.push({ t: +(c.start + local).toFixed(3), name: e.name, vol: e.vol, d: e.d, shot: c.shot });
    }
  }
  for (const s of EDIT.stingers) sfx.push({ ...s, d: 0 });
  sfx.sort((a, b) => a.t - b.t);
  return { seconds: EDIT.seconds, music: EDIT.music, sfx };
}

function layout(fmt) {
  // 9:16: the footage cropped to 4:3 (centre-weighted, so it plays a third bigger than letterboxed 16:9), captions below it
  if (fmt === '9x16') return { W: 1080, H: 1920, vertical: true, box: { x: 0, y: 470, w: 1080, h: 810, r: 0 }, capV: 1360, capTopV: 1360 };
  return { W: 1920, H: 1080, vertical: false, box: { x: 0, y: 0, w: 1920, h: 1080 } };
}

function frameIndex() {
  const out = {};
  for (const d of fs.readdirSync(SHOTS)) {
    const dir = path.join(SHOTS, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    out[d] = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).map((f) => parseInt(f, 10)).sort((a, b) => a - b);
  }
  return out;
}

function serve() {
  const css = fs.readdirSync(path.join(ROOT, 'dist/client/assets')).find((f) => f.endsWith('.css'));
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    let file = null, type = 'text/html';
    if (u === '/' ) file = path.join(__dirname, 'compose.html');
    else if (u === '/game.css') { file = path.join(ROOT, 'dist/client/assets', css); type = 'text/css'; }
    else if (u.startsWith('/shots/')) { file = path.join(SHOTS, path.normalize(u.slice(7)).replace(/^(\.\.[/\\])+/, '')); type = 'image/jpeg'; }
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=3600' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, () => r(server)));
}

async function video() {
  const L = layout(FORMAT);
  const scale = HALF ? 0.5 : 1;
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: L.W, height: L.H }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.error('page:', e.message));
  const edit = { ...EDIT, flashes: [EDIT.title.start, EDIT.clips.find((c) => c.shot === 'chaos_blackout').start, EDIT.end.start], url: process.env.TRAILER_URL ?? EDIT.url };
  await page.addInitScript(([E, F, L]) => { window.EDIT = E; window.FRAMES = F; window.LAYOUT = L; }, [edit, frameIndex(), L]);
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.evaluate(async () => { window.setupCompose(); await document.fonts.load('700 60px Fredoka'); await document.fonts.load('600 60px Fredoka'); await document.fonts.ready; });
  const cdp = await page.context().newCDPSession(page);

  const from = opt('--from', 0), to = opt('--to', EDIT.seconds);
  const n0 = Math.round(from * 30), n1 = Math.round(to * 30);
  const silent = !AUDIO || AUDIO === '-';
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-'];
  if (!silent) args.push('-ss', String(from), '-i', path.join(AUDIO, 'mix.wav'));
  args.push('-c:v', 'libx264', '-preset', HALF ? 'veryfast' : 'slow', '-crf', HALF ? '23' : '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  if (!silent) args.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest');
  args.push(OUT);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let n = n0; n < n1; n++) {
    await page.evaluate((T) => window.renderFrame(T), n / 30);
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 96 });
    if (!ff.stdin.write(Buffer.from(r.data, 'base64'))) await new Promise((res) => ff.stdin.once('drain', res));
    if (n % 150 === 0) console.log(`  ${(n / 30).toFixed(1)}s  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise((res) => ff.on('close', res));
  await browser.close(); server.close();
  console.log('wrote', OUT);
}

if (cmd === 'cues') { fs.writeFileSync(OUT, JSON.stringify(cues(), null, 1)); console.log('cues:', OUT); }
else if (cmd === 'video') video().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
else console.log('usage: see the top of compose.cjs');
