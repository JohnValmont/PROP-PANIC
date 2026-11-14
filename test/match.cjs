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
const coins = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('pp_profile')).coins | 0; } catch { return 0; } });
const waitPhase = (page, phase, timeout = 40000) => page.waitForFunction((p) => window.__pp.phase === p, phase, { timeout, polling: 100 });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_BRAKE_MS: '0', PP_HIDE_MS: '2500', PP_HUNT_MS: '8000', PP_END_MS: '12000', PP_FINAL_MS: '12000' }, stdio: ['ignore', 'pipe', 'inherit'] });
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
    ok(/bargain bin/i.test(await text(A, '#lvlBadge')) && (await A.$$('#jobsMini .jm')).length === 3, 'the menu card shows the price tag and three odd jobs');

    console.log('profile and wardrobe');
    await A.click('#profBtn');
    await A.waitForSelector('#profile .profBody', { state: 'visible', timeout: 4000 });
    ok(await A.isHidden('.hero') && (await text(A, '#profile')).includes("TODAY'S ODD JOBS"), 'the profile opens in place of the hero text, on the overview');
    await A.click('#profile [data-tab="chars"]');
    ok((await A.$$('#profile .charCard')).length === 9 && (await text(A, '[data-item="char.mascot"]')).includes('4,000'), 'the Characters tab lists every hunter character with its price');
    await A.click('#profile [data-item="char.robot"]');
    ok(await A.evaluate(() => window.__pp.profile.kit.char === 'char.robot'), 'a free character is worn with one click');
    await A.click('#profile [data-tab="hunter"]');
    await A.click('#profile [data-slot="gun"]');
    ok((await A.$$('#profile .item')).length === 13, 'the hunter locker lists every blaster');
    await A.click('#profile [data-slot="hat"]');
    await A.click('#profile [data-item="hat.beanie"]'); await A.click('#profile [data-item="hat.beanie"]');
    ok(!(await A.evaluate(() => window.__pp.profile.owned.includes('hat.beanie'))), 'a hat cannot be bought without the coins');
    await A.evaluate(() => { window.__pp.profile.coins = 400; });
    await A.click('#profile [data-item="hat.beanie"]');
    ok((await text(A, '[data-item="hat.beanie"]')).includes('BUY FOR 150?'), 'the first click asks to confirm the price');
    await A.click('#profile [data-item="hat.beanie"]');
    const bought = await A.evaluate(() => ({ owned: window.__pp.profile.owned.includes('hat.beanie'), coins: window.__pp.profile.coins, hat: window.__pp.profile.kit.hat, saved: JSON.parse(localStorage.getItem('pp_profile')).kit.hat }));
    ok(bought.owned && bought.coins === 250 && bought.hat === 'hat.beanie' && bought.saved === 'hat.beanie', 'the second click buys and wears it, and it is saved');
    await A.click('#profile [data-tab="props"]');
    ok(await A.evaluate(() => window.__pp.showcaseOn), 'the googly-eyed box appears beside the hunter in the prop wardrobe');
    await A.click('#profile [data-slot="eyes"]');
    ok((await A.$$('#profile .item')).length === 10 && (await text(A, '[data-item="eyes.monocle"]')).includes('Feat: Antiquarian'), 'eyes list every style and how to get the ones not owned');
    await A.click('#profile [data-tab="catalogue"]');
    ok((await text(A, '#profile .catTop')).includes('/ 132 stamps') && (await A.$$('#profile .obj')).length === 66, 'the catalogue lists all 66 objects');
    await A.click('#profile [data-tab="feats"]');
    ok((await A.$$('#profile .feat2')).length >= 20, 'feats are listed with their progress');
    await shot(A, 'match-0-profile.png');
    await A.evaluate(() => { window.__pp.profile.coins = 0; window.__pp.applyKit(); });
    await A.click('#profile [data-act="close"]');
    ok(await A.isHidden('#profile') && await A.isVisible('.hero'), 'closing the profile brings the hero text back');
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
    { const me = await A.evaluate(() => { const g = window.__pp, r = g.roster.get(g.myId); return r && { kit: r.kit, lvl: r.lvl }; }); ok(me && me.kit[1] === 6 && me.lvl === 1, `the server has what the player wears (${JSON.stringify(me)})`); }
    ok((await A.$$('#lobbyPlayers .lv')).length >= 1, 'the lobby shows level badges');
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
    const res = await A.evaluate(() => { const g = window.__pp, r = g.results, me = r.board.find((b) => b.id === g.myId), f = r.final && r.final.find((b) => b.id === g.myId); return { final: !!r.final, rounds: r.rounds, champ: r.final && r.final[0].name, round: me && me.coins, bonus: f && f.coins, wallet: g.profile.coins, play: g.report && g.report.coinsPlay, earned: g.report && g.report.coins, games: g.profile.life.games }; });
    const panel = await text(A, '#results');
    ok(res.final && panel.includes('GAME OVER · 1 ROUND') && panel.includes(`${res.champ} wins the game`), `the last round shows the final standings and the winner of the game (${res.champ})`);
    ok(res.round >= 5 && res.bonus >= 15 && res.play === res.round + res.bonus && res.wallet === res.earned && res.earned >= res.play && (await coins(A)) === res.wallet, `coins are paid for the round and for finishing the game, plus bonuses, and saved (${res.round} + ${res.bonus} + ${res.earned - res.play} bonus = ${res.wallet})`);
    ok(panel.includes(`+${res.earned}`) && panel.includes('wallet ' + res.wallet) && panel.includes('ODD JOBS') && (await text(A, '#nextIn')).startsWith('Back to the lobby in'), 'the results panel shows XP, the payout, the wallet, the odd jobs and that the lobby is next');
    ok(res.games === 1, 'the finished game is counted in the lifetime record');
    ok((await text(A, '#phaseLabel')) === 'GAME OVER', 'the header says the game is over');
    await shot(A, 'match-2-final.png');
    await A.reload();
    await boot();
    await A.waitForFunction(() => window.__pp.inGame, null, { timeout: 15000 });
    await sleep(600);
    ok((await coins(A)) === res.wallet && (await A.evaluate(() => window.__pp.profile.coins)) === res.wallet, 'reloading during the results does not pay the same round twice');

    console.log('back in the lobby, then a three-round game');
    await waitPhase(A, 'lobby');
    await A.waitForFunction(() => document.getElementById('lobby').offsetParent !== null && document.getElementById('roundsBtn').offsetParent !== null, null, { timeout: 5000 }).catch(() => {});
    ok(await A.isVisible('#lobby') && (await text(A, '#roundsBtn')) === 'Game length: 1 round', 'after the game everyone is back in the lobby, with the host\'s choice kept');
    await A.click('#roundsBtn');
    await A.waitForFunction(() => document.getElementById('roundsBtn').innerText.includes('3 rounds'), null, { timeout: 4000 }).catch(() => {});
    await A.click('#startBtn');
    await waitPhase(A, 'hiding');
    await A.waitForFunction(() => document.getElementById('phaseLabel').textContent.startsWith('ROUND 1/3'), null, { timeout: 8000, polling: 100 }).catch(() => {});
    { const lbl = await text(A, '#phaseLabel'); ok(lbl === 'ROUND 1/3 · HIDE!' || lbl === 'ROUND 1/3 · HUNT', `a three-round game counts its rounds in the header (${lbl})`); }
    ok((await A.evaluate(() => [...window.__pp.roster.values()].every((r) => r.score === 0))), 'scores start from zero in the new game');
    await waitPhase(A, 'end');
    await A.waitForSelector('#results .prog', { state: 'visible', timeout: 8000 }).catch(() => {});
    const r2 = await A.evaluate(() => { const g = window.__pp; return { final: !!g.results.final, wallet: g.profile.coins, mine: g.report.coins }; });
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
