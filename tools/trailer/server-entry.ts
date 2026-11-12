/**
 * The real game server under a virtual clock, plus a director channel for the capture script.
 * Started with child_process.fork, so it talks over IPC:
 *   { id, cmd: 'advance', ms }   move game time forward
 *   { id, cmd: 'eval', code }    run a staging snippet with `room`, `rooms`, `CFG`, ... in scope
 * Nothing here changes game rules: it only decides when time passes and sets up scenes.
 */
import { advance, clockNow, reseed } from './clock';
import { Room } from '../../server/room';
import { CFG, CHAOS_WEIGHTS, SCORE } from '../../shared/constants';
import { PROPS, PROP_INDEX, propBody } from '../../shared/props';
import '../../server/index'; // its first tick only runs on the first advance, after the hook below

const rooms = new Set<Room>();
const tick = Room.prototype.tick;
Room.prototype.tick = function (this: Room) { rooms.add(this); return tick.call(this); };

const scope: Record<string, unknown> = { rooms, CFG, CHAOS_WEIGHTS, SCORE, PROPS, PROP_INDEX, propBody, advance, clockNow, reseed, H: {} };
Object.assign(globalThis, { __dir: scope });

process.on('message', (m: any) => {
  let out: unknown = null, error: string | null = null;
  try {
    if (m.cmd === 'advance') { advance(m.ms); out = clockNow(); }
    else if (m.cmd === 'eval') {
      const room = [...rooms].find((r) => !r.closed) ?? null;
      // eslint-disable-next-line no-new-func
      out = new Function('room', 'S', `with (S) { return (() => { ${m.code} })(); }`)(room, scope) ?? null;
    }
  } catch (e) { error = String((e as Error)?.stack ?? e); }
  process.send!({ id: m.id, out, error });
});
