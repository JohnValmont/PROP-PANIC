/**
 * Lockstep capture: the real server (virtual clock, forked) and a real browser client (virtual clock,
 * init script) advance together one video frame at a time, and each frame is grabbed from the page.
 */
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Server {
  static async start({ bundle, port, env = {} }) {
    const s = new Server();
    s.proc = fork(bundle, [], { cwd: ROOT, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
    s.pending = new Map(); s.n = 0;
    process.on('exit', () => s.stop()); // never leave a server behind (it would also hold our stdout pipe open)
    s.proc.on('message', (m) => { const p = s.pending.get(m.id); if (p) { s.pending.delete(m.id); m.error ? p.rej(new Error(m.error)) : p.res(m.out); } });
    await new Promise((res, rej) => {
      s.proc.stdout.on('data', (d) => { const t = String(d); if (process.env.TRAILER_VERBOSE) process.stdout.write('[srv] ' + t); if (t.includes('PROP PANIC server')) res(); });
      s.proc.on('exit', (c) => rej(new Error('server exited ' + c)));
    });
    return s;
  }
  call(msg) { const id = ++this.n; return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.proc.send({ id, ...msg }); }); }
  advance(ms) { return this.call({ cmd: 'advance', ms }); }
  eval(code) { return this.call({ cmd: 'eval', code }); }
  stop() { try { this.proc.kill(); } catch { /* gone */ } }
}

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'];

class Client {
  static async open(browser, { url, width = 1920, height = 1080, quality = 'high', name = 'Camera', look = 0, storage = {} }) {
    const c = new Client();
    c.ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await c.ctx.addInitScript({ path: path.join(__dirname, 'vt-client.js') });
    await c.ctx.addInitScript(([q, name, look, storage]) => {
      localStorage.setItem('pp_quality', q); localStorage.setItem('pp_seen', '1'); localStorage.setItem('pp_name', name);
      localStorage.setItem('pp_look', String(look)); localStorage.setItem('pp_mute', '1');
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    }, [quality, name, look, storage]);
    c.page = await c.ctx.newPage();
    c.errors = [];
    c.page.on('pageerror', (e) => c.errors.push(e.message));
    c.page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load/.test(m.text())) c.errors.push(m.text()); });
    c.cdp = await c.ctx.newCDPSession(c.page);
    await c.page.goto(url);
    await c.page.waitForFunction(() => window.__pp && window.__assets, null, { timeout: 60000 });
    return c;
  }
  eval(fn, arg) { return this.page.evaluate(fn, arg); }
  /** Cinematic camera (window.__cine = { p, l, fov, roll }), a HUD switch, and a log of every sound and music cue. */
  async install() {
    await this.page.evaluate(() => {
      const g = window.__pp, vt = window.__vt;
      // the game steps its graphics down when it sees under 34 fps; under the virtual clock it always sees 30
      g.fpsChecked = true;
      const orig = g.updateCamera.bind(g);
      window.__cine = null;
      g.updateCamera = (dt) => {
        orig(dt);
        const c = window.__cine;
        if (!c) return;
        const cam = g.camera;
        cam.position.set(c.p[0], c.p[1], c.p[2]); cam.up.set(0, 1, 0); cam.lookAt(c.l[0], c.l[1], c.l[2]);
        if (c.roll) cam.rotateZ(c.roll);
        const f = c.fov ?? 55;
        if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
        g.viewmodel.visible = !!c.viewmodel;
      };
      // the new-player helper line and the "click to play" hint are not part of what a regular player sees
      const st = document.createElement('style'); st.textContent = '#objective, #hint { display: none !important; }'; document.head.append(st);
      // 'cine': a camera that is not the player's own keeps the round's HUD (timer, banners, chaos meter) but not the player's controls
      const cine = document.createElement('style');
      cine.textContent = 'body.cine #abilities, body.cine #role, body.cine #meter, body.cine #crosshair, body.cine #prompt, body.cine #spectate, body.cine #roleBar { display: none !important; }';
      document.head.append(cine);
      window.__hud = (on) => { document.getElementById('hud').style.opacity = on ? '' : '0'; document.body.classList.toggle('cine', on === 'cine'); };
      window.__labels = true;
      const ents = g.updateEnts.bind(g);
      g.updateEnts = (dt) => { ents(dt); if (!window.__labels) for (const e of g.ents.values()) if (e.label) e.label.visible = false; };
      window.__log = [];
      const play = g.sfx.play.bind(g.sfx);
      g.sfx.play = (name, pos, vol = 1) => {
        const c = g.camera.position;
        const d = pos ? Math.hypot(pos[0] - c.x, pos[1] - c.y, pos[2] - c.z) : 0;
        window.__log.push({ t: vt.t, k: 'sfx', name, vol, d: +d.toFixed(2) });
        return play(name, pos, vol);
      };
      const music = g.sfx.music.bind(g.sfx);
      g.sfx.music = (mode) => { window.__log.push({ t: vt.t, k: 'music', mode }); return music(mode); };
    });
  }
  async waitArt() { await this.page.waitForFunction(() => window.__assets.progress >= 0.999, null, { timeout: 600000, polling: 500 }); }
  async grab(file, quality = 92) {
    const r = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

/**
 * Advance the whole world by one frame: the server first (its snapshots go out over the socket), a
 * moment for them to arrive, then the page (simulation, interpolation, render).
 */
async function stepWorld(server, client, ms) {
  await server.advance(ms);
  await sleep(6);
  await client.page.evaluate((ms) => window.__vt.step(ms), ms);
  await sleep(3); // inputs the page just sent reach the server before its next tick
}

/** Server + director + one camera client sitting in a fresh private room, with both clocks locked. */
async function boot({ bundle, port = 8120, quality = 'high', width = 1920, height = 1080, seed = 7, name = 'You', look = 0, verbose = false }) {
  const server = await Server.start({ bundle, port, env: { TRAILER_SEED: String(seed) } });
  console.log(await server.eval(fs.readFileSync(path.join(__dirname, 'director.js'), 'utf8')));
  const browser = await launch();
  const client = await Client.open(browser, { url: `http://localhost:${port}/?debug=1`, width, height, quality, name, look });
  await client.waitArt();
  await client.install();
  await client.page.click('#createBtn');
  await client.page.waitForFunction(() => window.__pp.inGame, null, { timeout: 20000 });
  await client.eval(() => window.__vt.lock());
  await stepWorld(server, client, 50); // first tick: the room registers with the director
  return { server, browser, client };
}

async function launch() { return chromium.launch({ args: GL_ARGS }); }

module.exports = { Server, Client, stepWorld, launch, boot, sleep, ROOT };
