/**
 * Browser test for ghost mode: a player who joins late in a round (and so sits it out) watches the bots
 * play through the real UI, first with mouse and keyboard, then with touch controls.
 *   npm run build && npm run test:ghost
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const SHOTS = path.join(__dirname, 'shots');
const PORT = 8097, URL = `http://localhost:${PORT}/`;
let failures = 0;
const ok = (c, l) => { if (c) console.log('  ✓', l); else { failures++; console.log('  ✗ FAIL:', l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = (page) => page.evaluate(() => { const g = window.__pp, c = g.camera.position, e = g.ents.get(g.specTarget);
  return { team: g.team, alive: g.alive, on: g.specOn, mode: g.specMode, target: g.specTarget, pov: g.specPov, cam: [c.x, c.y, c.z], yaw: g.yaw, pitch: g.pitch, locked: g.locked, phase: g.phase,
    ent: e ? [e.x, e.y, e.z, e.h, e.group.visible] : null, tteam: g.roster.get(g.specTarget)?.team, tname: g.roster.get(g.specTarget)?.name, list: g.specList(), bar: document.getElementById('spectate').innerText, barOn: document.getElementById('spectate').style.display,
    prompt: document.getElementById('prompt').style.display !== 'none' ? document.getElementById('prompt').innerText : '', vm: g.viewmodel.visible, left: g.phaseEnds - g.serverNow(), help: document.getElementById('help').innerText,
    labels: [...g.ents.values()].filter((e) => e.label && e.group.visible).map((e) => [e.label.material.depthTest, +e.label.scale.y.toFixed(2)]), btn: ['tAct', 'tQ', 'tF', 'tJump', 'tDash', 'tTaunt', 'tAlt'].map((id) => { const b = document.getElementById(id); return b.style.display === 'none' ? '-' : b.textContent; }).join(',') }; });
// screenshots are illustrative only: a slow software-rendered capture must never fail the run
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), timeout: 15000 }).catch(() => console.log(`  (skipped screenshot ${name})`));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// one ghost per run: three software-rendered browsers at once starve each other on a machine with no GPU
async function run(touch) {
  const server = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_HIDE_MS: '3000', PP_HUNT_MS: '110000', PP_END_MS: '4000', PP_JOIN_MS: '100000' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));
  const browsers = [], errors = [];
  const open = async (name, extra = {}) => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
    browsers.push(browser);
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, ...extra });
    await ctx.addInitScript(() => { localStorage.setItem('pp_quality', 'low'); localStorage.setItem('pp_seen', '1'); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    return page;
  };
  let B;
  try {
    console.log(touch ? 'touch ghost' : 'desktop ghost');
    const A = await open('A');
    await A.goto(`${URL}?debug=1&noart=1`);
    await A.waitForFunction(() => window.__pp && window.__pp.renderer.info.render.calls > 10, null, { timeout: 30000 });
    await A.evaluate(() => { window.__pp.renderEvery = 30; });
    await A.fill('#nameInput', 'Alice'); await A.click('#createBtn');
    await A.waitForFunction(() => window.__pp.inGame, null, { timeout: 8000 });
    const code = await A.evaluate(() => window.__pp.code);
    for (let i = 0; i < 4; i++) { await A.click('#botsPlus'); await sleep(150); }
    await A.click('#startBtn');
    await A.waitForFunction(() => window.__pp.phase === 'hunt', null, { timeout: 30000 });
    {
      B = await open(touch ? 'T' : 'B', touch ? { hasTouch: true, viewport: { width: 844, height: 390 } } : {});
      await B.goto(`${URL}?room=${code}&debug=1&noart=1${touch ? '&touch=1' : ''}`);
      await B.waitForFunction(() => window.__pp && window.__pp.renderer.info.render.calls > 10, null, { timeout: 30000 });
      await B.evaluate(() => { window.__pp.renderEvery = 6; });
      await B.fill('#nameInput', touch ? 'Tess' : 'Bob');
    }
    // the server seats a newcomer as a spectator only late in a hunt (the last 100 seconds here, PP_JOIN_MS)
    await A.waitForFunction(() => window.__pp.phase === 'hunt' && window.__pp.phaseEnds - window.__pp.serverNow() < 99000, null, { timeout: 190000, polling: 250 });
    if (touch) await B.tap('#joinBtn'); else await B.click('#joinBtn');
    {
      await B.waitForFunction(() => window.__pp.inGame && window.__pp.roster.size > 2, null, { timeout: 8000 });
      await B.waitForFunction(() => window.__pp.specOn && window.__pp.specMode === 'follow' && window.__pp.specTarget > 0, null, { timeout: 6000 }).catch(() => {});
      let g = await G(B);
      ok(g.team === 'spec' && g.on, 'late joiner is a ghost');
      ok(g.mode === 'follow' && g.tteam === 'hunter', `ghost attaches to a player by itself (${g.tname}, ${g.tteam})`);
      await sleep(900); g = await G(B);
      ok(g.ent && dist(g.cam, g.ent) < 8 && dist(g.cam, g.ent) > 0.3, `camera orbits the watched player (${g.ent && dist(g.cam, g.ent).toFixed(2)} m away)`);
      ok(g.barOn === 'block' && g.bar.includes('WATCHING') && g.bar.includes(g.tname) && g.bar.includes('HUNTER'), `strip names who is being watched: ${JSON.stringify(g.bar)}`);
      ok(g.labels.length > 0 && g.labels.every((l) => l[0] === false), `name tags are drawn through walls for ghosts (${g.labels.length} tags, sizes ${g.labels.map((l) => l[1]).join('/')})`);
      await shot(B, touch ? 'ghost-5-touch.png' : 'ghost-1-watching.png');
      if (!touch) {
        await B.click('#c', { position: { x: 320, y: 120 } });
        await B.waitForFunction(() => window.__pp.locked, null, { timeout: 4000 }).catch(() => {});
        g = await G(B);
        ok(g.locked, 'pointer locks on click');
        ok(g.help.includes('GHOST CONTROLS'), 'controls card lists the ghost controls');
        const first = g.target;
        await B.keyboard.press('KeyF'); await sleep(200); g = await G(B);
        ok(g.target !== first && g.list.includes(g.target) && g.mode === 'follow', `F moves to the next player (${g.tname})`);
        await B.keyboard.press('KeyQ'); await sleep(200); g = await G(B);
        ok(g.target === first, 'Q goes back to the previous player');
        // during a hunt a ghost haunts: look at an object, click, and the server puts haunting on cooldown
        // the orbit camera follows a moving player, so the object under the crosshair can drift away: aim, click, retry
        let aimedAt = -1, cooled = false, promptText = '';
        for (let attempt = 0; attempt < 3 && !cooled; attempt++) {
          aimedAt = await B.evaluate(async () => {
            const g = window.__pp;
            for (const pitch of [-0.4, -0.6, -0.2]) for (let yaw = 0; yaw < 6.3; yaw += 0.5) {
              g.yaw = yaw; g.pitch = pitch;
              await new Promise((r) => requestAnimationFrame(r));
              if (g.hauntTarget >= 0) return g.hauntTarget;
            }
            return -1;
          });
          promptText = (await G(B)).prompt;
          await B.mouse.down(); await B.mouse.up();
          cooled = await B.waitForFunction(() => window.__pp.cd.haunt > window.__pp.serverNow(), null, { timeout: 2500 }).then(() => true).catch(() => false);
        }
        g = await G(B);
        ok(aimedAt >= 0 && promptText.includes('Haunt'), `aiming at an object offers to haunt it: ${JSON.stringify(promptText)}`);
        ok(cooled && g.mode === 'follow', 'left click haunts it (the server starts the cooldown), and the ghost keeps watching');
        await shot(B, 'ghost-1b-haunt.png');
        await B.mouse.down({ button: 'right' }); await B.mouse.up({ button: 'right' }); await sleep(200); g = await G(B);
        ok(g.target !== first, 'right click steps to the next player while haunting is on');
        await B.keyboard.press('KeyQ'); await sleep(200); g = await G(B);
        // cycle all the way to a prop
        for (let i = 0; i < g.list.length && (await G(B)).tteam !== 'prop'; i++) { await B.keyboard.press('KeyF'); await sleep(120); }
        await sleep(700); g = await G(B);
        ok(g.tteam === 'prop' && /the \w+/.test(g.bar) && g.bar.includes('PROP'), `can attach to props too; strip shows the disguise: ${JSON.stringify(g.bar)}`);
        await shot(B, 'ghost-2-prop.png');
        await B.keyboard.press('Space'); await sleep(200);
        ok(!(await G(B)).pov, 'Space does nothing on a prop (no eyes to borrow)');
        while ((await G(B)).tteam !== 'hunter') { await B.keyboard.press('KeyF'); await sleep(120); }
        await B.keyboard.press('Space'); await sleep(900); g = await G(B);
        const off = await B.evaluate(() => new Promise((res) => { const g = window.__pp, u = g.updateEnts.bind(g); g.updateEnts = (dt) => { const e = g.ents.get(g.specTarget), c = g.camera.position; res([Math.hypot(c.x - e.x, c.y - e.y - 1.58, c.z - e.z), g.fps]); g.updateEnts = u; u(dt); }; }));
        ok(g.pov && off[0] < 0.1 && g.ent[4] === false && g.vm, `Space looks through the hunter's eyes (camera ${off[0].toFixed(2)} m from their eye, body hidden, blaster shown)`);
        ok(g.bar.includes('THROUGH THE EYES OF'), 'strip says whose eyes');
        await shot(B, 'ghost-3-eyes.png');
        await B.keyboard.press('Space'); await sleep(700); g = await G(B);
        ok(!g.pov && g.ent[4] === true && !g.vm && dist(g.cam, g.ent) > 1, 'Space again steps back out');
        const c0 = g.cam;
        await B.keyboard.down('KeyW'); await sleep(700); await B.keyboard.up('KeyW'); await sleep(250); g = await G(B);
        ok(g.mode === 'free' && dist(g.cam, c0) > 2, `pushing W lets go and flies free (moved ${dist(g.cam, c0).toFixed(1)} m)`);
        ok(g.bar.includes('FLYING FREE'), 'strip says flying free');
        const y0 = g.cam[1];
        await B.keyboard.down('Space'); await sleep(350); await B.keyboard.up('Space'); await sleep(200); g = await G(B);
        ok(g.cam[1] > y0 + 0.5 || g.cam[1] >= 4.19, `Space climbs (${y0.toFixed(2)} → ${g.cam[1].toFixed(2)})`);
        await B.keyboard.down('ShiftLeft'); await sleep(350); await B.keyboard.up('ShiftLeft'); await sleep(200);
        ok((await G(B)).cam[1] < g.cam[1] - 0.5, 'Shift descends');
        // keep the crosshair on a player (bots wander) until the offer to watch them shows, then click
        const want = await B.evaluate(() => new Promise((res) => {
          const g = window.__pp, id = g.specList()[0], t0 = performance.now();
          const tick = () => {
            const e = g.ents.get(id), c = g.camera.position;
            if (e) { const dx = e.x - c.x, dy = e.y + e.h / 2 - c.y, dz = e.z - c.z; g.yaw = Math.atan2(-dx, -dz); g.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
            if (document.getElementById('prompt').innerText.includes('Watch') || performance.now() - t0 > 4000) { g.mouseL = false; res(id); return; }
            requestAnimationFrame(tick);
          };
          tick();
        }));
        g = await G(B);
        ok(g.prompt.includes('Watch'), `looking at a player while flying offers to watch them: ${JSON.stringify(g.prompt)} (${g.phase}, ${Math.round(g.left / 1000)} s left)`);
        await shot(B, 'ghost-4-flying.png');
        await B.mouse.down({ button: 'right' }); await B.mouse.up({ button: 'right' }); await sleep(300); g = await G(B);
        if (g.mode !== 'follow') console.log('  (attach debug)', JSON.stringify(await B.evaluate(() => { const g = window.__pp, now = g.serverNow(); return { mode: g.specMode, locked: g.locked, list: g.specList(), canHaunt: g.canHaunt(), ages: [...g.ents.values()].map((e) => [e.id, Math.round(now - e.lastSeen), e.buf.length, !!e.model]), roster: [...g.roster.values()].map((r) => [r.id, r.team, r.alive]) }; })));
        ok(g.mode === 'follow' && g.list.includes(g.target), `right clicking attaches to a player again (${g.tname}${g.target === want ? ', the one under the crosshair' : ''})`);
        await B.keyboard.press('KeyE'); await sleep(200);
        ok((await G(B)).mode === 'free', 'E lets go');
        await B.keyboard.press('KeyE'); await sleep(200);
        ok((await G(B)).mode === 'follow', 'E attaches again');
        await B.keyboard.press('Enter'); await sleep(150);
        ok(await B.isVisible('#chatMenu'), 'quick chat still opens for ghosts');
        await B.keyboard.press('Escape');
      } else {
        ok(g.btn === 'HAUNT,PREV,NEXT,EYES,-,-,FLY', `touch buttons relabel for a ghost watching a hunter: ${g.btn}`);
        const first = g.target;
        await B.tap('#tF'); await sleep(250); g = await G(B);
        ok(g.target !== first, 'NEXT button steps to the next player');
        await B.tap('#tQ'); await sleep(250); g = await G(B);
        ok(g.target === first, 'PREV button steps back');
        await B.tap('#tJump'); await sleep(900); g = await G(B);
        ok(g.pov && g.btn.startsWith('HAUNT,PREV,NEXT,BACK'), `EYES button looks through the hunter's eyes (${g.btn})`);
        await B.tap('#tJump'); await sleep(500);
        // drag the left stick forward
        const c0 = (await G(B)).cam;
        const cdp = await B.context().newCDPSession(B);
        const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
        await tp('touchStart', [{ x: 150, y: 250, id: 1 }]); await tp('touchMove', [{ x: 150, y: 190, id: 1 }]);
        await sleep(800); g = await G(B);
        ok(g.mode === 'free' && dist(g.cam, c0) > 2, `pushing the stick lets go and flies the ghost (moved ${dist(g.cam, c0).toFixed(1)} m)`);
        ok(g.btn === 'HAUNT,PREV,NEXT,UP,DOWN,-,WATCH', `flying buttons: ${g.btn}`);
        await tp('touchEnd', []);
        const y0 = (await G(B)).cam[1];
        await tp('touchStart', [{ x: 844 - 132 - 32, y: 390 - 70 - 32, id: 2 }]); await sleep(400); await tp('touchEnd', []); await sleep(200); g = await G(B);
        ok(g.cam[1] > y0 + 0.5 || g.cam[1] >= 4.19, `UP button climbs (${y0.toFixed(2)} → ${g.cam[1].toFixed(2)})`);
        await shot(B, 'ghost-6-touch-flying.png');
        await B.tap('#tAlt'); await sleep(300); g = await G(B);
        ok(g.mode === 'follow', 'WATCH button attaches to the nearest / aimed player');
        await B.tap('#tAlt'); await sleep(300);
        ok((await G(B)).mode === 'free', 'FLY button lets go');
        const cd0 = await B.evaluate(() => window.__pp.cd.haunt);
        await B.tap('#tAct'); await sleep(600);
        ok((await G(B)).mode === 'free' && (await B.evaluate(() => window.__pp.cd.haunt)) >= cd0, 'HAUNT button haunts (or says why not) without changing the view');
      }
    }
    ok(errors.length === 0, `no browser errors (${errors.slice(0, 3).join(' | ') || 'clean'})`);
  } catch (e) { failures++; console.log('  ✗ EXCEPTION:', e.message.split('\n').slice(0, 3).join(' / ')); }
  finally { for (const b of browsers) await b.close().catch(() => {}); server.kill(); await sleep(500); }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await run(false);
  await run(true);
  console.log(failures ? `\n${failures} FAILED` : '\nAll ghost checks passed.');
  process.exit(failures ? 1 : 0);
})();
