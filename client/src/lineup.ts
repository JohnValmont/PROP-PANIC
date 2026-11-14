/**
 * The front of house during the alpha: the live table board on the Play page, the line people join when every seat
 * is taken, and the call that brings them in when their turn comes (the server side is server/gate.ts).
 *
 * The idea is that nobody who opens the game is simply turned away:
 * - the board shows, before anyone presses a button, how many seats are free and which tables are running;
 * - a full server gives you a place in line with a live position, never an error;
 * - while you wait you can play a practice game against bots that runs entirely in your browser;
 * - when a seat frees, it is held for you for half a minute, and you are called in (automatically if you are
 *   just watching the line, with a banner if you are in the middle of practice).
 */
import type { Game } from './game';

export interface Intent { mode: 'quick' | 'create' | 'join'; code: string; }
interface Status {
  seats: number; used: number; reserved: number; line: number; eta: number; hot: boolean;
  publicTables: number; privateTables: number; privateUsed: number; locked: number;
  list: { code: string; pub: boolean; map: string; phase: string; humans: number; bots: number; cap: number }[];
}
interface Hooks {
  /** Take a seat the line reserved: leave practice if need be, then connect with the pass. */
  takeSeat(i: Intent, pass: string): void;
  /** Start (or go back to) a practice game. */
  practice(): void;
  /** Join a public table from the board. */
  joinTable(code: string): void;
  /** Press Play (quick play): the free-table tile does this. */
  quick(): void;
  /** Put this person back in line with the same request (after a missed pass or a dropped connection). */
  requeue(i: Intent): void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const SHORT: Record<string, string> = { "Tumbleton's Emporium": 'Emporium', 'Sunny Meadow': 'Meadow' };
const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

/** "about 3 min", from the server's estimate in seconds. */
function eta(sec: number): string {
  if (sec < 50) return 'under a minute';
  if (sec < 100) return 'about 1 min';
  return `about ${Math.round(sec / 60)} min`;
}

export class Lineup {
  private ws: WebSocket | null = null;
  private intent: Intent | null = null;
  private pos = 0;
  private etaSec = 0;
  private pass = '';
  private passUntil = 0;
  /** True between pressing Join (with a pass) and the server's welcome. */
  claiming = false;
  private status: Status | null = null;
  private pollTimer = 0;
  private lastTouch = Date.now();
  private chipTimer = 0;
  /** Why the line ended without a seat: shown with a button to get back in line. */
  private lost = '';

