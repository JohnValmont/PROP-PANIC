/**
 * Render trailer shots from the real game.
 *   node run.cjs preview <outdir> [shot ...]   low-res stills every few frames, to check staging
 *   node run.cjs final   <outdir> [shot ...]   every frame at 1920x1080
 * Each shot writes <outdir>/<shot>/00000.jpg... and <outdir>/<shot>/log.json (sounds and music cues,
 * in seconds from the shot's first frame) for the soundtrack.
 */
const fs = require('node:fs');
const path = require('node:path');
const { boot, stepWorld } = require('./lib.cjs');
const SHOTS = require('./shots.cjs');
const EDIT = require('./edit.cjs');
/** Seconds of each shot the edit reaches into. */
const USED = {};
for (const c of EDIT.clips) USED[c.shot] = Math.max(USED[c.shot] || 0, c.in + c.dur);
USED[EDIT.end.shot] = Math.max(USED[EDIT.end.shot] || 0, EDIT.end.dur * 0.7);

const [mode = 'preview', OUT = 'out', ...only] = process.argv.slice(2);
const FINAL = mode === 'final';
const FPS = 30, DT = 1000 / FPS;
const EVERY = FINAL ? 1 : Number(process.env.PREVIEW_EVERY || 6);
const BUNDLE = process.env.TRAILER_BUNDLE;

async function main() {
  const list = SHOTS.filter((s) => !only.length || only.includes(s.name));
  const { server, browser, client } = await boot({ bundle: BUNDLE, port: 8130 + (process.pid % 50), width: FINAL ? 1920 : 640, height: FINAL ? 1080 : 360, name: 'You', look: 8 * 2 + 1 });
  await client.eval(() => { localStorage.setItem('pp_help', '0'); window.__pp.helpOn = false; window.__pp.locked = true; });
  const D = makeContext(server, client);
  for (const shot of list) {
    const dir = path.join(OUT, shot.name);
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    // the final render films only what the edit uses (plus a few frames of slack)
    const frames = FINAL && USED[shot.name] ? Math.min(Math.round(shot.seconds * FPS), Math.ceil(USED[shot.name] * FPS) + 4) : Math.round(shot.seconds * FPS);
    if (FINAL && fs.existsSync(path.join(dir, 'log.json')) && fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length >= frames) { console.log(`${shot.name}: already rendered`); continue; }
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jpg') || f === 'log.json') fs.unlinkSync(path.join(dir, f));
    await D.reset();
    await shot.setup(D);
    // warm-up: a few rendered frames so shadow maps and post-processing have caught up after a fast-forward
    await client.eval(() => { window.__pp.renderEvery = 1; });
    for (let w = 0; w < 3; w++) { D.i = -1; D.t = 0; if (shot.frame) await shot.frame(D, -1, 0); await stepWorld(server, client, DT); }
    const start = await client.eval(() => window.__vt.t);
    for (let i = 0; i < frames; i++) {
      const rec = i % EVERY === 0 || i === frames - 1;
      await client.eval((r) => { window.__pp.renderEvery = r ? 1 : 1e9; }, rec);
      D.i = i; D.t = i / FPS;
      if (shot.frame) await shot.frame(D, i, i / FPS);
      await stepWorld(server, client, DT);
      if (rec) await client.grab(path.join(dir, `${String(i).padStart(5, '0')}.jpg`), FINAL ? 93 : 80);
      if (FINAL && i % 30 === 0) process.stdout.write(`  ${shot.name} ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
    const log = await client.eval((s) => window.__log.filter((e) => e.t >= s).map((e) => ({ ...e, t: +((e.t - s) / 1000).toFixed(3) })), start);
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ seconds: shot.seconds, fps: FPS, every: EVERY, log }, null, 1));
    const q = await client.eval(() => window.__pp.quality);
    console.log(`${shot.name} [${q}]: ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s`, client.errors.length ? client.errors.splice(0) : '');
  }
  await browser.close(); server.stop();
}

function makeContext(server, client) {
  const D = {
    server, client,
    srv: (code) => server.eval(code),
    cli: (fn, arg) => client.eval(fn, arg),
    async ff(ms) {
      await client.eval(() => { window.__pp.renderEvery = 1e9; });
      for (let t = 0; t < ms; t += 50) await stepWorld(server, client, 50);
    },
    cam(p, l, fov = 50, extra = {}) { return client.eval((c) => { window.__cine = c; }, { p, l, fov, ...extra }); },
    noCam() { return client.eval(() => { window.__cine = null; }); },
    hud(on) { return client.eval((on) => window.__hud(on), on); },
    labels(on) { return client.eval((on) => { window.__labels = on; }, on); },
    /** Turn the camera player's view towards a point (k = how much of the way this frame). */
    aim(x, y, z, k = 1) {
      return client.eval(([x, y, z, k]) => {
        const g = window.__pp, c = g.camera.position;
        const dx = x - c.x, dy = y - c.y, dz = z - c.z;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
        let d = yaw - g.yaw; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
        g.yaw += d * k; g.pitch += (pitch - g.pitch) * k;
      }, [x, y, z, k]);
    },
    /** The real input paths: fire the blaster, use an ability, send a message as the client would. */
    fire() { return client.eval(() => window.__pp.fire()); },
    ab(k) { return client.eval((k) => window.__pp.useAbility(k), k); },
    send(m) { return client.eval((m) => window.__pp.net.send(m), m); },
    entPos(id) { return client.eval((id) => { const e = window.__pp.ents.get(id); return e ? [e.x, e.y, e.z] : null; }, id); },
    reset() { return client.eval(() => { window.__cine = null; window.__hud(true); window.__labels = true; window.__pp.keys.clear(); }); },
  };
  return D;
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
