/** Direct server-side checks of round mechanics that are awkward to stage over the network.  Run: npm run test:mechanics */
import { CFG } from '../shared/constants';
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

  console.log(failures ? `\n${failures} FAILED` : '\nAll mechanics checks passed.');
  process.exit(failures ? 1 : 0);
}
main();
