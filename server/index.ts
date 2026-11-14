/**
 * PROP PANIC server: one Node process that serves the built client and hosts every game room.
 *   GET /            static client (dist/client)
 *   GET /health      liveness + room counts
 *   GET /status      the menu's table board: seats, tables, the line (server/gate.ts)
 *   GET /admin       private statistics page (only when PP_ADMIN_KEY is set; see docs/ADMIN.md)
 *   WS  /ws          game protocol (see shared/protocol.ts)
 *
 * Everything that arrives from the network is treated as hostile: see SECURITY.md for the threat model.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { randomInt } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { CFG } from '../shared/constants';
import { cleanKit } from '../shared/progress';
import { Room, type Player } from './room';
import { handleAdmin } from './admin';
import { Gate, GATE } from './gate';
import { cleanAid, flush as flushStats, observe } from './stats';

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_DIR = path.resolve(process.env.PP_STATIC ?? path.resolve(process.cwd(), 'dist/client'));
/** Behind a reverse proxy (Render, Fly, nginx) the socket address is the proxy: read the forwarded client address instead. */
const TRUST_PROXY = process.env.PP_TRUST_PROXY ? process.env.PP_TRUST_PROXY === '1' : !!process.env.RENDER;
/** Extra hostnames allowed to open game sockets (the site's own host always is). Comma separated. */
const EXTRA_ORIGINS = (process.env.PP_ORIGINS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
/** Sites allowed to embed the game in a frame, e.g. "https://itch.io https://html-classic.itch.zone". */
const FRAME_ANCESTORS = process.env.PP_FRAME_ANCESTORS ?? "'self'";
const num = (name: string, fallback: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : fallback; };
const LIMITS = {
  conns: num('PP_MAX_CONNS', 1500), // sockets in total
  perIp: num('PP_MAX_PER_IP', 32), // sockets from one address (a classroom behind one router still fits)
  newPerMin: num('PP_NEW_PER_MIN', 120), // socket opens per address per minute
  badJoinsPerMin: 12, // wrong room codes per address per minute (stops code guessing)
  rooms: num('PP_MAX_ROOMS', 400),
  msgsPerSec: 400, bytesPerSec: 64 * 1024, payload: 4 * 1024,
};

// Short rounds for automated tests: PP_FAST=1
if (process.env.PP_FAST) {
  CFG.HIDE_MS = Number(process.env.PP_HIDE_MS ?? 2500); CFG.HUNT_MS = Number(process.env.PP_HUNT_MS ?? 14_000); CFG.END_MS = Number(process.env.PP_END_MS ?? 2500); CFG.FINAL_MS = Number(process.env.PP_FINAL_MS ?? CFG.END_MS);
  CFG.PANIC_MS = 6000; CFG.LOBBY_COUNTDOWN_MS = 1500; CFG.ROLLCALL_MS = 4000; CFG.ROLLCALL_PANIC_MS = 2000;
  if (process.env.PP_JOIN_MS) CFG.LATE_JOIN_MS = Number(process.env.PP_JOIN_MS);
}
if (process.env.PP_CHAOS) CFG.CHAOS_PASSIVE = Number(process.env.PP_CHAOS); // test-only: fill the chaos meter fast

const rooms = new Map<string, Room>();
/** Seats, tables and the line for everyone who arrives when they are full. */
const gate = new Gate(rooms);

function newCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[randomInt(A.length)];
    if (!rooms.has(c)) return c;
  }
}

/** Names are shown to everyone: strip markup, control and invisible/bidi characters, and collapse look-alike forms. */
function cleanName(raw: unknown): string {
  let s = typeof raw === 'string' ? raw.slice(0, 64) : '';
  try { s = s.normalize('NFKC'); } catch { /* keep as is */ }
  // Cc = control, Cf = invisible formatting (zero-width, text-direction overrides), Zl/Zp = line and paragraph separators
  s = s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>&"'`\\]/gu, '').replace(/\s+/g, ' ').trim();
  s = Array.from(s).slice(0, 16).join('');
  return s || 'Player' + (100 + randomInt(900));
}

function findPublic(): Room {
  const best = gate.publicTable(); // the busiest public table with a free seat
  if (best) return best;
  const r = new Room(newCode(), true);
  rooms.set(r.code, r);
  return r;
}

