# Optional accounts

Players can sign in with **Discord** or **Google** so their profile (level, coins, wardrobe, catalogue, feats, odd jobs)
is kept on the server instead of only in their browser. Signing in is optional: guests play exactly as before, and
nothing on the way into a game asks them to sign in. The offer sits at the top of **Profile → Overview**.

Without the setup below the server runs with accounts off: no sign-in buttons appear and nothing changes for anyone.

## What signing in changes

| | Guest | Signed in |
| --- | --- | --- |
| Where the profile lives | This browser (`pp_profile`) | Supabase (`pp_profiles`), keyed by the account |
| Who banks each round | The browser, from the server's results | The server, from its own results |
| Buying, wearing, titles | Checked in the browser | Checked on the server (`applyChange` in `shared/progress.ts`) |
| What others see you wear, and your level | What the browser says (range-checked) | What the account owns and has earned |
| Lost if | Site data is cleared, private window, another device | The account is deleted |
| Practice games (vs bots, in the browser) | Banked | Not banked: they run in the browser, so the server cannot vouch for them |

The rules are the same pure functions on both sides (`shared/progress.ts`), so a round pays exactly the same either way.

**First sign-in.** A new account has no profile yet. The player chooses: **Bring my progress** (this browser's guest
profile, once; the browser then starts a fresh guest profile so the same progress cannot be brought into a second
account) or **Start fresh**. A brought-in profile is cleaned up like a save code and the row is marked `imported`, so a
future leaderboard can leave those out if it wants profiles that were earned entirely on the server.

**Signing out** leaves the account untouched and shows this browser's guest profile again. **Delete account** (two
confirmations) removes the profile row and the sign-in itself from Supabase.

## How it works

- The browser signs in with Supabase Auth's OAuth **PKCE** flow (`client/src/account.ts`, no SDK): it goes to
  Supabase, which sends it to Discord or Google, and comes back to the game with a one-time code that it swaps for an
  access token and a refresh token. Tokens are kept in the browser's storage (`pp_auth`) and renewed before they run out.
- Every request to the game server's API (`/api/me...`) and the game socket's hello carry the access token. The server
  asks Supabase Auth whose it is (`GET /auth/v1/user`), which also catches signed-out and deleted users, and remembers the
  answer for up to five minutes.
- The server keeps each profile in use in memory and writes it back a couple of seconds after a change, and once more when
  it stops. One process holds every profile, so two tabs of the same account change the same copy and cannot overwrite
  each other.
- Profiles are read and written only with the **secret** key, which stays in the server's environment. Row level security
  is on with no policies, so the **publishable** key (which browsers need to sign in) can neither read nor write them.

## Set it up

You need the Supabase project from `docs/ADMIN.md` (the same one works; the statistics tables are not required for
accounts), and about 20 minutes.

### 1. Create the table

Supabase → **SQL Editor** → **New query**, paste this and **Run**. It should say *Success. No rows returned*.

```sql
-- Prop Panic accounts. Safe to run more than once.
create table if not exists pp_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile jsonb not null,                 -- the whole profile, as shared/progress.ts defines it
  imported boolean not null default false, -- started from a guest profile the browser brought in
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Row level security on, with no policies: only the secret key the game server holds can read or write profiles.
alter table pp_profiles enable row level security;
```

### 2. Tell Supabase where the game is

Supabase → **Authentication** → **URL Configuration**:

- **Site URL:** your game's address, e.g. `https://prop-panic.onrender.com`
- **Redirect URLs:** add the same address with a trailing slash, e.g. `https://prop-panic.onrender.com/` (and
  `http://localhost:8080/` if you want to sign in while developing locally).

The game sends players back to exactly `origin + path`, so the entry must match.

Discord and Google both follow one pattern: **create an app with the provider → give it Supabase's callback address →
copy its Client ID and Client Secret → paste both into Supabase.** Menu names in these dashboards change from time to
time; the steps do not.

**First, copy the callback address.** Supabase → **Authentication** → **Sign In / Providers** → click **Discord**. The
panel shows a **Callback URL** like `https://abcdefghijklmnop.supabase.co/auth/v1/callback`. Copy it. This address goes
to Discord and Google. Your game's own address never does: it goes only into Supabase (step 2).

### 3. Discord

