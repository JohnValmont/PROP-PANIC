/**
 * Optional sign-in, so a profile is kept on the server instead of only in this browser (server/accounts.ts).
 *
 * Signing in uses Supabase Auth with the OAuth "PKCE" flow, written out here in a few dozen lines rather than pulling
 * in an SDK: the browser goes to the provider (Discord, Google) and comes back with a one-time code, which it swaps
 * for an access token and a refresh token. The access token goes with every request to our server, which asks
 * Supabase whose it is. The tokens live in this browser's storage (`pp_auth`); nothing here is a password.
 *
 * Playing never needs any of this: a guest's profile stays in `pp_profile` exactly as before.
 */
import { sanitizeProfile, type Change, type Profile } from '../../shared/progress';

interface Config { url: string; key: string; providers: string[]; }
interface Session { access: string; refresh: string; exp: number; uid: string; name: string; provider: string; }

export type AcctState =
  | 'off' // the server has no accounts set up: nothing to show
  | 'guest' // not signed in
  | 'loading' // signed in, fetching the profile
  | 'choose' // signed in for the first time: start fresh or bring this browser's profile
  | 'on' // signed in, profile loaded: the server keeps it
  | 'error'; // signed in, but the account could not be reached right now

const KEY = 'pp_auth', VERIFIER = 'pp_pkce', BACK = 'pp_auth_back', CACHE = 'pp_acct_cache';
const ls = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
const ss = {
  get(k: string) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch { /* blocked */ } },
  del(k: string) { try { sessionStorage.removeItem(k); } catch { /* blocked */ } },
};
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const PROVIDER_NAMES: Record<string, string> = { discord: 'Discord', google: 'Google', github: 'GitHub', twitch: 'Twitch', apple: 'Apple' };

export class Account {
  state: AcctState = 'off';
  cfg: Config | null = null;
  /** The profile as the server last sent it (null unless state is 'on'). */
  profile: Profile | null = null;
  imported = false;
  /** Why the last attempt failed, for the profile screen. */
  error = '';
  /** Just came back from the sign-in page (the menu opens the profile so the player sees what happened). */
  returned = false;
  private session: Session | null = null;
  private refreshing: Promise<boolean> | null = null;
  /** Called whenever state or profile changes. */
  onChange: () => void = () => {};

  get on() { return this.state === 'on'; }
  /** Signed in at all (the profile may still be loading). */
  get signedIn() { return !!this.session; }
  get who() { return this.session ? `${this.session.name || 'your account'}${this.session.provider ? ` (${PROVIDER_NAMES[this.session.provider] ?? this.session.provider})` : ''}` : ''; }

  constructor() {
    try { const s = JSON.parse(ls.get(KEY) ?? 'null'); if (s && typeof s.access === 'string' && typeof s.refresh === 'string') this.session = s; } catch { /* none */ }
    // until the server answers, show the account's profile as it was last seen, so the level does not flicker
    if (this.session) {
      try { const c = JSON.parse(ls.get(CACHE) ?? 'null'); if (c && c.uid === this.session.uid && c.p) { this.profile = sanitizeProfile(c.p); this.state = 'on'; } } catch { /* none */ }
    }
    // back from the sign-in page: take the one-time code (or the reason it failed) out of the address bar, and put
    // back the room link the player had open when they left
    const q = new URLSearchParams(location.search), back = ss.get(BACK);
    if (back !== null && (q.has('code') || q.has('error'))) {
      ss.del(BACK);
      this.returned = true;
      this.pendingCode = q.get('code');
      if (!this.pendingCode) this.error = (q.get('error_description') ?? 'Sign-in was cancelled.').slice(0, 160);
      history.replaceState(null, '', location.pathname + (back ? `?room=${encodeURIComponent(back)}` : ''));
    }
  }
  private pendingCode: string | null = null;
  /** Settles once the server has said whether accounts are on (a Play pressed straight after loading waits for it). */
  private cfgReady: Promise<void> = Promise.resolve();

  /** Ask the server whether accounts are on, finish a sign-in that just came back, and load the profile. */
  async init() {
    this.cfgReady = (async () => {
      try {
        const r = await fetch('/api/config', { cache: 'no-store' });
        const c = r.ok ? await r.json() : null;
        if (c?.accounts && typeof c.url === 'string' && typeof c.key === 'string') this.cfg = { url: c.url, key: c.key, providers: Array.isArray(c.providers) ? c.providers : [] };
      } catch { /* offline or an old server: no accounts */ }
    })();
    await this.cfgReady;
    if (!this.cfg) { this.state = 'off'; this.profile = null; this.onChange(); return; }
    const code = this.pendingCode;
    this.pendingCode = null;
    if (code) await this.exchange(code);
    if (!this.session) { this.setState('guest'); return; }
    await this.load();
  }

  private setState(s: AcctState) { this.state = s; if (s !== 'on') this.profile = s === 'loading' ? this.profile : null; this.onChange(); }

  // ---------------------------------------------------------------- signing in and out
  async signIn(provider: string) {
    if (!this.cfg) return;
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    ss.set(VERIFIER, verifier);
    ss.set(BACK, new URLSearchParams(location.search).get('room') ?? '');
    const q = new URLSearchParams({ provider, redirect_to: location.origin + location.pathname, code_challenge: challenge, code_challenge_method: 's256' });
    location.assign(`${this.cfg.url}/auth/v1/authorize?${q}`);
  }

