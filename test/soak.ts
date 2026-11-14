/**
 * Soak test: one human-shaped client sits in a public room while bots play many fast rounds with
 * the chaos meter turned up, so every chaos event and bot code path runs repeatedly.
 * Fails on any server exception.   Run: npm run test:soak   (SOAK_SECONDS=150 by default)
 */
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = 8096;
const SECONDS = Number(process.env.SOAK_SECONDS ?? 150);

async function main() {
  let stderr = '';
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), PP_FAST: '1', PP_BRAKE_MS: '0', PP_HIDE_MS: '2000', PP_HUNT_MS: '14000', PP_END_MS: '1000', PP_CHAOS: '22' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => (stderr += String(d)));
  await new Promise<void>((res) => server.stdout.on('data', (d) => { if (String(d).includes('PROP PANIC server')) res(); }));

  const seen: Record<string, number> = {};
  const count = (k: string) => (seen[k] = (seen[k] ?? 0) + 1);
  let rounds = 0, snaps = 0, badSnap = 0, seq = 0;
  const winners: Record<string, number> = {};
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', name: 'Soaker', mode: 'quick' })));
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.t === 's') {
      snaps++;
      for (const row of m.p) for (const v of row) if (!Number.isFinite(v)) badSnap++;
      if (m.me) for (const v of m.me) if (!Number.isFinite(v)) badSnap++;
    } else if (m.t === 'phase') {
      if (m.phase === 'hiding') rounds++;
      if (m.phase === 'end') winners[m.results.winner] = (winners[m.results.winner] ?? 0) + 1;
    } else if (m.t === 'ev') count(m.k === 'chaos' ? `chaos:${m.kind}` : m.k);
  });
  // behave like a restless player: wander, jump, taunt, drop decoys, try every ability
  const timer = setInterval(() => {
    if (ws.readyState !== 1) return;
    const yaw = Math.sin(Date.now() / 3000) * 3;
    const c: number[][] = [];
    for (let i = 0; i < 3; i++) c.push([++seq, 1 / 60, 0, 1, yaw, 0, Math.random() < 0.05 ? 1 : 0, yaw]);
    ws.send(JSON.stringify({ t: 'in', c }));
    const r = Math.random();
    if (r < 0.02) ws.send(JSON.stringify({ t: 'taunt', i: 0 }));
    else if (r < 0.04) ws.send(JSON.stringify({ t: 'ab', k: ['decoy', 'ghost', 'pulse', 'shock'][Math.floor(Math.random() * 4)] }));
    else if (r < 0.12) ws.send(JSON.stringify({ t: 'fire', yaw: Math.random() * 6.28, pitch: (Math.random() - 0.6) * 0.6, rt: 0 }));
    else if (r < 0.14) ws.send(JSON.stringify({ t: 'tf', d: Math.floor(Math.random() * 380) }));
  }, 50);

  await new Promise((r) => setTimeout(r, SECONDS * 1000));
  clearInterval(timer);
  const alive = ws.readyState === 1;
  ws.close();
  server.kill();

  const chaosKinds = Object.keys(seen).filter((k) => k.startsWith('chaos:'));
  console.log(`rounds: ${rounds}, winners: ${JSON.stringify(winners)}, snapshots: ${snaps}`);
  console.log('events:', Object.entries(seen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  '));
  const fails: string[] = [];
  if (stderr.trim()) fails.push('server wrote to stderr:\n' + stderr.slice(0, 1500));
  if (!alive) fails.push('connection dropped during the soak');
  if (badSnap) fails.push(`${badSnap} non-finite numbers in snapshots`);
  if (rounds < Math.floor(SECONDS / 25)) fails.push(`only ${rounds} rounds completed`);
  if (chaosKinds.length < 3) fails.push(`only saw chaos kinds: ${chaosKinds.join(', ') || 'none'}`);
  for (const k of ['shot', 'taunt', 'roll', 'panic', 'poof']) if (!seen[k]) fails.push(`never saw event "${k}"`);
  console.log(fails.length ? '\nFAILED:\n' + fails.join('\n') : '\nSoak passed: no server errors.');
  process.exit(fails.length ? 1 : 0);
}
main();
