/**
 * The admin page and play statistics, against a real server and a stand-in for Supabase's REST API.
 *   npm run test:stats
 * Checks: the page is off without a key, asks for the password, refuses wrong ones and locks out guessing;
 * a round and a visit are written to the database with the columns docs/ADMIN.md creates; the history is read back;
 * and visits still open when the server stops are written before it exits.
 */
import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

let failures = 0;
const ok = (c: unknown, label: string) => { if (c) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY = 'test-admin-key-123';
const COLS: Record<string, string[]> = {
  pp_sessions: ['aid', 'started_at', 'ended_at', 'seconds', 'rounds', 'public'],
  pp_rounds: ['at', 'public', 'map', 'winner', 'humans', 'bots', 'human_hunters', 'seconds'],
  pp_samples: ['at', 'humans', 'rooms'],
};

// ---- a stand-in for Supabase: records inserts, answers the views the admin page reads
const rows: Record<string, any[]> = { pp_sessions: [], pp_rounds: [], pp_samples: [] };
const seen = { apikey: '', auth: '' as string | undefined };
const db = http.createServer((req, res) => {
  const table = (req.url ?? '').split('?')[0].replace('/rest/v1/', '');
  seen.apikey = String(req.headers.apikey ?? ''); seen.auth = req.headers.authorization;
  if (req.method === 'POST') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { try { rows[table]?.push(...JSON.parse(body)); } catch { /* recorded as nothing */ } res.writeHead(201).end(); });
    return;
  }
  const views: Record<string, unknown[]> = {
    pp_daily: [{ day: '2026-11-13', players: 8, sessions: 14, avg_seconds: 1500, rounds: 21, peak: 8 }],
    pp_totals: [{ players: 8, sessions: 14, hours: 5.8, rounds: 21, first_day: '2026-11-11' }],
    pp_maps: [{ map: 'Sunny Meadow', rounds: 10, hunter_wins: 4, prop_wins: 6, avg_humans: 7.5 }],
  };
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(views[table] ?? []));
});

function startServer(port: number, env: Record<string, string>): Promise<ChildProcess> {
  const s = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), PP_FAST: '1', PP_BRAKE_MS: '0', PP_HIDE_MS: '300', PP_HUNT_MS: '1500', PP_END_MS: '600', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  s.stderr!.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return new Promise((res) => s.stdout!.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(s); }));
}
const get = (port: number, path: string, auth?: string) => new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((res, rej) => {
  http.get({ host: '127.0.0.1', port, path, headers: auth ? { authorization: 'Basic ' + Buffer.from(auth).toString('base64') } : {} }, (r) => {
    let body = ''; r.on('data', (d) => (body += d)); r.on('end', () => res({ status: r.statusCode ?? 0, body, headers: r.headers }));
  }).on('error', rej);
});

async function main() {
  await new Promise<void>((r) => db.listen(0, '127.0.0.1', r));
  const dbPort = (db.address() as any).port;

  console.log('admin page switched off');
  {
    const s = await startServer(8131, {});
    ok((await get(8131, '/admin')).status === 404, 'without PP_ADMIN_KEY there is no admin page');
    s.kill();
  }

  console.log('admin page and statistics');
  const s = await startServer(8132, { PP_ADMIN_KEY: KEY, SUPABASE_URL: `http://127.0.0.1:${dbPort}`, SUPABASE_KEY: 'sb_secret_test', PP_STATS_FLUSH_MS: '300' });
  const r0 = await get(8132, '/admin');
  ok(r0.status === 401 && /Basic/.test(String(r0.headers['www-authenticate'])), 'asks for a password');
  ok((await get(8132, '/admin', 'x:wrong-password')).status === 401, 'a wrong password is refused');
  ok((await get(8132, '/admin', `anyone:${KEY}`)).status === 200, 'the right password opens it, with any user name');

  // a private room with a human and bots plays one round
  const ws = new WebSocket('ws://127.0.0.1:8132/ws');
  const msgs: any[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ t: 'hello', name: 'Tester', mode: 'create', aid: 'abcdef0123456789' }));
  const until = async (f: () => boolean, ms: number) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(50); return f(); };
  await until(() => msgs.some((m) => m.t === 'welcome'), 3000);
  ws.send(JSON.stringify({ t: 'bots', n: 3 }));
  await sleep(200);
  ws.send(JSON.stringify({ t: 'start' }));
  const ended = await until(() => msgs.some((m) => m.t === 'phase' && m.phase === 'end'), 15000);
  ok(ended, 'a round is played to the end');

  const page = await get(8132, '/admin', `u:${KEY}`);
  ok(/humans online/.test(page.body) && /private/.test(page.body), 'the page lists the live room');
  ok(/different players/.test(page.body) && /Sunny Meadow/.test(page.body) && /40%/.test(page.body), 'history is read back from the database (players, map win rates)');
  ok(!/<script/i.test(page.body) && page.headers['cache-control'] === 'no-store', 'the page has no script and is never cached');

  await until(() => rows.pp_rounds.length > 0, 3000);
  const round = rows.pp_rounds[0];
  ok(round && round.humans === 1 && round.bots === 3 && ['props', 'hunters'].includes(round.winner) && typeof round.map === 'string', 'the round was written: winner, map, humans and bots');
  ok(rows.pp_samples.some((x) => x.humans === 1), 'a sample of humans online was written');
  ok(seen.apikey === 'sb_secret_test' && seen.auth === undefined, 'a secret key goes in the apikey header only');

  // the server stops with the player still in the room: their visit must still be written
  const exited = new Promise((r) => s.on('exit', r));
  s.kill('SIGTERM');
  await exited;
  const visit = rows.pp_sessions.find((x) => x.aid === 'abcdef0123456789');
  ok(visit && visit.rounds === 1 && visit.public === false && visit.seconds >= 0, 'a visit still open at shutdown is written before the server exits');
  ok(!rows.pp_sessions.some((x) => x.aid === ''), 'bots are not counted as visits');

  for (const [table, list] of Object.entries(rows)) {
    const bad = list.find((r) => Object.keys(r).sort().join() !== COLS[table].slice().sort().join());
    ok(!bad, `every ${table} row has exactly the columns docs/ADMIN.md creates`);
  }

  console.log('password guessing');
  const s2 = await startServer(8133, { PP_ADMIN_KEY: KEY });
  ok(/No database is connected/.test((await get(8133, '/admin', `x:${KEY}`)).body), 'without a database the page says history is not kept');
  for (let i = 0; i < 10; i++) await get(8133, '/admin', `x:guess${i}`);
  ok((await get(8133, '/admin', `x:${KEY}`)).status === 429, 'ten wrong passwords lock the address out, even for the right one');
  s2.kill();

  db.close();
  console.log(failures ? `\n${failures} stats check(s) FAILED` : '\nAll stats checks passed.');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
