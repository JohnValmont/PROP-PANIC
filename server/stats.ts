/**
 * Play statistics for the administrator: who played, for how long, and how rounds went.
 *
 * Rows are kept in memory and written in batches to a Supabase (Postgres) project through its REST API, so the
 * history survives the server sleeping or restarting. Without SUPABASE_URL and SUPABASE_KEY nothing leaves the
 * process and the admin page shows only what happened since the server started.
 *
 * Nothing personal is recorded: no address, no name. A player is an anonymous random id their browser made up.
 * The SQL that creates the tables is in docs/ADMIN.md.
 */
const SB_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SB_KEY = (process.env.SUPABASE_KEY ?? '').trim();
const FLUSH_MS = Number(process.env.PP_STATS_FLUSH_MS) || 30_000;
const SAMPLE_MS = 5 * 60_000;
const MAX_QUEUE = 5000;

export const statsEnabled = /^https:\/\/[^/\s]+$/.test(SB_URL) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SB_URL)
  ? !!SB_KEY : false;

export interface SessionRow { aid: string; started_at: string; ended_at: string; seconds: number; rounds: number; public: boolean; }
export interface RoundRow { at: string; public: boolean; map: string; winner: string; humans: number; bots: number; human_hunters: number; seconds: number; }
export interface SampleRow { at: string; humans: number; rooms: number; }
type Table = 'pp_sessions' | 'pp_rounds' | 'pp_samples';

const queues: Record<Table, object[]> = { pp_sessions: [], pp_rounds: [], pp_samples: [] };
let failing = false;

/** Since this process started: shown on the admin page whether or not a database is set up. */
export const live = {
  startedAt: Date.now(),
  sessions: 0, rounds: 0, players: new Set<string>(), peak: 0, peakAt: 0,
  wins: { props: 0, hunters: 0 } as Record<string, number>,
  writeErrors: 0, lastError: '',
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { apikey: SB_KEY, 'content-type': 'application/json' };
  // legacy service_role keys are JWTs and go in Authorization too; the newer sb_secret_ keys must not
  if (SB_KEY.startsWith('eyJ')) h.authorization = `Bearer ${SB_KEY}`;
  return h;
}

function queue(table: Table, row: object) {
  if (!statsEnabled) return;
  const q = queues[table];
  q.push(row);
  if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE); // database unreachable for a long time: keep the newest
}

/** Anonymous player ids are random strings the browser made; anything else is dropped. */
export function cleanAid(raw: unknown): string {
  return typeof raw === 'string' && /^[A-Za-z0-9_-]{8,40}$/.test(raw) ? raw : '';
}

export function recordSession(r: SessionRow) {
  live.sessions++;
  if (r.aid) live.players.add(r.aid);
  queue('pp_sessions', r);
}
export function recordRound(r: RoundRow) {
  live.rounds++;
  live.wins[r.winner] = (live.wins[r.winner] ?? 0) + 1;
  queue('pp_rounds', r);
}
/** Called every tick with the humans online; keeps the peak and writes a sample every few minutes while anyone plays. */
let nextSample = 0;
export function observe(humans: number, rooms: number) {
  const t = Date.now();
  if (humans > live.peak) { live.peak = humans; live.peakAt = t; }
  if (humans > 0 && t >= nextSample) { nextSample = t + SAMPLE_MS; queue('pp_samples', { at: new Date(t).toISOString(), humans, rooms } satisfies SampleRow); }
}

export async function flush(): Promise<void> {
  if (!statsEnabled) return;
  for (const table of Object.keys(queues) as Table[]) {
    const rows = queues[table];
    if (!rows.length) continue;
    const batch = rows.splice(0, 500);
    try {
      const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
        method: 'POST', headers: { ...headers(), prefer: 'return=minimal' }, body: JSON.stringify(batch), signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      if (failing) { failing = false; console.log('[stats] database writes working again'); }
    } catch (e) {
      rows.unshift(...batch);
      live.writeErrors++; live.lastError = String((e as Error).message ?? e).slice(0, 200);
      if (!failing) { failing = true; console.error(`[stats] could not write ${table}: ${live.lastError}`); }
      return;
    }
  }
}
if (statsEnabled) setInterval(() => { void flush(); }, FLUSH_MS).unref();

/** Read a view from the database for the admin page. Returns null when there is no database or it cannot be read. */
export async function query<T = Record<string, unknown>>(view: string, params = ''): Promise<T[] | null> {
  if (!statsEnabled) return null;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${view}?${params}`, { headers: headers(), signal: AbortSignal.timeout(6000) });
    if (!res.ok) { live.lastError = `read ${view}: ${res.status} ${(await res.text()).slice(0, 160)}`; return null; }
    return (await res.json()) as T[];
  } catch (e) {
    live.lastError = `read ${view}: ${String((e as Error).message ?? e).slice(0, 160)}`;
    return null;
  }
}

/** One line a day in the server log as well, so there is a record even without a database. */
let logDay = new Date().toISOString().slice(0, 10);
setInterval(() => {
  const day = new Date().toISOString().slice(0, 10);
  if (day === logDay) return;
  console.log(`[stats] ${logDay}: since start ${live.sessions} sessions, ${live.players.size} players, ${live.rounds} rounds, peak ${live.peak} online`);
  logDay = day;
}, 60_000).unref();
