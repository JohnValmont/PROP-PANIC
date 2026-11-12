/** Direct server-side checks of round mechanics that are awkward to stage over the network.  Run: npm run test:mechanics */
import { CFG, COINS, SCORE } from '../shared/constants';
import { aimDir } from '../shared/physics';
import { PROPS } from '../shared/props';
import { Room } from '../server/room';

let failures = 0;
const ok = (c: unknown, label: string) => { if (c) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  CFG.HIDE_MS = 50; CFG.ESCAPE_MS = 150;
  const room = new Room('TEST', false);
  const sent: any[] = [];
  const ws = { readyState: 1, send: (s: string) => { const m = JSON.parse(s); if (m.t === 'ev') sent.push(m); }, close() {} } as any;
  const a = room.addPlayer('A', ws, false, 9), b = room.addPlayer('B', ws, false, 0), c = room.addPlayer('C', ws, false, 0);
  room.startRound();
  await sleep(80); room.tick();
  ok(room.phase === 'hunt', 'round reaches the hunt phase');
  const all = [a, b, c];
  const hunter = all.find((p) => p.team === 'hunter')!, props = all.filter((p) => p.team === 'prop');
  ok(props.length === 2 && room.roster().find((r) => r.id === a.id)!.look === 9, 'roles assigned; cosmetic look is carried in the roster');

  // bonk: a prop falling onto the hunter's head stuns the hunter and bounces the prop
  const p = props[0];
  p.body.x = hunter.body.x; p.body.z = hunter.body.z; p.body.y = hunter.body.y + CFG.HUNTER_H + 0.1; p.body.vy = -4; p.body.ground = false;
  room.tick();
  ok(hunter.bonkUntil > room.now && p.body.vy > 5 && sent.some((m) => m.k === 'bonk'), 'landing on a hunter bonks them and bounces the prop');
  const shots = hunter.stats.shots;
  room.fire(hunter, 0, 0, room.now);
  ok(hunter.stats.shots === shots, 'a bonked hunter cannot fire');
  p.body.vy = -4; p.body.y = hunter.body.y + CFG.HUNTER_H + 0.1; hunter.bonkUntil = 0;
  room.tick();
  ok(hunter.bonkUntil === 0, 'bonk has a cooldown per prop');

  // escape bonus: survive a hit long enough
  p.escapeAt = room.now + 1; const pts = p.stats.pts;
  await sleep(30); room.tick();
  ok(p.stats.escapes === 1 && p.stats.pts >= pts + 40, 'surviving after a hit pays the escape bonus');

  // sneeze chaos event launches real props
  for (let i = 0; i < 40 && !sent.some((m) => m.k === 'sneeze'); i++) { room.chaos = 100; (room as any).event = null; (room as any).lastEventKind = ''; room.tick(); }
  ok(sent.some((m) => m.k === 'sneeze'), 'chaos can roll the sneeze event');

  // last prop standing
  props[1].alive = false; (room as any).firstDeath = props[1].id;
  p.cd.ghost = room.now + 99999;
  room.tick();
  ok(sent.some((m) => m.k === 'last' && m.who === p.id) && p.cd.ghost <= room.now, 'last prop standing is announced and gets abilities recharged');

  // reconnecting must not leave a player frozen: the client restarts its input numbering
  {
    const r2 = new Room('RECO', false);
    const w2 = { readyState: 1, send() {}, close() {} } as any;
    const q = r2.addPlayer('Q', w2, false, 0);
    r2.onMessage(q, { t: 'in', c: [[900, 0.02, 0, 1, 0, 0, 0, 0]] });
    ok(q.ack === 900, 'inputs are acknowledged in order');
    r2.reattach(q.token, w2);
    await sleep(60);
    const z0 = q.body.z;
    r2.onMessage(q, { t: 'in', c: [[1, 0.03, 0, 1, 0, 0, 0, 0], [2, 0.03, 0, 1, 0, 0, 0, 0]] });
    ok(q.ack === 2 && q.body.z !== z0, 'after a reconnect the first inputs move the player again (not ignored as old)');
    // the race that froze real players: an input still carrying the old numbering reaches the new socket first
    r2.reattach(q.token, w2);
    await sleep(60);
    r2.onMessage(q, { t: 'in', c: [[950, 0.02, 0, 1, 0, 0, 0, 0]] });
    await sleep(60);
    const z1 = q.body.z;
    r2.onMessage(q, { t: 'in', c: [[1, 0.03, 0, 1, 0, 0, 0, 0], [2, 0.03, 0, 1, 0, 0, 0, 0]] });
    ok(q.ack === 2 && q.body.z !== z1, 'a stale input arriving after the reconnect cannot freeze the player');
    // wedged inside a wall: the server frees the player by itself
    q.body.x = -24.3; q.body.z = 0; q.body.y = 0;
    for (let i = 0; i < 20; i++) r2.tick();
    ok((r2 as any).world.fits(q.body.x, q.body.y + 0.02, q.body.z, q.body.hw - 0.02, q.body.h - 0.04), 'a player stuck inside a wall is moved to free space');
  }

  // ---- 2.5: haunting. A caught prop rattles an innocent object; a hunter who shoots it is spooked.
  {
    CFG.HIDE_MS = 30;
    const h = new Room('HANT', false);
    const evs: any[] = [];
    const w = { readyState: 1, bufferedAmount: 0, send: (s: string) => { const m = JSON.parse(s); if (m.t === 'ev') evs.push(m); }, close() {}, terminate() {} } as any;
    const q = { readyState: 1, bufferedAmount: 0, send() {}, close() {}, terminate() {} } as any;
    const ps = [h.addPlayer('H1', w), h.addPlayer('H2', q), h.addPlayer('H3', q)];
    h.startRound(); await sleep(50); h.tick();
    const hunter = ps.find((p) => p.team === 'hunter')!, [ghost, live] = ps.filter((p) => p.team === 'prop');
    // find an object the hunter has a clear shot at
    let target = -1, yaw = 0, pitch = 0;
    for (const d of h.map.decor) {
      if (d.y !== 0 || !h.world.fits(d.x, 0, d.z + 2.2, 0.32, 1.75)) continue;
      hunter.body.x = d.x; hunter.body.z = d.z + 2.2; hunter.body.y = 0;
      const dx = d.x - hunter.body.x, dy = d.y + PROPS[d.type].h / 2 - CFG.HUNTER_EYE, dz = d.z - hunter.body.z;
      yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const [ax, ay, az] = aimDir(yaw, pitch);
      if (h.world.raycast(hunter.body.x, CFG.HUNTER_EYE, hunter.body.z, ax, ay, az, 10).decor === d.id) { target = d.id; break; }
    }
    ok(target >= 0, 'found an object in the hunter\'s line of fire');
    for (const p of [ghost, live]) { p.body.x = hunter.body.x + 8; p.body.z = hunter.body.z + 8; }
    h.haunt(live, target);
    ok(!h.haunted.size, 'a prop still hiding cannot haunt');
    h.haunt(hunter, target);
    ok(!h.haunted.size, 'a hunter cannot haunt');
    ghost.alive = false; ghost.cd.haunt = 0;
    h.haunt(ghost, target);
    ok(h.haunted.get(target)?.by === ghost.id && evs.some((m) => m.k === 'haunt' && m.d === target && m.by === ghost.id), 'a caught prop haunts an object and everyone is told');
    const other = h.map.decor.find((d) => d.id !== target)!.id;
    h.haunt(ghost, other);
    ok(!h.haunted.has(other), 'haunting has a cooldown');
    const focus = hunter.focus, pts = ghost.stats.pts;
    hunter.nextFireAt = 0;
    h.fire(hunter, yaw, pitch, h.now);
    ok(evs.some((m) => m.k === 'spook' && m.by === hunter.id && m.ghost === ghost.id), 'shooting a haunted object spooks the hunter');
    ok(Math.round(focus - hunter.focus) === CFG.FOCUS_SPOOK - CFG.FOCUS_HIT * 0 && ghost.stats.spooks === 1 && ghost.stats.pts === pts + SCORE.spook, `the hunter loses ${CFG.FOCUS_SPOOK} focus and the ghost scores ${SCORE.spook}`);
    ok(!h.haunted.has(target), 'a haunting pays out once');
    hunter.nextFireAt = 0; const f2 = hunter.focus;
    h.fire(hunter, yaw, pitch, h.now);
    ok(Math.round(f2 - hunter.focus) === CFG.FOCUS_MISS, 'the same object shot again is just an innocent object');
    CFG.HAUNT_ON = false; ghost.cd.haunt = 0;
    h.haunt(ghost, other);
    ok(!h.haunted.has(other), 'HAUNT_ON = false switches haunting off');
    CFG.HAUNT_ON = true;
  }

  // ---- 2.5: what hunters are not told. Decoys, puffs of smoke and hiding-phase taunts used to reach every client.
  {
    CFG.HIDE_MS = 400;
    const r = new Room('LEAK', false);
    const inbox = new Map<string, any[]>();
    const sock = (n: string) => ({ readyState: 1, bufferedAmount: 0, send: (s: string) => { let l = inbox.get(n); if (!l) inbox.set(n, (l = [])); l.push(JSON.parse(s)); }, close() {}, terminate() {} }) as any;
    const ps = [r.addPlayer('A', sock('A')), r.addPlayer('B', sock('B')), r.addPlayer('C', sock('C'))];
    r.startRound(); r.tick();
    const hunter = ps.find((p) => p.team === 'hunter')!, prop = ps.find((p) => p.team === 'prop')!, mate = ps.find((p) => p.team === 'prop' && p !== prop)!;
    const got = (p: typeof prop, k: string) => (inbox.get(p.name) ?? []).filter((m) => m.t === 'ev' && m.k === k);
    r.taunt(prop, 0);
    ok(got(mate, 'taunt').length === 1 && got(hunter, 'taunt').length === 0, 'a taunt while the props hide is not sent to the blindfolded hunter');
    await sleep(450); r.tick();
    ok(r.phase === 'hunt', 'hunt begins');
    // hunter and prop on opposite sides of the emporium partition wall at x = -10.5
    hunter.body.x = -8; hunter.body.z = -1.5; hunter.body.y = 0; hunter.body.vx = hunter.body.vz = 0;
    prop.body.x = -14; prop.body.z = -1.5; prop.body.y = 0; prop.body.vx = prop.body.vz = 0;
    for (let i = 0; i < 30; i++) { r.tick(); await sleep(30); }
    inbox.clear();
    r.ability(prop, 'decoy');
    const near = r.map.decor.find((d) => Math.hypot(d.x - prop.body.x, d.z - prop.body.z) < 4 && d.type !== prop.disguise);
    if (near) { prop.nextTransformAt = 0; r.transform(prop, near.id); }
    for (let i = 0; i < 5; i++) { r.tick(); await sleep(30); }
    ok(got(mate, 'decoy').length === 1 && got(hunter, 'decoy').length === 0, 'a decoy planted out of sight is not announced to the hunter');
    ok(!near || (got(mate, 'poof').length >= 1 && got(hunter, 'poof').length === 0), 'nor is the puff of a prop changing shape behind a wall');
    const decoy = r.decoys[0];
    hunter.body.x = decoy.x + 1.5; hunter.body.z = decoy.z; // walk round the wall
    for (let i = 0; i < 12; i++) { r.tick(); await sleep(30); }
    const seen = got(hunter, 'decoy');
    ok(seen.length === 1 && seen[0].id === decoy.id && seen[0].owner === 0, 'it reaches the hunter once in view, without saying whose it is');
  }

  // ---- 2.5: a hunter who drops out hands over to a bot instead of handing the props a free round
  {
    CFG.HIDE_MS = 20; CFG.HUNT_MS = 60_000; const dcMs = CFG.HUNTER_DC_MS; CFG.HUNTER_DC_MS = 40;
    const r = new Room('BNCH', false);
    const q = { readyState: 1, bufferedAmount: 0, send() {}, close() {}, terminate() {} } as any;
    const a = r.addPlayer('A', q), b = r.addPlayer('B', q);
    r.botsWanted = 2; (r as any).balanceBots();
    // roles are random: deal again until a human hunts
    for (let i = 0; i < 40; i++) { (r as any).toLobby(); r.startRound(); if (a.team === 'hunter' || b.team === 'hunter') break; }
    await sleep(30); r.tick();
    const hunter = [...r.players.values()].find((p) => p.team === 'hunter')!;
    ok(hunter.human, 'a human is the hunter');
    const other = hunter === a ? b : a;
    r.disconnect(hunter);
    await sleep(60); r.tick(); r.tick();
    const sub = [...r.players.values()].find((p) => p.team === 'hunter');
    ok(r.phase === 'hunt' && !!sub && !!sub.bot && hunter.team === 'spec', `the round goes on with a bot hunting (${sub?.name})`);
    ok(other.team === 'prop' && other.alive, 'the human prop keeps their hiding place');
    CFG.HUNTER_DC_MS = dcMs;
  }

  // a game is a fixed number of rounds: scores run across it, the last round settles it, then it is back to the lobby
  {
    CFG.HIDE_MS = 15; CFG.HUNT_MS = 30; CFG.END_MS = 15; CFG.FINAL_MS = 15;
    const g = new Room('GAME', false);
    const ends: any[] = [], lobbies: any[] = [];
    const w = { readyState: 1, send: (s: string) => { const m = JSON.parse(s); if (m.t === 'phase' && m.phase === 'end') ends.push(m); if (m.t === 'lobby') lobbies.push(m); }, close() {} } as any;
    const quiet = { readyState: 1, send() {}, close() {} } as any; // only the host's socket records, or every message would be counted three times
    const host = g.addPlayer('H', w, false, 0), guest = g.addPlayer('I', quiet, false, 0);
    g.addPlayer('J', quiet, false, 0);
    ok(g.roundsPref === 3, 'a game is three rounds unless the host says otherwise');
    g.onMessage(host, { t: 'rounds', n: 4 }); g.onMessage(host, { t: 'rounds', n: 'x' }); g.onMessage(host, { t: 'rounds', n: 1e9 });
    ok(g.roundsPref === 3, 'a game length that is not on offer is refused');
    g.onMessage(guest, { t: 'rounds', n: 5 });
    ok(g.roundsPref === 3, 'only the host chooses the game length');
    g.onMessage(host, { t: 'rounds', n: 5 }); g.onMessage(host, { t: 'rounds', n: 3 });
    ok(g.roundsPref === 3 && lobbies.at(-1)?.rounds === 3 && lobbies.some((m) => m.rounds === 5), 'the host can change it, and the lobby is told');
    const pub = new Room('PUBL', true);
    const ph = pub.addPlayer('P', quiet, false, 0);
    pub.onMessage(ph, { t: 'rounds', n: 10 });
    ok(pub.roundsPref === 3, 'public games are always three rounds');

    const play = async () => {
      const first = ends.length, hunters = new Set<number>();
      g.startRound();
      for (let i = 0; i < 400 && g.phase !== 'lobby'; i++) {
        await sleep(5); g.tick();
        for (const p of g.players.values()) if (p.team === 'hunter') hunters.add(p.id);
      }
      return { ends: ends.slice(first), hunters };
    };
    const g1 = await play();
    // changing the length mid-game must not cut the game in progress short (checked on game 2 below)
    ok(g1.ends.length === 3 && g1.ends.map((m) => m.round).join() === '1,2,3' && g1.ends.every((m) => m.rounds === 3 && m.results.rounds === 3), 'a three-round game plays rounds 1, 2 and 3');
    ok(g.phase === 'lobby' && g.round === 0, 'after the last round everybody is back in the lobby');
    ok(g1.hunters.size === 3, 'with three players and three rounds, everyone hunts once');
    ok(!g1.ends[0].results.final && !g1.ends[1].results.final && g1.ends[2].results.final?.length === 3, 'only the last round carries the final standings');
    const fin = g1.ends[2].results.final;
    ok(fin[0].total >= fin[1].total && fin[1].total >= fin[2].total, 'final standings are ordered by total score');
    ok(fin.map((r: any) => r.coins).join() === [COINS.game + COINS.place[0], COINS.game + COINS.place[1], COINS.game].join(), `finishing pays everyone, the podium pays extra, last place gets no podium bonus (${fin.map((r: any) => r.coins).join(' / ')})`);
    const b0 = g1.ends[0].results;
    const expect = (r: any) => Math.max(COINS.round, Math.min(COINS.roundCap, COINS.round + Math.floor(r.round / COINS.perPoints))) + ((r.team === 'hunter') === (b0.winner === 'hunters') ? COINS.win : 0);
    ok(b0.board.length === 3 && b0.board.every((r: any) => Number.isInteger(r.coins) && r.coins === expect(r) && r.coins <= COINS.roundCap + COINS.win), `each round pays coins from the points scored, capped, plus a win bonus (${b0.board.map((r: any) => `${r.round} pts → ${r.coins}`).join(', ')})`);
    ok(g1.ends.map((m) => m.results.n).join() === '1,2,3', 'rounds are numbered across the room, so a reward is banked once');
    ok(fin.some((r: any) => r.total > 0), 'scores run across the rounds of a game');

    g.onMessage(host, { t: 'rounds', n: 1 });
    g.startRound();
    ok([...g.players.values()].every((p) => p.score === 0) && g.rounds === 1, 'a new game starts everyone on zero, at the length the host picked');
    g.onMessage(host, { t: 'rounds', n: 10 });
    for (let i = 0; i < 200 && g.phase !== 'lobby'; i++) { await sleep(5); g.tick(); }
    ok(ends.length === 4 && ends[3].results.final && ends[3].results.n === 4 && ends[3].rounds === 1 && g.phase === 'lobby', 'a one-round game ends after its only round, even if the host changes the length while it runs');
    ok(g.roundsPref === 10, 'the change applies to the next game');
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll mechanics checks passed.');
  process.exit(failures ? 1 : 0);
}
main();
