# Admin page and play statistics

`/admin` is a private page for whoever runs the server. It shows:

- **Right now:** humans online, rooms open (code, public or private, phase, round, humans, bots).
- **Since the server started:** different players, visits, rounds, peak online, hunter win rate.
- **History** (needs the free database below): different players, visits, hours played and rounds in all; a table of
  the last 30 days (players, visits, average visit length, rounds, peak online); and hunter / prop win rates per map.

It refreshes itself every 30 seconds. Nothing personal is stored: no IP address and no name. Each browser makes up a
random id (`pp_aid` in its storage) so that ten visits by one person count as one player, not ten.

Without a database the page still works, but its numbers reset whenever the server restarts, and on Render's free
plan the server goes to sleep when nobody plays. That is why the history goes in Supabase.

## 1. Turn the page on

In Render: your service → **Environment** → **Add Environment Variable**:

| Key | Value |
| --- | --- |
| `PP_ADMIN_KEY` | a long password you make up (at least 8 characters; 20+ random characters is better) |

Save; Render redeploys. Open `https://<your-game>/admin`. The browser asks for a user name and password: type
anything as the user name and the key as the password. Ten wrong passwords lock that address out for 15 minutes.
Without `PP_ADMIN_KEY` the page does not exist (404).

## 2. Keep the history in Supabase (free)

1. Sign up at [supabase.com](https://supabase.com) and click **New project**. Any name (e.g. `prop-panic`), a database
   password (you will not need it again here), and the region closest to where your Render service runs. Free plan.
2. When the project is ready, open **SQL Editor** → **New query**, paste everything in the box below, click **Run**.
   It should say *Success. No rows returned*.
3. Open **Project Settings** → **API Keys**. Copy the **secret** key (`sb_secret_...`). If your project only shows
   the older keys, copy **service_role** instead. **Never** put this key in the client, a screenshot or the repository:
   it can read and write the whole database.
4. Open **Project Settings** → **Data API** (or **API**) and copy the **Project URL** (`https://xxxx.supabase.co`).
5. In Render → **Environment**, add:

   | Key | Value |
   | --- | --- |
   | `SUPABASE_URL` | the Project URL |
   | `SUPABASE_KEY` | the secret key |

6. Save, let it redeploy, play one round, wait a minute and open `/admin`. The *History* section should show numbers.
   If it says the database could not be read, the message under it says why (usually a wrong key, or step 2 skipped).

```sql
-- Prop Panic statistics. Safe to run more than once.
create table if not exists pp_sessions (
  id bigint generated always as identity primary key,
  aid text not null default '',         -- random id the browser made up; not linked to a person
  started_at timestamptz not null,
  ended_at timestamptz not null,
  seconds integer not null,
  rounds integer not null,              -- rounds played in this visit
  public boolean not null               -- Play now (true) or a private room (false)
);
create table if not exists pp_rounds (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  public boolean not null,
  map text not null,
  winner text not null,                 -- 'props' or 'hunters'
  humans integer not null,
  bots integer not null,
  human_hunters integer not null,
  seconds integer not null
);
create table if not exists pp_samples (  -- humans online, every 5 minutes while anyone plays
  id bigint generated always as identity primary key,
  at timestamptz not null,
  humans integer not null,
  rooms integer not null
);
create index if not exists pp_sessions_ended on pp_sessions (ended_at);
create index if not exists pp_rounds_at on pp_rounds (at);
create index if not exists pp_samples_at on pp_samples (at);

-- Row level security on, with no policies: the public (anon) key can neither read nor write these tables.
-- Only the secret key the game server holds can.
alter table pp_sessions enable row level security;
alter table pp_rounds enable row level security;
alter table pp_samples enable row level security;

-- Views read by the admin page. security_invoker keeps them behind the same rules as the tables.
create or replace view pp_daily with (security_invoker = true) as
with s as (
  select (ended_at at time zone 'utc')::date as day, count(distinct nullif(aid, '')) as players,
         count(*) as sessions, round(avg(seconds))::integer as avg_seconds
  from pp_sessions group by 1
), r as (
  select (at at time zone 'utc')::date as day, count(*) as rounds from pp_rounds group by 1
), p as (
  select (at at time zone 'utc')::date as day, max(humans) as peak from pp_samples group by 1
)
select coalesce(s.day, r.day, p.day) as day,
       coalesce(s.players, 0) as players, coalesce(s.sessions, 0) as sessions,
       coalesce(s.avg_seconds, 0) as avg_seconds, coalesce(r.rounds, 0) as rounds, coalesce(p.peak, 0) as peak
from s full join r on r.day = s.day full join p on p.day = coalesce(s.day, r.day);

create or replace view pp_totals with (security_invoker = true) as
select (select count(distinct nullif(aid, '')) from pp_sessions) as players,
       (select count(*) from pp_sessions) as sessions,
       (select round(coalesce(sum(seconds), 0) / 3600.0, 1) from pp_sessions) as hours,
       (select count(*) from pp_rounds) as rounds,
       (select min(ended_at)::date from pp_sessions) as first_day;

create or replace view pp_maps with (security_invoker = true) as
select map, count(*) as rounds,
       count(*) filter (where winner = 'hunters') as hunter_wins,
       count(*) filter (where winner = 'props') as prop_wins,
       round(avg(humans), 1) as avg_humans
from pp_rounds where human_hunters > 0   -- a round hunted only by a bot says nothing about balance
group by map;
```

You can also look at the raw rows any time in Supabase → **Table Editor**, or ask your own questions in the SQL editor,
for example how many people came back on a later day:

```sql
select count(*) from (select aid from pp_sessions where aid <> ''
  group by aid having count(distinct (ended_at at time zone 'utc')::date) > 1) returning_players;
```

## Good to know

- **What counts as a visit:** from joining a room to leaving it for good (closing the tab and not coming back within
  30 seconds, being removed for idling, or the server stopping). A refresh that puts you back in your seat is the same visit.
- **Rows are written in batches every 30 seconds** and once more when the server shuts down. If Supabase is
  unreachable the server keeps the rows (up to 5,000 per table) and tries again; the admin page shows failed writes.
- **Supabase pauses free projects that see no activity for about a week.** The game writing statistics counts as
  activity, but if nobody plays for a week, open the Supabase dashboard and click **Restore**. No data is lost.
- **Space:** a visit is about 100 bytes, so the free 500 MB holds millions of them.
- **Privacy:** the anonymous id is not a name, an email or an address, but if you add a privacy notice to the site,
  mention that the game counts visits with a random id stored in the browser.
- Not set up? Nothing breaks: without `SUPABASE_URL` and `SUPABASE_KEY` the server sends nothing anywhere.
