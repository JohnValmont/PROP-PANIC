/**
 * Optional accounts: a player can sign in (Discord or Google, through Supabase Auth) to keep their profile on the
 * server instead of only in their browser. Guests are untouched and never need one.
 *
 * For a signed-in player the server is the authority on the profile:
 *   - it banks every round itself with `bankRound` (shared/progress.ts), from the results it worked out;
 *   - buying, wearing and titles go through `applyChange` here, with the same rules the browser shows;
 *   - what they wear and their level badge in a room come from this copy, not from what the browser claims.
 *
 * Profiles live in one Supabase table (`pp_profiles`, SQL in docs/ACCOUNTS.md), read and written only with the
 * secret key this process holds. Row level security is on with no policies, so the publishable key handed to
 * browsers (it is only used to sign in) cannot read or write any profile.
 *
 * One process holds every profile in use in memory, so two tabs of one account change the same object and cannot
 * overwrite each other's progress. Changes are written back a moment later, and once more when the server stops.
 *
 *   GET  /api/config      whether accounts are on, and what a browser needs to sign in
 *   GET  /api/me          the signed-in player's profile (null until they choose how to start)
 *   POST /api/me/start    first sign-in: start fresh, or bring this browser's guest profile (once)
 *   POST /api/me/change   buy / wear / title
 *   POST /api/me/delete   delete the account and its profile for good
 */
import type http from 'node:http';
import { createHash } from 'node:crypto';
import { applyChange, bankRound, newProfile, sanitizeProfile, type Change, type Profile, type Report, type RoundInput } from '../shared/progress';

const SB_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SB_KEY = (process.env.SUPABASE_KEY ?? '').trim();
/** The publishable (or legacy anon) key: public by design, used by browsers to sign in and here to check their tokens. */
const SB_PUB = (process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim();
const PROVIDERS = (process.env.PP_AUTH_PROVIDERS ?? 'discord,google').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[a-z]{2,20}$/.test(s)).slice(0, 6);
const SAVE_MS = Number(process.env.PP_ACCT_SAVE_MS) || 2000;
const RETRY_MS = 10_000;
const IDLE_MS = 30 * 60_000;
const TOKEN_CACHE_MS = 5 * 60_000;
const API_PER_MIN = 120;
const BODY_MAX = 64 * 1024;

const urlOk = /^https:\/\/[^/\s]+$/.test(SB_URL) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SB_URL);
export const accountsEnabled = urlOk && !!SB_KEY && !!SB_PUB && PROVIDERS.length > 0 && process.env.PP_ACCOUNTS !== '0';
/** Origin the browser talks to for signing in, for the content security policy. Empty when accounts are off. */
export const authOrigin = accountsEnabled ? SB_URL : '';

/** Room glue (server/index.ts): a profile changed (keep looks in rooms current), or an account was deleted. */
export const accountHooks = {
  change: (_uid: string, _p: Profile) => {},
  gone: (_uid: string) => {},
};

/** For the admin page. */
export const acctLive = { cached: 0, saves: 0, writeErrors: 0, lastError: '' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

function dbHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: SB_KEY, 'content-type': 'application/json', ...extra };
  if (SB_KEY.startsWith('eyJ')) h.authorization = `Bearer ${SB_KEY}`; // legacy service_role JWT; sb_secret_ keys must not go here
  return h;
}
async function sb(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
  return fetch(`${SB_URL}${path}`, { ...init, headers: { ...dbHeaders(), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(8000) });
}
function noteError(where: string, e: unknown) {
  acctLive.writeErrors++;
  acctLive.lastError = `${where}: ${String((e as Error)?.message ?? e).slice(0, 160)}`;
  console.error(`[accounts] ${acctLive.lastError}`);
}

// ---------------------------------------------------------------- who is this? (access tokens)
const tokens = new Map<string, { uid: string; until: number }>();
const digest = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * The account an access token belongs to, asked of Supabase Auth (which also catches signed-out and deleted users),
 * remembered for a few minutes so a burst of requests costs one lookup. Null for anything that is not a live session.
 */
export async function verifyToken(token: unknown): Promise<string | null> {
  if (!accountsEnabled || typeof token !== 'string' || token.length > 4096 || !JWT.test(token)) return null;
  const key = digest(token), t = Date.now();
  const hit = tokens.get(key);
  if (hit && hit.until > t) return hit.uid;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_PUB, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const u = (await res.json()) as { id?: unknown };
    if (typeof u?.id !== 'string' || !UUID.test(u.id)) return null;
    let exp = t + TOKEN_CACHE_MS;
    try { const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); if (typeof claims.exp === 'number') exp = Math.min(exp, claims.exp * 1000); } catch { /* keep the default */ }
    if (tokens.size > 5000) tokens.clear();
    tokens.set(key, { uid: u.id, until: exp });
    return u.id;
  } catch { return null; }
}

