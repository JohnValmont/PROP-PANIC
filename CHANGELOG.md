# Changelog

## 2.4.0

- **Games.** Rounds used to chain forever with one running score. A game is now a set of rounds, three by
  default: scores start at zero, the hunter role rotates each round, and the last round ends with the final
  standings and the winner of the game before everyone returns to the lobby. The header counts the rounds
  ("ROUND 2/3"), and the results panel says which round is next.
- **Game length for private rooms.** The host picks 1, 3, 5, 7 or 10 rounds in the lobby. The choice is fixed
  once a game starts; changing it mid-game applies to the next one. Public games are always three rounds.
- **Coins.** Every round pays coins: 5 for taking part, 1 per 20 points scored (capped at 40), 10 for being on the
  winning side. The last round adds 15 for finishing the game and 30 / 20 / 10 for the podium. The server works
  out each payout; the results panel shows it and the menu shows the wallet. There is nothing to buy yet. The
  wallet is stored in the browser like XP, so it is not tamper-proof (see `SECURITY.md`).
- Rewards are banked once per round, including XP: reloading during the results no longer pays XP a second time.
- Maps alternate across games too, so a three-round game no longer always opens on the Emporium.
- Fixed: a pause panel left open when a game ended would have covered the lobby. It closes, and the host of a
  private room gets the mouse back for the lobby buttons.
- New tests: `npm run test:match` (17 browser checks) and 19 server checks for game flow and payouts.
- Protocol: the phase, lobby and results messages carry new fields, so a 2.3 client should be reloaded.

## 2.3.0

- **Ghost mode for caught props and late joiners.** Being caught used to leave you with a bare fly camera that
  did not work on touch at all. Now:
  - You start attached to the hunter who caught you (late joiners: to the first hunter), with a camera that
    orbits them and stays out of walls.
  - Left click or F steps to the next player, right click or Q to the previous one. Props and hunters both.
  - Space looks through a watched hunter's eyes, blaster and recoil included; Space again steps back out.
  - Pushing a direction lets go and flies you free from where the camera is. Space / Shift climb and descend,
    the view looks all the way up and down, and E swaps between flying and watching.
  - While flying, look at a player and click to attach to them (the nearest one if nobody is under the crosshair).
  - Touch: the stick flies the ghost and the buttons become FLY / WATCH, PREV, NEXT, EYES, UP and DOWN.
  - Ghosts see every living player's name through walls, scaled to stay readable from across the map, and a strip
    at the bottom says who is being watched and as what.
- Fixed: the screen shake from being caught, and the wider view of a dash, no longer linger into the next round.
- New browser test, `npm run test:ghost` (41 checks, desktop and touch).

## 2.2.3

- Fixed: players (props and hunters) could still freeze after a reconnect. An input numbered for the old
  connection could reach the server on the new one before the game restarted its count, and every later input
  was then discarded. The client now sends nothing but the hello until it has been welcomed, and the server
  accepts a restarted count at any time.
- Fixed: reconnecting during the results screen threw an error in the page.
- After a page refresh mid-game the "Click to play" panel is shown, since the browser needs a click to recapture
  the mouse.

## 2.2.2
- Fixed players freezing in place after any reconnect or page reload: the server kept the old input count and ignored
  the client's new inputs until it caught up (minutes, in a long session).
- Inputs are batched to about 60 messages a second, so very high refresh-rate displays no longer trip the flood guard
  (which disconnected them and then triggered the freeze above).
- The server now frees any player wedged inside a wall or object within half a second.

## 2.2.1
- Touch: the game goes full screen and landscape on the first button tap (where the browser allows it); the fire
  button doubles as a look pad so hunters can track a target while zapping; new ZOOM (hunter) / LOCK (prop) toggle.

## 2.2.0
- **Touch controls.** On phones and tablets: a floating stick under the left thumb, drag on the right to look, and
  buttons for the action, jump, both abilities, dash, taunt and the menu. The menu fits a phone held sideways, and a
  prompt asks you to rotate from portrait. Add `?touch` to the address to try it on a desktop.
