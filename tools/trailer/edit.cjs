/**
 * The edit: which shot plays when, the captions over it, and the music cues. Cuts land on bar lines of the
 * game's own songs (sneak 98 bpm, lobby 112 bpm, panic 168 bpm). Every caption states something the game
 * really does (see README.md); nothing here promises a feature that is not in it.
 */
const BAR = { sneak: (60 / 98) * 4, lobby: (60 / 112) * 4, panic: (60 / 168) * 4 };
const LEAD = 0.1; // the game's sequencer starts a song 0.1 s after it is asked to

const clips = [], captions = [], music = [], stingers = [];
let t = 0;
const clip = (shot, dur, o = {}) => { clips.push({ shot, start: +t.toFixed(4), dur: +dur.toFixed(4), in: o.in ?? 0, zoom: o.zoom ?? 0, hud: o.hud }); t += dur; return clips[clips.length - 1]; };
const cap = (start, dur, kicker, text, o = {}) => captions.push({ start: +start.toFixed(4), dur: +dur.toFixed(4), kicker, text, color: o.color ?? 'yellow', pos: o.pos ?? 'low' });
const song = (mode, at) => music.push({ t: +Math.max(0, at - LEAD).toFixed(4), mode });

// ---------------------------------------------------------------- cold open (sneak)
song('sneak', LEAD);
clip('open_shelf', LEAD + BAR.sneak * 2);
cap(1.0, 3.6, '', 'Everything on this shelf is for sale…', { pos: 'mid' });
const cat = clip('open_cat', 4.6);
cap(cat.start + 0.5, 1.8, '', '…except one.', { pos: 'mid' });
music.push({ t: +(cat.start + 2.2 - 0.05).toFixed(4), mode: 'none' }); // the music stops; the cat squeaks
// ---------------------------------------------------------------- title (lobby song from here)
song('lobby', t);
const title = clip('title_meadow', BAR.lobby * 2, { zoom: 0.04 });
stingers.push({ t: title.start, name: 'reveal', vol: 1 }, { t: title.start, name: 'pop', vol: 1.2 });
// ---------------------------------------------------------------- how it plays
const tf = clip('prop_transform', BAR.lobby * 2, { in: 0.2 });
cap(tf.start + 0.2, tf.dur - 0.35, 'PROPS', 'Disguise yourself as everyday objects');
const hit = clip('hunter_hit', BAR.lobby * 2, { in: 0.1 });
cap(hit.start + 0.2, hit.dur - 0.35, 'HUNTERS', 'Three minutes to zap every fake', { color: 'pink' });
const q = clip('hunter_quack', BAR.lobby * 3);
cap(q.start + 0.2, 2.0, '', 'Shoot the wrong thing too often…', { color: 'pink' });
cap(q.start + 2.35, q.dur - 2.5, '', '…and spend 6 seconds as a rubber duck', { color: 'purple' });
const sc = clip('gadget_scanner', BAR.lobby * 1.5);
cap(sc.start + 0.15, sc.dur - 0.3, 'SCANNER', 'Catches any prop that moves as it passes', { color: 'teal' });
const sh = clip('gadget_shock', BAR.lobby * 1.5);
cap(sh.start + 0.15, sh.dur - 0.3, 'SHOCKWAVE', 'Launches real props. The decor never flinches', { color: 'teal' });
const dc = clip('gadget_decoy', BAR.lobby * 1.5);
cap(dc.start + 0.15, dc.dur - 0.3, 'DECOYS', "Shoot one and you're flash-blinded", { color: 'yellow' });
const ha = clip('haunt', BAR.lobby * 2);
cap(ha.start + 0.2, ha.dur - 0.35, 'CAUGHT?', 'Come back as a ghost and haunt the hunters', { color: 'purple' });
const m1 = clip('map_emporium', BAR.lobby);
cap(m1.start + 0.1, BAR.lobby * 2 - 0.25, 'TWO MAPS', "Tumbleton's Emporium and Sunny Meadow", { color: 'yellow' });
clip('map_meadow', BAR.lobby);
// ---------------------------------------------------------------- chaos (panic song)
song('panic', t);
const bo = clip('chaos_blackout', BAR.panic * 2);
cap(bo.start + 0.1, bo.dur * 2.5 - 0.2, 'CHAOS METER', 'Fill it and the round gets weird', { color: 'purple' });
clip('chaos_moon', BAR.panic * 2);
clip('chaos_shuffle', BAR.panic * 2);
clip('chaos_polter', BAR.panic * 2);
clip('chaos_sneeze', BAR.panic * 2);
const pt = clip('panic_time', BAR.panic * 2);
// ---------------------------------------------------------------- the end of a round
music.push({ t: +(t - 0.05).toFixed(4), mode: 'none' });
const rv = clip('reveal', BAR.lobby * 2.5);
cap(rv.start + 0.4, 2.6, '', 'Survive, and everyone sees where you hid', { color: 'teal' });
// ---------------------------------------------------------------- friends + end card (lobby song)
song('lobby', t);
const lb = clip('lobby', BAR.lobby * 2);
cap(lb.start + 0.15, lb.dur - 0.3, 'FRIENDS', 'Share a 4-letter code. Bots fill the empty seats', { color: 'teal', pos: 'right' });
const end = { start: +t.toFixed(4), dur: +(BAR.lobby * 3).toFixed(4), shot: 'title_meadow', in: 0 };
t += end.dur;
music.push({ t: +(t - 0.4).toFixed(4), mode: 'none' });

const title_card = { start: title.start, dur: title.dur };
/** Where to play, on the end card (TRAILER_URL overrides it). */
const url = 'prop-panic-1.onrender.com';
module.exports = { seconds: +t.toFixed(3), fps: 30, clips, captions, music, stingers, title: title_card, end, url, BAR };
if (require.main === module) {
  console.log(JSON.stringify(module.exports, null, 1));
  console.error('total', t.toFixed(2), 's');
}