// ---------------------------------------------------------------- profiles in memory, written back to Supabase
interface Entry { uid: string; p: Profile | null; imported: boolean; used: number; dirty: boolean; timer: NodeJS.Timeout | null; saving: Promise<void> | null; gone: boolean; }
const cache = new Map<string, Entry>();
const loading = new Map<string, Promise<Entry>>();

/** The profile kept for an account, loading it on first use. `p` is null until the player has chosen how to start. Throws if the database cannot be read. */
async function entry(uid: string): Promise<Entry> {
  const have = cache.get(uid);
  if (have) { have.used = Date.now(); return have; }
  let pending = loading.get(uid);
  if (!pending) {
    pending = (async () => {
      const res = await sb(`/rest/v1/pp_profiles?user_id=eq.${uid}&select=profile,imported`);
      if (!res.ok) throw new Error(`read profile: ${res.status} ${(await res.text()).slice(0, 160)}`);
      const rows = (await res.json()) as { profile: unknown; imported: boolean }[];
      const e: Entry = { uid, p: rows[0] ? sanitizeProfile(rows[0].profile) : null, imported: !!rows[0]?.imported, used: Date.now(), dirty: false, timer: null, saving: null, gone: false };
      cache.set(uid, e); acctLive.cached = cache.size;
      return e;
    })().finally(() => loading.delete(uid));
    loading.set(uid, pending);
  }
  return pending;
}

/** The profile in memory for an account, if loaded (rooms read it when a signed-in player sits down). */
export function cachedProfile(uid: string): Profile | null { return cache.get(uid)?.p ?? null; }

function touch(e: Entry) {
  e.used = Date.now(); e.dirty = true;
  accountHooks.change(e.uid, e.p!);
  if (!e.timer) e.timer = setTimeout(() => { e.timer = null; void save(e); }, SAVE_MS);
}

