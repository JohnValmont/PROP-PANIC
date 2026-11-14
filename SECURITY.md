# Security

PROP PANIC is a public game server that anyone can connect to. Accounts are optional (Discord or Google through
Supabase Auth, `docs/ACCOUNTS.md`); most players are guests. This file says what the server defends against, how, and
what it does not.

## Threat model

| Attacker wants to | Defence |
| --- | --- |
| Crash the server for everyone | Every request and message handler is guarded; malformed URLs, NUL bytes, oversized or garbage messages are rejected. A bug in one handler closes one connection instead of the process. |
| Exhaust memory or CPU | 4 KB message cap, per-connection message and byte rate limits, per-address socket and open-rate limits, a global socket cap, a room cap, heartbeats that drop dead sockets, and a send path that skips then disconnects clients that stop reading. |
| Move faster, teleport, fire faster, shoot through walls | The server simulates all movement from inputs with a time bank, and decides every hit, cooldown, transform and score itself. Clients only send intent. |
| See props through walls or read who is disguised as what | Hunters are sent a prop only while they have line of sight to it, and its disguise travels with that position update rather than in the player list. Nothing is sent while the props hide or a prop has vanished. Decoys reach a hunter only once in view and never say whose they are; the puff of a prop changing shape reaches a hunter only if that prop is in view; taunts are not sent during the hiding phase. |
| Take over someone's seat | Seat tokens are 144 random bits from the OS, compared in constant time, and only valid for a short grace period after a disconnect. |
| Guess private room codes | Wrong codes are limited to 12 a minute per address. The public table board (`/status`) lists public rooms by code; private rooms appear only as a count. |
| Jump the line or hold seats | A freed seat is reserved by a 144-bit single-use pass sent only to the person at the front of the line, valid for 30 seconds. A hello without a valid pass waits behind everyone already in line. Waiting sockets count toward the per-address and global socket limits, and the line itself is capped. |
| Inject script or markup through a name | Names are normalised and stripped of markup, control and invisible characters on the server, and escaped again when drawn. Chat is a fixed list of phrases, not free text. A content security policy forbids inline script. |
| Drive the game from another website | Sockets are only accepted from the game's own origin (plus any listed in `PP_ORIGINS`). The page cannot be framed elsewhere unless `PP_FRAME_ANCESTORS` allows it. |
| Read files off the server | Static serving is confined to the build directory; traversal, dotfiles and non-GET methods are refused. |
| Sign in as someone else, or forge a signed-in seat | The server never decides who someone is from what the browser says: every access token is checked with Supabase Auth (`/auth/v1/user`), which also rejects signed-out and deleted users; a verdict is remembered for at most five minutes or until the token expires. A hello with a token Auth does not recognise gets a guest seat. Sign-in uses the PKCE flow, so a one-time code that leaks from the address bar is useless without the verifier kept in that tab. |
| Read or change someone else's profile | Profiles are read and written only by the server, with the secret key, by the account id Auth returned for the token. Row level security is on with no policies, so the publishable key handed to browsers reaches no profile. |
| Award themselves coins, items, levels or a look (signed in) | A signed-in player's rounds are banked by the server from its own results; buying, wearing and titles go through the same rules on the server; what others see them wear, and their level, come from the account. The browser's claims are ignored. |
| Drive the account API from another website, or flood it | Changes (`POST /api/me/...`) are refused from other origins; there are no cookies, only a bearer token, so there is nothing ambient to ride on. 64 KB body cap, 120 requests a minute per address. |

`npm run test:security` attacks a real server with each of these and fails if any defence regresses.

## What is not protected

- **Picking out the fake among objects in view.** A hunter's client has to draw a visible prop, and the layout
  of the real objects is derived from a seed the client also knows, so a modified client can compare the two and
  highlight the player. Line-of-sight culling removes wall-hacks and radar, not this. Closing it would mean
  keeping the layout secret from hunters and merging still players into it, which changes how collisions work.
  Since 2.5 the game hands every hunter the same knowledge legitimately: they study the empty room while the props
  hide. That levels the field between modified and honest clients rather than widening it.
- **Roll calls and haunting.** Roll calls send every prop's (and decoy's) position to everyone by design, so a modified
  client can draw them on a map for the half second they squeak. Which ghost haunted an object is sent to hunters too;
  it tells them nothing about living props.
