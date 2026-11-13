/**
 * End-to-end protocol test: boots the real server in fast mode and drives it with several
 * WebSocket clients. Covers rooms, matchmaking, roles, authoritative movement, anti-speed-hack,
 * transforming, shooting, round flow and reconnects.   Run: npm test
 */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { PROPS } from '../shared/props';
import { buildMap } from '../shared/map';

const PORT = 8099;
const URL = `ws://localhost:${PORT}/ws`;
let failures = 0;
const ok = (cond: unknown, label: string) => { if (cond) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  ws!: WebSocket;
  msgs: any[] = [];
  id = 0; token = ''; code = '';
  roster: any[] = [];
  phase: any = null;
  snap: any = null;
  seq = 0;
  closed = false;
  private waiters: { pred: (m: any) => boolean; res: (m: any) => void }[] = [];

  constructor(public name: string) {}

  connect(hello: object): Promise<void> {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL);
      this.closed = false;
      this.ws.on('open', () => { this.ws.send(JSON.stringify({ t: 'hello', name: this.name, ...hello })); res(); });
      this.ws.on('error', rej);
      this.ws.on('close', () => (this.closed = true));
      this.ws.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.t === 'welcome') { this.id = m.id; this.token = m.token; this.code = m.code; }
        if (m.t === 'roster') this.roster = m.p;
        if (m.t === 'phase') this.phase = m;
        if (m.t === 's') this.snap = m; else this.msgs.push(m);
        this.waiters = this.waiters.filter((w) => { if (w.pred(m)) { w.res(m); return false; } return true; });
      });
    });
  }
  send(m: object) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (m: any) => boolean, ms = 6000, label = ''): Promise<any> {
    const past = this.msgs.find(pred);
    if (past) return Promise.resolve(past);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`${this.name}: timeout waiting for ${label}`)), ms);
      this.waiters.push({ pred, res: (m) => { clearTimeout(timer); res(m); } });
    });
  }
  me() { return this.roster.find((r) => r.id === this.id); }
  /** Send `n` movement commands of `dt` seconds each. */
  move(n: number, dt: number, mz = 1, yaw = 0, buttons = 0) {
    const c: number[][] = [];
    for (let i = 0; i < n; i++) c.push([++this.seq, dt, 0, mz, yaw, 0, buttons, yaw]);
    this.send({ t: 'in', c });
  }
  async walk(seconds: number, yaw = 0) {
    const steps = Math.round(seconds / 0.05);
    for (let i = 0; i < steps; i++) { this.move(3, 1 / 60, 1, yaw); await sleep(50); }
  }
}

