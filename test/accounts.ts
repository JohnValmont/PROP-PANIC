/**
 * Optional accounts, against a real server and a stand-in for Supabase (Auth and the REST API).
 *   npm run test:accounts
 * Checks: accounts are off without keys; the config hands out the publishable key and never the secret one; the API
 * refuses missing and forged tokens, other origins and oversized bodies; the first sign-in starts fresh or brings a
 * guest profile once; buying and wearing follow the rules on the server; a signed-in seat wears what the account owns
 * at the level it has earned (whatever the browser claims) and its round is banked by the server and written back;
 * a guest seat is untouched; deleting an account removes the profile and the sign-in; changes are written at shutdown.
 */
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import { ITEMS, kitToWire, newProfile, xpLevel, KIT, CHARS, GUNS } from '../shared/progress';

let failures = 0;
const ok = (c: unknown, label: string) => { if (c) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(40); return f(); };

// ---- tokens: shaped like JWTs, as the server checks the shape before asking Auth
const EXP = Math.floor(Date.now() / 1000) + 3600;
const jwt = (sub: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub, exp: EXP })).toString('base64url')}.c2lnbmF0dXJlc2lnbmF0dXJl`;
const ALICE = '11111111-1111-4111-8111-111111111111', BOB = '22222222-2222-4222-8222-222222222222', CAROL = '33333333-3333-4333-8333-333333333333';
const users = new Map<string, string>([[jwt(ALICE), ALICE], [jwt(BOB), BOB], [jwt(CAROL), CAROL]]);
const deletedUsers = new Set<string>();

// ---- a stand-in for Supabase
const profiles = new Map<string, { profile: any; imported: boolean }>();
const log: { method: string; path: string; apikey: string; auth?: string }[] = [];
const db = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  log.push({ method: req.method!, path: url.pathname, apikey: String(req.headers.apikey ?? ''), auth: req.headers.authorization });
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const json = (status: number, v?: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(v === undefined ? '' : JSON.stringify(v));
    if (url.pathname === '/auth/v1/user') {
      if (req.headers.apikey !== 'sb_publishable_test') return json(401, { msg: 'bad apikey' });
      const tok = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      const uid = users.get(tok);
      return uid && !deletedUsers.has(uid) ? json(200, { id: uid, email: 'x@example.com' }) : json(401, { msg: 'invalid token' });
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      if (req.headers.apikey !== 'sb_secret_test') return json(401, {});
      deletedUsers.add(url.pathname.split('/').pop()!);
      return json(200, {});
    }
    if (url.pathname === '/rest/v1/pp_profiles') {
      if (req.headers.apikey !== 'sb_secret_test') return json(401, {});
      const uid = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, '');
      if (req.method === 'GET') { const r = profiles.get(uid); return json(200, r ? [r] : []); }
      if (req.method === 'POST') {
        const row = JSON.parse(body);
        if (profiles.has(row.user_id)) return json(409, { code: '23505' });
        profiles.set(row.user_id, { profile: row.profile, imported: row.imported });
        return json(201);
      }
      if (req.method === 'PATCH') { const r = profiles.get(uid); if (r) r.profile = JSON.parse(body).profile; return json(204); }
      if (req.method === 'DELETE') { profiles.delete(uid); return json(204); }
    }
    if (url.pathname.startsWith('/rest/v1/pp_')) return json(201); // statistics: not what this test is about
    json(404, {});
  });
});

function startServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const s = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), PP_FAST: '1', PP_BRAKE_MS: '0', PP_HIDE_MS: '300', PP_HUNT_MS: '1500', PP_END_MS: '600', PP_STATS_FLUSH_MS: '300', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  s.stderr!.on('data', (d) => { if (!/\[accounts\]/.test(String(d))) process.stderr.write(`[server] ${d}`); });
  return new Promise((res) => s.stdout!.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(s); }));
}
function call(port: number, method: string, path: string, opts: { token?: string; body?: unknown; raw?: string; origin?: string } = {}) {
  return new Promise<{ status: number; j: any; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const data = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (data !== undefined) headers['content-type'] = 'application/json';
    if (opts.origin) headers.origin = opts.origin;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (r) => {
      let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => { let j: any = null; try { j = JSON.parse(b); } catch { /* not json */ } resolve({ status: r.statusCode ?? 0, j, headers: r.headers }); });
    });
    req.on('error', (e) => (opts.raw && opts.raw.length > 64 * 1024 ? resolve({ status: 413, j: null, headers: {} }) : reject(e)));
    if (data !== undefined) req.write(data);
    req.end();
  });
}
function connect(port: number, hello: object) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const msgs: any[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  ws.on('open', () => ws.send(JSON.stringify(hello)));
  return { ws, msgs };
}

async function main() {
  await new Promise<void>((r) => db.listen(0, '127.0.0.1', r));
  const SB = `http://127.0.0.1:${(db.address() as any).port}`;
  const ENV = { SUPABASE_URL: SB, SUPABASE_KEY: 'sb_secret_test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', PP_ACCT_SAVE_MS: '150' };

  console.log('accounts switched off');
  {
    const s = await startServer(8141, {});
    const c = await call(8141, 'GET', '/api/config');
    ok(c.status === 200 && c.j?.accounts === false, 'without keys the config says accounts are off');
    ok((await call(8141, 'GET', '/api/me', { token: jwt(ALICE) })).status === 404, 'and the account API does not exist');
    const p = connect(8141, { t: 'hello', name: 'G', mode: 'create', auth: jwt(ALICE) });
    await until(() => p.msgs.some((m) => m.t === 'welcome'), 3000);
    ok(p.msgs.find((m) => m.t === 'welcome')?.acct === 0, 'a token in the hello is ignored: the player is a guest');
    p.ws.close(); s.kill();
  }

  console.log('the account API');
  let s = await startServer(8142, ENV);
  const cfg = await call(8142, 'GET', '/api/config');
  ok(cfg.j?.accounts === true && cfg.j.url === SB && cfg.j.key === 'sb_publishable_test' && cfg.j.providers.join() === 'discord,google', 'the config gives the sign-in address, the publishable key and the providers');
  ok(!JSON.stringify(cfg.j).includes('sb_secret'), 'the secret key is never handed out');
  const page = await call(8142, 'GET', '/status');
  ok(String(page.headers['content-security-policy'] ?? '').includes(`connect-src 'self' data: blob: ws://127.0.0.1:8142 wss://127.0.0.1:8142 ${SB}`), 'the content security policy lets the page reach the sign-in service');
  ok((await call(8142, 'GET', '/api/me')).status === 401, 'no token: not signed in');
  ok((await call(8142, 'GET', '/api/me', { token: jwt('44444444-4444-4444-8444-444444444444') })).status === 401, 'a token Auth does not recognise is refused');
  ok((await call(8142, 'GET', '/api/me', { token: 'not-a-jwt' })).status === 401, 'garbage is refused without asking Auth');
  ok((await call(8142, 'POST', '/api/me/change', { token: jwt(ALICE), body: { op: 'equip', id: 'x' }, origin: 'https://evil.example' })).status === 403, 'a change from another website is refused');
  ok((await call(8142, 'GET', '/api/me/start', { token: jwt(ALICE) })).status === 405, 'wrong method is refused');
  ok((await call(8142, 'POST', '/api/me/start', { token: jwt(ALICE), raw: 'x'.repeat(70_000) })).status === 413, 'an oversized body is refused');

  const me0 = await call(8142, 'GET', '/api/me', { token: jwt(ALICE) });
  ok(me0.status === 200 && me0.j.profile === null, 'a new account has no profile until the player chooses how to start');

  // Alice brings a guest profile; the server cleans it up (unknown items dropped, numbers clamped)
  const guest: any = newProfile();
  guest.xp = 5000; guest.coins = 3000; guest.owned = ['not.an.item']; guest.life.rounds = 12; guest.paid = 'ROOM:1:1';
  const st = await call(8142, 'POST', '/api/me/start', { token: jwt(ALICE), body: { guest } });
  ok(st.status === 200 && st.j.imported === true && st.j.profile.xp === 5000 && st.j.profile.owned.length === 0 && st.j.profile.paid === '', 'the first sign-in brings the guest profile, cleaned up');
  ok(profiles.get(ALICE)?.imported === true, 'the row is created and marked as brought in');
  const again = await call(8142, 'POST', '/api/me/start', { token: jwt(ALICE), body: { guest: { ...guest, xp: 9e8 } } });
  ok(again.status === 409 && again.j.profile.xp === 5000, 'a guest profile can be brought in only once');
  const bobStart = await call(8142, 'POST', '/api/me/start', { token: jwt(BOB), body: {} });
  ok(bobStart.status === 200 && bobStart.j.imported === false && bobStart.j.profile.xp === 0, 'or the player starts fresh');

  // buying and wearing are decided by the server
  const forSale = Object.values(ITEMS).find((it) => 'price' in it.how && it.how.price <= 3000)!;
  const pricey = Object.values(ITEMS).find((it) => 'price' in it.how && it.how.price > 3000)!;
  const levelItem = Object.values(ITEMS).find((it) => 'level' in it.how && it.how.level > xpLevel(5000))!;
  const r1 = await call(8142, 'POST', '/api/me/change', { token: jwt(BOB), body: { op: 'buy', id: forSale.id } });
  ok(r1.status === 200 && r1.j.ok === false && r1.j.profile.coins === 0, 'cannot buy without the coins');
  const r2 = await call(8142, 'POST', '/api/me/change', { token: jwt(ALICE), body: { op: 'buy', id: forSale.id } });
  ok(r2.j.ok === true && r2.j.profile.owned.includes(forSale.id) && r2.j.profile.coins === 3000 - (forSale.how as any).price && r2.j.profile.kit[forSale.slot] === forSale.id, 'buying takes the coins, and the item is worn');
  const r3 = await call(8142, 'POST', '/api/me/change', { token: jwt(ALICE), body: { op: 'buy', id: pricey.id } });
  ok(r3.j.ok === false, 'cannot buy what the account cannot afford');
  const r4 = await call(8142, 'POST', '/api/me/change', { token: jwt(ALICE), body: { op: 'equip', id: levelItem.id } });
  ok(r4.j.ok === false && r4.j.profile.kit[levelItem.slot] !== levelItem.id, 'cannot wear an item the account has not unlocked');
  const r5 = await call(8142, 'POST', '/api/me/change', { token: jwt(ALICE), body: { op: 'title', id: 'not-earned' } });
  ok(r5.j.ok === false, 'cannot wear a title that has not been earned');
  ok(await until(() => profiles.get(ALICE)?.profile.owned.includes(forSale.id), 2000), 'the purchase is written back to the database');

  console.log('playing signed in');
  const fake = [7, 0, 0, 0, 0, CHARS.length - 1, GUNS.length - 1, 0]; // a modified browser claiming the rarest look
  const a = connect(8142, { t: 'hello', name: 'Alice', mode: 'create', kit: fake, lvl: 999, auth: jwt(ALICE), aid: 'abcdef0123456789' });
  await until(() => a.msgs.some((m) => m.t === 'welcome'), 4000);
  const welcome = a.msgs.find((m) => m.t === 'welcome');
  ok(welcome?.acct === 1, 'the welcome says this seat banks into the account');
  await until(() => a.msgs.some((m) => m.t === 'roster'), 2000);
  const meRow = [...a.msgs].reverse().find((m) => m.t === 'roster').p.find((r: any) => r.id === welcome.id);
  const want = kitToWire(profiles.get(ALICE)!.profile);
  ok(meRow.lvl === xpLevel(5000) && meRow.lvl !== 999, 'the level shown to others is the account\'s, not the browser\'s claim');
  ok(JSON.stringify(meRow.kit) === JSON.stringify(want) && meRow.kit[KIT.char] !== fake[KIT.char], 'the look is what the account owns, not what the browser sent');

  // a guest in the same room is untouched
  const code = welcome.code;
  const g = connect(8142, { t: 'hello', name: 'Guest', mode: 'join', code, kit: fake, lvl: 7 });
  await until(() => g.msgs.some((m) => m.t === 'welcome'), 3000);
  ok(g.msgs.find((m) => m.t === 'welcome')?.acct === 0, 'a guest seat is a guest seat');

  // a forged token in the hello: still plays, as a guest
  const f = connect(8142, { t: 'hello', name: 'Forger', mode: 'join', code, auth: jwt('55555555-5555-4555-8555-555555555555') });
  await until(() => f.msgs.some((m) => m.t === 'welcome'), 4000);
  ok(f.msgs.find((m) => m.t === 'welcome')?.acct === 0, 'a hello with a token Auth does not recognise plays as a guest');

  const roundsBefore = profiles.get(ALICE)!.profile.life.rounds;
  a.ws.send(JSON.stringify({ t: 'bots', n: 2 }));
  await sleep(200);
  a.ws.send(JSON.stringify({ t: 'start' }));
  await until(() => a.msgs.some((m) => m.t === 'phase' && m.phase === 'end'), 15000);
  ok(await until(() => a.msgs.some((m) => m.t === 'acct'), 3000), 'after the round the server sends the banked profile and what it earned');
  const acct = a.msgs.find((m) => m.t === 'acct');
  ok(acct && acct.rep.xp >= 10 && acct.p.life.rounds === roundsBefore + 1, 'the report and the profile agree: one more round, some XP');
  ok(!g.msgs.some((m) => m.t === 'acct') && !f.msgs.some((m) => m.t === 'acct'), 'guests get no account message');
  ok(await until(() => profiles.get(ALICE)!.profile.life.rounds === roundsBefore + 1, 2000), 'the banked round is written to the database');
  ok(profiles.get(ALICE)!.profile.paid.startsWith(code + ':'), 'the round is marked as banked (so it cannot be paid twice)');
  ok(log.filter((l) => l.path === '/rest/v1/pp_profiles').every((l) => l.apikey === 'sb_secret_test' && l.auth === undefined), 'profiles are read and written with the secret key only, in the apikey header');
  ok(log.filter((l) => l.path === '/auth/v1/user').every((l) => l.apikey === 'sb_publishable_test'), 'tokens are checked with the publishable key');

  // a reload puts Alice back in her seat, still signed in, without sending the token again
  const tokenSeat = welcome.token;
  a.ws.close();
  await sleep(150);
  const a2 = connect(8142, { t: 'hello', name: 'Alice', mode: 'rejoin', code, token: tokenSeat });
  await until(() => a2.msgs.some((m) => m.t === 'welcome'), 3000);
  ok(a2.msgs.find((m) => m.t === 'welcome')?.acct === 1, 'back in the seat after a reload, still banking into the account');

  console.log('deleting an account');
  const del = await call(8142, 'POST', '/api/me/delete', { token: jwt(ALICE), body: {} });
  ok(del.status === 200 && !profiles.has(ALICE) && deletedUsers.has(ALICE), 'the profile row and the sign-in are both deleted');
  ok((await call(8142, 'GET', '/api/me', { token: jwt(ALICE) })).status === 401, 'the old token no longer works');
  await sleep(400);
  ok(!profiles.has(ALICE), 'nothing writes the deleted profile back');
  a2.ws.close(); g.ws.close(); f.ws.close();

  console.log('shutdown');
  await call(8142, 'POST', '/api/me/start', { token: jwt(CAROL), body: {} });
  s.kill('SIGTERM');
  await new Promise((r) => s.on('exit', r));
  s = await startServer(8143, { ...ENV, PP_ACCT_SAVE_MS: '60000' });
  profiles.get(BOB)!.profile.coins = 0;
  const bobGuest = await call(8143, 'GET', '/api/me', { token: jwt(BOB) });
  ok(bobGuest.j.profile.xp === 0, 'a fresh server loads the profile from the database');
  // Bob earns nothing by changing a title, but the write is pending for a minute: stopping the server must flush it
  await call(8143, 'POST', '/api/me/change', { token: jwt(BOB), body: { op: 'equip', id: Object.values(ITEMS).find((it) => 'free' in it.how && it.slot === 'hat' && it.id !== bobGuest.j.profile.kit.hat)!.id } });
  const hatNow = (await call(8143, 'GET', '/api/me', { token: jwt(BOB) })).j.profile.kit.hat;
  ok(profiles.get(BOB)!.profile.kit.hat !== hatNow, 'the change is held in memory for now');
  s.kill('SIGTERM');
  await new Promise((r) => s.on('exit', r));
  ok(profiles.get(BOB)!.profile.kit.hat === hatNow, 'and written to the database when the server stops');

  db.close();
  console.log(failures ? `\n${failures} account check(s) FAILED` : '\nAll account checks passed.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
