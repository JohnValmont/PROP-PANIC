# Changelog

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
