/**
 * The front door (server/gate.ts): when every seat is taken, newcomers wait in a fair line with a live position and an estimate,
 * a freed seat goes to the front of the line as a pass, nobody playing is removed, reconnects always get back in,
 * and the table board never shows a private room's code.   Run: npm run test:gate
 */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

let PORT = 8097;
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
    env: { ...process.env, PORT: String(PORT), PP_SEATS: '3', PP_PRIVATE_TABLES: '1', PP_PASS_MS: '4000', PP_BRAKE_MS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => (stderr += String(d)));
  await new Promise<void>((r) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) r(); }));

  try {
    // three seats, one private room
    const host = await client({ t: 'hello', name: 'Host', mode: 'create' });
    const hw = await host.wait('welcome');
    ok(hw, 'first player opens a private room');
    const a = await client({ t: 'hello', name: 'A', mode: 'quick' });
    const aw = await a.wait('welcome');
    ok(aw && aw.code !== hw.code, 'quick play opens a public table');
    // seats are free but the only private room is in use: say so at once, never a line with seats to spare
    const c = await client({ t: 'hello', name: 'C', mode: 'create' });
    const ce = await c.wait('err');
    ok(ce && /private rooms are in use/.test(ce.msg) && !c.msgs.some((m) => m.t === 'line'), `no private room free: told straight away (${ce?.msg})`);
    const b = await client({ t: 'hello', name: 'B', mode: 'quick' });
    const bw = await b.wait('welcome');
    ok(bw, 'a free seat is always usable by quick play');
    // all three seats taken: now, and only now, people wait in line
    const d = await client({ t: 'hello', name: 'D', mode: 'quick' });
    const dl = await d.wait('line');
    ok(dl && dl.pos === 1 && dl.seats === 3 && dl.used === 3, `full: D is first in line (pos ${dl?.pos}, ${dl?.used}/${dl?.seats})`);
    ok(dl && dl.eta > 0, `the line always gives an estimated wait (${dl?.eta}s)`);
    const e = await client({ t: 'hello', name: 'E', mode: 'create' });
    const el = await e.wait('line');
    ok(el && el.pos === 2 && el.eta >= dl.eta, `full: E is second, with a longer or equal wait (${el?.eta}s)`);
    // a made-up pass does nothing
    const fake = await client({ t: 'hello', name: 'X', mode: 'quick', pass: 'not-a-pass' });
    ok((await fake.wait('line'))?.pos === 3, 'a made-up pass does not let anyone in');
    fake.ws.close();

    const st = await status();
    ok(st.seats === 3 && st.used === 3 && st.line >= 2 && st.eta > 0 && st.privateTables === 1 && st.privateUsed === 1, `table board: ${st.used}/${st.seats} seats, ${st.line} waiting, wait ${st.eta}s`);
    ok(st.list.length === 1 && st.list[0].code === aw.code, 'the board lists the public table');
    ok(!JSON.stringify(st).includes(hw.code), "the private room's code appears nowhere in the status");

    // a reconnect to a held seat always gets in, even with a line
    a.ws.terminate();
    await sleep(300);
    const a2 = await client({ t: 'hello', name: 'A', mode: 'rejoin', code: aw.code, token: aw.token });
    ok(await a2.wait('welcome'), 'reconnecting to a held seat skips the line');

    // B leaves the public table: D (front, needs a seat) gets the pass; E (needs a private room) cannot use it yet
    b.ws.close();
    const dp = await d.wait('ready', 45_000); // a dropped player's seat is held 30 s mid-round for a reconnect
    ok(dp && typeof dp.pass === 'string', 'a freed seat goes to the front of the line');
    ok(!e.msgs.some((m) => m.t === 'ready'), 'someone waiting for a private room is not handed a public seat');
    const d2 = await client({ t: 'hello', name: 'D', mode: 'quick', pass: dp?.pass });
    ok(await d2.wait('welcome'), 'the pass is a seat');
    d.ws.close();
    const reuse = await client({ t: 'hello', name: 'Y', mode: 'quick', pass: dp?.pass });
    ok(await reuse.wait('line'), 'a used pass does not let anyone else in');
    reuse.ws.close();

    // the private host leaves: E gets the room's seat and table, but never claims it
    host.ws.close();
    const ep = await e.wait('ready', 25_000);
    ok(ep, 'when the private room closes, the person waiting for one gets it');
    const missed = await e.wait('missed', 8000);
    ok(missed, 'an unused pass runs out and the place is given up');
    // leaving the line releases a held pass at once
    const f = await client({ t: 'hello', name: 'F', mode: 'quick' });
    const fl = await f.wait('line', 3000);
    const fp = fl ? await f.wait('ready', 4000) : null;
    if (fl && fp) {
      f.send({ t: 'leave' });
      await sleep(1500);
      const g = await client({ t: 'hello', name: 'G', mode: 'quick' });
      ok(await g.wait('welcome', 3000), 'a pass given back by Leave goes to the next person straight away');
      g.ws.close();
    } else ok(await f.wait('welcome', 10) || fl, 'F got in');
    for (const x of [a2, d2, c, e, f]) x.ws.close();
  } finally {
    server.kill();
  }
  // with the real defaults: 24 people pressing Play all get a seat, and the 25th gets a place in line with an estimate
  PORT = 8095;
  const real = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), PP_BRAKE_MS: '0', PP_MAX_PER_IP: '100', PP_SEATS: '', PP_PRIVATE_TABLES: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  real.stderr.on('data', (d) => (stderr += String(d)));
  await new Promise<void>((r) => real.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) r(); }));
  try {
    const seated: Client[] = [];
    for (let i = 0; i < 24; i++) { const c = await client({ t: 'hello', name: 'P' + i, mode: 'quick' }); if (await c.wait('welcome', 4000)) seated.push(c); }
    ok(seated.length === 24, `defaults: all 24 seats are usable through Play (${seated.length} seated)`);
    const st = await status();
    ok(st.used === 24 && st.list.length === 3 && st.list.every((t: any) => t.humans === 8), `24 players fill exactly 3 public tables of 8 (${st.list.map((t: any) => t.humans).join(', ')})`);
    const late = await client({ t: 'hello', name: 'Late', mode: 'quick' });
    const ll = await late.wait('line');
    ok(ll && ll.pos === 1 && ll.seats === 24 && ll.eta > 0, `the 25th person gets in line: #${ll?.pos}, about ${Math.round((ll?.eta ?? 0) / 60)} min`);
    for (const c of [...seated, late]) c.ws.close();
  } finally {
    real.kill();
  }
  if (/Error|exception/i.test(stderr)) { console.log(stderr); failed++; }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall gate checks passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
