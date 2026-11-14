/**
 * Browser test of the alpha front door: the table board, the line, practice while waiting, and the call to take
 * the seat. The server runs with two seats at one table so it is full straight away.
 *   npm run build && npm run test:lineup
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const WebSocket = require('ws');

const PORT = 8099;
const URL = `http://localhost:${PORT}/?debug=1&noart=1`;
const SHOTS = path.join(__dirname, 'shots');
let failures = 0;
const ok = (cond, label) => { if (cond) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), timeout: 15000 }).catch(() => console.log(`  (skipped screenshot ${name})`));
const bot = (hello) => new Promise((res) => { const ws = new WebSocket(`ws://localhost:${PORT}/ws`); ws.on('open', () => ws.send(JSON.stringify(hello))); ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'welcome') res(ws); }); });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn(process.execPath, ['dist/server.cjs'], { env: { ...process.env, PORT: String(PORT), PP_SEATS: '2', PP_BRAKE_MS: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) r(); }));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('pp_seen', '1'); localStorage.setItem('pp_quality', 'low'); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { failures++; console.log('  ✗ page error:', e.message); });
    console.log('table board');
    await page.goto(URL);
    await page.waitForFunction(() => document.querySelector('#tSeats')?.textContent.includes('seats'), null, { timeout: 30000 });
    ok((await page.textContent('#tSeats')).includes('0 of 2'), 'the board shows free seats before anyone plays');
    ok(await page.locator('.tbl.free').count() === 1 && await page.locator('.tbl.priv').count() === 1 && await page.locator('.tbl.locked').count() === 1, 'a free table, the private rooms, and more locked until after alpha');
    await sleep(800); await shot(page, 'lineup-board.png');

    // two people take both seats at the only table
    const a = await bot({ t: 'hello', name: 'Ann', mode: 'quick' });
    const b = await bot({ t: 'hello', name: 'Bo', mode: 'quick' });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('#quickBtn').textContent === 'GET IN LINE', null, { timeout: 20000 }).catch(() => {});
    ok(await page.textContent('#quickBtn') === 'GET IN LINE', 'when full, Play says it will put you in line');
    ok(/Estimated wait: (under a minute|about \d+ min)/.test(await page.textContent('#seatNote')), `the Play card shows the estimated wait (${await page.textContent('#seatNote')})`);
    ok(await page.locator('.tbl.pub').count() === 1, 'the running public table is on the board');
    await shot(page, 'lineup-full.png');

    console.log('the line');
    await page.click('#quickBtn');
    await page.waitForSelector('#lineup:not(.hidden)', { timeout: 10000 });
    ok((await page.textContent('#luPos')) === '#1', 'first in line');
    ok((await page.textContent('#luMsg')).includes('alpha'), 'the line explains the alpha limit politely');
    ok(/Estimated wait: (under a minute|about \d+ min)/.test(await page.textContent('#luEta')), `the line shows an estimated wait (${await page.textContent('#luEta')})`);
    await sleep(500); await shot(page, 'lineup-line.png');

    console.log('practice while waiting');
    await page.click('#luPractice');
    await page.waitForFunction(() => window.__pp.inGame && window.__pp.code === 'SOLO', null, { timeout: 30000 });
    ok(true, 'the practice room runs in the browser');
    const roster = await page.evaluate(() => [...window.__pp.roster.values()].map((p) => p.bot));
    ok(roster.filter(Boolean).length >= 4, `practice is filled with bots (${roster.filter(Boolean).length})`);
    ok(await page.isVisible('#lineChip.waiting'), 'the place in line rides along during practice');
    ok(!(await page.isVisible('#copyLink')), 'no invite link in an offline room');
    await page.click('#startBtn');
    await page.waitForFunction(() => ['hiding', 'hunt'].includes(window.__pp.phase), null, { timeout: 30000 });
    ok(true, 'a practice round starts');
    await sleep(1500); await shot(page, 'lineup-practice.png');

    console.log('the call');
    a.close();
    await page.waitForSelector('#lineChip.ready', { timeout: 40000 });
    ok(true, 'when a seat frees, the practising player is called');
    await shot(page, 'lineup-ready.png');
    await page.click('#lcJoin');
    await page.waitForFunction(() => window.__pp.inGame && window.__pp.code !== 'SOLO' && window.__pp.code.length === 4, null, { timeout: 20000 });
    ok(true, 'Join now takes the held seat on the real server');
    ok(!(await page.isVisible('#lineChip')), 'the chip is gone once seated');
    const h = await (await fetch(`http://localhost:${PORT}/status`)).json();
    ok(h.used === 2 && h.line === 0, `the server counts the seat (${h.used}/${h.seats}, ${h.line} in line)`);
    b.close();

    console.log('phone');
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phone.addInitScript(() => { try { localStorage.setItem('pp_seen', '1'); localStorage.setItem('pp_quality', 'low'); } catch {} });
    const pp = await phone.newPage();
    await pp.goto(URL);
    await pp.waitForFunction(() => document.querySelector('#tSeats')?.textContent.includes('seats'), null, { timeout: 30000 });
    ok(await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll on a phone');
    await sleep(800); await shot(pp, 'lineup-phone.png');
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nAll line checks passed.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