async function main() {
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_HUNT_MS: '9000' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));
  try {
    console.log('rooms');
    const a = new Client('Alice'), b = new Client('Bob');
    await a.connect({ mode: 'create', kit: [9, 11, 8, 2, 1, 4, 7, 3], lvl: 23 });
    await a.wait((m) => m.t === 'welcome', 3000, 'welcome');
    ok(/^[A-Z]{4}$/.test(a.code), `private room created with code ${a.code}`);
    await b.connect({ mode: 'join', code: a.code.toLowerCase(), kit: [1e9, -3, 'x', null], lvl: -50 });
    await b.wait((m) => m.t === 'welcome', 3000, 'welcome');
    await a.wait((m) => m.t === 'roster' && m.p.length === 2, 3000, 'roster of 2');
    ok(b.code === a.code && a.roster.length === 2, 'second player joined by code (case-insensitive)');
    ok(a.me().host && !b.roster.find((r: any) => r.id === b.id).host, 'creator is host');
    const bk = a.roster.find((r: any) => r.id === b.id);
    ok(JSON.stringify(a.me().kit) === '[9,11,8,2,1,4,7,3]' && a.me().lvl === 23, 'kit and level from the hello are carried in the roster');
    ok(bk.kit.length === 8 && bk.kit.every((v: unknown) => Number.isInteger(v) && (v as number) >= 0) && bk.kit[0] < 20 && bk.lvl === 1, `a hostile kit and level are clamped (${JSON.stringify(bk.kit)}, level ${bk.lvl})`);
    const x = new Client('Nobody');
    await x.connect({ mode: 'join', code: 'ZZZZ' });
    const err = await x.wait((m) => m.t === 'err', 3000, 'err');
    ok(/not found/i.test(err.msg), 'joining an unknown code is rejected');

    console.log('lobby');
    b.send({ t: 'start' });
    b.send({ t: 'bots', n: 5 });
    b.send({ t: 'map', m: 2 });
    await sleep(300);
    ok(a.phase.phase === 'lobby' && a.roster.length === 2 && a.msgs.filter((m) => m.t === 'lobby').every((m) => m.map === 0), 'non-host cannot start, add bots or change the map');
    a.send({ t: 'bots', n: 2 });
    await a.wait((m) => m.t === 'roster' && m.p.length === 4, 3000, 'bots');
    ok(a.roster.filter((r: any) => r.bot).length === 2, 'host added 2 labelled bots');
    const l0 = a.snap.me.slice(0, 3);
    await a.walk(0.5, Math.PI);
    await sleep(150);
    ok(Math.hypot(a.snap.me[0] - l0[0], a.snap.me[2] - l0[2]) > 1, 'players can roam the lobby');

    console.log('round start');
    a.msgs.length = 0; b.msgs.length = 0;
    a.send({ t: 'start' });
    await a.wait((m) => m.t === 'phase' && m.phase === 'hiding', 3000, 'hiding');
    await sleep(200);
    const hunters = a.roster.filter((r: any) => r.team === 'hunter');
    ok(hunters.length === 1 && a.roster.filter((r: any) => r.team === 'prop').length === 3, 'server assigned 1 hunter / 3 props');
    ok(buildMap(a.phase.seed, a.phase.map).decor.length > 100, 'round seed reproduces the map client-side');
    ok(a.roster.every((r: any) => r.quack === false), 'nobody starts the round quacked, whatever their last disguise was');

    // Make sure a human is the hunter for the shooting test; otherwise just use whoever is.
    const humanHunter = [a, b].find((c) => c.me().team === 'hunter') ?? null;
    const humanProp = [a, b].find((c) => c.me().team === 'prop')!;
    console.log(`  (hunter: ${hunters[0].name}${humanHunter ? '' : ' — a bot'})`);

    console.log('authoritative movement');
    const p0 = humanProp.snap.me.slice(0, 3);
    await humanProp.walk(0.5, Math.PI); // down the central aisle
    await sleep(150);
    const p1 = humanProp.snap.me.slice(0, 3);
    const moved = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    ok(moved > 0.8 && moved < 4, `prop moved under server simulation (${moved.toFixed(2)} m in 0.5 s)`);
    // speed hack: claim 4 seconds of movement in one burst
    await sleep(700);
    const q0 = humanProp.snap.me.slice(0, 3);
    humanProp.move(20, 0.05, 1, -Math.PI / 2); humanProp.move(20, 0.05, 1, -Math.PI / 2);
    humanProp.move(20, 0.05, 1, -Math.PI / 2); humanProp.move(20, 0.05, 1, -Math.PI / 2);
    await sleep(200);
    const q1 = humanProp.snap.me.slice(0, 3);
    const burst = Math.hypot(q1[0] - q0[0], q1[2] - q0[2]);
    ok(burst < 0.75 * 5.5 * 1.3, `speed hack clamped by time bank (claimed 4 s, moved ${burst.toFixed(2)} m)`);
    ok(humanProp.snap.ack === humanProp.seq, 'server acks the latest input sequence');
    if (humanHunter) {
      const h0 = humanHunter.snap.me.slice(0, 3);
      await humanHunter.walk(0.4);
      await sleep(120);
      ok(Math.hypot(humanHunter.snap.me[0] - h0[0], humanHunter.snap.me[2] - h0[2]) < 0.01, 'hunter is frozen during the hiding phase');
      ok(humanHunter.snap.p.every((row: number[]) => a.roster.find((r: any) => r.id === row[0]).team !== 'prop'), 'hunter receives no prop positions while blindfolded');
    }

    console.log('transform');
    const map = buildMap(a.phase.seed, a.phase.map);
    const me = humanProp.snap.me;
    const near = map.decor.filter((d) => Math.hypot(d.x - me[0], d.z - me[2]) < 4 && d.type !== humanProp.me().disguise).sort((u, v) => PROPS[u.type].h - PROPS[v.type].h)[0];
    humanProp.send({ t: 'tf', d: near.id });
    await humanProp.wait((m) => m.t === 'roster' && m.p.find((r: any) => r.id === humanProp.id).disguise === near.type, 3000, 'disguise change');
    ok(true, `prop transformed into a ${PROPS[near.type].name}`);
    const far = map.decor.find((d) => Math.hypot(d.x - me[0], d.z - me[2]) > 15 && d.type !== near.type)!;
    humanProp.send({ t: 'tf', d: far.id });
    await sleep(1000);
    ok(humanProp.me().disguise === near.type, 'transforming into a far-away object is refused');
    humanProp.send({ t: 'fire', yaw: 0, pitch: 0, rt: 0 });
    humanProp.send({ t: 'ab', k: 'pulse' });

    console.log('hunt');
    await a.wait((m) => m.t === 'phase' && m.phase === 'hunt', 6000, 'hunt');
    ok(true, 'hiding phase ended on the server timer');
    humanProp.msgs.length = 0;
    humanProp.send({ t: 'taunt', i: 1 });
    const taunt = await humanProp.wait((m) => m.t === 'ev' && m.k === 'taunt' && m.who === humanProp.id, 3000, 'taunt');
    ok(taunt.pts >= 10, `taunt broadcast and scored (${taunt.pts} pts)`);
    humanProp.send({ t: 'ab', k: 'decoy' });
    await humanProp.wait((m) => m.t === 'ev' && m.k === 'decoy' && m.owner === humanProp.id, 3000, 'decoy');
    ok(true, 'decoy spawned');
    ok(!humanProp.msgs.some((m) => m.k === 'pulse' || (m.k === 'shot' && m.by === humanProp.id)), 'props cannot fire or use hunter abilities');

    if (humanHunter) {
      // aim at the other human using only what the server told us
      await sleep(150);
      const row = humanHunter.snap.p.find((r: number[]) => r[0] === humanProp.id);
      const hm = humanHunter.snap.me;
      const def = PROPS[humanProp.me().disguise];
      // the server only reports a prop the hunter can see: with no line of sight, any direction will do for these checks
      const dx = row ? row[1] - hm[0] : 0, dy = row ? row[2] + def.h / 2 - (hm[1] + 1.58) : 0, dz = row ? row[3] - hm[2] : -1;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      humanHunter.send({ t: 'fire', yaw, pitch, rt: humanHunter.snap.st });
      humanHunter.send({ t: 'fire', yaw, pitch, rt: humanHunter.snap.st }); // too fast: must be dropped
      await sleep(250);
      const shots = humanHunter.msgs.filter((m) => m.k === 'shot' && m.by === humanHunter.id);
      ok(shots.length === 1, 'fire rate is enforced server-side');
      console.log(`  (first shot hit kind ${shots[0].hit}: 1 wall, 2 innocent toy, 3 prop, 4 decoy)`);
      ok(shots[0].hit >= 1, 'server resolved the shot against the world');
    }

    console.log('round end + rematch');
    const end = await a.wait((m) => m.t === 'phase' && m.phase === 'end', 14000, 'end');
    ok(end.results && ['props', 'hunters'].includes(end.results.winner) && end.results.board.length === 4, `round ended: ${end.results.winner} win, scoreboard has 4 rows`);
    ok(end.results.board.some((r: any) => r.round > 0), 'points were awarded');
    ok(end.round === 1 && end.rounds === 3 && end.results.rounds === 3 && !end.results.final, 'round 1 of a three-round game: no final standings yet');
    ok(end.results.board.every((r: any) => Number.isInteger(r.coins) && r.coins >= 5 && r.coins <= 50), `every player is paid coins for the round (${end.results.board.map((r: any) => r.coins).join(', ')})`);
    const st = end.results.board.map((r: any) => r.st);
    ok(st.every((x: any) => x && Number.isInteger(x.k) && Number.isInteger(x.hid) && Array.isArray(x.ct) && (x.nh === 0 || x.nh === 1)), 'every row carries round stats for the profile');
    ok(end.results.board.every((r: any) => r.st.hid === -1 || (r.survived && PROPS[r.st.hid])), 'only a survivor is credited a disguise for the catalogue');
    ok(end.results.board.every((r: any) => r.st.ct.length === r.st.k && r.st.ct.every((t: number) => PROPS[t])), 'each catch lists the disguise it found');
    console.log('  awards:', end.results.awards.map((w: any) => `${w.title} → ${w.name}`).join(', ') || '(none)');
    a.msgs.length = 0;
    const next = await a.wait((m) => m.t === 'phase' && m.phase === 'hiding', 6000, 'next round');
    ok(next.round === 2 && next.seed !== end.seed, 'next round starts automatically with a fresh layout');
    ok(a.phase.map === 1 && buildMap(next.seed, 1).name === 'Sunny Meadow' && buildMap(next.seed, 1).decor.length > 100, 'maps alternate: round 2 is played on Sunny Meadow');
    await sleep(200);
    const h2 = a.roster.filter((r: any) => r.team === 'hunter');
    ok(h2.length === 1 && h2[0].id !== hunters[0].id, `hunter role rotates (${hunters[0].name} → ${h2[0].name})`);

    console.log('reconnect');
    const bid = b.id, btoken = b.token;
    b.ws.close();
    await a.wait((m) => m.t === 'roster' && m.p.some((r: any) => r.id === bid && !r.conn), 3000, 'dc flag');
    ok(a.roster.length === 4, 'seat is held while a player is disconnected mid-round');
    const b2 = new Client('Bob');
    await b2.connect({ mode: 'rejoin', code: a.code, token: btoken });
    await b2.wait((m) => m.t === 'welcome', 3000, 'welcome');
    ok(b2.id === bid, 'reconnected into the same seat');
    await sleep(200);
    ok(b2.snap && (b2.snap.me !== null || !b2.roster.find((r: any) => r.id === bid).alive), 'reconnected client receives snapshots again');

    console.log('quick play');
    const c = new Client('Carol'), d = new Client('Dave');
    await c.connect({ mode: 'quick' });
    await c.wait((m) => m.t === 'welcome', 3000, 'welcome');
    await d.connect({ mode: 'quick' });
    await d.wait((m) => m.t === 'welcome', 3000, 'welcome');
    ok(c.code === d.code && c.code !== a.code, 'quick play puts strangers in the same public room');
    await c.wait((m) => m.t === 'roster' && m.p.length === 5, 3000, 'fill');
    ok(c.roster.filter((r: any) => r.bot).length === 3, 'public room topped up with bots to 5 players');
    await c.wait((m) => m.t === 'phase' && m.phase === 'hiding', 5000, 'autostart');
    ok(true, 'public room auto-starts after a short countdown');
    const late = new Client('Eve');
    await late.connect({ mode: 'quick' });
    await late.wait((m) => m.t === 'welcome', 3000, 'welcome');
    await late.wait((m) => m.t === 'roster', 3000, 'roster');
    await sleep(200);
    ok(late.code === c.code && late.me().team === 'prop' && late.me().alive, 'late joiner drops straight in as a prop');

    console.log('robustness');
    c.ws.send('not json'); c.ws.send(JSON.stringify({ t: 'in', c: [[1, 'x']] })); c.ws.send(JSON.stringify({ t: 'tf', d: 1e9 }));
    c.ws.send(JSON.stringify({ t: 'in', c: [[9e9, 0.01, NaN, 1, 0, 0, 0, 0]] })); c.ws.send(JSON.stringify(null));
    await sleep(300);
    ok(!c.closed && c.snap, 'malformed messages are ignored without killing the connection');
    for (const cl of [a, b2, c, d, late]) cl.ws.close();
    await sleep(300);
    const health = await (await fetch(`http://localhost:${PORT}/health`)).json();
    ok(health.ok === true, `health endpoint ok (${health.rooms} rooms)`);
  } catch (e) {
    failures++;
    console.log('  ✗ EXCEPTION:', (e as Error).message);
  } finally {
    server.kill();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nAll server checks passed.');
  process.exit(failures ? 1 : 0);
}
main();
