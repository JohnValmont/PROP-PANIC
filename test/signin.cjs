/**
 * Browser test of the optional accounts, against a stand-in for Supabase Auth and its REST API:
 * a guest signs in through the redirect, the one-time code is swapped for tokens (PKCE), they bring their guest
 * profile into the new account, change their look (saved on the server), play a round that the server banks,
 * reload (still signed in), and sign out (back to a guest).
 *   npm run build && npm run test:signin
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const PORT = 8097;
const SHOTS = path.join(__dirname, 'shots');
let failures = 0;
const ok = (cond, label) => { if (cond) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name), timeout: 15000 }).catch(() => console.log(`  (skipped screenshot ${name})`));

// ---- the stand-in: one user, one pending sign-in at a time
const UID = '66666666-6666-4666-8666-666666666666';
const ACCESS = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: UID, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.c2lnbmF0dXJlc2lnbmF0dXJl`;
const profiles = new Map();
let challenge = '', authorizeQuery = null, loggedOut = false;
const sb = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey, authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const json = (status, v) => res.writeHead(status, { ...cors, 'content-type': 'application/json' }).end(v === undefined ? '' : JSON.stringify(v));
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (url.pathname === '/auth/v1/authorize') {
      authorizeQuery = Object.fromEntries(url.searchParams);
      challenge = url.searchParams.get('code_challenge');
      return res.writeHead(302, { location: `${url.searchParams.get('redirect_to')}?code=one-time-code` }).end();
    }
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const b = JSON.parse(body || '{}');
      const s256 = crypto.createHash('sha256').update(b.code_verifier ?? '').digest('base64url');
      if (b.auth_code !== 'one-time-code' || s256 !== challenge || req.headers.apikey !== 'sb_publishable_test') return json(400, { error_description: 'bad code' });
      return json(200, { access_token: ACCESS, refresh_token: 'refresh-1', expires_in: 3600, user: { id: UID, email: 'tester@example.com', user_metadata: { full_name: 'Test Player' }, app_metadata: { provider: 'discord' } } });
    }
    if (url.pathname === '/auth/v1/logout') { loggedOut = true; return json(204); }
    if (url.pathname === '/auth/v1/user') return String(req.headers.authorization) === `Bearer ${ACCESS}` ? json(200, { id: UID }) : json(401, {});
    if (url.pathname === '/rest/v1/pp_profiles') {
      const uid = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, '');
      if (req.method === 'GET') return json(200, profiles.has(uid) ? [profiles.get(uid)] : []);
      if (req.method === 'POST') { const r = JSON.parse(body); profiles.set(r.user_id, { profile: r.profile, imported: r.imported }); return json(201); }
      if (req.method === 'PATCH') { const r = profiles.get(uid); if (r) r.profile = JSON.parse(body).profile; return json(204); }
    }
    if (url.pathname.startsWith('/rest/v1/')) return json(201);
    json(404, {});
  });
});

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await new Promise((r) => sb.listen(0, '127.0.0.1', r));
  const SB = `http://127.0.0.1:${sb.address().port}`;
  const server = spawn(process.execPath, ['dist/server.cjs'], {
    env: { ...process.env, PORT: String(PORT), PP_BRAKE_MS: '0', PP_FAST: '1', PP_HIDE_MS: '400', PP_HUNT_MS: '2500', PP_END_MS: '6000', SUPABASE_URL: SB, SUPABASE_KEY: 'sb_secret_test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', PP_ACCT_SAVE_MS: '200' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((r) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) r(); }));
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    // a returning guest: level 4 or so, some coins, a few rounds behind them
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('pp_seen', '1'); localStorage.setItem('pp_quality', 'low');
        if (!sessionStorage.getItem('seeded')) {
          sessionStorage.setItem('seeded', '1');
          localStorage.setItem('pp_profile', JSON.stringify({ v: 1, xp: 2000, coins: 640, owned: [], cat: {}, life: { rounds: 9 }, feats: [], paid: '', since: 1700000000000, kit: {}, jobs: { day: '', have: [0, 0, 0], done: [false, false, false], shift: false } }));
        }
      } catch {}
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { failures++; console.log('  ✗ page error:', e.message); });
    const csp = [];
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });

    console.log('a guest sees the offer');
    await page.goto(`http://localhost:${PORT}/?debug=1&noart=1&room=ABCD`);
    await page.waitForFunction(() => window.__pp && window.__pp.account && window.__pp.account.state === 'guest', null, { timeout: 30000 });
    const guestLvl = await page.evaluate(() => window.__pp.profile.xp);
    ok(guestLvl === 2000, 'the guest profile is in use');
    await page.click('#profBtn');
    await page.waitForSelector('.sect.acct');
    ok(await page.locator('[data-prov="discord"]').count() === 1 && await page.locator('[data-prov="google"]').count() === 1, 'Overview offers Continue with Discord and Continue with Google');
    ok(/never need an account to play/.test(await page.textContent('.sect.acct')), 'and says an account is optional');
    await sleep(400); await shot(page, 'signin-offer.png');

    console.log('signing in');
    await page.click('[data-prov="discord"]');
    await page.waitForFunction(() => window.__pp && window.__pp.account && window.__pp.account.state === 'choose', null, { timeout: 30000 });
    ok(authorizeQuery && authorizeQuery.provider === 'discord' && authorizeQuery.code_challenge_method === 's256' && authorizeQuery.redirect_to === `http://localhost:${PORT}/`, 'the browser went to the provider with a PKCE challenge');
    ok(new URL(page.url()).search === '?room=ABCD', 'the one-time code is gone from the address and the room link is back');
    await page.waitForSelector('[data-act="startImport"]', { timeout: 10000 });
    ok(/Test Player \(Discord\)/.test(await page.textContent('.sect.acct')) && /Level \d+/.test(await page.textContent('.sect.acct')), 'back in the game, the profile asks whether to bring this browser\'s progress');
    await shot(page, 'signin-choose.png');
    await page.click('[data-act="startImport"]');
    await page.waitForFunction(() => window.__pp.account.state === 'on', null, { timeout: 10000 });
    ok(profiles.get(UID)?.imported === true && profiles.get(UID).profile.xp === 2000, 'the guest profile was brought into the account');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pp_profile')).xp) === 0, 'and this browser starts a fresh guest profile');
    ok(await page.evaluate(() => window.__pp.profile.xp) === 2000 && await page.evaluate(() => document.getElementById('profBtn').classList.contains('acct')), 'the menu shows the account\'s profile, marked as saved');
    ok(/saved on the server after every round/.test(await page.textContent('.sect.acct')), 'Overview says it is saved on the server');
    await sleep(300); await shot(page, 'signin-on.png');

    console.log('a change is saved on the server');
    await page.click('[data-tab="hunter"]');
    await page.click('[data-slot="hat"]');
    const hat = await page.evaluate(() => [...document.querySelectorAll('.item:not(.locked):not(.on)')].map((e) => e.dataset.item)[0]);
    await page.click(`[data-item="${hat}"]`);
    await page.waitForFunction(() => true);
    let saved = false;
    for (let i = 0; i < 30 && !saved; i++) { saved = profiles.get(UID).profile.kit.hat === hat; if (!saved) await sleep(100); }
    ok(saved, `wearing a hat (${hat}) is saved to the account`);

    console.log('a round is banked by the server');
    await page.click('[data-act="close"]').catch(() => {});
    const roundsBefore = profiles.get(UID).profile.life.rounds;
    await page.evaluate(() => { document.getElementById('codeInput').value = ''; });
    await page.click('#createBtn');
    await page.waitForFunction(() => window.__pp.inGame && window.__pp.code, null, { timeout: 20000 });
    ok(await page.evaluate(() => window.__pp.acctSeat) === true, 'the seat is the account\'s (the welcome said so)');
    await page.evaluate(() => { window.__pp.net.send({ t: 'bots', n: 2 }); });
    await sleep(300);
    await page.evaluate(() => { window.__pp.net.send({ t: 'start' }); });
    await page.waitForFunction(() => window.__pp.report, null, { timeout: 30000 });
    ok(await page.evaluate(() => window.__pp.profile.life.rounds) === roundsBefore + 1, 'the results show what the server banked');
    let written = false;
    for (let i = 0; i < 30 && !written; i++) { written = profiles.get(UID).profile.life.rounds === roundsBefore + 1; if (!written) await sleep(100); }
    ok(written, 'and it is in the database');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pp_profile')).life.rounds) === 0, 'the guest profile in this browser was not touched');
    await sleep(1500); await shot(page, 'signin-results.png');

    console.log('reload and sign out');
    await page.evaluate(() => { sessionStorage.removeItem('pp_seat'); });
    await page.goto(`http://localhost:${PORT}/?debug=1&noart=1`);
    await page.waitForFunction(() => window.__pp && window.__pp.account.state === 'on', null, { timeout: 30000 });
    ok(await page.evaluate(() => window.__pp.profile.life.rounds) === roundsBefore + 1, 'after a reload the player is still signed in, with the account\'s profile');
    await page.click('#profBtn');
    await page.waitForSelector('[data-act="signout"]');
    await page.click('[data-act="signout"]');
    await page.waitForFunction(() => window.__pp.account.state === 'guest', null, { timeout: 10000 });
    ok(loggedOut, 'signing out ends the session at the sign-in service');
    ok(await page.evaluate(() => window.__pp.profile.xp) === 0 && await page.evaluate(() => localStorage.getItem('pp_auth')) === null, 'back to a guest profile, and no tokens left in the browser');
    ok(csp.length === 0, `no content security policy violations${csp.length ? ': ' + csp[0] : ''}`);
  } catch (e) {
    failures++; console.log('  ✗', e);
  } finally {
    await browser.close();
    server.kill();
    sb.close();
  }
  console.log(failures ? `\n${failures} sign-in check(s) FAILED` : '\nAll sign-in checks passed.');
  process.exit(failures ? 1 : 0);
})();