async function save(e: Entry): Promise<void> {
  if (e.saving) { await e.saving; if (!e.dirty) return; }
  if (!e.dirty || !e.p || e.gone) return;
  e.dirty = false;
  const body = JSON.stringify({ profile: e.p, updated_at: new Date().toISOString() });
  e.saving = (async () => {
    try {
      const res = await sb(`/rest/v1/pp_profiles?user_id=eq.${e.uid}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
      acctLive.saves++;
    } catch (err) {
      e.dirty = true; // try again shortly; the copy in memory is still the truth meanwhile
      noteError('save profile', err);
      if (!e.timer && !e.gone) e.timer = setTimeout(() => { e.timer = null; void save(e); }, RETRY_MS);
    }
  })();
  try { await e.saving; } finally { e.saving = null; }
}

/** Write every changed profile now (the server is stopping). */
export async function flushAccounts(): Promise<void> {
  await Promise.all([...cache.values()].map((e) => { if (e.timer) { clearTimeout(e.timer); e.timer = null; } return save(e); }));
}

// profiles nobody has used for a while leave memory (once written)
setInterval(() => {
  const t = Date.now();
  for (const [uid, e] of cache) if (!e.dirty && !e.saving && !e.timer && t - e.used > IDLE_MS) cache.delete(uid);
  for (const [k, v] of tokens) if (v.until <= t) tokens.delete(k);
  acctLive.cached = cache.size;
}, 60_000).unref();

/** A signed-in player sits down: their account's profile, loaded (null if they have not started one, or the database is unreachable). */
export async function profileForSeat(uid: string): Promise<Profile | null> {
  try { return (await entry(uid)).p; } catch (e) { noteError('load profile', e); return null; }
}

/** Bank a round into an account. Null if there is no profile yet, it was already banked, or the database cannot be read. */
export async function bankForAccount(uid: string, input: RoundInput): Promise<{ p: Profile; rep: Report } | null> {
  let e: Entry;
  try { e = await entry(uid); } catch (err) { noteError('load profile to bank a round', err); return null; }
  if (!e.p || e.gone || e.p.paid === input.key) return null;
  const rep = bankRound(e.p, input);
  touch(e);
  return { p: e.p, rep };
}

// ---------------------------------------------------------------- the HTTP API the profile screen uses
const hits = new Map<string, { n: number; at: number }>();
setInterval(() => { const t = Date.now(); for (const [ip, h] of hits) if (t - h.at > 120_000) hits.delete(ip); }, 60_000).unref();

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0; const parts: Buffer[] = [];
    req.on('data', (d: Buffer) => {
      size += d.length;
      // past the cap: stop reading and answer 413 (the connection closes after the answer)
      if (size > BODY_MAX) { req.removeAllListeners('data'); req.pause(); reject(new Error('too large')); } else parts.push(d);
    });
    req.on('end', () => { try { resolve(size ? JSON.parse(Buffer.concat(parts).toString()) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

/** Handles /api/*. Returns false for any other path. `sameOrigin` is the socket origin check, applied to every change. */
export function handleAccountApi(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, ip: string, head: Record<string, string>, sameOrigin: boolean): boolean {
  if (!pathname.startsWith('/api/')) return false;
  const send = (status: number, body: object) => {
    try { res.writeHead(status, { ...head, 'content-type': 'application/json', 'cache-control': 'no-store', ...(status === 413 ? { connection: 'close' } : {}) }).end(JSON.stringify(body)); } catch { /* gone */ }
  };
  if (pathname === '/api/config') {
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, { error: 'GET only.' }); return true; }
    send(200, accountsEnabled ? { accounts: true, url: SB_URL, key: SB_PUB, providers: PROVIDERS } : { accounts: false });
    return true;
  }
  const routes: Record<string, string> = { '/api/me': 'GET', '/api/me/start': 'POST', '/api/me/change': 'POST', '/api/me/delete': 'POST' };
  if (!routes[pathname] || !accountsEnabled) { send(404, { error: 'Not found.' }); return true; }
  if (req.method !== routes[pathname]) { send(405, { error: `${routes[pathname]} only.` }); return true; }
  if (req.method === 'POST' && !sameOrigin) { send(403, { error: 'Forbidden.' }); return true; }
  const t = Date.now(), h = hits.get(ip) ?? { n: 0, at: t };
  if (t - h.at > 60_000) { h.n = 0; h.at = t; }
  hits.set(ip, h);
  if (++h.n > API_PER_MIN) { send(429, { error: 'Too many requests. Wait a minute.' }); return true; }

  const auth = String(req.headers.authorization ?? '');
  void (async () => {
    try {
      const uid = await verifyToken(auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
      if (!uid) return send(401, { error: 'Not signed in.' });
      const body = req.method === 'POST' ? await readBody(req).catch((e: Error) => ({ __bad: e.message })) : {};
      if (body?.__bad) return send(body.__bad === 'too large' ? 413 : 400, { error: 'Bad request.' });
      if (pathname === '/api/me/delete') {
        await deleteAccount(uid);
        return send(200, { ok: true });
      }
      let e: Entry;
      try { e = await entry(uid); } catch (err) { noteError('load profile', err); return send(503, { error: 'Your account could not be reached. Try again in a minute.' }); }
      if (e.gone) return send(401, { error: 'Not signed in.' });
      if (pathname === '/api/me') return send(200, { profile: e.p, imported: e.imported });
      if (pathname === '/api/me/start') {
        if (e.p) return send(409, { error: 'This account already has a profile.', profile: e.p, imported: e.imported });
        const guest = body && typeof body.guest === 'object' && body.guest ? body.guest : null;
        const p = guest ? sanitizeProfile(guest) : newProfile();
        p.paid = '';
        const r = await sb('/rest/v1/pp_profiles', { method: 'POST', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ user_id: uid, profile: p, imported: !!guest }) });
        if (r.status === 409) { cache.delete(uid); const again = await entry(uid); return send(409, { error: 'This account already has a profile.', profile: again.p, imported: again.imported }); }
        if (!r.ok) { noteError('create profile', `${r.status} ${(await r.text()).slice(0, 160)}`); return send(503, { error: 'Your account could not be reached. Try again in a minute.' }); }
        e.p = p; e.imported = !!guest; e.used = Date.now();
        accountHooks.change(uid, p);
        return send(200, { profile: p, imported: e.imported });
      }
      // /api/me/change
      if (!e.p) return send(409, { error: 'Choose how to start your account first.' });
      const c: Change = { op: body?.op, id: typeof body?.id === 'string' ? body.id.slice(0, 64) : '' };
      if (c.op !== 'buy' && c.op !== 'equip' && c.op !== 'title') return send(400, { error: 'Bad request.' });
      const r = applyChange(e.p, c);
      if (r.ok) touch(e);
      return send(200, { ok: r.ok, why: r.why, profile: e.p });
    } catch (err) {
      noteError('api', err);
      send(500, { error: 'Something went wrong.' });
    }
  })();
  return true;
}

/** Delete an account for good: its profile row, then the sign-in itself. Throws if either cannot be done. */
async function deleteAccount(uid: string) {
  const e = cache.get(uid);
  if (e) { e.gone = true; if (e.timer) clearTimeout(e.timer); e.timer = null; e.dirty = false; if (e.saving) await e.saving.catch(() => {}); }
  const a = await sb(`/rest/v1/pp_profiles?user_id=eq.${uid}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
  if (!a.ok) throw new Error(`delete profile: ${a.status}`);
  const b = await sb(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
  if (!b.ok && b.status !== 404) throw new Error(`delete user: ${b.status} ${(await b.text()).slice(0, 120)}`);
  cache.delete(uid); acctLive.cached = cache.size;
  for (const [k, v] of tokens) if (v.uid === uid) tokens.delete(k);
  accountHooks.gone(uid);
}
