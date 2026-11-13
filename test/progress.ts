/**
 * Progression rules (shared/progress.ts), checked directly: the level curve, the catalogue, feats, odd jobs,
 * the wardrobe, banking a round, save codes and the server's kit check.   Run: npm run test:progress
 */
import { PROPS } from '../shared/props';
import {
  CHARS, DEPARTMENTS, EYES, FEATS, GUNS, KIT, TRAILS, FEAT_INDEX, HATS, ITEMS, JOBS, KIT_LIMITS, PAINTS, POPS, STAMPS_MAX, bankRound, buyItem, cleanKit, equip, exportCode,
  importCode, jobsFor, stampCount, kitToWire, levelCoins, levelStep, levelXp, migrateLegacy, newProfile, owns, sanitizeProfile, xpLevel,
  type RoundInput, type RoundStats,
} from '../shared/progress';

let failures = 0;
const ok = (cond: unknown, label: string) => { if (cond) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const T = (id: string) => PROPS.findIndex((p) => p.id === id);
const stats = (o: Partial<RoundStats> = {}): RoundStats => ({ sh: 0, hi: 0, k: 0, inn: 0, bk: 0, es: 0, ta: 0, bz: 0, nr: 0, qk: 0, sp: 0, hn: 0, hid: -1, ct: [], nh: 0, ...o });
let n = 0;
const round = (o: Partial<RoundInput> = {}): RoundInput => ({ key: `r${n++}`, day: '2026-11-13', team: 'prop', won: false, survived: false, pts: 100, coins: 10, st: stats(), gameOver: false, place: 0, players: 0, ...o });

console.log('level curve');
{
  const old = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 150)) + 1;
  let same = true;
  for (let xp = 0; xp <= 15_000; xp += 37) if (xpLevel(xp) !== old(xp)) same = false;
  ok(same, 'identical to the 2.6 curve up to level 11, so no one loses a level');
  let inverse = true, steps = true;
  for (let l = 1; l <= 120; l++) {
    if (xpLevel(levelXp(l)) !== l || xpLevel(levelXp(l) - 1) !== Math.max(1, l - 1)) inverse = false;
    if (levelXp(l + 1) - levelXp(l) !== levelStep(l)) steps = false;
  }
  ok(inverse && steps, 'levelXp and xpLevel agree for levels 1-120, and each step matches levelStep');
  ok(levelStep(10) === 2850 && levelStep(11) === 3000 && levelStep(60) === 3000, 'steps grow to level 10, then stay at 3,000 XP');
  ok(levelCoins(2) === 30 && levelCoins(40) === 150 && levelCoins(99) === 150, 'level-up coins rise with level and are capped');
}

console.log('content is consistent');
{
  const all = DEPARTMENTS.flatMap((d) => d.props);
  ok(all.length === PROPS.length && new Set(all).size === PROPS.length && all.every((id) => T(id) >= 0), `the five departments hold all ${PROPS.length} disguises exactly once`);
  ok(STAMPS_MAX === PROPS.length * 2, `${STAMPS_MAX} stamps in all`);
  const ids = [...PAINTS, ...HATS, ...EYES, ...POPS, ...CHARS, ...GUNS, ...TRAILS].map((i) => i.id);
  ok(new Set(ids).size === ids.length && Object.keys(ITEMS).length === ids.length, `${ids.length} wardrobe items with unique ids`);
  const featItems = Object.values(ITEMS).filter((i) => 'feat' in i.how);
  ok(featItems.every((i) => { const f = FEATS[FEAT_INDEX[(i.how as { feat: string }).feat]]; return f && f.reward.item === i.id; }), 'every feat-only item is the reward of the feat that unlocks it');
  ok(FEATS.every((f) => !f.reward.item || ITEMS[f.reward.item]), 'every feat reward item exists');
  ok(DEPARTMENTS.every((d) => FEAT_INDEX[d.feat] !== undefined), 'every department has its feat');
  ok(PAINTS.slice(0, 8).every((p) => 'free' in p.how) && HATS[0].id === 'hat.cap' && HATS[5].id === 'hat.crown', 'wire order kept: eight free paints, the six 2.6 hats in their old slots');
  ok(new Set(JOBS.map((j) => j.id)).size === JOBS.length && (['prop', 'hunter', 'any'] as const).every((s) => JOBS.some((j) => j.side === s)), 'jobs have unique ids and cover every side');
}

