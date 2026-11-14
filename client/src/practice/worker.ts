/**
 * Practice room: the real game server's room (server/room.ts), running in a Web Worker in the player's own browser,
 * against bots. It costs the server nothing, so anyone waiting for a seat can play while they wait.
 * Messages are the same JSON strings the server would send over a WebSocket (see ./socket.ts).
 */
import './shims';
import { CFG } from '../../../shared/constants';
import { cleanKit } from '../../../shared/progress';
import { Room, type Player } from '../../../server/room';

let room: Room | null = null;
let me: Player | null = null;
let timer = 0;

/** What the room believes is a WebSocket. */
const sock = {
  readyState: 1,
  bufferedAmount: 0,
  send(s: string) { if (sock.readyState === 1) postMessage(s); },
  close() { if (sock.readyState !== 1) return; sock.readyState = 3; clearInterval(timer); postMessage({ closed: true }); },
  terminate() { sock.close(); },
};

const name = (raw: unknown) => {
  const s = (typeof raw === 'string' ? raw : '').replace(/[\p{Cc}\p{Cf}<>&"'`\\]/gu, '').trim();
  return Array.from(s).slice(0, 16).join('') || 'Player';
};

onmessage = (e: MessageEvent) => {
  let m: any;
  try { m = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!m || typeof m !== 'object') return;
  try {
    if (room && me) { room.onMessage(me, m); return; }
    if (m.t !== 'hello') return;
    room = new Room('SOLO', false);
    room.botsWanted = 5; // a full-feeling game straight away; the host can change it in the lobby
    const lvl = typeof m.lvl === 'number' && Number.isFinite(m.lvl) ? Math.max(1, Math.min(999, Math.floor(m.lvl))) : 1;
    me = room.addPlayer(name(m.name), sock as any, false, cleanKit(m.kit), lvl, '');
    timer = setInterval(() => {
      try { room!.tick(); } catch (err) { console.error('[practice] tick failed', err); }
    }, 1000 / CFG.TICK) as unknown as number;
  } catch (err) {
    console.error('[practice] failed', err);
    sock.close();
  }
};
