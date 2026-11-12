/** DOM overlay: timers, role card, abilities, feed, banners, lobby/results panels. No game logic lives here. */
import { QUICK_CHAT, type Phase, type Team } from '../../shared/constants';
import type { Results, RosterEntry } from '../../shared/protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface AbilityView { key: string; name: string; icon: string; left: number; total: number; active?: boolean; }

const TIPS = [
  'Shooting innocent objects drains your FOCUS. Hit zero and you spend 6 seconds as a rubber duck.',
  'Your Scanner (Q) only catches props that MOVE while the ring passes over them.',
  'Shockwave (F) launches real props into the air. Innocent objects never flinch.',
  'Every 22 seconds all props are forced to squeak. Listen for where it comes from.',
  'Decoys squeak too. Shoot one and you get flash-blinded.',
  'The PROP-O-METER warms up when any prop is within a few metres.',
  'A vase facing the wrong way on a tidy shelf is probably not a vase.',
];

export class Hud {
  root = $('hud');
  private bannerTimer = 0;
  private lastTimer = '';
  private abKey = '';
  private tipI = Math.floor(Math.random() * TIPS.length);
  private lastTipAt = 0;

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }

  setPhase(phase: Phase, round: number, panic: boolean) {
    const label = phase === 'lobby' ? 'LOBBY' : phase === 'hiding' ? `ROUND ${round} · HIDE!` : phase === 'hunt' ? (panic ? 'PANIC TIME!' : `ROUND ${round} · HUNT`) : 'ROUND OVER';
    $('phaseLabel').textContent = label;
    $('phaseBox').classList.toggle('panic', panic && phase === 'hunt');
    $('panicFrame').classList.toggle('on', panic && phase === 'hunt');
    $('chaosWrap').style.visibility = phase === 'hunt' ? 'visible' : 'hidden';
    $('counts').style.visibility = phase === 'hunt' || phase === 'hiding' ? 'visible' : 'hidden';
  }

  setTimer(ms: number, show: boolean) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const txt = show ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '';
    if (txt !== this.lastTimer) { this.lastTimer = txt; $('timer').textContent = txt; }
  }

  setCounts(props: number) { $('propsAlive').textContent = String(props); }
  setChaos(v: number) { ($('chaosBar').firstElementChild as HTMLElement).style.width = `${v}%`; $('chaosWrap').classList.toggle('hot', v >= 85); }

  setRole(team: Team, alive: boolean, name: string, bar: number, lobby: boolean) {
    const el = $('role');
    el.style.display = alive ? 'block' : 'none';
    el.className = team === 'hunter' ? 'hunter' : 'prop';
    $('roleTeam').textContent = lobby ? 'WARMING UP AS' : team === 'hunter' ? 'HUNTER · FOCUS' : 'PROP · DISGUISED AS';
    $('roleName').textContent = name;
    ($('roleBar').firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, bar))}%`;
    $('roleBar').style.display = lobby ? 'none' : 'block';
  }

  setAbilities(list: AbilityView[]) {
    const el = $('abilities');
    const key = list.map((a) => a.key + a.name).join('|');
    if (key !== this.abKey) {
      this.abKey = key;
      el.innerHTML = list.map((a) => `<div class="ab"><span class="k">${esc(a.key)}</span><div class="ic">${a.icon}</div><div class="cd"></div><div class="sec"></div><div class="nm">${esc(a.name)}</div></div>`).join('');
    }
    list.forEach((a, i) => {
      const n = el.children[i] as HTMLElement;
      const ready = a.left <= 0;
      n.classList.toggle('ready', ready && !a.active);
      n.classList.toggle('active', !!a.active);
      (n.children[2] as HTMLElement).style.height = ready ? '0%' : `${Math.min(100, (a.left / a.total) * 100)}%`;
      const sec = ready ? '' : String(Math.ceil(a.left / 1000));
      if (n.children[3].textContent !== sec) n.children[3].textContent = sec;
      (n.children[1] as HTMLElement).style.opacity = ready ? '1' : '0.25';
    });
  }

  crosshair(mode: 'hunter' | 'prop' | 'none') { const c = $('crosshair'); c.style.display = mode === 'none' ? 'none' : 'block'; c.classList.toggle('prop', mode === 'prop'); }
  hitmark(color: string) { const h = $('hitmark'); h.style.color = color; h.classList.remove('show'); void h.offsetWidth; h.classList.add('show'); }

  prompt(html: string | null) { const p = $('prompt'); if (html === null) { if (p.style.display !== 'none') p.style.display = 'none'; return; } p.style.display = 'block'; if (p.innerHTML !== html) p.innerHTML = html; }
  hint(text: string | null) { const h = $('hint'); h.style.display = text ? 'block' : 'none'; if (text && h.textContent !== text) h.textContent = text; }
  /** Ghost strip: who the camera is attached to (or that it is flying free). `hint` is trusted markup. */
  spectate(v: { head: string; label: string; name: string; team: Team | null; note: string; hint: string } | null) {
    const h = $('spectate');
    h.style.display = v ? 'block' : 'none';
    if (!v) return;
    const tag = v.team === 'hunter' ? '<span class="tag h">HUNTER</span>' : v.team === 'prop' ? '<span class="tag p">PROP</span>' : '';
    const html = `<div class="spHead">${esc(v.head)}</div><div class="spWho">${esc(v.label)}${v.name ? ` <b>${esc(v.name)}</b>${tag}` : ''}${v.note ? ` <i>${esc(v.note)}</i>` : ''}</div><div class="spHint">${v.hint}</div>`;
    if (html !== this.specKey) { this.specKey = html; h.innerHTML = html; }
  }
  private specKey = '';
  meter(v: number | null) { const m = $('meter'); m.style.display = v === null ? 'none' : 'block'; if (v !== null) (m.querySelector('i') as HTMLElement).style.width = `${Math.round(v * 100)}%`; }
  objective(text: string) { const o = $('objective'); o.style.display = text ? 'block' : 'none'; if (text && o.textContent !== text) o.textContent = text; }
  help(html: string | null) { const o = $('help'); o.style.display = html ? 'grid' : 'none'; if (html && this.helpKey !== html) { this.helpKey = html; o.innerHTML = html; } }
  private helpKey = '';
  freeze(on: boolean) { $('freeze').style.display = on ? 'block' : 'none'; }
  revealed(on: boolean) { $('revealed').style.display = on ? 'block' : 'none'; }

  banner(title: string, sub = '', cls = '', ms = 2600) {
    const b = $('banner');
    $('bannerTitle').textContent = title; $('bannerSub').textContent = sub;
    b.className = '';
    void b.offsetWidth;
    b.className = `show ${cls}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (b.className = `hide ${cls}`), ms);
  }

  popup(text: string, bad = false) {
    const p = document.createElement('div');
    p.className = 'popup' + (bad ? ' bad' : '');
    p.textContent = text;
    p.style.top = `${-$('popups').childElementCount * 26}px`;
    $('popups').appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }

  /** parts: plain strings are escaped; {b: 'name'} is rendered bold. */
  feed(parts: (string | { b: string })[], cls = '') {
    const f = $('feed');
    const d = document.createElement('div');
    d.className = 'feedItem ' + cls;
    d.innerHTML = parts.map((p) => (typeof p === 'string' ? esc(p) : `<b>${esc(p.b)}</b>`)).join('');
    f.appendChild(d);
    while (f.childElementCount > 6) f.firstElementChild!.remove();
    setTimeout(() => d.remove(), 6000);
  }

  hurt() { const v = $('vignette'); v.classList.add('hit'); setTimeout(() => v.classList.remove('hit'), 90); }
  blind(ms: number) {
    const b = $('blind');
    b.textContent = 'BAMBOOZLED!';
    b.style.transition = 'none'; b.style.opacity = '1';
    setTimeout(() => { b.style.transition = `opacity ${ms * 0.5}ms ease-in`; b.style.opacity = '0'; }, ms * 0.5);
  }

  blindfold(show: boolean, msLeft = 0) {
    const b = $('blindfold');
    b.style.display = show ? 'flex' : 'none';
    if (!show) return;
    $('bfCount').textContent = String(Math.max(0, Math.ceil(msLeft / 1000)));
    const now = performance.now();
    if (now - this.lastTipAt > 4500) { this.lastTipAt = now; $('bfTip').textContent = 'TIP: ' + TIPS[this.tipI++ % TIPS.length]; }
  }

  private tags(r: { team: Team; bot?: boolean }, alive = true): string {
    return (r.team === 'hunter' ? '<span class="tag h">HUNTER</span>' : r.team === 'prop' ? (alive ? '<span class="tag p">PROP</span>' : '<span class="tag b">CAUGHT</span>') : '<span class="tag s">WATCHING</span>') + (r.bot ? '<span class="tag b">BOT</span>' : '');
  }

  lobby(show: boolean, o?: { code: string; pub: boolean; roster: RosterEntry[]; me: number; host: boolean; bots: number; countdown: number; canStart: boolean; map: number }) {
    const el = $('lobby');
    el.style.display = show ? 'flex' : 'none';
    if (!show || !o) return;
    $('lobbyCode').textContent = o.code;
    const mb = $('mapBtn');
    mb.style.display = !o.pub && o.host ? 'block' : 'none';
    const mt = `Map: ${['Alternate', 'Emporium', 'Sunny Meadow'][o.map] ?? 'Alternate'}`;
    if (mb.textContent !== mt) mb.textContent = mt;
    const html = o.roster.map((r) => `<div class="pl${r.id === o.me ? ' me' : ''}"><span>${esc(r.name)}${r.bot ? ' <span class="tag b">BOT</span>' : ''}${r.host ? ' <span class="tag s">HOST</span>' : ''}</span><small>${r.score || ''}</small></div>`).join('');
    const lp = $('lobbyPlayers');
    if (lp.innerHTML !== html) lp.innerHTML = html;
    $('lobbyBots').style.display = !o.pub && o.host ? 'flex' : 'none';
    $('botsN').textContent = String(o.bots);
    const sb = $<HTMLButtonElement>('startBtn');
    sb.style.display = !o.pub && o.host ? 'block' : 'none';
    sb.disabled = !o.canStart;
    $('lobbyStatus').textContent = o.pub
      ? o.countdown > 0 ? `Round starts in ${Math.ceil(o.countdown / 1000)}…` : 'Finding players…'
      : o.host ? (o.canStart ? 'Ready when you are!' : 'Invite a friend or add bots to start.') : 'Waiting for the host to start…';
  }

  scoreboard(show: boolean, roster?: RosterEntry[], me?: number) {
    const el = $('scoreboard');
    el.style.display = show ? 'flex' : 'none';
    if (!show || !roster) return;
    const rows = roster.slice().sort((a, b) => b.score - a.score).map((r) =>
      `<tr class="${r.id === me ? 'me' : ''}${r.alive ? '' : ' dead'}"><td>${esc(r.name)}${this.tags(r, r.alive)}${r.conn ? '' : ' <span class="tag b">OFFLINE</span>'}</td><td class="n dim">${r.bot ? '' : `${r.ping | 0} ms`}</td><td class="n">${r.score}</td></tr>`).join('');
    el.innerHTML = `<h2>Scoreboard</h2><table class="board"><tr><th>PLAYER</th><th style="text-align:right">PING</th><th style="text-align:right">TOTAL</th></tr>${rows}</table>`;
  }

  results(show: boolean, res?: Results, me?: number, myTeam?: Team, msLeft = 0, nextMap = '') {
    const el = $('results');
    el.style.display = show ? 'flex' : 'none';
    if (!show || !res) return;
    const key = JSON.stringify(res.board.map((b) => b.id)) + res.winner;
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      const won = (res.winner === 'props' && myTeam === 'prop') || (res.winner === 'hunters' && myTeam === 'hunter');
      const title = res.winner === 'props' ? 'PROPS WIN!' : 'HUNTERS WIN!';
      const sub = myTeam === 'spec' ? 'You watched this one. You are in next round!' : won ? 'Nicely done.' : res.winner === 'props' ? 'The props got away this time.' : 'Every last prop was found.';
      const awards = res.awards.map((a) => `<div class="award"><div class="at">${esc(a.title.toUpperCase())}</div><div class="an">${esc(a.name)}</div><div class="ad">${esc(a.detail)}</div></div>`).join('');
      const rows = res.board.map((r) => `<tr class="${r.id === me ? 'me' : ''}"><td>${esc(r.name)}${this.tags(r, r.survived || r.team !== 'prop')}</td><td class="n">${r.round >= 0 ? '+' : ''}${r.round}</td><td class="n">${r.total}</td></tr>`).join('');
      el.innerHTML = `<h2 class="${res.winner}">${title}</h2><div class="resSub">${sub}</div>${awards ? `<div class="awards">${awards}</div>` : ''}<table class="board"><tr><th>PLAYER</th><th style="text-align:right">ROUND</th><th style="text-align:right">TOTAL</th></tr>${rows}</table><div class="nextIn" id="nextIn"></div>`;
    }
    const n = document.getElementById('nextIn');
    if (n) n.textContent = `Next round in ${Math.max(0, Math.ceil(msLeft / 1000))}…${nextMap ? ` on ${nextMap}.` : ''} Roles rotate!`;
  }

  chatMenu(show: boolean) {
    const el = $('chatMenu');
    el.style.display = show ? 'flex' : 'none';
    if (show && !el.childElementCount) el.innerHTML = QUICK_CHAT.map((c, i) => `<div><b>${i + 1}</b>${esc(c)}</div>`).join('');
  }
}