console.log('odd jobs');
{
  const a = jobsFor('2026-11-13'), b = jobsFor('2026-11-13');
  ok(a.map((j) => j.id).join() === b.map((j) => j.id).join(), 'the same day gives the same three jobs');
  ok(a[0].side === 'prop' && a[1].side === 'hunter' && a[2].side === 'any', 'one job as a prop, one as a hunter, one either way');
  const days = new Set<string>();
  for (let d = 1; d <= 28; d++) days.add(jobsFor(`2026-02-${String(d).padStart(2, '0')}`).map((j) => j.id).join());
  ok(days.size > 14, `boards vary from day to day (${days.size} different in 28 days)`);
}

console.log('banking a round');
{
  const p = newProfile();
  const sign = T('sign');
  const r1 = bankRound(p, round({ survived: true, won: true, pts: 400, st: stats({ hid: sign, nh: 1, nr: 12, ta: 3 }) }));
  ok(p.cat.sign?.[0] === 1 && r1.stamps.length === 1 && r1.stamps[0].grade === 1, 'surviving as an object stamps it');
  ok(p.life.rounds === 1 && p.life.survived === 1 && p.life.untouched === 1 && p.life.wins === 1 && p.life.near === 12, 'lifetime record updated');
  ok(r1.xp >= 400 + 40 && p.xp === r1.xp, `XP is the round score plus extras (${r1.xp})`);
  ok(r1.levelFrom === 1 && r1.levelTo === xpLevel(p.xp) && r1.levelTo >= 2, `levelled up to ${r1.levelTo}`);
  ok(r1.unlocked.includes('hat.party'), 'level 2 unlocks the party hat');
  ok(p.coins === r1.coins && r1.coins > r1.coinsPlay, `coins: ${r1.coinsPlay} from play plus ${r1.coins - r1.coinsPlay} in bonuses`);
  const r2 = bankRound(p, round({ team: 'hunter', st: stats({ k: 2, hi: 6, sh: 7, ct: [sign, T('duck')] }) }));
  ok(p.cat.sign?.[1] === 1 && p.cat.duck?.[1] === 1 && r2.stamps.length === 2, 'catching props stamps their disguises');
  ok(p.life.cleanHunts === 1 && p.life.catches === 2, 'two catches and no innocent shots is a clean hunt');
  for (let i = 0; i < 2; i++) bankRound(p, round({ survived: true, st: stats({ hid: sign }) }));
  ok(p.cat.sign[0] === 3, 'a stamp counts every survival');
  ok(p.cat.sign[0] === 3 && JSON.stringify(bankRound(p, round({ survived: true, st: stats({ hid: sign }) })).stamps) === '[]', 'no new grade between silver (3) and gold (10)');
  const before = p.xp; bankRound(p, round({ pts: -40 }));
  ok(p.xp - before >= 10, 'a bad round still pays the 10 XP minimum');
}