- **Settings no longer stall.** The menus and HUD used a live blur over the 3D view, which is very expensive on weak
  graphics chips; it is gone. Changing graphics now says what it is doing before it does it.

## 2.1.0
- **Fast graphics rebuilt for low-end laptops.** It now loads separate low-detail models (about a third of the
  triangles, 4 MB instead of 17 MB), colour textures only, simple per-vertex shading, no extra lights, no grass,
  no anti-aliasing and a slightly reduced resolution. Older integrated graphics start on Fast automatically, and
  the automatic step-down triggers sooner. Switching to or from Fast reloads the page (your seat is kept).
- **Taunt direction for hunters.** A taunt now shows an arrow around the crosshair pointing at its source, with
  the distance, for about two and a half seconds; positional audio uses head-related panning for clearer
  front/back cues.

## 2.0.0
- **Scanned assets.** The 49 procedural toys are replaced by 66 photo-scanned, physically based disguises plus set
  dressing, all CC0 from Poly Haven, optimised by a new asset pipeline (`tools/assets.mjs`). See `CREDITS.md`.
- **New renderer.** Image-based lighting from HDR panoramas, textured architecture, soft shadows, ambient occlusion,
  bloom, and Ultra / High / Fast tiers with automatic step-down.
- **Maps re-themed.** Tumbleton's Emporium (furniture hall, curiosities, stock room, crate fort, bargain pen) and a
  rebuilt Sunny Meadow (HDR sky, textured terrain, wind-blown grass, leafy trees, reflective pond, plank barn).
- **Hunters** are articulated security robots with clear-coat paint and procedural walk, aim and recoil animation.
- **Anti-cheat.** Hunters only receive props they have line of sight to, and a prop's disguise travels with its
  position instead of the player list. The debug handle on `window` needs `?debug`.
- **Server hardening.** Fixed three single-request crashes; guarded handlers; payload, rate and per-address limits;
  origin checks; heartbeats; back-pressure handling; OS-random seat tokens and room codes; strict content security
  policy; compressed, cacheable static files; idle seats released. See `SECURITY.md`.
- Ping in the scoreboard. A new security test suite (34 checks).
- Breaking: prop ids changed, so a 1.x client cannot play on a 2.x server.

## 1.0.0
- New map: **Sunny Meadow**, an open-air fairground with a barn and hay loft, bandstand, campsite, pond, market stalls,
  pumpkin patch, hay-bale maze and play fort, plus 17 outdoor disguises. Maps alternate each round; private hosts can pick.
- Outdoor rendering: sky dome, sun, drifting clouds, rolling hills, woodland backdrop, grass and wildflowers, reflective pond,
  windmill, campfire, lamp posts that glow during an eclipse.
- New music engine (drums, bass, chords and lead per phase), room reverb, per-map ambience, movement and UI sounds,
  separate music volume.
- Invert-Y option, three-segment prop health, map name in the HUD, next map on the results screen.
- Small spheres and distant trees use fewer polygons; both maps render fewer triangles than the store did at 0.3.0.

## 0.3.0
- Rebindable keys, plus sensitivity, field of view, volume and graphics settings reachable from the main menu.
- "How to play" guide (shown once on first visit), an always-on objective line and a per-role controls card.
- Roughly 45% fewer loose toys, faster roll calls (22 s), shorter scanner cooldown and cheaper misses, so hunting is readable.
- Bevelled models, rounder hunters, wallpapered outer walls, trimmed partition walls.
- Build stamp in the corner of the menu; CI workflow; Render blueprint.

## 0.2.0
- Glossy materials, baked ambient occlusion, bloom and tone mapping; overhead toy train.
- Hunter colours and hats, googly eyes, XP levels.
- Head bonks, great-escape bonus, last-prop showdown, sneeze chaos event, aim zoom.

## 0.1.0
- First playable: server-authoritative prop hunt, one map, bots, private rooms, quick play.