  constructor(private game: Game, private h: Hooks) {
    $('luPractice').onclick = () => { this.game.sfx.play('click'); this.hideOverlay(); this.h.practice(); };
    $('luLeave').onclick = () => { this.game.sfx.play('click'); this.leave(); };
    $('lcJoin').onclick = $('pSeatBtn').onclick = () => this.claim();
    $('tList').addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLButtonElement>('button.tbl');
      if (!tile || tile.disabled) return;
      if (tile.dataset.code) this.h.joinTable(tile.dataset.code); else this.h.quick();
    });
    for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => { this.lastTouch = Date.now(); }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.poll(); });
    this.poll();
  }

  /** In line, waiting for a seat (or holding one that has not been taken yet). */
  get waiting(): boolean { return !!this.ws; }
  /** A seat is being held for this person right now. */
  get readyNow(): boolean { return !!this.pass && this.passUntil > Date.now(); }

  // ------------------------------------------------------------------------------------------ the table board
  /**
   * The board refreshes every 10 seconds while the Play page is in front of someone, every 30 once they have not
   * touched anything for a few minutes, and not at all during a game or in a background tab.
   */
  private poll() {
    clearTimeout(this.pollTimer);
    const onMenu = !document.body.classList.contains('ingame') && document.visibilityState === 'visible';
    if (onMenu) fetch('/status', { cache: 'no-store' }).then((r) => r.json()).then((s: Status) => { this.status = s; this.renderBoard(); }).catch(() => this.renderBoard());
    const idle = Date.now() - this.lastTouch > 3 * 60_000;
    this.pollTimer = window.setTimeout(() => this.poll(), onMenu ? (idle ? 30_000 : 10_000) : 15_000);
  }

  refresh() { this.poll(); }

  /** The server is (as far as the last look says) full: Play will mean a place in line. */
  private full(): boolean {
    const s = this.status;
    return !!s && (s.hot || s.line > 0 || s.used + s.reserved >= s.seats);
  }

  private renderBoard() {
    const s = this.status;
    if (!s) { $('tSeats').textContent = 'Could not reach the tables'; return; }
    const free = Math.max(0, s.seats - s.used - s.reserved);
    $('tSeats').innerHTML = `<b>${s.used}</b> of ${s.seats} seats taken${s.line ? ` · <b>${s.line}</b> in line` : free ? ` · <b class="tFree">${free} free</b>` : ''}`;
    const tiles: string[] = [];
    // the public tables (enough for every seat), running or free
    const live = s.list.slice(0, Math.max(s.publicTables, s.list.length));
    for (let i = 0; i < Math.max(s.publicTables, live.length); i++) {
      const t = live[i];
      if (!t) { tiles.push(`<button class="tbl free" role="listitem" title="Start a new game here"><b>Open</b><span>Press Play</span></button>`); continue; }
      const pips = Array.from({ length: Math.min(t.cap, 8) }, (_, k) => `<i class="${k < t.humans ? 'on' : ''}"></i>`).join('');
      const full = t.humans >= t.cap;
      tiles.push(`<button class="tbl pub" role="listitem" data-code="${esc(t.code)}" ${full ? 'disabled' : ''} title="${full ? 'This table is full' : 'Join this table'}"><b>${esc(SHORT[t.map] ?? t.map)}</b><span>${esc(t.phase)}</span><em class="pips">${pips}</em></button>`);
    }
    // private rooms: how many are in use, never which
    tiles.push(`<div class="tbl priv" role="listitem" title="Private rooms among friends (Private room button)">${LOCK}<b>Private</b><span>${s.privateUsed} of ${s.privateTables} rooms</span></div>`);
    if (s.locked) tiles.push(`<div class="tbl locked" role="listitem" title="${s.locked} more tables open once the game leaves alpha">${LOCK}<b>Locked</b><span>After alpha</span></div>`);
    $('tList').innerHTML = tiles.join('');
    // phones show only the public tables as tiles; the rest fits on one line
    $('tMore').innerHTML = `${LOCK}<span>Private rooms: ${s.privateUsed} of ${s.privateTables} in use · ${s.locked} more tables after alpha</span>`;
    const full = this.full();
    $('tNote').textContent = s.hot ? 'The server is catching its breath: new seats open in a moment.'
      : full && this.waiting ? 'You are in line: your seat is on its way.' : ''; // the Play card itself says when it is full
    // the Play button says what it will do
    const q = $<HTMLButtonElement>('quickBtn');
    if (!q.disabled) q.textContent = full && !this.waiting ? 'GET IN LINE' : 'PLAY NOW';
    const wait = eta(s.eta);
    $('seatNote').textContent = full && !this.waiting ? `All ${s.seats} seats are taken. Estimated wait: ${wait}. You can practice while you wait.` : '';
  }

  // ------------------------------------------------------------------------------------------ the line
  /** The server put this connection in line: from here on the line owns the socket. */
  adopt(ws: WebSocket, first: any, intent: Intent) {
    this.drop();
    this.ws = ws; this.intent = intent; this.pass = ''; this.passUntil = 0; this.claiming = false; this.lost = '';
    ws.onmessage = (e) => { let m: any; try { m = JSON.parse(e.data); } catch { return; } this.onMsg(m); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      // closed after a successful claim is normal; otherwise the place is gone
      if (!this.claiming) this.lose(this.lost || 'The connection dropped and you lost your place in line.');
    };
    this.onMsg(first);
    this.showOverlay();
  }

  private onMsg(m: any) {
    if (m.t === 'line') {
      this.pos = m.pos; this.etaSec = Number(m.eta) || 0;
      $('luPos').textContent = `#${m.pos}`;
      $('luEta').textContent = `Estimated wait: ${eta(m.eta)}`;
      $('luFill').style.width = `${Math.min(100, Math.round((m.used / Math.max(1, m.seats)) * 100))}%`;
      $('luSeats').textContent = `${m.used} of ${m.seats} seats in use · ${m.size} waiting`;
      const full = m.used >= m.seats;
      $('luTitle').textContent = full ? 'All seats are taken' : 'One moment';
      $('luMsg').innerHTML = (m.hot && !full ? '<b>The server is busy catching up</b>, so new players wait a moment. ' : '')
        + `PROP PANIC is in <b>alpha</b> and runs on one small free server, so only <b>${m.seats} people</b> can play at once${full ? `, and all ${m.seats} seats are taken` : ''}. `
        + 'Keep this tab open: when your turn comes, you will be seated automatically.';
      this.renderChip();
    } else if (m.t === 'ready') {
      this.pass = String(m.pass); this.passUntil = Date.now() + Number(m.ms || 30_000);
      this.game.sfx.play('ready');
      // just watching the line: go straight in. Practising: call them, and hand the mouse back so they can answer.
      if (!$('lineup').classList.contains('hidden')) { this.claim(); return; }
      if (document.pointerLockElement) document.exitPointerLock();
      this.renderChip();
      clearInterval(this.chipTimer);
      this.chipTimer = window.setInterval(() => this.renderChip(), 500);
    } else if (m.t === 'missed') {
      this.lost = 'Your seat was held for 30 seconds and then went to the next person in line.';
    } else if (m.t === 'err') {
      this.lost = String(m.msg ?? '');
    }
  }

  /** Take the seat that is being held. */
  claim() {
    if (!this.readyNow || !this.intent || this.claiming) return;
    this.claiming = true;
    clearInterval(this.chipTimer);
    this.hideOverlay(); this.hideChip();
    this.h.takeSeat(this.intent, this.pass);
  }

  /** The server welcomed us into a game: the line's job is done. */
  seated() {
    this.claiming = false; this.pass = '';
    this.drop();
    this.hideOverlay(); this.hideChip();
  }

  /** Connecting with the pass failed: forget the line (the place was used up by the attempt). */
  claimFailed() { this.claiming = false; this.pass = ''; this.drop(); this.hideChip(); }

  leave() {
    try { this.ws?.send(JSON.stringify({ t: 'leave' })); } catch { /* closing */ }
    this.drop();
    this.hideOverlay(); this.hideChip();
    this.poll();
  }

  private drop() {
    clearInterval(this.chipTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onmessage = ws.onclose = null; try { ws.close(); } catch { /* ignore */ } }
  }

  /** The line ended without a seat: say why, and offer to get back in it. */
  private lose(why: string) {
    clearInterval(this.chipTimer);
    this.pass = '';
    const i = this.intent;
    if (document.body.classList.contains('ingame')) {
      // in practice: a quiet note in the corner, with the button to rejoin
      $('lcTxt').textContent = why;
      $('lcJoin').textContent = 'Get back in line';
      $('lcJoin').onclick = () => { if (i) this.h.requeue(i); this.hideChip(); $('lcJoin').onclick = () => this.claim(); };
      $('lineChip').className = 'lost';
      return;
    }
    this.hideOverlay();
    const err = $('menuError');
    err.textContent = why;
    this.poll();
  }

  // ------------------------------------------------------------------------------------------ views
  showOverlay() { if (this.ws && !this.claiming) $('lineup').classList.remove('hidden'); this.hideChip(); }
  private hideOverlay() { $('lineup').classList.add('hidden'); }
  private hideChip() { $('lineChip').className = 'hidden'; $('pSeatBtn').classList.add('hidden'); }

  /** The chip that rides along during practice: your place in line, then the call to come in. */
  renderChip() {
    const playing = document.body.classList.contains('ingame');
    if (!this.ws || !playing || this.claiming) { if (!this.lost || !playing) this.hideChip(); return; }
    const chip = $('lineChip');
    if (this.readyNow) {
      const left = Math.max(0, Math.ceil((this.passUntil - Date.now()) / 1000));
      $('lcTxt').innerHTML = `<b>Your seat is ready!</b> Held for you for ${left}s`;
      $('lcJoin').textContent = 'Join now';
      chip.className = 'ready';
      $('pSeatBtn').classList.remove('hidden');
      $('pSeatBtn').textContent = `Take your seat (${left}s)`;
    } else {
      $('lcTxt').innerHTML = `In line for a seat: <b>#${this.pos}</b> · ${eta(this.etaSec)}`;
      chip.className = 'waiting';
      $('pSeatBtn').classList.add('hidden');
    }
  }
}
