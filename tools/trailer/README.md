# Trailer tooling

Everything in the PROP PANIC trailer is the game itself: the real server and client, filmed frame by frame.
The music and sound effects are the game's own `client/src/audio.ts`, rendered offline. The captions use the
game's stylesheet and font. Nothing is mocked up.

## How it works

| File | Job |
| --- | --- |
| `clock.ts`, `server-entry.ts` | The real server under a virtual clock (and seeded randomness), forked with an IPC channel: `advance(ms)` and `eval(code)`. |
| `vt-client.js` | The same for the page: `requestAnimationFrame`, timers, `performance.now`, `Date.now` and CSS animations all run on one clock that only moves when told. |
| `lib.cjs` | Lockstep: per video frame the server advances 1/30 s, its snapshots arrive, the page advances 1/30 s and renders, and the frame is grabbed. A frame that takes the software renderer 8 s still covers exactly 1/30 s of game time. Also a camera override, a HUD switch and a log of every sound the game plays. |
| `director.js` | Staging helpers evaluated inside the server: place players, freeze or steer bots, start a round on a chosen map seed, force a chaos event. They call the room's own methods (`fire`, `transform`, `ability`, `taunt`, `haunt`, `triggerChaos`). Game rules are never changed. |
| `shots.cjs` | The shots. Each one stages a round and films it. |
| `run.cjs` | Renders shots: `preview` (low-res stills every 6th frame, to check staging) or `final` (every frame at 1920x1080, resumable). |
| `edit.cjs` | The cut: shot order, in points, captions and music cues, timed to bar lines of the game's songs. |
| `compose.html`, `compose.cjs` | Lays the frames out with captions and title cards (16:9, or 9:16 with the footage cropped to 4:3) and pipes them into ffmpeg. `cues` builds the sound cue sheet from the shots' logs. |
| `audio.cjs` | Renders the music and effects stems with the game's audio engine on an `OfflineAudioContext`, then mixes them to -14 LUFS. |
| `mapinfo.ts`, `scout.cjs` | Location scouting: the loose props of a map seed near a point, and stills from candidate camera positions. |

Two capture details matter. The game drops to Fast graphics when it sees under 34 fps, and under the
virtual clock it always sees 30, so `lib.cjs` turns that check off. The new-player objective line and the
"click to play" hint are hidden, as they would be for a regular player.

## Rebuilding the trailer

Needs Node, Playwright's Chromium and ffmpeg, and runs without a GPU (software WebGL). Paths below are examples.

```bash
npm run build
npx esbuild tools/trailer/server-entry.ts --bundle --platform=node --format=cjs --outfile=/tmp/trailer/server.cjs --external:bufferutil --external:utf-8-validate
export TRAILER_BUNDLE=/tmp/trailer/server.cjs
```

```bash
node tools/trailer/run.cjs preview /tmp/trailer/prev          # minutes: check the staging
```

```bash
node tools/trailer/run.cjs final /tmp/trailer/final           # hours on a CPU: about 8 s a frame at 1080p
```

```bash
node tools/trailer/compose.cjs cues /tmp/trailer/final /tmp/trailer/cues.json
node tools/trailer/audio.cjs /tmp/trailer/cues.json /tmp/trailer/audio
node tools/trailer/compose.cjs video /tmp/trailer/final /tmp/trailer/prop-panic-trailer.mp4 16x9 /tmp/trailer/audio
node tools/trailer/compose.cjs video /tmp/trailer/final /tmp/trailer/prop-panic-trailer-vertical.mp4 9x16 /tmp/trailer/audio
```

The end card prints the game's address (`url` in `edit.cjs`; `TRAILER_URL` overrides it, and an empty value leaves it off).

A single shot can be re-rendered on its own (`run.cjs final <dir> haunt`). The final render skips shots that are
already complete and replays the frames a half-finished shot already has, so an interrupted run picks up at the frame where it stopped. It first re-renders the last saved frame and compares it with the one on disk; if a shot did not replay identically (bots that act on their own can differ in a fresh session), it is filmed again from the start rather than spliced. Shots are staged on fixed map seeds
(309 for the emporium, 202 for the meadow): a change to the map generator or the prop catalogue can move
things, so preview first.
