/** WebSocket connection with automatic seat-preserving reconnects, or (mode 'practice') a room running in this browser. */
import { PracticeSocket } from './practice/socket';

export type Mode = 'quick' | 'create' | 'join' | 'practice';
export type NetState = 'open' | 'reconnecting' | 'closed';

/**
 * A random id this browser keeps, so the server's statistics can tell ten visits by one person from ten people.
 * It says nothing about who the player is.
 */
function anonId(): string {
  try {
    let id = localStorage.getItem('pp_aid');
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      const b = crypto.getRandomValues(new Uint8Array(12));
      id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('pp_aid', id);
    }
    return id;
  } catch { return ''; }
}

export class Net {
  onMsg: (m: any) => void = () => {};
  onState: (s: NetState, info?: string) => void = () => {};
  /**
   * The server is full and put this connection in line. The socket is handed over (the caller owns it from now on)
   * so this Net is free at once, for a practice game while the line moves.
   */
  onLine: (ws: WebSocket, first: any) => void = () => {};
  /** Connected to a practice room in this browser rather than the server. */
  local = false;
  token = '';
  code = '';
  private ws: WebSocket | null = null;
  private name = '';
  private welcomed = false;
  /** True once the current socket has been welcomed: nothing but the hello may be sent before that. */
  private ready = false;
  private wantClose = false;
  private tries = 0;
  private timer = 0;
  private lastErr = '';

  private url(): string {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  /** `pass`: a seat the line has reserved for this browser. `auth`: a signed-in player's access token (client/src/account.ts). */
  connect(name: string, mode: Mode, code: string | undefined, kit: number[], lvl: number, pass?: string, auth?: string) {
    this.close();
    this.name = name; this.wantClose = false; this.welcomed = false; this.tries = 0; this.token = ''; this.code = ''; this.lastErr = '';
    this.local = mode === 'practice';
    this.open({ t: 'hello', name, mode, code, kit, lvl, aid: this.local ? '' : anonId(), pass, auth: auth || undefined });
  }

  /** Try to reclaim the seat saved by a previous page load. Returns false if there is none. */
  resume(): boolean {
    let seat: any = null;
    try { seat = JSON.parse(sessionStorage.getItem('pp_seat') ?? 'null'); } catch { /* ignore */ }
    if (!seat || typeof seat.code !== 'string' || typeof seat.token !== 'string') return false;
    this.close();
    this.name = String(seat.name ?? 'Player'); this.wantClose = false; this.welcomed = false; this.tries = 0; this.lastErr = '';
    this.code = seat.code; this.token = seat.token; this.local = false;
    this.open({ t: 'hello', name: this.name, mode: 'rejoin', code: seat.code, token: seat.token });
    return true;
  }

  forget() { try { sessionStorage.removeItem('pp_seat'); } catch { /* ignore */ } }

  private open(hello: object) {
    let ws: WebSocket;
    try { ws = this.local ? new PracticeSocket() as unknown as WebSocket : new WebSocket(this.url()); } catch { this.onState('closed', this.local ? 'Practice could not start in this browser.' : 'Could not reach the server.'); return; }
    this.ws = ws; this.ready = false;
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'line' && !this.welcomed) {
        // hand the waiting connection over and forget it
        ws.onmessage = ws.onclose = ws.onerror = null;
        this.ws = null; this.ready = false;
        this.onLine(ws, m);
        return;
      }
      if (m.t === 'welcome') {
        this.welcomed = true; this.ready = true; this.tries = 0; this.token = m.token; this.code = m.code;
        // remembered per tab so an accidental refresh drops you back into your seat (a practice room lives in the tab: nothing to come back to)
        if (!this.local) try { sessionStorage.setItem('pp_seat', JSON.stringify({ code: m.code, token: m.token, name: this.name })); } catch { /* ignore */ }
        this.onState('open');
      }
      if (m.t === 'err') this.lastErr = m.msg;
      this.onMsg(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null; this.ready = false;
      if (this.wantClose) return;
      if (this.lastErr) { this.onState('closed', this.lastErr); return; }
      if (this.local) { this.onState('closed', 'Practice ended.'); return; }
      if (!this.welcomed) { this.onState('closed', 'Could not reach the server.'); return; }
      if (++this.tries > 16) { this.onState('closed', 'Connection lost.'); return; }
      this.onState('reconnecting');
      this.timer = window.setTimeout(() => this.open({ t: 'hello', name: this.name, mode: 'rejoin', code: this.code, token: this.token }), 1500);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  // Held back until the welcome: an input numbered for the old connection, sent on the new one before the game
  // has restarted its count, would leave the server waiting for numbers the client will not reach for minutes.
  send(m: object) { if (this.ws && this.ready && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  close() {
    this.wantClose = true;
    clearTimeout(this.timer);
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
  }
}