console.log('jobs and feats through banking');
{
  const p = newProfile();
  const day = '2026-11-13', jobs = jobsFor(day);
  // play rounds that satisfy anything: survive, as hunter catch many, finish games on top
  let shift = false;
  for (let i = 0; i < 12 && !shift; i++) {
    const hunter = i % 2 === 1;
    const r = bankRound(p, round({
      day, team: hunter ? 'hunter' : 'prop', won: true, survived: !hunter, pts: 600,
      st: stats(hunter ? { k: 3, hi: 12, sh: 12, ct: [i, i + 20, i + 40] } : { hid: i + 1, nh: 1, nr: 40, ta: 9, es: 2, bk: 1, bz: 1, sp: 1 }),
      gameOver: i % 3 === 2, place: 1, players: 6,
    }));
    shift = r.shift;
  }
  ok(shift && p.jobs.done.every(Boolean), `all three jobs done (${jobs.map((j) => j.id).join(', ')}) and the full-shift bonus paid`);
  const coins = p.coins;
  bankRound(p, round({ day, team: 'hunter', won: true, st: stats({ k: 5, hi: 15 }) }));
  ok(p.coins - coins < 200, 'jobs and the shift bonus pay once a day');
  const r = bankRound(p, round({ day: '2026-11-14', survived: true, st: stats() }));
  ok(p.jobs.day === '2026-11-14' && r.jobs.length === 3, 'a new day brings a new board');
  for (let i = 0; stampCount(p) < 10 && i < 30; i++) bankRound(p, round({ day: '2026-11-14', survived: true, st: stats({ hid: 50 - i }) }));
  ok(stampCount(p) >= 10 && p.feats.includes('shopper'), `ten stamps earn Window Shopper (${stampCount(p)} stamps)`);
}
{
  const p = newProfile();
  for (const id of DEPARTMENTS[0].props) p.cat[id] = [1, 0];
  p.cat[DEPARTMENTS[0].props[0]] = [0, 0];
  const r = bankRound(p, round({ survived: true, st: stats({ hid: T(DEPARTMENTS[0].props[0]) }) }));
  ok(r.feats.includes('interior') && r.unlocked.includes('hat.lampshade') && owns(p, 'hat.lampshade'), 'hiding as every piece of furniture earns Interior Designer and the Lampshade');
  p.life.ducks = 9;
  const r2 = bankRound(p, round({ team: 'hunter', st: stats({ qk: 1 }) }));
  ok(r2.feats.includes('quack') && owns(p, 'hat.duck'), 'the tenth duck earns Quack Addict and the Duck Hat');
}
{
  const p = newProfile();
  bankRound(p, round({ gameOver: true, place: 3, players: 3 }));
  ok(p.life.podiums === 0, 'third of three is last place: no podium, as on the server');
  bankRound(p, round({ gameOver: true, place: 1, players: 2 }));
  ok(p.life.podiums === 1 && p.life.champs === 1 && p.life.games === 2, 'first of two is a podium and a game won');
}

console.log('wardrobe');
{
  const p = newProfile();
  ok(!buyItem(p, 'hat.beanie').ok && p.coins === 0, 'cannot buy without the coins');
  p.coins = 1000;
  ok(buyItem(p, 'hat.beanie').ok && p.coins === 850 && owns(p, 'hat.beanie'), 'buying takes the price and adds the item');
  ok(!buyItem(p, 'hat.beanie').ok && p.coins === 850, 'cannot buy twice');
  ok(!buyItem(p, 'hat.crown').ok && !buyItem(p, 'hat.lampshade').ok, 'level and feat items are not for sale');
  ok(!equip(p, 'hat.crown') && equip(p, 'hat.beanie') && p.kit.hat === 'hat.beanie', 'only owned items can be worn');
  const w = kitToWire(p);
  ok(w[1] === HATS.findIndex((h) => h.id === 'hat.beanie') && w[4] === 0, `kit on the wire: ${JSON.stringify(w)}`);
  p.kit.title = 'heir';
  ok(kitToWire(p)[4] === 0, 'a title not earned is not sent');
}

