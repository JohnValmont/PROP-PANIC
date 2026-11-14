/**
 * Security regression tests. Boots the real server and attacks it the way a hostile client would:
 * malformed requests, path tricks, foreign origins, floods, oversized and garbage messages, seat
 * hijacking, room-code guessing; then checks what a hunter's client is actually sent about props.
 * Run: npm run test:security
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import WebSocket from 'ws';
import { CFG, F } from '../shared/constants';
import { Room } from '../server/room';

const PORT = 8097;
const WS = `ws://localhost:${PORT}/ws`;
let failures = 0;
const ok = (cond: unknown, label: string) => { if (cond) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A raw request line, exactly as written (the http module would normalise the nasty ones away). */
function raw(line: string): Promise<string> {
  return new Promise((res) => {
    const s = net.connect(PORT, '127.0.0.1', () => s.write(`${line}\r\nHost: localhost:${PORT}\r\nConnection: close\r\n\r\n`));
    let out = '';
    s.on('data', (d) => (out += d.toString('latin1')));
    s.on('close', () => res(out));
    s.on('error', () => res(out));
    setTimeout(() => s.destroy(), 4000);
  });
}
const status = (r: string) => Number(r.split(' ')[1] ?? 0);
function get(pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname, headers }, (r) => {
      const chunks: Buffer[] = [];
      r.on('data', (c) => chunks.push(c)).on('end', () => res({ status: r.statusCode ?? 0, headers: r.headers, body: Buffer.concat(chunks) }));
    }).on('error', rej);
  });
}
const alive = async () => { try { return (await get('/health')).status === 200; } catch { return false; } };

interface Sock { ws: WebSocket; msgs: any[]; closed: boolean; code: number; welcome: any; }
function open(hello: object | null, opts: { origin?: string } = {}): Promise<Sock> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS, opts.origin ? { origin: opts.origin } : {});
    const s: Sock = { ws, msgs: [], closed: false, code: 0, welcome: null };
    ws.on('open', () => { if (hello) ws.send(JSON.stringify({ t: 'hello', name: 'Sec', ...hello })); res(s); });
    ws.on('message', (d) => { try { const m = JSON.parse(d.toString()); if (m.t === 'welcome') s.welcome = m; if (m.t !== 's') s.msgs.push(m); } catch { /* ignore */ } });
    ws.on('close', (c) => { s.closed = true; s.code = c; });
    ws.on('unexpected-response', (_q, r) => rej(new Error('HTTP ' + r.statusCode)));
    ws.on('error', (e) => rej(e));
  });
}
const until = async (f: () => unknown, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(25); } return false; };

