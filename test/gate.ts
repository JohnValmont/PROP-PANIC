/**
 * The front door (server/gate.ts): seats and tables run out, newcomers wait in a fair line with a live position,
 * a freed seat goes to the front of the line as a pass, nobody playing is removed, reconnects always get back in,
 * and the table board never shows a private room's code.   Run: npm run test:gate
 */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 8097;
let failed = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client { ws: WebSocket; msgs: any[]; wait: (t: string, ms?: number) => Promise<any>; send: (m: object) => void; }
function client(hello: object): Promise<Client> {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const msgs: any[] = [];
    const waiters: [string, (m: any) => void][] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      msgs.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i][0] === m.t) { waiters[i][1](m); waiters.splice(i, 1); }
    });
    const c: Client = {
      ws, msgs,
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (t, ms = 6000) => {
        const seen = msgs.find((m) => m.t === t);
        if (seen) { msgs.splice(msgs.indexOf(seen), 1); return Promise.resolve(seen); }
        return new Promise((r) => { const timer = setTimeout(() => r(null), ms); waiters.push([t, (m) => { clearTimeout(timer); msgs.splice(msgs.indexOf(m), 1); r(m); }]); });
      },
    };
    ws.on('open', () => { ws.send(JSON.stringify(hello)); res(c); });
  });
}
const status = async () => (await fetch(`http://localhost:${PORT}/status`)).json();

async function main() {
  let stderr = '';
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), PP_SEATS: '3', PP_TABLES: '2', PP_PASS_MS: '4000', PP_BRAKE_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => (stderr += String(d)));
  await new Promise<void>((r) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) r(); }));

  try {
    // three seats, two tables: a private room and a public one
    const host = await client({ t: 'hello', name: 'Host', mode: 'create' });
    const hw = await host.wait('welcome');
    ok(hw, 'first player gets a seat');
    const a = await client({ t: 'hello', name: 'A', mode: 'quick' });
    const aw = await a.wait('welcome');
    ok(aw && aw.code !== hw.code, 'quick play opens a second table');
    // the second table is taken: a new private room must wait even though a seat is free
    const c = await client({ t: 'hello', name: 'C', mode: 'create' });
    const cl = await c.wait('line');
    ok(cl && cl.pos === 1, `a private room with no free table waits in line (pos ${cl?.pos})`);
    // but someone who only needs a seat at the public table is not stuck behind them
    const b = await client({ t: 'hello', name: 'B', mode: 'quick' });
    const bl = await b.wait('line');
    ok(bl && bl.pos === 2, 'walk-ins never jump the line: B queues behind C');
    const bp = await b.wait('ready', 3000);
    ok(bp && typeof bp.pass === 'string', 'B is handed a pass for the free public seat (C needs a table, not a seat)');
    const b2 = await client({ t: 'hello', name: 'B', mode: 'quick', pass: bp?.pass });
    ok(await b2.wait('welcome'), 'the pass is a seat');
    b.ws.close();
    // now all three seats are full
    const d = await client({ t: 'hello', name: 'D', mode: 'quick' });
    const dl = await d.wait('line');
    ok(dl && dl.pos === 2 && dl.seats === 3, `full: D is second in line (pos ${dl?.pos})`);
    // a pass cannot be reused, and a made-up one does nothing
    const fake = await client({ t: 'hello', name: 'X', mode: 'quick', pass: bp?.pass });
    ok(await fake.wait('line'), 'a used pass does not let anyone else in');
    fake.ws.close();

    const st = await status();
    ok(st.seats === 3 && st.used === 3 && st.line >= 2 && st.tables === 2, `table board: ${st.used}/${st.seats} seats, ${st.line} waiting`);
    ok(st.list.some((t: any) => !t.pub && t.code === '') && st.list.some((t: any) => t.pub && t.code === aw.code), 'private table codes stay secret, public ones are listed');
    ok(!JSON.stringify(st).includes(hw.code), "the private room's code appears nowhere in the status");

    // a reconnect to a held seat always gets in, even with a line
    a.ws.terminate();
    await sleep(300);
    const a2 = await client({ t: 'hello', name: 'A', mode: 'rejoin', code: aw.code, token: aw.token });
    ok(await a2.wait('welcome'), 'reconnecting to a held seat skips the line');

    // the private host leaves: their table frees, so C (front of line, wants a table) gets the pass, then D waits on
    host.ws.close();
    await sleep(400);
    const cp = await c.wait('ready', 25_000);
    ok(cp, 'when a table frees, the front of the line gets it');
    const dPos = await d.wait('line', 3000);
    ok(dPos && dPos.pos === 1, `D moves up to first (pos ${dPos?.pos})`);
    // C never claims it: the pass runs out and C is told
    const missed = await c.wait('missed', 8000);
    ok(missed, 'an unused pass runs out and the place is given up');
    const dp = await d.wait('ready', 6000);
    ok(dp, 'the next person in line gets the seat');
    // leaving the line releases a held pass at once
    d.send({ t: 'leave' });
    await sleep(1500);
    const e = await client({ t: 'hello', name: 'E', mode: 'quick' });
    ok(await e.wait('welcome', 3000), 'a pass given back by Leave goes to the next person straight away');
    for (const x of [a2, b2, e, c, d]) x.ws.close();
  } finally {
    server.kill();
  }
  if (/Error|exception/i.test(stderr)) { console.log(stderr); failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall gate checks passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