console.log('storage, migration, save codes');
{
  const old = migrateLegacy(150 * 49, 321, 3 * 8 + 5, 'ABCD:7:1');
  ok(xpLevel(old.xp) === 8 && old.coins === 321 && old.paid === 'ABCD:7:1', 'XP, coins and the paid key carry over');
  ok(old.kit.paint === PAINTS[3].id && old.kit.hat === 'hat.crown' && owns(old, 'hat.crown'), 'a level 8 player keeps the crown (it now unlocks at 20) and their colour');
  const low = migrateLegacy(150 * 9, 0, 4, '');
  ok(xpLevel(low.xp) === 4 && low.kit.hat === HATS[0].id, 'a hat their level no longer reaches (top hat at level 4) falls back to the cap');
  const junk = sanitizeProfile({ xp: -5, coins: 'lots', owned: ['hat.viking', 'nope', 7], cat: { duck: [2, 1e99], fake: [1, 1] }, feats: ['shopper', 'x'], kit: { hat: 'hat.crown', title: 'shopper', eyes: 'eyes.monocle' }, jobs: { day: 'today', have: [1], done: [] }, life: { rounds: NaN, catches: 4 } });
  ok(junk.xp === 0 && junk.coins === 0 && junk.owned.join() === 'hat.viking' && !('fake' in junk.cat) && junk.cat.duck[0] === 2 && junk.cat.duck[1] === 1e6, 'junk is dropped or clamped');
  ok(junk.kit.hat === HATS[0].id && junk.kit.eyes === EYES[0].id && junk.kit.title === 'shopper', 'items not owned fall back to the defaults; an earned title stays');
  ok(junk.jobs.day === '' && junk.life.rounds === 0 && junk.life.catches === 4, 'a malformed job board is reset, bad numbers become zero');
  const p = newProfile(); p.xp = 12345; p.coins = 77; p.cat.duck = [3, 1]; p.feats.push('shopper');
  const back = importCode(exportCode(p));
  ok(back && back.since === p.since && back.xp === 12345 && back.coins === 77 && back.cat.duck[0] === 3 && back.feats[0] === 'shopper', 'a save code round-trips');
  ok(importCode('nonsense') === null && importCode('PP1.!!!') === null && importCode('PP1.' + btoa('{"v":2}')) === null, 'bad save codes are refused');
}

console.log('server kit check');
{
  const lim = KIT_LIMITS();
  ok(JSON.stringify(cleanKit(null)) === '[0,0,0,0,0,0,0,0]' && JSON.stringify(cleanKit([1e9, -4, 2.7, 'x', NaN, 99, 1e9, -1])) === JSON.stringify([lim[0] - 1, 0, 2, 0, 0, lim[5] - 1, lim[6] - 1, 0]), 'anything becomes a kit within range');
  ok(JSON.stringify(cleanKit([3, 2, 1, 0, 0])) === '[3,2,1,0,0,0,0,0]', 'a kit from an older client (no character, blaster or trail) gets the defaults');
  ok(lim[KIT.char] === CHARS.length && lim[KIT.gun] === GUNS.length && lim[KIT.trail] === TRAILS.length, 'the hunter slots are on the wire');
}

console.log('hunter looks');
{
  const p = newProfile();
  ok(p.kit.char === CHARS[0].id && p.kit.gun === GUNS[0].id && p.kit.trail === TRAILS[0].id && owns(p, CHARS[0].id) && owns(p, 'char.robot'), 'a new profile is the free character with the free blaster; the robot is free too');
  ok(!equip(p, 'char.mascot') && !buyItem(p, 'char.mascot').ok, 'a character must be bought before it can be worn');
  p.coins = 5000;
  ok(buyItem(p, 'char.mascot').ok && equip(p, 'char.mascot') && p.coins === 1000 && kitToWire(p)[KIT.char] === CHARS.findIndex((c) => c.id === 'char.mascot'), 'buy and wear a character, and it goes on the wire');
  ok(buyItem(p, 'gun.banana').ok && equip(p, 'gun.banana') && kitToWire(p)[KIT.gun] === GUNS.findIndex((g) => g.id === 'gun.banana'), 'buy and wear a blaster');
  ok(!owns(p, 'gun.golden') && !owns(p, 'char.agent'), 'feat blasters and characters are not for sale');
  p.feats.push('champion', 'bloodhound');
  ok(owns(p, 'gun.golden') && owns(p, 'char.agent'), 'the feat unlocks them (also for players who earned it before 2.12)');
  const back = sanitizeProfile(JSON.parse(JSON.stringify(p)));
  ok(back.kit.char === 'char.mascot' && back.kit.gun === 'gun.banana', 'the hunter kit survives a save and load');
  const old = sanitizeProfile({ xp: 0, coins: 0, kit: { paint: PAINTS[2].id, hat: HATS[0].id } });
  ok(old.kit.char === CHARS[0].id && old.kit.gun === GUNS[0].id && old.kit.paint === PAINTS[2].id, 'a 2.11 profile gets the default character and blaster, keeping its paint');
}

console.log(failures ? `\n${failures} FAILED` : '\nall progression checks passed');
process.exit(failures ? 1 : 0);