async function network() {
  console.log('http');
  ok(status(await raw('GET /%E0%A4%A HTTP/1.1')) === 400 && await alive(), 'a malformed percent-escape gets 400, not a crash');
  ok([400, 404].includes(status(await raw('GET /%00.js HTTP/1.1'))) && await alive(), 'a NUL byte in the path is refused, not a crash');
  ok(status(await raw('GET // HTTP/1.1')) > 0 && await alive(), 'an unparsable URL is answered, not a crash');
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/assets/..%5c..%5cpackage.json', '/.env', '/art/../../package.json']) {
    const r = await raw(`GET ${p} HTTP/1.1`);
    ok([400, 403, 404].includes(status(r)) && !r.includes('"dependencies"'), `path trick is refused: ${p}`);
  }
  ok(status(await raw('POST / HTTP/1.1')) === 405 && status(await raw('DELETE /index.html HTTP/1.1')) === 405, 'only GET and HEAD are served');
  const page = await get('/');
  const csp = String(page.headers['content-security-policy'] ?? '');
  ok(page.status === 200 && csp.includes("default-src 'self'") && csp.includes("object-src 'none'") && csp.includes('frame-ancestors') && !/script-src[^;]*unsafe-inline/.test(csp), 'pages carry a content security policy with no inline script');
  ok(page.headers['x-content-type-options'] === 'nosniff' && page.headers['referrer-policy'] === 'no-referrer', 'nosniff and referrer policy are set');
  ok(!/onload=|onclick=|onerror=|<script(?![^>]*src=)/i.test(page.body.toString()), 'the page has no inline scripts or event handlers for the policy to block');
  const gz = await get('/', { 'accept-encoding': 'gzip' });
  ok(gz.headers['content-encoding'] === 'gzip' && gz.body.length < page.body.length, 'text is served compressed');
  const again = await get('/', { 'if-none-match': String(page.headers.etag) });
  ok(again.status === 304, 'conditional requests get 304');

  console.log('websocket admission');
  let refused = '';
  try { await open(null, { origin: 'https://evil.example' }); } catch (e) { refused = String((e as Error).message); }
  ok(refused.includes('403'), 'a socket opened by a page on another site is refused');
  let same: Sock | null = null;
  try { same = await open({ mode: 'create' }, { origin: `http://localhost:${PORT}` }); } catch { /* fails below */ }
  ok(!!same && await until(() => same!.welcome), 'the game page itself (same origin) is accepted');
  const token: string = same?.welcome?.token ?? '';
  ok(token.length >= 22 && /^[A-Za-z0-9_-]+$/.test(token), 'seat tokens are long random strings');
  const other = await open({ mode: 'create' });
  await until(() => other.welcome);
  ok(other.welcome.token !== token && other.welcome.code !== same?.welcome?.code, 'every seat and room gets its own token and code');

  console.log('seat hijacking and code guessing');
  const thief = await open({ mode: 'rejoin', code: same!.welcome.code, token: token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A') });
  ok(await until(() => thief.msgs.some((m) => m.t === 'err')) && !thief.welcome, 'a wrong seat token cannot take over a seat');
  const huge = await open({ mode: 'rejoin', code: same!.welcome.code, token: 'x'.repeat(3000) });
  ok(await until(() => huge.msgs.some((m) => m.t === 'err') || huge.closed) && !huge.welcome, 'an oversized token is rejected');
  let blocked = false;
  for (let i = 0; i < 16 && !blocked; i++) {
    const g = await open({ mode: 'join', code: 'ZZZ' + 'ABCDEFGHJKLMNPQR'[i] });
    await until(() => g.msgs.some((m) => m.t === 'err'));
    blocked = g.msgs.some((m) => /Too many attempts/.test(m.msg ?? ''));
    g.ws.terminate();
  }
  ok(blocked, 'guessing room codes is cut off after a dozen misses a minute');

  console.log('hostile messages');
  const big = await open({ mode: 'create' });
  await until(() => big.welcome);
  big.ws.send(JSON.stringify({ t: 'chat', pad: 'x'.repeat(6000) }));
  ok(await until(() => big.closed), 'an oversized message closes the connection');
  const flood = await open({ mode: 'create' });
  await until(() => flood.welcome);
  for (let i = 0; i < 900; i++) flood.ws.send('{"t":"ping","c":1}');
  ok(await until(() => flood.closed), 'a message flood closes the connection');
  // fuzz: every message type with hostile field values; the server must stay up and keep serving others
  const fz = await open({ mode: 'create' });
  await until(() => fz.welcome);
  const evil: unknown[] = [null, undefined, NaN, Infinity, -Infinity, 1e308, -1e308, 2 ** 31, -(2 ** 31), 0.5, -1, '', 'x', '__proto__', 'constructor', [], [[]], {}, { length: 1e9 }, true, [1e308, NaN, 'a', null, {}, [], 1, 2]];
  const types = ['in', 'fire', 'tf', 'ab', 'taunt', 'chat', 'start', 'map', 'bots', 'ping', 'hello', 'kick', 'toString', '__proto__', ''];
  const keys = ['c', 'yaw', 'pitch', 'rt', 'd', 'k', 'i', 'm', 'n', 'name', 'code', 'token', 'mode', 'kit', 'lvl'];
  let sent = 0;
  for (let round = 0; round < 6 && !fz.closed; round++) {
    for (const t of types) for (const v of evil) {
      const m: any = { t };
      for (const k of keys) m[k] = evil[(sent++ * 7 + k.length) % evil.length];
      m[keys[sent % keys.length]] = v;
      if (fz.ws.readyState === 1) fz.ws.send(JSON.stringify(m));
    }
    for (const junk of ['', '{', '[]', 'null', '"x"', '{"t":{"t":"in"}}', '{"t":"in","c":[[1,2,3]]}', '{"t":"in","c":[[1e999,0,0,0,0,0,0,0]]}', '{"__proto__":{"t":"start"}}']) if (fz.ws.readyState === 1) fz.ws.send(junk);
    if (fz.ws.readyState === 1) fz.ws.send(Buffer.from([0, 255, 1, 254]));
    await sleep(1100); // stay under the flood limit so the fuzz is judged on content alone
  }
  ok(await alive(), `the server survives ${sent} hostile messages`);
  const after = await open({ mode: 'create' });
  ok(await until(() => after.welcome), 'and still seats new players afterwards');
  ok(({} as any).t === undefined, 'no prototype pollution in this process');
  for (const s of [same, other, thief, huge, big, flood, fz, after]) s?.ws.terminate();

  console.log('connection limits');
  const socks: WebSocket[] = [];
  let refusedAt = 0;
  for (let i = 0; i < 12 && !refusedAt; i++) {
    await new Promise<void>((res) => {
      const w = new WebSocket(WS);
      w.on('open', () => { socks.push(w); res(); });
      w.on('unexpected-response', (_q, r) => { if (r.statusCode === 429) refusedAt = i; res(); });
      w.on('error', () => res());
    });
  }
  ok(refusedAt > 0 && refusedAt <= 6, `one address cannot hold unlimited sockets (refused at #${refusedAt + 1} with a limit of 6)`);
  for (const w of socks) w.terminate();
  await sleep(200);
}

/** What does a hunter's client receive about a prop it cannot see? Checked against the room directly. */
async function visibility() {
  console.log('what a hunter is told');
  CFG.HIDE_MS = 50;
  const room = new Room('TEST', false);
  const inbox = new Map<string, any[]>();
  const sock = (name: string) => ({ readyState: 1, bufferedAmount: 0, send: (s: string) => { let l = inbox.get(name); if (!l) inbox.set(name, (l = [])); l.push(JSON.parse(s)); }, close() {}, terminate() {} }) as any;
  const a = room.addPlayer('A', sock('A')), b = room.addPlayer('B', sock('B')), c = room.addPlayer('C', sock('C'));
  room.startRound();
  await sleep(80); room.tick();
  const all = [a, b, c], hunter = all.find((p) => p.team === 'hunter')!, prop = all.find((p) => p.team === 'prop')!;
  const snapsFor = (p: typeof a) => { inbox.set(p.name, []); room.tick(); return (inbox.get(p.name) ?? []).filter((m) => m.t === 's'); };
  const tickFor = async (ms: number) => { const t = Date.now(); while (Date.now() - t < ms) { room.tick(); await sleep(25); } };
  const sees = (p: typeof a, id: number) => snapsFor(p).some((s) => s.p.some((row: number[]) => row[0] === id));

  // opposite sides of a partition wall in the emporium (x = -10.5 runs from z = -5 to 2)
  hunter.body.x = -8; hunter.body.z = -1.5; hunter.body.y = 0; hunter.body.vx = hunter.body.vz = 0;
  prop.body.x = -14; prop.body.z = -1.5; prop.body.y = 0; prop.body.vx = prop.body.vz = 0;
  await tickFor(900); // let any earlier sighting expire
  ok(!sees(hunter, prop.id), 'a prop behind a wall is not in the hunter\'s position updates at all');
  const mate = all.find((p) => p.team === 'prop' && p !== prop);
  if (mate) ok(sees(mate, prop.id), 'the same prop is sent to its own team');
  const hunterRoster = room.roster(hunter).find((r) => r.id === prop.id)!, propRoster = room.roster(prop).find((r) => r.id === prop.id)!;
  ok(hunterRoster.disguise === -1 && propRoster.disguise === prop.disguise, 'the hunter\'s player list does not say what a living prop is disguised as');
  // walk the prop into the open doorway: now it must appear, with its disguise attached to the position
  prop.body.x = -10.5; prop.body.z = 3.5;
  await tickFor(250);
  const row = snapsFor(hunter).flatMap((s) => s.p).find((r: number[]) => r[0] === prop.id);
  ok(!!row && row[7] === prop.disguise, 'a prop in line of sight is sent, with its disguise');
  // scanner reveal shows through walls by design
  prop.body.x = -14; prop.body.z = -1.5;
  await tickFor(900);
  prop.revealUntil = room.now + 5000;
  await tickFor(200); // visibility is re-tested about ten times a second
  const rev = snapsFor(hunter).flatMap((s) => s.p).find((r: number[]) => r[0] === prop.id);
  ok(!!rev && (rev[6] & F.REVEAL) !== 0, 'a scanner ping still reveals a prop through a wall');
  // a client that stops reading must not make the server buffer without bound
  let terminated = false;
  hunter.ws = { readyState: 1, bufferedAmount: 2_000_000, send() { throw new Error('should not send'); }, close() {}, terminate() { terminated = true; } } as any;
  room.tick();
  ok(terminated, 'a client that stops reading is disconnected instead of buffered forever');
}

async function main() {
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_HUNT_MS: '600000', PP_MAX_PER_IP: '6', PP_NEW_PER_MIN: '100000', PP_SEATS: '200', PP_PRIVATE_TABLES: '100', PP_BRAKE_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d)); server.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 80 && !(await alive()); i++) await sleep(100);
    await network();
    ok(!/tick failed|message handler failed|uncaught|unhandled/i.test(log), 'no handler ever threw on the server');
    if (/tick failed|message handler failed|uncaught|unhandled/i.test(log)) console.log(log.split('\n').filter((l) => /fail|uncaught|unhandled|Error|at /.test(l)).slice(0, 12).join('\n'));
  } finally { server.kill(); }
  await visibility();
  console.log(failures ? `\n${failures} FAILED` : '\nAll security checks passed.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
