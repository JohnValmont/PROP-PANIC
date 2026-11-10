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

const state = (page) => page.evaluate(() => {
  const g = window.__pp;
  return { inGame: g.inGame, phase: g.phase, team: g.team, alive: g.alive, round: g.round, id: g.myId, code: g.code, locked: g.locked, hp: g.hp, focus: g.focus,
    roster: [...g.roster.values()], x: g.body.x, y: g.body.y, z: g.body.z, disguise: g.disguise, target: g.target, smooth: g.smooth.length(), hasMe: g.hasMe };
});
const waitPhase = (page, phase, timeout = 45000) => page.waitForFunction((p) => window.__pp.phase === p, phase, { timeout, polling: 100 });

/** Drive a player to (x, z) with real key presses, steering by setting the look direction. */
async function walkTo(page, x, z, timeout = 12000) {
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space'); // bunny-hop so loose toys on the floor never block the route
  const t0 = Date.now();
  let d = 99;
  while (Date.now() - t0 < timeout) {
    d = await page.evaluate(([tx, tz]) => { const g = window.__pp; const dx = tx - g.body.x, dz = tz - g.body.z; g.yaw = Math.atan2(-dx, -dz); return Math.hypot(dx, dz); }, [x, z]);
    if (d < 0.6) break;
    await sleep(60);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  return d;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_HIDE_MS: '32000', PP_HUNT_MS: '60000', PP_END_MS: '9000' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const errors = [];
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
    await ctx.addInitScript(() => localStorage.setItem('pp_quality', 'low'));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
    return page;
  };
  try {
    console.log('menu');
    const A = await open('A');
    await A.goto(URL);
    await A.waitForFunction(() => window.__pp && window.__pp.renderer.info.render.calls > 10, null, { timeout: 20000 });
    ok(await A.isVisible('#menu') && (await A.textContent('.logo')).includes('PROP'), 'menu renders over a live 3D scene');
    await A.fill('#nameInput', 'Alice');
    await A.screenshot({ path: path.join(SHOTS, '01-menu.png') });

    console.log('private room');
    await A.click('#createBtn');
    await A.waitForFunction(() => window.__pp.inGame, null, { timeout: 8000 });
    let a = await state(A);
    ok(/^[A-Z]{4}$/.test(a.code) && A.url().includes(`room=${a.code}`), `room ${a.code} created and reflected in the URL`);
    ok(await A.isVisible('#lobby') && (await A.textContent('#lobbyCode')) === a.code, 'lobby panel shows the invite code');
    ok(!a.locked && await A.isDisabled('#startBtn'), 'host keeps the mouse in the lobby; Start is disabled with one player');

    const B = await open('B');
    await B.goto(`${URL}?room=${a.code}`);
    await B.waitForFunction(() => window.__pp, null, { timeout: 20000 });
    ok((await B.inputValue('#codeInput')) === a.code, 'invite link pre-fills the room code');
    await B.fill('#nameInput', 'Bob');
    await B.click('#joinBtn');
    await B.waitForFunction(() => window.__pp.inGame && window.__pp.roster.size === 2, null, { timeout: 8000 });
    await A.waitForFunction(() => window.__pp.roster.size === 2, null, { timeout: 8000 });
    ok(true, 'second browser joined through the invite link');
    ok(!(await B.isVisible('#startBtn')), 'only the host sees the Start button');
    await A.screenshot({ path: path.join(SHOTS, '02-lobby.png') });

    console.log('refresh keeps your seat');
    const bId = (await state(B)).id;
    await B.reload();
    await B.waitForFunction(() => window.__pp && window.__pp.inGame, null, { timeout: 10000 });
    ok((await state(B)).id === bId, 'page refresh resumes the same seat');

    console.log('round 1');
    await A.click('#startBtn');
    await B.click('#c', { position: { x: 600, y: 200 } });
    await waitPhase(A, 'hiding'); await waitPhase(B, 'hiding');
    await A.waitForFunction(() => window.__pp.hasMe && window.__pp.locked, null, { timeout: 5000 });
    await B.waitForFunction(() => window.__pp.hasMe && window.__pp.locked, null, { timeout: 5000 });
    a = await state(A); let b = await state(B);
    ok([a.team, b.team].sort().join() === 'hunter,prop', `roles assigned: Alice=${a.team}, Bob=${b.team}`);
    const [H, P] = a.team === 'hunter' ? [A, B] : [B, A];
    ok(await H.isVisible('#blindfold') && !(await P.isVisible('#blindfold')), 'hunter is blindfolded during hiding, prop is not');
    ok((await H.evaluate(() => { const g = window.__pp; return [...g.ents.values()].filter((e) => e.id !== g.myId && e.group.visible).length; })) === 0, 'hunter client renders no props while blindfolded');

    // prop: walk to open floor by the checkout, then disguise as whatever is nearest
    const p0 = await state(P);
    let d = await walkTo(P, p0.x, 8.6);
    d = await walkTo(P, 2.6, 8.8);
    d = await walkTo(P, 2.6, 12.6);
    let p1 = await state(P);
    console.log(`  (software-rendered test clients run at ~${Math.round(await P.evaluate(() => window.__pp.fps))} fps)`);
    ok(d < 0.8, `prop walked to the checkout with real key input (${p1.x.toFixed(1)}, ${p1.z.toFixed(1)})`);
    await sleep(900);
    ok((await state(P)).smooth < 0.25, 'client prediction agrees with the server (no rubber-banding)');
    // aim the camera at a nearby toy until the game offers to transform into it
    const aimed = await P.evaluate(async () => {
      const g = window.__pp;
      for (let yaw = 0; yaw < 6.3; yaw += 0.2) for (const pitch of [-0.75, -0.5, -0.3, -0.12]) {
        g.yaw = yaw; g.pitch = pitch;
        await new Promise((r) => setTimeout(r, 70));
        if (g.target >= 0 && g.world.decorDef(g.target).d.type !== g.disguise) return g.world.decorDef(g.target).def.name;
      }
      return null;
    });
    ok(!!aimed && await P.isVisible('#prompt'), `aiming at a toy shows the transform prompt (${aimed})`);
    await P.keyboard.press('KeyE');
    await P.waitForFunction((n) => document.getElementById('roleName').textContent === n, aimed, { timeout: 4000 }).catch(async () => {
      console.log('  (transform debug)', JSON.stringify(await P.evaluate(() => { const g = window.__pp; const i = g.target >= 0 ? g.world.decorDef(g.target) : null; return { role: document.getElementById('roleName').textContent, target: g.target, tname: i && i.def.name, td: i && [i.d.x, i.d.y, i.d.z], body: [g.body.x, g.body.y, g.body.z], popups: document.getElementById('popups').textContent, phase: g.phase, locked: g.locked, active: document.activeElement && document.activeElement.tagName }; })));
      throw new Error('transform did not happen');
    });
    ok(true, `pressed E and became a ${aimed}`);
    await P.screenshot({ path: path.join(SHOTS, '03-prop-hiding.png') });
    await H.screenshot({ path: path.join(SHOTS, '04-hunter-blindfold.png') });

    await waitPhase(H, 'hunt'); await waitPhase(P, 'hunt');
    await sleep(500);
    ok(!(await H.isVisible('#blindfold')) && await H.isVisible('#crosshair'), 'hunt begins: blindfold off, crosshair on');
    await P.keyboard.press('KeyT');
    await sleep(300);
    p1 = await state(P);
    // hunter: find the prop on screen, aim with the camera, hold the trigger
    const seen = await H.evaluate((pid) => { const e = window.__pp.ents.get(pid); return e && e.group.visible ? e.kind : null; }, p1.id);
    ok(seen && seen.startsWith('prop:'), `hunter client now renders the prop in its disguise (${seen})`);
    await H.screenshot({ path: path.join(SHOTS, '05-hunter-view.png') });
    await H.mouse.down();
    const t0 = Date.now();
    let dead = false;
    while (Date.now() - t0 < 12000 && !dead) {
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
    ok(dead, 'hunter shot the prop three times with held fire and caught it');
    await waitPhase(H, 'end', 8000); await waitPhase(P, 'end', 8000);
    await sleep(400);
    ok((await H.textContent('#results h2')).includes('HUNTERS WIN') && await P.isVisible('#results'), 'both clients show the results screen: hunters win');
    const hs = await state(H);
    ok(hs.roster.find((r) => r.id === hs.id).score >= 250 || (await H.textContent('#results')).includes('+'), 'hunter was awarded points for the catch');
    await H.screenshot({ path: path.join(SHOTS, '06-results.png') });

    console.log('round 2');
    await waitPhase(A, 'hiding', 10000); await waitPhase(B, 'hiding', 10000);
    await sleep(500);
    const h2 = await state(H), p2 = await state(P);
    ok(h2.round === 2 && h2.team === 'prop' && p2.team === 'hunter', 'rematch starts automatically and the roles swap');
    ok(await P.isVisible('#blindfold'), 'the new hunter is blindfolded');
    await H.keyboard.press('KeyQ');
    await H.waitForFunction(() => window.__pp.decoys.size === 1, null, { timeout: 4000 });
    await P.waitForFunction(() => window.__pp.decoys.size === 1, null, { timeout: 4000 }).catch(() => {});
    ok((await P.evaluate(() => window.__pp.decoys.size)) === 1, 'a decoy placed by the prop appears on the other client');
    await H.keyboard.down('ShiftLeft'); await sleep(120); await H.keyboard.up('ShiftLeft');
    await H.keyboard.down('KeyW'); await sleep(500); await H.keyboard.up('KeyW');
    ok((await H.evaluate(() => window.__pp.body.dashCd)) > 0, 'dash triggers and goes on cooldown');
    await H.screenshot({ path: path.join(SHOTS, '07-prop-round2.png') });

    ok(errors.length === 0, `no browser errors (${errors.slice(0, 3).join(' | ') || 'clean'})`);
  } catch (e) {
    failures++;
    console.log('  ✗ EXCEPTION:', e.message.split('\n')[0]);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nAll browser checks passed.');
  process.exit(failures ? 1 : 0);
}
main();
