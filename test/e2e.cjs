/**
 * Browser end-to-end test: two real Chromium clients play a full round against each other through
 * the real server. One hides as a prop, the other hunts it down with the actual UI and input paths.
 *   npm run build && npm run test:e2e
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 8098;
const URL = `http://localhost:${PORT}/`;
const SHOTS = path.join(__dirname, 'shots');
let failures = 0;
const ok = (cond, label) => { if (cond) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// screenshots are illustrative only: a slow software-rendered capture must never fail the run
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), timeout: 15000 }).catch(() => console.log(`  (skipped screenshot ${name})`));

const state = (page) => page.evaluate(() => {
  const g = window.__pp;
  return { inGame: g.inGame, phase: g.phase, team: g.team, alive: g.alive, round: g.round, id: g.myId, code: g.code, locked: g.locked, hp: g.hp, focus: g.focus,
    roster: [...g.roster.values()], x: g.body.x, y: g.body.y, z: g.body.z, disguise: g.disguise, target: g.target, smooth: g.smooth.length(), hasMe: g.hasMe };
});
const waitPhase = (page, phase, timeout = 75000) => page.waitForFunction((p) => window.__pp.phase === p, phase, { timeout, polling: 100 });

/**
 * Drive a player to (x, z) with real key presses. Steering runs inside the page every frame (so it
 * stays accurate however slowly the client renders) and gives up only when progress stops.
 */
