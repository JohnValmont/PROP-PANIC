# Changelog

## 2.12.0

Hunters get characters, blasters you can see in their hands, and a locker of their own.

- **Characters.** A new Characters tab with nine hunters: Night Guard (the new default), Securibot 3000 (the old robot,
  still free), Granny Tumbleton, The Janitor, Pest Control, Inspector Gumshoe, Agent Zero, Mall Santa and Barnaby Bear.
  All of them share one skeleton, so the size, speed, hit box and animation are the same for everyone. Your paint
  colours their uniform. Rarity (common, rare, epic, legendary) is only a label and a frame colour.
- **Blasters.** 13 of them, held in the hand: Zapper, Super Soaker, Plunger Popper, Banana, Hair Dryer, Baguette, Retro
  Raygun, Duck Cannon, Leaf Blower, Wet Fish, TV Remote, Finger Guns and the Golden Zapper. Two-handed ones are held
  with both hands. Every blaster fires the same shot with the same rules; the look, the muzzle flash and a little extra
  sound on your own shot are the only differences.
- **Zap trails.** Eight tracer styles (Laser Red, Plasma Blue, Bubbles, Confetti, Rainbow...) that everyone sees.
- **First person shows your hand.** The blaster is held in your character's hand, sleeve and all, and the other hand
  comes in for two-handed blasters. Watching through a hunter's eyes as a ghost shows their arms and blaster.
- **Shots leave the muzzle.** Tracers start from the blaster you can see (yours on screen, or the one in another
  hunter's hand) instead of from a point in the hunter's chest.
- **Fix:** the blaster was held upside down in third person (grip up). The robot's ball hand hid it.
- **Profile tabs:** Overview, Characters, Hunter locker (blasters, zap trails, hats, paint), Prop wardrobe (eyes,
  catch pop), Catalogue, Feats. Characters, blasters and hats have 3D thumbnails, rendered once in a separate small
  WebGL context. Wearing a blaster, trail or character makes the fitting-room hunter fire a test shot.
- **Earned, not bought:** Agent Zero (Bloodhound), TV Remote (Sharpshooter), Golden Zapper (Champion), Gold Rush trail
  (Collector). Players who already have those feats get them straight away.
- **Wire format:** the kit grows from 5 to 8 numbers (character, blaster, trail appended). An older client's five-number
  kit still works and gets the defaults. Bots dress at random from everything.

## 2.8.0

An admin page, so whoever runs the server can see how the game is actually being played.

- **`/admin`**, behind a password (`PP_ADMIN_KEY`): humans online, rooms open, and totals since the server started.
- **History in Supabase (free).** With `SUPABASE_URL` and `SUPABASE_KEY` set, every visit, every round and the number
  online every five minutes are written in batches, and the page shows different players, visits, hours played, a
  30-day table (players, visits, average visit, rounds, peak online) and hunter / prop win rates per map. Visits still
  open when the server stops are written before it exits. `docs/ADMIN.md` has the setup and the SQL.
- No names or addresses are kept: each browser makes up a random id (`pp_aid`) so one person's ten visits count once.
- New test: `npm run test:stats` (in CI).

## 2.7.0

A proper progression system. Coins finally buy something, and the profile is more than a number.

- **Profile.** Click the price tag on the menu card. Four tabs: Overview (level, title, today's odd jobs, lifetime
  stats, backup), Wardrobe, Catalogue and Feats. The panel slides in on the right so the robot in the middle stays in
  view, wearing what you pick.
- **Level and price tag.** Points are still XP. The curve is unchanged up to level 11 and then needs a flat 3,000 XP
  a level, so later levels keep coming. Each level pays coins, and the badge is an Emporium price tag that changes its
  name every few levels (Bargain Bin to Priceless). Level badges show next to names in the lobby, scoreboard and
  results.
- **Wardrobe: 47 looks in four slots.** Paint (8 free colours plus Pearl, Midnight, Chrome, Opal and Gilded), hats
  (the 6 old ones plus Beanie, Traffic Cone, Chef's Hat, Cowboy Hat, Wizard Hat, Viking Helmet, Lampshade, Duck Hat and
  Halo), googly-eye styles (Wide, Beady, Angry, Sleepy, Lashes, Lovestruck, Shades, Cyclops, Monocle) and the burst
  everyone sees when you are caught (Feathers, Bubbles, Coin Shower, Glitter, Rainbow, Leaves, Sparks, Sawdust).
  Nothing in it can give a hiding prop away: the eyes come out only once a prop has given itself away, and the burst
  comes when it is caught. Looks are bought (150 to 1,200 coins), come with a level, or are earned by a feat. The
  first click on a price asks to confirm it. A box beside the robot shows your eyes and previews your burst.
- **Catalogue.** Every disguise has a Hid stamp (survive a round as it, having worn it for the last 20 seconds, so a
  last-second swap does not count) and a Caught stamp (catch a prop disguised as it). Bronze at 1, silver at 3, gold at
  10, each paying XP and coins. The 66 objects are filed in five departments; hiding as everything in one earns its
  look. It is there to make props try new objects instead of always the same few.
- **Feats and titles.** 24 milestones, from 10 catalogue stamps to level 40. Each pays once and unlocks a title worn
  next to your name.
- **Odd jobs.** Three a day, the same for everyone (one as a prop, one as a hunter, one either way), with a bonus for
  all three. Shown on the menu card and the results panel.
- **Results panel.** The coin line is replaced by a progress strip: XP and the level bar, coins (play and bonuses),
  new stamps, unlocks, feats and the day's jobs. The level-up banner that used to sit behind the panel is gone.
- **Save codes.** Overview → Backup copies the profile as a code to restore in another browser.
- **Upgrading.** A 2.6 profile (XP, coins, colour and hat) is carried over on first load. The Crown now unlocks at
  level 20; anyone who had it keeps it.
- Server: the results carry each player's round stats (catches and what they were disguised as, escapes, bonks,
  time near a hunter, and the disguise a survivor is credited for). The hello and roster carry a kit and level
  instead of the packed `look` number, checked for range only (see `SECURITY.md`). A 2.6 client should be reloaded.
