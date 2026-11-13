# Playtest checklist

Bots prove the code runs. They say nothing about whether a mechanic is fun, fair or understood. Use this for the
first sessions with real people. Every number named here is in `shared/constants.ts`.

## Set-up

- 7 or 8 people, a private room, the default three-round game, both maps. Run at least two games so everyone hunts.
- One person (not playing) watches over shoulders or a stream and writes down the moments listed below with a time.
- Ask nobody to read *How to play* first: half of what is being tested is whether the screen explains itself.
- Afterwards, three questions to each player: what was the best moment, when were you bored, when were you confused.

## What to watch, by system

### Haunting (new in 2.5, `HAUNT_ON`)

Watch for:
- Do caught players start haunting without being told? How long after the "CAUGHT!" banner? (Target: within 15 s.)
- Do caught players stay at the screen, or reach for their phone? Count phones.
- Do hunters learn to ignore haunted objects, or keep falling for them all game? Spook count per round is in the
  results awards (Poltergeist) and can be read off the feed.
- Does it get annoying for hunters? Listen for complaints about noise or about being punished for something they
  could not tell apart.
- Does the extra chaos make chaos events arrive too often? (Each haunt adds `CHAOS_HAUNT`, each spook `CHAOS_SPOOK`.)

Tune first: `CD_HAUNT` (7 s), `FOCUS_SPOOK` (10), `SCORE.spook` (35), `HAUNT_BAIT_MS` (9 s).

Cut it (set `HAUNT_ON: false`) if: caught players still leave or tune out at the same rate as before, or hunters say
it makes them stop shooting altogether (the round goes props' way more than about two in three times *because* of it).

### Room preview for hunters (new in 2.5, `PREVIEW_ON`)

Watch for:
- Do hunters actually fly round, or sit still? Do they say anything like "that wasn't there before"?
- Hunter win rate per round, compared with the same group with the switch off for one game. With 1 hunter against
  6-7 props the old game leaned to props; this is meant to pull it back, not flip it.
- Do props complain that hunters "knew" where they were? That would mean the layout is too memorable on one map.

Tune first: `HIDE_MS` (25 s: shorter makes memorising harder), map density in `shared/map.ts`.

Cut it if: hunters win more than about 70% of rounds with it and about 50% without, or hunters ignore it and the
blindfold tips were more useful.

### Hunter stand-in (new in 2.5, `HUNTER_DC_MS` / `HUNTER_AFK_MS`)

Hard to observe on purpose. Have one hunter close their tab mid-round once. Check the bot takes over within ~12 s and
nobody hiding loses their spot. Ask the props whether a bot hunter felt like a cheap win.

Cut it if: people would rather the round ended. Set both timers very high.

### 2.7: progression

Mostly visible after a session, so ask at the end, and look at a couple of players' profiles.

- Does anyone open the profile without being told? (The price tag on the menu card is the only door.)
- After a round, do people read the progress strip on the results panel, or skip past it?
- Catalogue: do props try objects they have no stamp for? If everyone still hides as the same few objects, the
  stamp rewards (`GRADE_REWARD`) are too small; if props pick hopeless disguises just for stamps, the
  20-second hold (`CATALOG_HOLD_MS`) is too short.
- Odd jobs: is the hunter job ever finished in a short session? If not, players do not get enough hunter rounds.
- Prices: after an hour, how many coins does a typical player have and what did they buy? A first purchase should
  come within the first session; the dearest items should take weeks.
- Titles: does anyone change theirs? Does anyone mention someone else's?

Cut or change it if: the results panel feels cluttered (drop the jobs line first), or people feel pushed to grind
instead of play.

### Existing systems worth a second look

- **Focus and QUACK**: how often does a hunter turn into a duck per round? If never, `FOCUS_MISS` is too low; if more
  than twice, too high.
- **Three hits to catch (`DMG` 34)**: do props escape after the first hit often enough to be exciting (target: about a
  third of first hits end in an escape), or does it feel like hunters get robbed?
- **Chaos events**: which ones do people cheer, which do they groan at? Weight them in `CHAOS_WEIGHTS`
  (0 removes one). Poltergeist and Prop Shuffle are the most likely to feel random.
- **Roll call every 22 s (`ROLLCALL_MS`)**: does it make hiding pointless in the Emporium? Do hunters use it at all?
- **Taunt scoring (`SCORE.tauntMax`, `TAUNT_RANGE`)**: do props taunt at all? Do the best players only taunt?
- **Scores and coins (`SCORE`, `COINS`)**: does the board match who people felt played best? Hunters tend to top it
  (`catch` 150 each).

## Moments to time

| Moment | Target | What a bad number means |
| --- | --- | --- |
| Menu to first round | under 30 s in Play now | lobby countdown or matchmaking too slow |
| First transform by a new prop | under 8 s | role card / prompt not read |
| First time a new hunter fires | under 20 s into the hunt | not sure what to shoot |
| A caught player's first haunt | under 15 s | haunting not discovered |
| Results panel read | players look at it, then talk | the reveal beat is too long or too short (`REVEAL_BEAT_MS`) |
| Back for another game | most people click Play again | the end of a game feels flat |

## With 4-5 players

One hunter against 3-4 props. Haunting has fewer ghosts, so less noise: check it is not *too* rare to learn. The preview
matters more: one hunter alone against hiding props was the weakest role. Public rooms fill to 5 with bots.