  private async exchange(code: string) {
    const verifier = ss.get(VERIFIER);
    ss.del(VERIFIER);
    if (!verifier || !this.cfg) { this.error = 'Sign-in did not finish. Please try again.'; return; }
    try {
      const r = await fetch(`${this.cfg.url}/auth/v1/token?grant_type=pkce`, {
        method: 'POST', headers: { apikey: this.cfg.key, 'content-type': 'application/json' }, body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.access_token) { this.error = j?.error_description || j?.msg || 'Sign-in did not finish. Please try again.'; return; }
      this.keep(j);
    } catch { this.error = 'Could not reach the sign-in service. Please try again.'; }
  }

  private keep(j: any) {
    const u = j.user ?? this.session ?? {};
    const meta = u.user_metadata ?? {};
    this.session = {
      access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000,
      uid: String(u.id ?? u.uid ?? ''),
      // a short label for the profile screen only: never sent to other players
      name: String(meta.full_name || meta.name || meta.user_name || (u.email ? String(u.email).replace(/@.*/, '') : '') || u.name || '').slice(0, 40),
      provider: String(u.app_metadata?.provider ?? u.provider ?? ''),
    };
    ls.set(KEY, JSON.stringify(this.session));
  }

  /** A fresh access token (renewing it if it is about to run out), or null if signed out or the session has ended. */
  async token(): Promise<string | null> {
    if (this.session && !this.cfg) await this.cfgReady;
    if (!this.session || !this.cfg) return null;
    if (this.session.exp - Date.now() > 120_000) return this.session.access;
    this.refreshing ??= this.refresh().finally(() => (this.refreshing = null));
    return (await this.refreshing) ? this.session?.access ?? null : null;
  }

  private async refresh(): Promise<boolean> {
    // another tab may have renewed it already (refresh tokens are single use)
    try { const s = JSON.parse(ls.get(KEY) ?? 'null'); if (s?.refresh && s.exp - Date.now() > 120_000) { this.session = s; return true; } if (s?.refresh) this.session!.refresh = s.refresh; } catch { /* use ours */ }
    try {
      const r = await fetch(`${this.cfg!.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST', headers: { apikey: this.cfg!.key, 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: this.session!.refresh }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.access_token) { this.keep(j); return true; }
      if (r.status >= 400 && r.status < 500) this.forget('Your sign-in has expired. Sign in again to keep saving progress.');
      return false;
    } catch { return false; } // offline: keep the session and try again later
  }

  async signOut() {
    const s = this.session, cfg = this.cfg;
    this.forget('');
    if (s && cfg) { try { await fetch(`${cfg.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: cfg.key, authorization: `Bearer ${s.access}` } }); } catch { /* the local session is gone either way */ } }
  }

  private forget(why: string) {
    this.session = null; this.profile = null; this.imported = false; this.error = why;
    ls.del(KEY); ls.del(CACHE);
    this.setState(this.cfg ? 'guest' : 'off');
  }

  // ---------------------------------------------------------------- the profile on the server
  private async api(path: string, body?: object): Promise<{ status: number; j: any }> {
    const tok = await this.token();
    if (!tok) return { status: 401, j: { error: 'Not signed in.' } };
    try {
      const r = await fetch(path, body ? { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) } : { headers: { authorization: `Bearer ${tok}` }, cache: 'no-store' });
      return { status: r.status, j: await r.json().catch(() => ({})) };
    } catch { return { status: 0, j: { error: 'Could not reach the server.' } }; }
  }

  private take(j: any) {
    this.profile = sanitizeProfile(j.profile); this.imported = !!j.imported; this.error = '';
    this.cache();
    this.setState('on');
  }

  /** Remember the account's profile in this browser for display on the next visit (the server's copy is the real one). */
  cache() { if (this.profile && this.session) ls.set(CACHE, JSON.stringify({ uid: this.session.uid, p: this.profile })); }

  async load() {
    if (!this.session) return;
    if (this.state !== 'on') this.setState('loading');
    const { status, j } = await this.api('/api/me');
    if (status === 200 && j.profile) return this.take(j);
    if (status === 200) { this.profile = null; this.setState('choose'); return; }
    if (status === 401) { this.forget('Your sign-in has expired. Sign in again to keep saving progress.'); return; }
    this.error = j?.error || 'Your account could not be reached right now.';
    if (this.state !== 'on') this.setState('error'); else this.onChange();
  }

  /** First sign-in: bring this browser's guest profile (once), or start fresh. */
  async start(guest: Profile | null): Promise<boolean> {
    const { status, j } = await this.api('/api/me/start', { guest });
    if ((status === 200 || status === 409) && j.profile) { this.take(j); return true; }
    this.error = j?.error || 'Your account could not be reached right now.';
    this.onChange();
    return false;
  }

  /** Buy, wear or a title: the server applies it to its copy and sends that back. */
  async change(c: Change): Promise<{ ok: boolean; why?: string }> {
    const { status, j } = await this.api('/api/me/change', c);
    if (status === 200 && j.profile) { this.profile = sanitizeProfile(j.profile); this.cache(); this.onChange(); return { ok: !!j.ok, why: j.why }; }
    if (status === 401) this.forget('Your sign-in has expired. Sign in again to keep saving progress.');
    return { ok: false, why: j?.error || 'Your account could not be reached right now.' };
  }

  /** A round the server banked (sent over the game socket). */
  banked(p: Profile) { this.profile = sanitizeProfile(p); this.cache(); }

  async deleteAccount(): Promise<boolean> {
    const { status, j } = await this.api('/api/me/delete', {});
    if (status === 200) { this.forget(''); return true; }
    this.error = j?.error || 'The account could not be deleted right now. Please try again.';
    this.onChange();
    return false;
  }
}
