/** Direct server-side checks of round mechanics that are awkward to stage over the network.  Run: npm run test:mechanics */
import { CFG, COINS } from '../shared/constants';
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