1. Open [discord.com/developers/applications](https://discord.com/developers/applications) and log in with your Discord
   account.
2. **New Application** (top right). Name it **Prop Panic**: players see this name on the *Authorize* screen. Accept the
   terms, **Create**.
3. Optional: **General Information** → an icon and a short description, also shown on the authorize screen.
4. Sidebar → **OAuth2**.
5. **Client information**:
   - **Client ID** → **Copy**.
   - **Client Secret** → **Reset Secret**, confirm (Discord may ask for your 2FA code), and copy it **at once**: it is
     shown only once. Lost it? Reset again and use the new one.
6. **Redirects** → **Add Redirect** → paste the Supabase callback address.
7. **Save Changes** (the bar at the bottom of the page; easy to miss).
8. Supabase → **Authentication** → **Sign In / Providers** → **Discord** → switch on **Enable Sign in with Discord**,
   paste the Client ID and Client Secret, **Save**.

No bot, no permissions and no review by Discord are needed.

### 4. Google

Google wants the app described before it creates a sign-in client.

**Project**

1. Open [console.cloud.google.com](https://console.cloud.google.com).
2. Project picker (top left, next to the logo) → **New Project** → name **Prop Panic** → **Create**. Make sure it is the
   selected project afterwards.

**Consent screen** (what players see)

1. Search for **OAuth consent screen** (now part of **Google Auth Platform**). If it shows **Get started**, click it.
2. **App information:** app name **Prop Panic**, user support email: yours. **Next**.
3. **Audience:** **External**. **Next**.
4. **Contact information:** your email. **Next**, agree, **Create**.
5. **Do not upload a logo yet.** A logo triggers a brand review that can take days; without one, sign-in works at once.
6. Add no scopes: Supabase asks only for email, profile and openid, which need no review.

**Client**

1. Google Auth Platform → **Clients** → **Create client** (older menus: APIs & Services → Credentials → Create
   credentials → OAuth client ID).
2. **Application type:** Web application. **Name:** anything.
3. **Authorized JavaScript origins:** leave empty.
4. **Authorized redirect URIs** → **Add URI** → the Supabase callback address.
5. **Create**. Copy the **Client ID** and **Client secret** now (or **Download JSON**): Google may not show the secret
   again. Lost it? Open the client and add a new secret.

**Publish** (do not skip)

1. Google Auth Platform → **Audience**. **Publishing status** says **Testing**: only Google accounts you list by hand as
   test users can sign in.
2. **Publish app** → confirm. It should say **In production**. With only the basic scopes, no review is needed.

**Paste into Supabase:** **Authentication** → **Sign In / Providers** → **Google** → switch on **Enable Sign in with
Google**, **Client IDs**: the Client ID, **Client Secret (for OAuth)**: the secret. Leave the other options alone. **Save**.

Expect Google's screen to say *"to continue to abcdefghijklmnop.supabase.co"* rather than your game's name. It is only
cosmetic; removing it needs a custom domain for Supabase (a paid add-on).

Only want one of the two providers? Set `PP_AUTH_PROVIDERS` (below) to just that one.

### 5. Turn it on in the game server

Supabase → **Project Settings → API Keys**: copy the **publishable** key (`sb_publishable_...`; older projects: the
`anon` key). In Render → **Environment**, make sure all three are set:

| Key | Value |
| --- | --- |
| `SUPABASE_URL` | the Project URL (already set if statistics are on) |
| `SUPABASE_KEY` | the **secret** key (already set if statistics are on). Never put it anywhere else. |
| `SUPABASE_PUBLISHABLE_KEY` | the **publishable** key. Public by design: the game hands it to browsers to sign in. |
| `PP_AUTH_PROVIDERS` | optional, default `discord,google` |

Save; Render redeploys. The server log's first line ends with `· accounts on`, `/admin` shows `accounts on`, and
**Profile → Overview** shows the sign-in buttons. Sign in once yourself and check that a row appears in Supabase →
**Table Editor → pp_profiles** after you play a round.

`PP_ACCOUNTS=0` turns accounts off again without removing the keys (statistics keep working). Players who were signed
in simply see their guest profile until it is back on; nothing in their accounts is touched.

## If something goes wrong

- **The buttons do not appear:** one of the three variables is missing, or `PP_ACCOUNTS=0`. `GET /api/config` says
  `{"accounts":false}` in that case.
- **"redirect_to is not allowed" or you land on the Supabase site URL instead of the game:** step 2, the redirect URL
  must match the game's address exactly, trailing slash included.
- **Discord says "Invalid OAuth2 redirect_uri" or Google says "Error 400: redirect_uri_mismatch":** the provider's
  redirect must be the Supabase callback (`.../auth/v1/callback`), exactly, not the game. On Discord, remember **Save
  Changes**.
- **Google says "Access blocked" or that the app is being tested:** step 4, **Publish app**.
- **"Unsupported provider: provider is not enabled":** the provider is switched off in Supabase, or not saved.
- **"Your account could not be reached":** the table from step 1 is missing or the secret key is wrong; `/admin` shows
  the last error. Players keep playing; rounds in that game are not saved to their account, and they are told so.
- **Delete account fails:** deleting the sign-in needs the secret key to be accepted by Supabase's Auth admin API. If your
  project only accepts the legacy key there, set `SUPABASE_KEY` to the legacy **service_role** key instead.
- **Supabase pauses free projects** after about a week with no activity. Restore it from the dashboard; nothing is lost.
  While it is paused, nobody can sign in, and signed-in players play without saving (guests are unaffected).

## Privacy

The game's Privacy Policy and Terms (`client/public/privacy.html`, `terms.html`) already describe optional sign-in; the
sign-in panel links to the policy. Read them over before you turn accounts on.

Signing in stores, in Supabase Auth, the account's email address and the name and picture the provider shares; in
`pp_profiles`, the profile and the account id. The game shows other players only the name the player types in the menu,
never the account name or email. **Profile → Overview → Delete account** removes the profile and the sign-in.