// ---------------------------------------------------------------- per-address accounting
interface IpState { open: number; opens: number; badJoins: number; windowAt: number; }
const ips = new Map<string, IpState>();
function ipState(ip: string): IpState {
  let s = ips.get(ip);
  const t = Date.now();
  if (!s) ips.set(ip, (s = { open: 0, opens: 0, badJoins: 0, windowAt: t }));
  if (t - s.windowAt > 60_000) { s.windowAt = t; s.opens = 0; s.badJoins = 0; }
  return s;
}
function clientIp(req: http.IncomingMessage): string {
  if (TRUST_PROXY) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.length < 64) return cf.trim();
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff ?? '').split(',')[0].trim();
    if (first && first.length < 64) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
setInterval(() => { const t = Date.now(); for (const [ip, s] of ips) if (s.open <= 0 && t - s.windowAt > 120_000) ips.delete(ip); }, 60_000).unref();

// ---------------------------------------------------------------- http
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.hdr': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

function securityHeaders(req: http.IncomingMessage): Record<string, string> {
  const host = String(req.headers.host ?? '').replace(/[^A-Za-z0-9.:\-[\]]/g, '');
  const h: Record<string, string> = {
    // scripts only from this origin (the mesh decoder needs WebAssembly); no plugins, no foreign frames
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      `connect-src 'self' data: blob: ws://${host} wss://${host}`,
      "worker-src 'self' blob:",
      "object-src 'none'", "base-uri 'none'", "form-action 'none'",
      `frame-ancestors ${FRAME_ANCESTORS}`,
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  if (req.headers['x-forwarded-proto'] === 'https') h['strict-transport-security'] = 'max-age=15552000';
  return h;
}

/** Text assets are compressed once and kept; keyed by path, invalidated by size and mtime. */
const packed = new Map<string, { tag: string; raw: Buffer; gzip: Buffer; br: Buffer }>();

/** Short addresses for the static legal pages (the files themselves live in client/public). */
const PAGES: Record<string, string> = { '/privacy': '/privacy.html', '/terms': '/terms.html' };

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  let rel: string;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400).end(); return; }
  if (rel.includes('\0') || rel.split(/[\\/]/).some((seg) => seg.startsWith('.') && seg.length > 1)) { res.writeHead(404).end(); return; }
  if (rel in PAGES) rel = PAGES[rel];
  else if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.join(STATIC_DIR, path.normalize(rel));
  if (!file.startsWith(STATIC_DIR + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found.'); return; }
    const ext = path.extname(file).toLowerCase();
    const tag = `W/"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
    const hashed = rel.startsWith('/assets/') || (rel.startsWith('/art/') && url.searchParams.has('v'));
    const head: Record<string, string | number> = {
      ...securityHeaders(req),
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      etag: tag,
    };
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, head).end(); return; }
    if (COMPRESSIBLE.has(ext) && st.size < 8 * 1024 * 1024) {
      let p = packed.get(file);
      if (!p || p.tag !== tag) {
        let raw: Buffer;
        try { raw = fs.readFileSync(file); } catch { res.writeHead(404).end(); return; }
        p = { tag, raw, gzip: zlib.gzipSync(raw, { level: 9 }), br: zlib.brotliCompressSync(raw) };
        packed.set(file, p);
      }
      const accept = String(req.headers['accept-encoding'] ?? '');
      const body = /\bbr\b/.test(accept) ? p.br : /\bgzip\b/.test(accept) ? p.gzip : p.raw;
      if (body !== p.raw) head['content-encoding'] = body === p.br ? 'br' : 'gzip';
      head.vary = 'accept-encoding'; head['content-length'] = body.length;
      res.writeHead(200, head).end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    head['content-length'] = st.size;
    res.writeHead(200, head);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { allow: 'GET, HEAD' }).end(); return; }
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      let humans = 0;
      for (const r of rooms.values()) humans += r.humans;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ ok: true, rooms: rooms.size, humans, tick: tickStats() }));
      return;
    }
    if (url.pathname === '/status') {
      res.writeHead(200, { ...securityHeaders(req), 'content-type': 'application/json', 'cache-control': 'no-store' }).end(gate.status());
      return;
    }
    if (handleAdmin(req, res, url.pathname, clientIp(req), rooms, securityHeaders(req))) return;
    serveStatic(req, res, url);
  } catch {
    // a malformed request line or path must never take the process down
    try { res.writeHead(400).end(); } catch { /* socket already gone */ }
  }
});
server.headersTimeout = 15_000; server.requestTimeout = 30_000; server.keepAliveTimeout = 10_000;
server.on('clientError', (_e, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* ignore */ } });

// ---------------------------------------------------------------- websocket
const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.payload, perMessageDeflate: false });

function originAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser (native clients, tests): there is no ambient authority to steal
  try {
    const o = new URL(origin);
    const host = o.host.toLowerCase(), name = o.hostname.toLowerCase();
    return host === String(req.headers.host ?? '').toLowerCase() || name === 'localhost' || name === '127.0.0.1' || EXTRA_ORIGINS.includes(host) || EXTRA_ORIGINS.includes(name);
  } catch { return false; }
}

function refuse(socket: Duplex, code: number, text: string) {
  try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* ignore */ }
}

server.on('upgrade', (req, socket, head) => {
  let pathname = '';
  try { pathname = new URL(req.url ?? '/', 'http://x').pathname; } catch { /* refused below */ }
  if (pathname !== '/ws') return refuse(socket, 404, 'Not Found');
  if (!originAllowed(req)) return refuse(socket, 403, 'Forbidden');
  const ip = clientIp(req), st = ipState(ip);
  if (wss.clients.size >= LIMITS.conns) return refuse(socket, 503, 'Service Unavailable');
  if (st.open >= LIMITS.perIp || ++st.opens > LIMITS.newPerMin) return refuse(socket, 429, 'Too Many Requests');
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, ip, st));
});

interface Meta { alive: boolean; pingAt: number; player: Player | null; }
const meta = new WeakMap<WebSocket, Meta>();

function onConnection(ws: WebSocket, ip: string, st: IpState) {
  st.open++;
  let room: Room | null = null;
  let player: Player | null = null;
  let waiting = false;
  const info: Meta = { alive: true, pingAt: 0, player: null };
  meta.set(ws, info);
  let winAt = Date.now(), msgs = 0, bytes = 0;
  const fail = (msg: string) => { try { ws.send(JSON.stringify({ t: 'err', msg })); ws.close(); } catch { /* ignore */ } };
  const helloTimer = setTimeout(() => { if (!player) fail('No hello received.'); }, 8000);

  ws.on('pong', () => { info.alive = true; if (info.player && info.pingAt) info.player.rtt = Math.min(999, Date.now() - info.pingAt); });

  ws.on('message', (data, isBinary) => {
    // flood guard, in messages and in bytes
    const t = Date.now();
    if (t - winAt > 1000) { winAt = t; msgs = 0; bytes = 0; }
    msgs++; bytes += (data as Buffer).length ?? 0;
    if (msgs > LIMITS.msgsPerSec || bytes > LIMITS.bytesPerSec) { try { ws.close(1008, 'rate'); } catch { /* ignore */ } return; }
    if (isBinary) return;
    let m: any;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    try {
      if (player && room) { room.onMessage(player, m); return; }
      // someone waiting in line can only leave it; their seat arrives as a pass on a fresh connection
      if (waiting) { if (m.t === 'leave') { gate.drop(ws, true); waiting = false; try { ws.close(1000, 'left'); } catch { /* ignore */ } } return; }
      if (m.t !== 'hello') return;
      clearTimeout(helloTimer);
      const code = typeof m.code === 'string' ? m.code.slice(0, 16).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) : '';
      // reconnect to a held seat
      if (typeof m.token === 'string' && m.token.length <= 64 && code) {
        const r = rooms.get(code);
        const p = r && !r.closed ? r.reattach(m.token, ws) : null;
        if (r && p) { room = r; player = info.player = p; return; }
      }
      // a rejoin that did not match a held seat ends here: it must never fall through into a fresh seat
      if (m.mode === 'rejoin') return fail('That game has ended.');
      const mode = m.mode === 'join' || m.mode === 'create' ? m.mode : 'quick';
      if (mode === 'join') {
        // a wrong or full room is an answer, not a reason to wait in line
        if (st.badJoins >= LIMITS.badJoinsPerMin) return fail('Too many attempts. Wait a minute and try again.');
        const r = rooms.get(code);
        if (!r || r.closed) { st.badJoins++; return fail(`Room ${code || '????'} not found.`); }
        if (r.humanSlots >= (r.isPublic ? GATE.publicSeats : CFG.MAX_PLAYERS)) return fail('That room is full.');
      }
      // the front door: a seat now, or a place in line (server/gate.ts)
      const door = gate.admit(ws, { mode, code }, m.pass);
      if (door === 'busy') return fail('So many people are waiting that the line is full. Please try again in a few minutes.');
      if (door === 'noTable') return fail(`All ${GATE.privateTables} private rooms are in use right now. Press PLAY to join a public game, or try again in a few minutes.`);
      if (door === 'line') { waiting = true; return; }
      if (mode === 'join') {
        const r = rooms.get(code);
        if (!r || r.closed) return fail(`Room ${code || '????'} not found.`);
        room = r;
      } else if (mode === 'create') {
        if (rooms.size >= LIMITS.rooms) return fail('Server is busy, try again soon.');
        room = new Room(newCode(), false);
        rooms.set(room.code, room);
      } else {
        if (rooms.size >= LIMITS.rooms * 2) return fail('Server is busy, try again soon.');
        room = findPublic();
      }
      // what a player wears and their level come from their browser: checked for shape and range, not ownership (SECURITY.md)
      const lvl = typeof m.lvl === 'number' && Number.isFinite(m.lvl) ? Math.max(1, Math.min(999, Math.floor(m.lvl))) : 1;
      player = info.player = room.addPlayer(cleanName(m.name), ws, false, cleanKit(m.kit), lvl, cleanAid(m.aid));
    } catch (e) {
      // a handler bug must cost one connection, never the whole server
      console.error('[ws] message handler failed', e);
      try { ws.close(1011, 'error'); } catch { /* ignore */ }
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    st.open = Math.max(0, st.open - 1);
    if (waiting) gate.drop(ws);
    if (room && player && player.ws === ws) room.disconnect(player);
  });
  ws.on('error', () => { /* close follows */ });
}

// drop sockets that stopped answering (half-open connections), and measure round-trip time for the scoreboard
setInterval(() => {
  for (const ws of wss.clients) {
    const info = meta.get(ws);
    if (!info) continue;
    if (!info.alive) { ws.terminate(); continue; }
    info.alive = false; info.pingAt = Date.now();
    try { ws.ping(); } catch { /* closing */ }
  }
}, 10_000).unref();

// ---------------------------------------------------------------- main loop
const tickMs: number[] = [];
const loopLag = monitorEventLoopDelay({ resolution: 10 });
loopLag.enable();
setInterval(() => loopLag.reset(), 10_000).unref();

/**
 * Room tick cost and event-loop lag over the last few seconds, for /health. A tick that takes long, or a loop that
 * runs late, is lag every player on this server feels (pings and inputs wait for it): this shows it before they do.
 */
function tickStats() {
  const s = [...tickMs].sort((a, b) => a - b);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    avg: s.length ? r1(s.reduce((a, b) => a + b, 0) / s.length) : 0,
    p99: s.length ? r1(s[Math.min(s.length - 1, Math.floor(s.length * 0.99))]) : 0,
    lag: r1(loopLag.percentile(99) / 1e6),
  };
}

let lastLoop = performance.now(), lastPump = 0;
setInterval(() => {
  // how late this tick is: when the CPU quota runs out, the whole process stalls and ticks arrive late
  const t0 = performance.now();
  gate.sample(t0 - lastLoop - 1000 / CFG.TICK);
  lastLoop = t0;
  let humans = 0;
  for (const [code, r] of rooms) {
    const t = performance.now();
    try { r.tick(); } catch (e) { console.error(`[room ${code}] tick failed`, e); }
    tickMs.push(performance.now() - t);
    if (r.closed) rooms.delete(code); else humans += r.humans;
  }
  if (tickMs.length > 4000) tickMs.splice(0, tickMs.length - 2000);
  observe(humans, rooms.size);
  if (t0 - lastPump >= 1000) { lastPump = t0; try { gate.pump(); } catch (e) { console.error('[gate] pump failed', e); } }
}, 1000 / CFG.TICK);

// ---------------------------------------------------------------- lifecycle
process.on('uncaughtException', (e) => console.error('[fatal] uncaught exception (kept running)', e));
process.on('unhandledRejection', (e) => console.error('[fatal] unhandled rejection (kept running)', e));
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => {
  if (stopping) return;
  stopping = true;
  // everyone still here ends their visit now, and the statistics get one last chance to reach the database
  for (const r of rooms.values()) for (const p of r.players.values()) if (p.human) r.endSession(p);
  for (const ws of wss.clients) { try { ws.close(1012, 'restart'); } catch { /* ignore */ } }
  server.close();
  const exit = setTimeout(() => process.exit(0), 5000);
  exit.unref();
  flushStats().finally(() => setTimeout(() => process.exit(0), 300));
});

server.listen(PORT, () => console.log(`PROP PANIC server on http://localhost:${PORT}${process.env.PP_FAST ? ' (fast test mode)' : ''} · ${GATE.seats} seats, ${GATE.privateTables} private rooms`));
