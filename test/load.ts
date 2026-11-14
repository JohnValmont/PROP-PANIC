/**
 * Load test: boots the real server and fills several rooms with clients that talk exactly like the browser
 * (a movement command every 1/60 s, batched the way client/src/game.ts batches them, a ping each second,
 * hunters firing). Reports what the players feel (ping, snapshot rate and size) and what the server pays
 * (CPU share of one core, event-loop lag from /health).
 *
 *   npm run test:load                       4 rooms x 8 players, 25 s
 *   LOAD_ROOMS=8 LOAD_PLAYERS=12 LOAD_SECONDS=40 npm run test:load
 *   LOAD_CPU=0.1 npm run test:load          as on a host limited to a tenth of a CPU (Render's free plan)
 *   LOAD_PIN=1 taskset -c 1-3 npm run test:load     server on a core of its own, for steadier CPU numbers
 *   LOAD_NODE_ARGS="--cpu-prof --cpu-prof-dir=prof" npm run test:load   profile the server
 *
 * Exits non-zero when the server cannot keep up (p95 ping over LOAD_MAX_P95 ms, or a client getting fewer than
 * LOAD_MIN_RATE snapshots a second). CPU readings on a shared machine vary by a percentage point or so between runs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import WebSocket from 'ws';

const PORT = Number(process.env.LOAD_PORT ?? 8097);
const ROOMS = Number(process.env.LOAD_ROOMS ?? 4);
const PLAYERS = Number(process.env.LOAD_PLAYERS ?? 8);
const SECONDS = Number(process.env.LOAD_SECONDS ?? 25);
const BOTS = Number(process.env.LOAD_BOTS ?? 2);
/** Emulate a container CPU limit (Render free = 0.1): the server is paused once it has used its share of each 100 ms. */
const QUOTA = Number(process.env.LOAD_CPU ?? 0);
/** How often a client sends its batched movement commands (client/src/game.ts INPUT_SEND_MS). */
const SEND_MS = Number(process.env.LOAD_SEND_MS ?? 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (a: number[], q: number) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

class Client {
  ws!: WebSocket;
  id = 0; code = ''; team = 'prop'; phase = 'lobby';
  seq = 0; yaw = Math.random() * 6.28; pingN = 0;
  pingOut = new Map<number, number>();
  pings: number[] = []; snaps = 0; snapBytes = 0; bytes = 0; lost = 0;
  measuring = false;
  private outbox: number[][] = []; private lastSend = 0; private timers: NodeJS.Timeout[] = [];

  connect(hello: object): Promise<void> {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      this.ws.on('open', () => this.ws.send(JSON.stringify({ t: 'hello', name: 'Load', ...hello })));
      this.ws.on('error', rej);
      this.ws.on('message', (d: Buffer) => {
        const m = JSON.parse(d.toString());
        if (this.measuring) this.bytes += d.length;
        if (m.t === 'welcome') { this.id = m.id; this.code = m.code; res(); }
        else if (m.t === 'err') rej(new Error(m.msg));
        else if (m.t === 'phase') this.phase = m.phase;
        else if (m.t === 'roster') { const me = m.p.find((r: any) => r.id === this.id); if (me) this.team = me.team; }
        else if (m.t === 's' && this.measuring) { this.snaps++; this.snapBytes += d.length; }
        else if (m.t === 'pong') {
          const at = this.pingOut.get(m.c);
          if (at !== undefined) { this.pingOut.delete(m.c); if (this.measuring) this.pings.push(performance.now() - at); }
        }
      });
    });
  }

  /** Behave like a browser tab at 60 fps. */
  play() {
    this.timers.push(setInterval(() => {
      const t = performance.now();
      if (Math.random() < 0.01) this.yaw += (Math.random() - 0.5) * 2;
      this.outbox.push([++this.seq, 1 / 60, Math.random() < 0.2 ? 1 : 0, 1, this.yaw, 0, Math.random() < 0.02 ? 1 : 0, this.yaw]);
      if (t - this.lastSend >= SEND_MS - 1 || this.outbox.length >= 8) { this.send({ t: 'in', c: this.outbox }); this.outbox = []; this.lastSend = t; }
      if (this.team === 'hunter' && this.phase === 'hunt' && Math.random() < 0.06) this.send({ t: 'fire', yaw: this.yaw, pitch: -0.1, rt: 0 });
    }, 1000 / 60));
    this.timers.push(setInterval(() => {
      for (const [c, at] of this.pingOut) if (performance.now() - at > 2500) { this.pingOut.delete(c); if (this.measuring) this.lost++; }
      const c = ++this.pingN; this.pingOut.set(c, performance.now()); this.send({ t: 'ping', c });
    }, 1000));
  }
  send(m: object) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  stop() { for (const t of this.timers) clearInterval(t); try { this.ws.close(); } catch { /* ignore */ } }
}

/** CPU time in ns used by every thread of a process (scheduler accounting, far finer than /proc/pid/stat). */
function cpuNs(pid: number): number {
  let n = 0;
  for (const t of fs.readdirSync(`/proc/${pid}/task`)) { try { n += Number(fs.readFileSync(`/proc/${pid}/task/${t}/schedstat`, 'utf8').split(' ')[0]); } catch { /* thread ended */ } }
  return n;
}

/**
 * Roughly what the kernel's CFS bandwidth control does to a container limited to `quota` CPUs: within each
 * 100 ms period the process may use quota x 100 ms of CPU, then it is frozen until the period ends.
 */