- New test: `npm run test:progress` (in CI) checks the rules directly. The protocol, mechanics, browser and match tests
  cover the new fields, the 20-second hold, the wardrobe and the progress strip.

## 2.6.0

A new soundtrack and new sound effects. Still no audio files: everything is synthesised in code, now properly.

- **Real instruments instead of beeps.** Plucked strings and upright bass (Karplus-Strong), marimba, glockenspiel and
  bells (sums of decaying resonances), an FM electric piano, a reed, a brass section, a warm pad, a synth bass and lead,
  and a drum kit (kick, snare, clap, hats, shaker, rim, tom, crash, finger snaps, brushes). Notes are rendered into
  small sample buffers in the background, a few milliseconds at a time.
- **A composed soundtrack.** Four songs written out note by note with intros, A and B sections, bass lines, voice-led
  chords, melodies and counter-melodies: *Tumbleton's Theme* (menu, lobby, results), *Tiptoe* (hiding), *Searching*
  (the hunt) and *Panic!* (the last 30 seconds). Jingles for winning, levelling up and each side's role card; the sad
  trombone for losing.
- **Adaptive hunt music.** The hunt track brings in percussion and a marimba ostinato as a hunter and a prop close in
  on each other, or as the last minute nears, then pizzicato and snare when it gets really close.
- **Taunts are whistles**: five clear whistles, every one rising from low to high (a plain rising whistle, "fweet-fweet",
  a slide whistle, a whistled arpeggio, a rise with a wobble), so a hunter knows a taunt the moment they hear it.
- **Sound effects redone**: a layered blaster, rubber squeaks shaped by vowel resonances, wooden knocks
  for innocent objects, a referee's whistle to start the hunt, a comedy "awooga" for panic time, a theremin for a
  spooked hunter, robot footsteps. Frequent sounds get a few variations and a small random detune.
- **A proper mix**: stereo placement, a music reverb and a room reverb that changes with the map, high-passed reverb
  returns, a compressor and limiter, and the music dips for a moment under squeaks, taunts and catches so they are
  heard. Every effect is normalised and DC-free; levels were set by measuring each one.
