/**
 * GET /admin: a private page for whoever runs the server. Live rooms, totals since start, and (with a database)
 * the history: players per day, sessions, rounds and how they were won.
 *
 * Off unless PP_ADMIN_KEY is set. The browser asks for a user name and password (HTTP Basic); any user name works,
 * the password is the key. Wrong passwords are limited per address. The page is plain HTML with no script, so the
 * game's content security policy still holds, and it refreshes itself every 30 seconds.
 */
import type http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { Room } from './room';
import { live, query, statsEnabled } from './stats';

const KEY = (process.env.PP_ADMIN_KEY ?? '').trim();
export const adminEnabled = KEY.length >= 8;
if (process.env.PP_ADMIN_KEY && !adminEnabled) console.error('[admin] PP_ADMIN_KEY is shorter than 8 characters: the admin page stays off');

const digest = (s: string) => createHash('sha256').update(s).digest();
function keyOk(auth: string | undefined): boolean {
  const m = /^Basic\s+([A-Za-z0-9+/=]{1,400})$/.exec(auth ?? '');
  if (!m) return false;
  const decoded = Buffer.from(m[1], 'base64').toString('utf8');
  const pass = decoded.slice(decoded.indexOf(':') + 1);
  return timingSafeEqual(digest(pass), digest(KEY)); // equal-length digests: no length or timing leak
}

const fails = new Map<string, { n: number; at: number }>();
setInterval(() => { const t = Date.now(); for (const [ip, f] of fails) if (t - f.at > 15 * 60_000) fails.delete(ip); }, 60_000).unref();

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);
const ago = (ms: number) => dur(Math.max(0, (Date.now() - ms) / 1000));

function table(head: string[], rows: unknown[][], empty = 'Nothing yet.'): string {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;
}

interface Daily { day: string; players: number; sessions: number; avg_seconds: number; rounds: number; peak: number; }
interface Totals { players: number; sessions: number; hours: number; rounds: number; first_day: string; }
interface MapStat { map: string; rounds: number; hunter_wins: number; prop_wins: number; avg_humans: number; }