const throttled = { periods: 0, hit: 0 };
function throttle(pid: number, quota: number): () => void {
  const PERIOD = 100, budget = quota * PERIOD * 1e6;
  let start = performance.now(), base = cpuNs(pid), stopped = false;
  const timer = setInterval(() => {
    try {
      const t = performance.now();
      if (t - start >= PERIOD) { start = t; base = cpuNs(pid); throttled.periods++; if (stopped) { process.kill(pid, 'SIGCONT'); stopped = false; } return; }
      if (!stopped && cpuNs(pid) - base >= budget) { process.kill(pid, 'SIGSTOP'); stopped = true; throttled.hit++; }
    } catch { /* process gone */ }
  }, 1);
  return () => { clearInterval(timer); try { process.kill(pid, 'SIGCONT'); } catch { /* gone */ } };
}

async function main() {
  // LOAD_PIN=1: the server gets core 0 to itself (run this script under `taskset -c 1-3`) so the load does not skew the numbers
  const args = [...(process.env.LOAD_NODE_ARGS ?? '').split(' ').filter(Boolean), '--import', 'tsx', 'server/index.ts'];
  const server = spawn(process.env.LOAD_PIN ? 'taskset' : process.execPath, process.env.LOAD_PIN ? ['-c', '0', process.execPath, ...args] : args, {
    env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_HIDE_MS: '2000', PP_HUNT_MS: String((SECONDS + 30) * 1000), PP_MAX_PER_IP: '1000', PP_NEW_PER_MIN: '10000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (d) => (stderr += String(d)));
  await new Promise<void>((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));

  const unthrottle = QUOTA > 0 ? throttle(server.pid!, QUOTA) : () => {};
  const all: Client[] = [];
  for (let r = 0; r < ROOMS; r++) {
    const host = new Client();
    await host.connect({ mode: 'create' });
    all.push(host);
    for (let i = 1; i < PLAYERS; i++) { const c = new Client(); await c.connect({ mode: 'join', code: host.code }); all.push(c); }
    if (BOTS) host.send({ t: 'bots', n: BOTS });
    host.send({ t: 'start' });
  }
  for (const c of all) c.play();
  await sleep(4000); // past the hiding phase, into the hunt

  for (const c of all) c.measuring = true;
  const pid = server.pid!;
  const cpu0 = cpuNs(pid), t0 = performance.now();
  throttled.periods = throttled.hit = 0;
  await sleep(SECONDS * 1000);
  const cpu1 = cpuNs(pid), t1 = performance.now();
  for (const c of all) c.measuring = false;
  let health: any = {};
  try { health = await (await fetch(`http://localhost:${PORT}/health`)).json(); } catch { /* older server */ }
  for (const c of all) c.stop();
  unthrottle();
  server.kill();

  const secs = (t1 - t0) / 1000;
  const pings = all.flatMap((c) => c.pings);
  const snapRate = all.map((c) => c.snaps / secs);
  const snaps = all.reduce((n, c) => n + c.snaps, 0);
  const avgSnap = snaps ? all.reduce((n, c) => n + c.snapBytes, 0) / snaps : 0;
  const downKbps = (all.reduce((n, c) => n + c.bytes, 0) / all.length / secs) * 8 / 1000;
  const cpu = ((cpu1 - cpu0) / 1e9 / secs) * 100;
  const lost = all.reduce((n, c) => n + c.lost, 0);

  console.log(`${ROOMS} rooms x ${PLAYERS} players (+${BOTS} bots each), ${secs.toFixed(0)} s measured${QUOTA ? `, CPU limited to ${QUOTA}` : ''}`);
  console.log(`  ping ms        p50 ${pct(pings, 0.5).toFixed(1)}  p95 ${pct(pings, 0.95).toFixed(1)}  max ${pct(pings, 1).toFixed(1)}  lost ${lost}`);
  console.log(`  snapshots/s    min ${pct(snapRate, 0).toFixed(1)}  avg ${(snapRate.reduce((a, b) => a + b, 0) / snapRate.length).toFixed(1)}`);
  console.log(`  snapshot size  ${avgSnap.toFixed(0)} B avg;  download per player ${downKbps.toFixed(0)} kbit/s`);
  if (QUOTA) console.log(`  throttled      ${throttled.hit} of ${throttled.periods} periods (${((throttled.hit / Math.max(1, throttled.periods)) * 100).toFixed(0)}%)`);
  console.log(`  server CPU     ${cpu.toFixed(1)}% of one core${health.tick ? `;  tick avg ${health.tick.avg} ms, p99 ${health.tick.p99} ms;  loop lag p99 ${health.tick.lag} ms` : ''}`);

  const fails: string[] = [];
  if (stderr.trim()) fails.push('server wrote to stderr:\n' + stderr.slice(0, 1500));
  if (pct(pings, 0.95) > Number(process.env.LOAD_MAX_P95 ?? 60)) fails.push(`p95 ping ${pct(pings, 0.95).toFixed(1)} ms`);
  if (pct(snapRate, 0) < Number(process.env.LOAD_MIN_RATE ?? 15)) fails.push(`a client got only ${pct(snapRate, 0).toFixed(1)} snapshots/s`);
  console.log(fails.length ? '\nFAILED:\n' + fails.join('\n') : '\nLoad test passed.');
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
