# Security

PROP PANIC is a public game server that anyone can connect to, with no accounts. This file says what the
server defends against, how, and what it does not.

## Threat model

| Attacker wants to | Defence |
| --- | --- |
| Crash the server for everyone | Every request and message handler is guarded; malformed URLs, NUL bytes, oversized or garbage messages are rejected. A bug in one handler closes one connection instead of the process. |
| Exhaust memory or CPU | 4 KB message cap, per-connection message and byte rate limits, per-address socket and open-rate limits, a global socket cap, a room cap, heartbeats that drop dead sockets, and a send path that skips then disconnects clients that stop reading. |
| Move faster, teleport, fire faster, shoot through walls | The server simulates all movement from inputs with a time bank, and decides every hit, cooldown, transform and score itself. Clients only send intent. |
| See props through walls or read who is disguised as what | Hunters are sent a prop only while they have line of sight to it, and its disguise travels with that position update rather than in the player list. Nothing is sent while hunters are blindfolded or a prop is ghosted. |
| Take over someone's seat | Seat tokens are 144 random bits from the OS, compared in constant time, and only valid for a short grace period after a disconnect. |
| Guess private room codes | Wrong codes are limited to 12 a minute per address. |
| Inject script or markup through a name | Names are normalised and stripped of markup, control and invisible characters on the server, and escaped again when drawn. Chat is a fixed list of phrases, not free text. A content security policy forbids inline script. |
| Drive the game from another website | Sockets are only accepted from the game's own origin (plus any listed in `PP_ORIGINS`). The page cannot be framed elsewhere unless `PP_FRAME_ANCESTORS` allows it. |
| Read files off the server | Static serving is confined to the build directory; traversal, dotfiles and non-GET methods are refused. |

`npm run test:security` attacks a real server with each of these and fails if any defence regresses.

## What is not protected

- **Picking out the fake among objects in view.** A hunter's client has to draw a visible prop, and the layout
  of the real objects is derived from a seed the client also knows, so a modified client can compare the two and
  highlight the player. Line-of-sight culling removes wall-hacks and radar, not this. Closing it would mean
  keeping the layout secret from hunters and merging still players into it, which changes how collisions work.
- **Aim assistance.** A modified client can aim perfectly at whatever it has identified.
- **Teammates sharing information** over voice chat or a second screen (spectators and props see everything).
- **Cosmetic unlocks.** Level and hat unlocks live in the browser's storage; there are no accounts to check them
  against. They affect looks only.
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
| `PP_MAX_ROOMS` | 400 | Private rooms. |

## Reporting

Open an issue on the repository, or contact the maintainer privately if the problem can be used against a
running server.