- **Aim assistance.** A modified client can aim perfectly at whatever it has identified.
- **Teammates sharing information** over voice chat or a second screen (spectators and props see everything).
- **A guest's profile: level, coins, wardrobe, catalogue, feats.** A guest's profile lives in the browser's storage.
  The server decides how many coins a round pays and what each player did in it, but a guest's running totals, and
  what they own, are the client's word: a modified client can wear any look, any title and any level badge. The server
  checks only that the kit and level are in range (`cleanKit`), so nothing malformed reaches other players. Every item
  is cosmetic and nothing is sold for money, which is why this is acceptable. Signed-in players are not affected:
  their profile is the server's (above). Anything that is meant to prove something (a leaderboard, a paid item) should
  count signed-in profiles only.
- **What a signed-in profile started from.** The first sign-in may bring the browser's guest profile into the account,
  once, and that guest profile was the client's word. It is cleaned up like a save code and the row is marked
  `imported`, so anything that must count only progress earned on the server can leave those rows out. Making many
  accounts to bring the same edited profile into each is possible but pointless while everything is cosmetic.
- **Farming with several tabs or accounts.** Two seats earn twice, as two guests would. The coin cap per round still
  applies to each seat.
- **Volumetric denial of service.** The limits above handle abusive clients, not a flood of traffic; that needs
  a network-level service in front (the host's, or a CDN).
- **Per-address limits behind shared addresses.** Behind a proxy the server reads `CF-Connecting-IP` or the
  first `X-Forwarded-For` entry; a client that can forge that header can dodge per-address limits (the global
  caps still apply). Set `PP_TRUST_PROXY=0` if the server is exposed directly.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PP_TRUST_PROXY` | on when `RENDER` is set | Read the client address from proxy headers. |
| `PP_ORIGINS` | none | Extra hostnames allowed to open game sockets, comma separated. |
| `PP_FRAME_ANCESTORS` | `'self'` | Who may embed the page, e.g. `https://itch.io https://html-classic.itch.zone`. |
| `PP_MAX_CONNS` | 1500 | Sockets in total. |
| `PP_MAX_PER_IP` | 32 | Sockets per address. |
| `PP_NEW_PER_MIN` | 120 | Socket opens per address per minute. |
| `PP_MAX_ROOMS` | 400 | Private rooms (an absolute cap; `PP_PRIVATE_TABLES` is the one that normally applies). |
| `PP_SEATS` | 24 | Players across all rooms. Past this, newcomers wait in line (`server/gate.ts`). |
| `PP_PRIVATE_TABLES` | 3 | Private rooms running at once. When all are in use, Private room says so (Play still works). |
| `PP_LINE_MAX` | 400 | People waiting in line. Past this, a newcomer is asked to come back later. |
| `PP_PASS_MS` | 30000 | How long a freed seat is held for the person at the front of the line. |
| `PP_BRAKE_MS` | 20 | How late (smoothed) the game loop may run before new players wait regardless of seats. 0 turns it off. |
| `PP_ADMIN_KEY` | none | Password for `/admin` (8+ characters). Unset: the page does not exist. |
| `SUPABASE_URL`, `SUPABASE_KEY` | none | Where play statistics are kept (`docs/ADMIN.md`), and signed-in profiles. Unset: nothing is sent anywhere. |
| `SUPABASE_PUBLISHABLE_KEY` | none | With the two above, turns on optional accounts (`docs/ACCOUNTS.md`). Public by design. `SUPABASE_ANON_KEY` also works. |
| `PP_AUTH_PROVIDERS` | `discord,google` | Sign-in buttons offered, in order. They must be enabled in Supabase too. |
| `PP_ACCOUNTS` | on when the keys are set | `0` turns accounts off without removing the keys. |

## The admin page and statistics

`/admin` is behind HTTP Basic auth with `PP_ADMIN_KEY`, compared as SHA-256 digests in constant time; ten wrong
passwords lock an address out for 15 minutes. The page has no script, is never cached and asks not to be indexed. Serve
the game over HTTPS (Render does), or the password crosses the network in the clear.

Statistics hold no names and no addresses: a visit is a random id the browser made up, its start, end, length and
rounds. The Supabase secret key lives only in the server's environment. The tables have row level security on with no
policies, so the project's public key can neither read nor write them, and the views use `security_invoker` so they do
not get round that.

## Reporting

Open an issue on the repository, or contact the maintainer privately if the problem can be used against a
running server.
