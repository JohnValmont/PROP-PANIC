/** WebSocket connection with automatic seat-preserving reconnects. */
export type NetState = 'open' | 'reconnecting' | 'closed';

export class Net {
  onMsg: (m: any) => void = () => {};
  onState: (s: NetState, info?: string) => void = () => {};
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

  connect(name: string, mode: 'quick' | 'create' | 'join', code: string | undefined, kit: number[], lvl: number) {
    this.close();
    this.name = name; this.wantClose = false; this.welcomed = false; this.tries = 0; this.token = ''; this.code = ''; this.lastErr = '';
    this.open({ t: 'hello', name, mode, code, kit, lvl });
  }

  /** Try to reclaim the seat saved by a previous page load. Returns false if there is none. */
  resume(): boolean {
    let seat: any = null;
    try { seat = JSON.parse(sessionStorage.getItem('pp_seat') ?? 'null'); } catch { /* ignore */ }
    if (!seat || typeof seat.code !== 'string' || typeof seat.token !== 'string') return false;
    this.close();
    this.name = String(seat.name ?? 'Player'); this.wantClose = false; this.welcomed = false; this.tries = 0; this.lastErr = '';
    this.code = seat.code; this.token = seat.token;
    this.open({ t: 'hello', name: this.name, mode: 'rejoin', code: seat.code, token: seat.token });
    return true;
  }

  forget() { try { sessionStorage.removeItem('pp_seat'); } catch { /* ignore */ } }

  private open(hello: object) {
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch { this.onState('closed', 'Could not reach the server.'); return; }
    this.ws = ws; this.ready = false;
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') {
        this.welcomed = true; this.ready = true; this.tries = 0; this.token = m.token; this.code = m.code;
        // remembered per tab so an accidental refresh drops you back into your seat
        try { sessionStorage.setItem('pp_seat', JSON.stringify({ code: m.code, token: m.token, name: this.name })); } catch { /* ignore */ }
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
