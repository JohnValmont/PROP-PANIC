/**
 * PROP PANIC server: one Node process that serves the built client and hosts every game room.
 *   GET /            static client (dist/client)
 *   GET /health      liveness + room counts
 *   WS  /ws          game protocol (see shared/protocol.ts)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { CFG } from '../shared/constants';
import { Room, type Player } from './room';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = process.env.PP_STATIC ?? path.resolve(process.cwd(), 'dist/client');

// Short rounds for automated tests: PP_FAST=1
if (process.env.PP_FAST) {
  CFG.HIDE_MS = 2500; CFG.HUNT_MS = Number(process.env.PP_HUNT_MS ?? 14_000); CFG.END_MS = 2500;
  CFG.PANIC_MS = 6000; CFG.LOBBY_COUNTDOWN_MS = 1500; CFG.ROLLCALL_MS = 4000; CFG.ROLLCALL_PANIC_MS = 2000;
}

const rooms = new Map<string, Room>();

function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}

function cleanName(raw: unknown): string {
  let s = typeof raw === 'string' ? raw : '';
  s = s.replace(/[\u0000-\u001f\u007f<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s || 'Player' + Math.floor(100 + Math.random() * 900);
}

function findPublic(): Room {
  let best: Room | null = null;
  for (const r of rooms.values()) {
    if (!r.isPublic || r.closed || r.humanSlots >= 8) continue;
    if (!best || r.humanSlots > best.humanSlots) best = r; // fill the busiest room first
  }
  if (best) return best;
  const r = new Room(newCode(), true);
  rooms.set(r.code, r);
  return r;
}

// ---------------------------------------------------------------- http
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    let humans = 0;
    for (const r of rooms.values()) humans += r.humans;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, humans }));
    return;
  }
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(STATIC_DIR, path.normalize(rel));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found. Run `npm run build` first.'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------- websocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

wss.on('connection', (ws: WebSocket) => {
  let room: Room | null = null;
  let player: Player | null = null;
  const fail = (msg: string) => { try { ws.send(JSON.stringify({ t: 'err', msg })); ws.close(); } catch { /* ignore */ } };
  const helloTimer = setTimeout(() => { if (!player) fail('No hello received.'); }, 8000);

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m: any;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (player && room) { room.onMessage(player, m); return; }
    if (!m || m.t !== 'hello') return;
    clearTimeout(helloTimer);
    const code = typeof m.code === 'string' ? m.code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : '';
    // reconnect to a held seat
    if (typeof m.token === 'string' && code) {
      const r = rooms.get(code);
      const p = r && !r.closed ? r.reattach(m.token, ws) : null;
      if (r && p) { room = r; player = p; return; }
      if (m.mode === 'rejoin') return fail('That game has ended.');
    }
    if (m.mode === 'join') {
      const r = rooms.get(code);
      if (!r || r.closed) return fail(`Room ${code || '????'} not found.`);
      if (r.humanSlots >= CFG.MAX_PLAYERS) return fail('That room is full.');
      room = r;
    } else if (m.mode === 'create') {
      if (rooms.size > 400) return fail('Server is busy, try again soon.');
      room = new Room(newCode(), false);
      rooms.set(room.code, room);
    } else {
      room = findPublic();
    }
    player = room.addPlayer(cleanName(m.name), ws);
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (room && player && player.ws === ws) room.disconnect(player);
  });
  ws.on('error', () => { /* close follows */ });
});

// ---------------------------------------------------------------- main loop
setInterval(() => {
  for (const [code, r] of rooms) {
    try { r.tick(); } catch (e) { console.error(`[room ${code}] tick failed`, e); }
    if (r.closed) rooms.delete(code);
  }
}, 1000 / CFG.TICK);

server.listen(PORT, () => console.log(`PROP PANIC server on http://localhost:${PORT}${process.env.PP_FAST ? ' (fast test mode)' : ''}`));
