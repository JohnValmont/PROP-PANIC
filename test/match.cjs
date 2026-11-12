/**
 * Browser test for game length and coins: a host picks a one-round game against bots, sees it settled
 * with final standings and a coin payout, then starts a three-round game.
 *   npm run build && npm run test:match
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 8096, URL = `http://localhost:${PORT}/`;
const SHOTS = path.join(__dirname, 'shots');
let failures = 0;
const ok = (c, l) => { if (c) console.log('  ✓', l); else { failures++; console.log('  ✗ FAIL:', l); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// screenshots are illustrative only: a slow software-rendered capture must never fail the run
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), timeout: 15000 }).catch(() => console.log(`  (skipped screenshot ${name})`));
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.innerText ?? '', sel);
const coins = (page) => page.evaluate(() => Number(localStorage.getItem('pp_coins')) || 0);
const waitPhase = (page, phase, timeout = 40000) => page.waitForFunction((p) => window.__pp.phase === p, phase, { timeout, polling: 100 });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_HIDE_MS: '2500', PP_HUNT_MS: '8000', PP_END_MS: '12000', PP_FINAL_MS: '12000' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    await ctx.addInitScript(() => { localStorage.setItem('pp_quality', 'low'); localStorage.setItem('pp_seen', '1'); });
    const A = await ctx.newPage();
    A.on('pageerror', (e) => errors.push(e.message));
    A.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const boot = async () => { await A.waitForFunction(() => window.__pp && window.__pp.renderer.info.render.calls > 10, null, { timeout: 30000 }); await A.evaluate(() => { window.__pp.renderEvery = 10; }); };

    console.log('lobby');
    await A.goto(`${URL}?debug=1&noart=1`);
    await boot();
    ok((await text(A, '#coinN')) === '0', 'a new player starts with an empty wallet, shown in the menu');
    await A.fill('#nameInput', 'Alice'); await A.click('#createBtn');
    await A.waitForFunction(() => window.__pp.inGame, null, { timeout: 8000 });
    await A.waitForFunction(() => document.getElementById('roundsBtn').offsetParent !== null, null, { timeout: 5000 }).catch(() => {});
    ok((await text(A, '#roundsBtn')) === 'Game length: 3 rounds', 'the host of a private room sees the game length, three rounds by default');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const before = await text(A, '#roundsBtn');
      await A.click('#roundsBtn');
      await A.waitForFunction((b) => document.getElementById('roundsBtn').innerText !== b, before, { timeout: 4000 }).catch(() => {});
      seen.push((await text(A, '#roundsBtn')).replace('Game length: ', ''));
    }
    ok(seen.join() === '5 rounds,7 rounds,10 rounds,1 round', `clicking steps through the choices (${seen.join(' → ')})`);
    for (let i = 0; i < 2; i++) { await A.click('#botsPlus'); await sleep(150); }
    await A.waitForFunction(() => !document.getElementById('startBtn').disabled, null, { timeout: 5000 });
    await shot(A, 'match-1-lobby.png');

    console.log('a one-round game');
    await A.click('#startBtn');
    await waitPhase(A, 'hiding');
    await sleep(300);
    ok((await text(A, '#phaseLabel')) === 'ROUND · HIDE!', 'a single-round game does not number its round');
    await waitPhase(A, 'end');
    await A.waitForSelector('#results .final', { state: 'visible', timeout: 8000 }).catch(() => {});
    const res = await A.evaluate(() => { const g = window.__pp, r = g.results, me = r.board.find((b) => b.id === g.myId), f = r.final && r.final.find((b) => b.id === g.myId); return { final: !!r.final, rounds: r.rounds, champ: r.final && r.final[0].name, round: me && me.coins, bonus: f && f.coins, wallet: g.coins }; });
    const panel = await text(A, '#results');
    ok(res.final && panel.includes('GAME OVER · 1 ROUND') && panel.includes(`${res.champ} wins the game`), `the last round shows the final standings and the winner of the game (${res.champ})`);
    ok(res.round >= 5 && res.bonus >= 15 && res.wallet === res.round + res.bonus && (await coins(A)) === res.wallet, `coins are paid for the round and for finishing the game, and saved (${res.round} + ${res.bonus} = ${res.wallet})`);
    ok(panel.includes(`+${res.wallet} coins`) && panel.includes('Wallet: ' + res.wallet) && (await text(A, '#nextIn')).startsWith('Back to the lobby in'), 'the results panel shows the payout, the wallet and that the lobby is next');
    ok((await text(A, '#phaseLabel')) === 'GAME OVER', 'the header says the game is over');
    await shot(A, 'match-2-final.png');
    await A.reload();
    await boot();
    await A.waitForFunction(() => window.__pp.inGame, null, { timeout: 15000 });
    await sleep(600);
    ok((await coins(A)) === res.wallet && (await A.evaluate(() => window.__pp.coins)) === res.wallet, 'reloading during the results does not pay the same round twice');

    console.log('back in the lobby, then a three-round game');
    await waitPhase(A, 'lobby');
    await A.waitForFunction(() => document.getElementById('lobby').offsetParent !== null && document.getElementById('roundsBtn').offsetParent !== null, null, { timeout: 5000 }).catch(() => {});
    ok(await A.isVisible('#lobby') && (await text(A, '#roundsBtn')) === 'Game length: 1 round', 'after the game everyone is back in the lobby, with the host\'s choice kept');
    await A.click('#roundsBtn');
    await A.waitForFunction(() => document.getElementById('roundsBtn').innerText.includes('3 rounds'), null, { timeout: 4000 }).catch(() => {});
    await A.click('#startBtn');
    await waitPhase(A, 'hiding');
    await sleep(300);
    ok((await text(A, '#phaseLabel')) === 'ROUND 1/3 · HIDE!', 'a three-round game counts its rounds in the header');
    ok((await A.evaluate(() => [...window.__pp.roster.values()].every((r) => r.score === 0))), 'scores start from zero in the new game');
    await waitPhase(A, 'end');
    await A.waitForSelector('#results .coinRow', { state: 'visible', timeout: 8000 }).catch(() => {});
    const r2 = await A.evaluate(() => { const g = window.__pp; return { final: !!g.results.final, wallet: g.coins, mine: g.results.board.find((b) => b.id === g.myId).coins }; });
    ok(!r2.final && !(await A.isVisible('#results .final')) && /^Round 2 of 3 in \d+/.test(await text(A, '#nextIn')), `between rounds the panel counts down to the next round (${await text(A, '#nextIn')})`);
    ok(r2.wallet === res.wallet + r2.mine && (await coins(A)) === r2.wallet, `the wallet keeps growing round by round (${res.wallet} + ${r2.mine} = ${r2.wallet})`);
    // the header is repainted by the next frame after the phase message, so wait on the header itself
    await A.waitForFunction(() => document.getElementById('phaseLabel').textContent.startsWith('ROUND 2/3'), null, { timeout: 30000, polling: 100 }).catch(() => {});
    { const lbl = await text(A, '#phaseLabel'); ok(lbl.startsWith('ROUND 2/3') || lbl === 'PANIC TIME!', `round 2 follows by itself (${lbl})`); }

    console.log('menu');
    // Esc frees the mouse, which raises the pause panel (a scripted key press cannot break a real pointer lock)
    await A.evaluate(() => document.exitPointerLock());
    for (let i = 0; i < 3 && !(await A.isVisible('#leaveBtn')); i++) { await A.keyboard.press('Escape'); await sleep(300); }
    await A.click('#leaveBtn', { timeout: 8000 });
    await A.waitForSelector('#menu', { state: 'visible', timeout: 5000 });
    // round 2 may have paid out too by now on a slow machine: the menu must show whatever the wallet holds
    const held = await coins(A);
    ok(held >= r2.wallet && (await text(A, '#coinN')) === held.toLocaleString('en-US'), `the menu shows the wallet (${held} coins)`);
    await shot(A, 'match-4-menu.png');
    ok(errors.length === 0, `no browser errors (${errors.slice(0, 3).join(' | ') || 'clean'})`);
  } catch (e) { failures++; console.log('  ✗ EXCEPTION:', e.message.split('\n').slice(0, 3).join(' / ')); }
  finally { await browser.close().catch(() => {}); server.kill(); }
  console.log(failures ? `\n${failures} FAILED` : '\nAll match checks passed.');
  process.exit(failures ? 1 : 0);
})();