async function render(rooms: Map<string, Room>): Promise<string> {
  let humans = 0, bots = 0;
  const roomRows: unknown[][] = [];
  for (const r of rooms.values()) {
    let h = 0, b = 0;
    for (const p of r.players.values()) { if (p.bot) b++; else if (p.connected) h++; }
    humans += h; bots += b;
    roomRows.push([r.code, r.isPublic ? 'public' : 'private', r.phase, r.round ? `${r.round} / ${r.rounds}` : '–', h, b, ago(r.createdAt)]);
  }
  roomRows.sort((a, b) => n(b[4]) - n(a[4]));

  const [daily, totals, maps] = await Promise.all([
    query<Daily>('pp_daily', 'select=*&order=day.desc&limit=30'),
    query<Totals>('pp_totals', 'select=*'),
    query<MapStat>('pp_maps', 'select=*'),
  ]);
  const t = totals?.[0];
  const wins = live.wins;

  const history = !statsEnabled
    ? `<p class="warn">No database is connected, so there is no history: the numbers above reset whenever the server sleeps or restarts. Set <code>SUPABASE_URL</code> and <code>SUPABASE_KEY</code> (see docs/ADMIN.md).</p>`
    : !daily || !t
      ? `<p class="warn">The database could not be read: ${esc(live.lastError || 'unknown error')}. Check the keys and that the SQL in docs/ADMIN.md was run.</p>`
      : `
<div class="cards">
  <div class="card"><b>${n(t.players)}</b>different players</div>
  <div class="card"><b>${n(t.sessions)}</b>visits</div>
  <div class="card"><b>${n(t.hours).toFixed(1)} h</b>played in all</div>
  <div class="card"><b>${n(t.rounds)}</b>rounds</div>
</div>
<p class="muted">Since ${esc(t.first_day ?? '–')}.</p>
<h3>Last 30 days</h3>
${table(['Day (UTC)', 'Players', 'Visits', 'Avg visit', 'Rounds', 'Peak online'], daily.map((d) => [d.day, n(d.players), n(d.sessions), dur(n(d.avg_seconds)), n(d.rounds), n(d.peak) || '–']))}
<h3>Maps and balance</h3>
${table(['Map', 'Rounds', 'Hunters won', 'Props won', 'Avg humans'], (maps ?? []).map((m) => [m.map, n(m.rounds), pct(n(m.hunter_wins), n(m.rounds)), pct(n(m.prop_wins), n(m.rounds)), n(m.avg_humans).toFixed(1)]))}
<p class="muted">Balanced is roughly 45–55% each way. Rounds with no human hunter are left out.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><meta name="robots" content="noindex"><title>Prop Panic admin</title>
<style>
:root{--bg:#14162b;--panel:#1f2240;--text:#eef0ff;--muted:#9aa0c8;--line:#30355e;--accent:#ffd166;--warn:#ff8fa3}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,sans-serif;padding:24px 16px;max-width:980px;margin:auto}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px;color:var(--accent)}h3{font-size:15px;margin:20px 0 8px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;color:var(--muted);font-size:13px}
.card b{display:block;color:var(--text);font-size:24px}
table{width:100%;border-collapse:collapse;background:var(--panel);border-radius:10px;overflow:hidden;font-size:14px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:600}
td{font-variant-numeric:tabular-nums}.muted{color:var(--muted);font-size:13px}.warn{color:var(--warn)}code{color:var(--accent)}
@media (max-width:600px){table{display:block;overflow-x:auto}}
</style></head><body>
<h1>Prop Panic admin</h1><p class="muted">Refreshes every 30 s · server up ${ago(live.startedAt)} · database ${statsEnabled ? 'connected' : 'not set up'}${live.writeErrors ? ` · ${live.writeErrors} failed writes (last: ${esc(live.lastError)})` : ''}</p>
<h2>Right now</h2>
<div class="cards">
  <div class="card"><b>${humans}</b>humans online</div>
  <div class="card"><b>${rooms.size}</b>rooms open</div>
  <div class="card"><b>${bots}</b>bots playing</div>
</div>
<h3>Rooms</h3>
${table(['Code', 'Type', 'Phase', 'Round', 'Humans', 'Bots', 'Open for'], roomRows, 'No rooms open.')}
<h2>Since the server started</h2>
<div class="cards">
  <div class="card"><b>${live.players.size}</b>different players</div>
  <div class="card"><b>${live.sessions}</b>visits finished</div>
  <div class="card"><b>${live.rounds}</b>rounds</div>
  <div class="card"><b>${live.peak}</b>peak online${live.peak ? ` (${ago(live.peakAt)} ago)` : ''}</div>
  <div class="card"><b>${pct(n(wins.hunters), live.rounds)}</b>hunter wins</div>
</div>
<h2>History</h2>
${history}
</body></html>`;
}

/** Handles /admin. Returns false for any other path. */
export function handleAdmin(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, ip: string, rooms: Map<string, Room>, sec: Record<string, string>): boolean {
  if (pathname !== '/admin') return false;
  if (!adminEnabled) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found.'); return true; }
  const base = { ...sec, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
  const f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.at < 15 * 60_000) { res.writeHead(429, { ...base, 'content-type': 'text/plain' }).end('Too many wrong passwords. Try again in 15 minutes.'); return true; }
  if (!keyOk(req.headers.authorization)) {
    if (req.headers.authorization) { const e = fails.get(ip) ?? { n: 0, at: 0 }; e.n++; e.at = Date.now(); fails.set(ip, e); }
    res.writeHead(401, { ...base, 'www-authenticate': 'Basic realm="Prop Panic admin", charset="UTF-8"', 'content-type': 'text/plain' }).end('Password needed.');
    return true;
  }
  fails.delete(ip);
  render(rooms).then(
    (html) => res.writeHead(200, { ...base, 'content-type': 'text/html; charset=utf-8' }).end(html),
    () => { try { res.writeHead(500).end(); } catch { /* gone */ } },
  );
  return true;
}