async function walkTo(page, x, z) {
  // face the destination before any key goes down, otherwise the player sets off in the old direction
  await page.evaluate(([tx, tz]) => { const g = window.__pp; g.yaw = Math.atan2(-(tx - g.body.x), -(tz - g.body.z)); }, [x, z]);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space'); // bunny-hop so loose toys on the floor never block the route
  const d = await page.evaluate(([tx, tz]) => new Promise((resolve) => {
    const g = window.__pp;
    const t0 = performance.now();
    let lx = g.body.x, lz = g.body.z, movedAt = t0;
    const tick = () => {
      const dx = tx - g.body.x, dz = tz - g.body.z, dist = Math.hypot(dx, dz), now = performance.now();
      g.yaw = Math.atan2(-dx, -dz);
      if (Math.hypot(g.body.x - lx, g.body.z - lz) > 0.15) { lx = g.body.x; lz = g.body.z; movedAt = now; }
      if (dist < 0.5 || now - movedAt > 4000 || now - t0 > 45000) { g.keys.clear(); resolve(dist); return; }
      requestAnimationFrame(tick);
    };
    tick();
  }), [x, z]);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  return d;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_HIDE_MS: '30000', PP_HUNT_MS: '60000', PP_END_MS: '9000' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));
  // One browser per client: a background page in a shared headless browser gets its animation loop throttled.
  const browsers = [];
  const errors = [];
  const open = async (name) => {
    const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
    browsers.push(browser);
    const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
    await ctx.addInitScript(() => { localStorage.setItem('pp_quality', 'low'); localStorage.setItem('pp_seen', '1'); });
    const page = await ctx.newPage();
    await ctx.addInitScript(() => {
      window.__log = [];
      const hook = setInterval(() => {
        const g = window.__pp;
        if (!g) return;
        clearInterval(hook);
        const send = g.net.send.bind(g.net);
        g.net.send = (m) => { if (m.t !== 'in') window.__log.push('>' + JSON.stringify(m)); send(m); };
        const popup = g.hud.popup.bind(g.hud);
        g.hud.popup = (t, b) => { window.__log.push('popup:' + t); popup(t, b); };
      }, 20);
    });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    return page;
  };
  try {
    console.log('menu');
    const A = await open('A');
    await A.goto(URL);
    await A.waitForFunction(() => window.__pp && window.__pp.renderer.info.render.calls > 10, null, { timeout: 20000 });
    ok(await A.isVisible('#menu') && (await A.textContent('.logo')).includes('PANIC'), 'menu renders over a live 3D scene');
    const lite = (page) => page.evaluate(() => { window.__pp.renderEvery = 20; }); // no GPU here: draw 1 frame in 20, simulate all of them
    await A.fill('#nameInput', 'Alice');
    await shot(A, '01-menu.png');
    await lite(A);

    console.log('private room');
    await A.click('#createBtn');
    await A.waitForFunction(() => window.__pp.inGame, null, { timeout: 8000 });
    let a = await state(A);
    ok(/^[A-Z]{4}$/.test(a.code) && A.url().includes(`room=${a.code}`), `room ${a.code} created and reflected in the URL`);
    await A.waitForFunction(() => document.getElementById('lobbyCode').textContent.length === 4, null, { timeout: 5000 }).catch(() => {});
    ok(await A.isVisible('#lobby') && (await A.textContent('#lobbyCode')) === a.code, 'lobby panel shows the invite code');
    ok(!a.locked && await A.isDisabled('#startBtn'), 'host keeps the mouse in the lobby; Start is disabled with one player');

    const B = await open('B');
    await B.goto(`${URL}?room=${a.code}`);
    await B.waitForFunction(() => window.__pp, null, { timeout: 20000 });
    ok((await B.inputValue('#codeInput')) === a.code, 'invite link pre-fills the room code');
    await lite(B);
    await B.fill('#nameInput', 'Bob');
    await B.click('#joinBtn');
    await B.waitForFunction(() => window.__pp.inGame && window.__pp.roster.size === 2, null, { timeout: 8000 });
    await A.waitForFunction(() => window.__pp.roster.size === 2, null, { timeout: 8000 });
    ok(true, 'second browser joined through the invite link');
    ok(!(await B.isVisible('#startBtn')), 'only the host sees the Start button');
    await shot(A, '02-lobby.png');

    console.log('refresh keeps your seat');
    const bId = (await state(B)).id;
    await B.reload();
    await B.waitForFunction(() => window.__pp && window.__pp.inGame, null, { timeout: 25000 });
    ok((await state(B)).id === bId, 'page refresh resumes the same seat');
    await lite(B);

    console.log('round 1');
    await A.click('#startBtn');
    await B.click('#c', { position: { x: 340, y: 120 } });
    await waitPhase(A, 'hiding'); await waitPhase(B, 'hiding');
    await A.waitForFunction(() => window.__pp.hasMe && window.__pp.locked, null, { timeout: 5000 });
    await B.waitForFunction(() => window.__pp.hasMe && window.__pp.locked, null, { timeout: 5000 });
    a = await state(A); let b = await state(B);
    ok([a.team, b.team].sort().join() === 'hunter,prop', `roles assigned: Alice=${a.team}, Bob=${b.team}`);
    const [H, P] = a.team === 'hunter' ? [A, B] : [B, A];
    ok(await H.isVisible('#blindfold') && !(await P.isVisible('#blindfold')), 'hunter is blindfolded during hiding, prop is not');
    await sleep(800);
    ok((await H.evaluate(() => { const g = window.__pp; return [...g.ents.values()].filter((e) => e.id !== g.myId && e.group.visible).length; })) === 0, 'hunter client renders no props while blindfolded');

    // prop: disguise as a toy from the shelves beside the spawn aisle, using the real aim + E path
    const aimed = await P.evaluate(async () => {
      const g = window.__pp;
      for (const pitch of [-0.3, -0.12, -0.5]) for (let yaw = 0; yaw < 6.3; yaw += 0.3) {
        g.yaw = yaw; g.pitch = pitch;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // wait for real frames, however slow
        if (g.target >= 0 && g.world.decorDef(g.target).d.type !== g.disguise) return g.world.decorDef(g.target).def.name;
      }
      return null;
    });
    ok(!!aimed && await P.isVisible('#prompt'), `aiming at a toy shows the transform prompt (${aimed})`);
    await P.keyboard.press('KeyE');
    await P.waitForFunction((n) => document.getElementById('roleName').textContent === n, aimed, { timeout: 5000 }).catch(async () => {
      console.log('  (transform debug)', JSON.stringify(await P.evaluate(() => { const g = window.__pp; const i = g.target >= 0 ? g.world.decorDef(g.target) : null; return { log: window.__log.slice(-8), disguise: g.disguise, role: document.getElementById('roleName').textContent, target: g.target, tname: i && i.def.name, body: [g.body.x, g.body.y, g.body.z], popups: document.getElementById('popups').textContent, phase: g.phase, locked: g.locked }; })));
      throw new Error('transform did not happen');
    });
    ok(true, `pressed E and became a ${aimed}`);
    // then walk to open floor by the checkout, where the hunter will have a clear view
    const p0 = await state(P);
    const legs = [];
    let d = 0;
    for (const [wx, wz] of [[p0.x, 8.6], [2.6, 8.8], [2.6, 12.6]]) { d = await walkTo(P, wx, wz); const q = await state(P); legs.push(`${q.x.toFixed(1)},${q.z.toFixed(1)}`); }
    let p1 = await state(P);
    if (d >= 0.8) console.log(`  (walk debug) start ${p0.x.toFixed(1)},${p0.z.toFixed(1)} legs ended at ${legs.join(' | ')} as ${await P.textContent('#roleName')}; canMove/locked ${JSON.stringify(await P.evaluate(() => [window.__pp.canMove, window.__pp.locked, window.__pp.fps]))}`);
    console.log(`  (test clients simulate at ~${Math.round(await P.evaluate(() => window.__pp.fps))} fps)`);
    ok(d < 0.8, `prop walked to the checkout with real key input (${p1.x.toFixed(1)}, ${p1.z.toFixed(1)})`);
    await sleep(900);
    ok((await state(P)).smooth < 0.25, 'client prediction agrees with the server (no rubber-banding)');
    await shot(P, '03-prop-hiding.png');
    await shot(H, '04-hunter-blindfold.png');

    await waitPhase(H, 'hunt'); await waitPhase(P, 'hunt');
    await H.waitForFunction(() => document.getElementById('blindfold').style.display === 'none' && document.getElementById('crosshair').style.display === 'block', null, { timeout: 8000 }).catch(() => {});
    ok(!(await H.isVisible('#blindfold')) && await H.isVisible('#crosshair'), 'hunt begins: blindfold off, crosshair on');
    await P.keyboard.press('KeyT');
    await sleep(300);
    p1 = await state(P);
    // hunter: find the prop on screen, aim with the camera, hold the trigger
    const seen = await H.waitForFunction((pid) => { const e = window.__pp.ents.get(pid); return e && e.group.visible ? e.kind : false; }, p1.id, { timeout: 8000 }).then((h) => h.jsonValue()).catch(() => null);
    ok(seen && seen.startsWith('prop:'), `hunter client now renders the prop in its disguise (${seen})`);
    await shot(H, '05-hunter-view.png');
    await H.mouse.down();
    const t0 = Date.now();
    let dead = false;
    while (Date.now() - t0 < 30000 && !dead) {
      await H.evaluate((pid) => {
        const g = window.__pp, e = g.ents.get(pid);
        if (!e) return;
        const dx = e.x - g.body.x, dy = e.y + e.h / 2 - (g.body.y + 1.58), dz = e.z - g.body.z;
        g.yaw = Math.atan2(-dx, -dz); g.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }, p1.id);
      await sleep(120);
      dead = !(await state(P)).alive;
    }
    await H.mouse.up();
    if (!dead) console.log('  (shoot debug)', JSON.stringify(await H.evaluate((pid) => { const g = window.__pp, e = g.ents.get(pid); return { log: window.__log.slice(-5), locked: g.locked, mouseL: g.mouseL, team: g.team, phase: g.phase, quacked: g.quackedMe, focus: g.focus, me: [g.body.x, g.body.y, g.body.z].map((v) => +v.toFixed(2)), ent: e && [e.x, e.y, e.z, e.h].map((v) => +v.toFixed(2)), vis: e && e.group.visible, yaw: g.yaw, pitch: g.pitch }; }, p1.id)), JSON.stringify(await state(P).then((q) => ({ hp: q.hp, alive: q.alive, pos: [q.x, q.y, q.z].map((v) => +v.toFixed(2)) }))));
    ok(dead, 'hunter shot the prop three times with held fire and caught it');
    await waitPhase(H, 'end', 8000); await waitPhase(P, 'end', 8000);
    await sleep(400);
    ok((await H.textContent('#results h2')).includes('HUNTERS WIN') && await P.isVisible('#results'), 'both clients show the results screen: hunters win');
    const hs = await state(H);
    ok(hs.roster.find((r) => r.id === hs.id).score >= 250 || (await H.textContent('#results')).includes('+'), 'hunter was awarded points for the catch');
    await shot(H, '06-results.png');

    console.log('round 2');
    await waitPhase(A, 'hiding', 10000); await waitPhase(B, 'hiding', 10000);
    await P.waitForFunction(() => window.__pp.team === 'hunter' && document.getElementById('blindfold').style.display === 'flex', null, { timeout: 10000 }).catch(() => {});
    const h2 = await state(H), p2 = await state(P);
    ok(h2.round === 2 && h2.team === 'prop' && p2.team === 'hunter', 'rematch starts automatically and the roles swap');
    ok(await P.isVisible('#blindfold'), 'the new hunter is blindfolded');
    await H.keyboard.press('KeyQ');
    await H.waitForFunction(() => window.__pp.decoys.size === 1, null, { timeout: 4000 }).catch(async () => {
      console.log('  (decoy debug)', JSON.stringify(await H.evaluate(() => { const g = window.__pp; return { log: window.__log.slice(-6), team: g.team, alive: g.alive, hasMe: g.hasMe, phase: g.phase, cd: g.cd, now: g.serverNow(), chat: g.chatOpen, active: document.activeElement && document.activeElement.id, decoys: g.decoys.size }; })));
      throw new Error('decoy did not appear');
    });
    await P.waitForFunction(() => window.__pp.decoys.size === 1, null, { timeout: 4000 }).catch(() => {});
    ok((await P.evaluate(() => window.__pp.decoys.size)) === 1, 'a decoy placed by the prop appears on the other client');
    await H.keyboard.down('ShiftLeft'); await sleep(120); await H.keyboard.up('ShiftLeft');
    await H.keyboard.down('KeyW'); await sleep(500); await H.keyboard.up('KeyW');
    ok((await H.evaluate(() => window.__pp.body.dashCd)) > 0, 'dash triggers and goes on cooldown');
    await shot(H, '07-prop-round2.png');

    ok(errors.length === 0, `no browser errors (${errors.slice(0, 3).join(' | ') || 'clean'})`);
  } catch (e) {
    failures++;
    console.log('  ✗ EXCEPTION:', e.message.split('\n')[0]);
  } finally {
    for (const b of browsers) await b.close().catch(() => {});
    server.kill();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nAll browser checks passed.');
  process.exit(failures ? 1 : 0);
}
main();