- **Sound test** in Settings: play any track (including the hunt at full tension) or effect.
- `npm run audio:render` renders every track and effect to WAV/MP3 through the game's own engine.
  `npm run test:audio` (in CI) checks every instrument, effect and song renders clean.
- Caught before release by the new render and test tools: the reverbs must be generated at the device's own sample
  rate (otherwise the browser refuses them), a plucked bass carried a DC offset that ate headroom, and several effects
  peaked well over full scale and were being squashed by the limiter.

## 2.5.0

The two dead stretches of a round, and a few things hunters were told that they should not have been.

- **Haunting.** Being caught used to mean watching for up to three minutes. A caught prop (and a late joiner sitting
  a round out) is now a ghost that can aim at any real object and click to haunt it: it hops and twists like a nervous
  prop, with a knock from nowhere. A hunter who shoots it within 9 seconds is *spooked*: an extra Focus hit (10 instead
  of 6), a "BOO!" for everyone, and 35 points for the ghost. One haunt every 7 seconds, faster during a Poltergeist.
  Caught bots haunt objects near the hunters, and bot hunters sometimes take the bait, so the mechanic exists in a room
  of bots too. New award: Poltergeist. Switch: `HAUNT_ON`.
- **Hunters study the room.** The 25-second blindfold is replaced by a free-flying camera round the room as it was
  stocked, with no props in it (the server sends none, as before). Whatever turns up later is a fake. Switch:
  `PREVIEW_ON` (off restores the blindfold).
- **A hunter who leaves no longer hands the props the round.** A hunter disconnected for 12 seconds, or idle for 45 in a
  public room, is stood down and a bot takes over (one that has already been caught, if there is one; never the last
  prop hiding). Previously a dropped hunter's seat ended the round after the 30-second grace, or idled for three minutes.
- **Round start and end.** A role card says which side you are on, who the hunters are and the one thing to do;
  a mid-round joiner is told what they are. A big 3 · 2 · 1 before the hunters are released. When a round ends, three
  seconds pass before the board, with a pillar of light over every prop that survived, so hunters see where they were.
- **Hits read at a glance.** A hit prop shows how many hits it has left ("2 MORE", "ONE MORE!"); a prop changing
  disguise pops into its new shape.
- **Clearer words.** The prop ability *Ghost* is now *Vanish* (ghosts are what caught players are). How to play is
  three steps a side plus one line about haunting.
- **Hidden information, fixed:**
  - A decoy was announced to every client at once, owner included, so a modified hunter client saw every decoy (and so
    roughly where props had been) through walls. Hunters now hear of a decoy only when it comes into view, and never
    whose it is.
  - The puff of smoke when a prop changed disguise, vanished or was shuffled went to every client with its position.
    Hunters now get it only when they can see that prop.
  - Taunts during the hiding phase were sent to the blindfolded hunter.
- Scores are in one table (`SCORE`), chaos events have weights (`CHAOS_WEIGHTS`), the late-join cutoff is a constant
  (`LATE_JOIN_MS`). A hunter who is stood down earns no win bonus.
- Tests: 18 new server checks (haunting, what hunters are told, the stand-in), a browser check of the room preview, and
  the ghost test drives haunting with mouse and touch.
- Protocol: new `haunt` message and events, `cd` carries `haunt`; a 2.4 client should be reloaded.

## 2.4.1

- **Changing graphics no longer reloads the page.** Switching to or from Fast used to reload the whole site,
  because Fast uses its own models and materials. They are now swapped in place: the old set is released, the
  map and everyone on it are rebuilt, and the new set streams in. Ultra and High never reloaded, but two of the
  three steps of the Graphics button did. The automatic step-down to Fast on a slow machine no longer reloads
  either.
- Known difference: anti-aliasing of the Fast picture is decided when the page loads. A session that started on
  High or Ultra and switches to Fast keeps it (slightly smoother edges, slightly more work for the graphics
  chip); one that started on Fast has none, as before.

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
