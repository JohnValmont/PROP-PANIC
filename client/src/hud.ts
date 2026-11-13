/** DOM overlay: timers, role card, abilities, feed, banners, lobby/results panels. No game logic lives here. */
import { QUICK_CHAT, type Phase, type Team } from '../../shared/constants';
import type { Results, RosterEntry } from '../../shared/protocol';
import { FEATS, FEAT_INDEX, GRADE_NAMES, ITEMS, SHIFT_BONUS, STAMP_SIDES, levelXp, rankOf, titleName, type Report } from '../../shared/progress';
import { PROPS } from '../../shared/props';

const PROPS_NAME = (i: number) => PROPS[i]?.name ?? 'something';

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
  'Props you have caught come back as ghosts and rattle real objects. Shoot one of those and you lose Focus.',
  'Three hits catch a prop. After the first one it gets a burst of speed, so make the next two count.',
];

export class Hud {
  root = $('hud');
  private bannerTimer = 0;
  private lastTimer = '';
  private abKey = '';
  private tipI = Math.floor(Math.random() * TIPS.length);
  private lastTipAt = 0;

  show(v: boolean) { this.root.classList.toggle('hidden', !v); }

  setPhase(phase: Phase, round: number, panic: boolean, rounds: number) {
    const of = rounds > 1 ? `ROUND ${round}/${rounds}` : 'ROUND';
    const label = phase === 'lobby' ? 'LOBBY' : phase === 'hiding' ? `${of} · HIDE!` : phase === 'hunt' ? (panic ? 'PANIC TIME!' : `${of} · HUNT`) : round >= rounds ? 'GAME OVER' : 'ROUND OVER';
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

  private netKey = '';
  /** Ping badge: signal bars coloured by latency, plus packet loss and FPS so a player can tell network lag from a slow device. ms < 0 = no reply. */
  setNet(ms: number, loss: number, fps: number) {
    const key = `${ms}|${loss}|${fps}`;
    if (key === this.netKey) return;
    this.netKey = key;
    const lvl = ms < 0 ? 'dead' : ms < 60 && loss < 5 ? 'good' : ms < 100 && loss < 10 ? 'ok' : ms < 200 && loss < 20 ? 'meh' : 'bad';
    const bars = { good: 4, ok: 3, meh: 2, bad: 1, dead: 0 }[lvl];
    const el = $('netStat');
    el.className = lvl;
    el.querySelectorAll<HTMLElement>('.bars i').forEach((b, i) => b.classList.toggle('on', i < bars));
    $('netMs').textContent = ms < 0 ? 'NO SIGNAL' : `${ms} ms`;
    $('netLoss').textContent = loss > 0 && ms >= 0 ? `${loss}% loss` : '';
    const f = $('netFps');
    f.textContent = `${fps} FPS`;
    f.classList.toggle('low', fps < 30);
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

  /** `lift` raises the row clear of the ghost strip at the bottom of the screen. */
  setAbilities(list: AbilityView[], lift = false) {
    const el = $('abilities');
    el.classList.toggle('lift', lift);
    const key = list.map((a) => a.key + a.name).join('|');
    if (key !== this.abKey) {
      this.abKey = key;
      el.innerHTML = list.map((a) => `<div class="ab${a.name === 'HAUNT' ? ' haunt' : ''}"><span class="k">${esc(a.key)}</span><div class="ic">${a.icon}</div><div class="cd"></div><div class="sec"></div><div class="nm">${esc(a.name)}</div></div>`).join('');
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

  prompt(html: string | null, haunt = false) { const p = $('prompt'); if (html === null) { if (p.style.display !== 'none') p.style.display = 'none'; return; } p.style.display = 'block'; p.classList.toggle('haunt', haunt); if (this.promptKey !== html) { this.promptKey = html; p.innerHTML = html; } }
  private promptKey = '';
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

  /**
   * The hunter's wait while the props hide. `preview` swaps the solid blindfold for a frame around a live look at
   * the room (no props in it): `fly` then says how to move the camera.
   */
  blindfold(show: boolean, msLeft = 0, preview = false, fly = '') {
    const b = $('blindfold');
    b.style.display = show ? 'flex' : 'none';
    if (!show) return;
    $('bfCount').textContent = String(Math.max(0, Math.ceil(msLeft / 1000)));
    const mode = preview ? 'p' + fly : 'b';
    if (b.dataset.mode !== mode) {
      b.dataset.mode = mode; this.lastTipAt = 0;
      b.classList.toggle('preview', preview);
      $('bfTitle').textContent = preview ? 'MEMORISE THE ROOM' : 'NO PEEKING!';
      $('bfSub').innerHTML = preview ? 'The props are hiding in it right now, and you cannot see them yet. Whatever turns up later is a <b>FAKE</b>.' : 'The props are hiding. You are the <b>HUNTER</b>.';
    }
    const now = performance.now();
    if (now - this.lastTipAt > 4500) {
      // the first line of a preview says how to look around; after that, the usual hunting tips
      const first = preview && !this.lastTipAt;
      this.lastTipAt = now;
      if (first) $('bfTip').innerHTML = fly; else $('bfTip').textContent = 'TIP: ' + TIPS[this.tipI++ % TIPS.length];
    }
  }

  /** The start-of-round card: which side you are on, and the one thing to do about it. `sub` is plain text. */
  roleCard(cls: 'prop' | 'hunter' | 'ghost', top: string, title: string, sub: string, ms = 2800) {
    const c = $('roleCard');
    $('rcTop').textContent = top; $('rcTitle').textContent = title; $('rcSub').textContent = sub;
    c.className = '';
    void c.offsetWidth;
    c.className = `show ${cls}`;
    clearTimeout(this.roleTimer);
    this.roleTimer = window.setTimeout(() => { c.className = `out ${cls}`; this.roleTimer = window.setTimeout(() => (c.className = ''), 380); }, ms);
  }
  private roleTimer = 0;

  /** The big 3 · 2 · 1 before the hunters are let loose. null clears it. */
  count(n: number | null) {
    if (n === this.lastCount) return;
    this.lastCount = n;
    const c = $('bigCount');
    c.className = '';
    if (n === null) return;
    c.textContent = String(n);
    void c.offsetWidth;
    c.className = 'tick';
  }
  private lastCount: number | null = null;

  ghostTint(on: boolean) { $('ghostTint').classList.toggle('on', on); }

  /** A player's name with their level badge in front and their title (a feat) after it. */
  private ident(name: string, r?: { lvl?: number; kit?: number[] }): string {
    const lvl = r?.lvl ?? 0, title = titleName(r?.kit?.[4] ?? 0);
    return `${lvl > 0 ? `<span class="lv" title="Level ${lvl} · ${esc(rankOf(lvl).name)}">${lvl}</span>` : ''}${esc(name)}${title ? `<span class="ttl">${esc(title)}</span>` : ''}`;
  }

  private tags(r: { team: Team; bot?: boolean }, alive = true): string {
    return (r.team === 'hunter' ? '<span class="tag h">HUNTER</span>' : r.team === 'prop' ? (alive ? '<span class="tag p">PROP</span>' : '<span class="tag b">CAUGHT</span>') : '<span class="tag s">WATCHING</span>') + (r.bot ? '<span class="tag b">BOT</span>' : '');
  }

  lobby(show: boolean, o?: { code: string; pub: boolean; roster: RosterEntry[]; me: number; host: boolean; bots: number; countdown: number; canStart: boolean; map: number; rounds: number }) {
    const el = $('lobby');
    el.style.display = show ? 'flex' : 'none';
    if (!show || !o) return;
    $('lobbyCode').textContent = o.code;
    const mb = $('mapBtn');
    mb.style.display = !o.pub && o.host ? 'block' : 'none';
    const mt = `Map: ${['Alternate', 'Emporium', 'Sunny Meadow'][o.map] ?? 'Alternate'}`;
    if (mb.textContent !== mt) mb.textContent = mt;
    const rb = $('roundsBtn');
    rb.style.display = !o.pub && o.host ? 'block' : 'none';
    const games = o.rounds === 1 ? 'a single round' : `${o.rounds} rounds`;
    const rt = `Game length: ${o.rounds === 1 ? '1 round' : games}`;
    if (rb.textContent !== rt) rb.textContent = rt;
    const html = o.roster.map((r) => `<div class="pl${r.id === o.me ? ' me' : ''}"><span>${this.ident(r.name, r)}${r.bot ? ' <span class="tag b">BOT</span>' : ''}${r.host ? ' <span class="tag s">HOST</span>' : ''}</span><small>${r.score || ''}</small></div>`).join('');
    const lp = $('lobbyPlayers');
    if (lp.innerHTML !== html) lp.innerHTML = html;
    $('lobbyBots').style.display = !o.pub && o.host ? 'flex' : 'none';
    $('botsN').textContent = String(o.bots);
    const sb = $<HTMLButtonElement>('startBtn');
    sb.style.display = !o.pub && o.host ? 'block' : 'none';
    sb.disabled = !o.canStart;
    $('lobbyStatus').textContent = o.pub
      ? o.countdown > 0 ? `A game of ${games} starts in ${Math.ceil(o.countdown / 1000)}…` : 'Finding players…'
      : o.host ? (o.canStart ? 'Ready when you are!' : 'Invite a friend or add bots to start.') : `Waiting for the host to start a game of ${games}…`;
  }

  scoreboard(show: boolean, roster?: RosterEntry[], me?: number) {
    const el = $('scoreboard');
    el.style.display = show ? 'flex' : 'none';
    if (!show || !roster) return;
    const rows = roster.slice().sort((a, b) => b.score - a.score).map((r) =>
      `<tr class="${r.id === me ? 'me' : ''}${r.alive ? '' : ' dead'}"><td>${this.ident(r.name, r)}${this.tags(r, r.alive)}${r.conn ? '' : ' <span class="tag b">OFFLINE</span>'}</td><td class="n dim">${r.bot ? '' : `${r.ping | 0} ms`}</td><td class="n">${r.score}</td></tr>`).join('');
    el.innerHTML = `<h2>Scoreboard</h2><table class="board"><tr><th>PLAYER</th><th style="text-align:right">PING</th><th style="text-align:right">TOTAL</th></tr>${rows}</table>`;
  }

  results(show: boolean, res?: Results, me?: number, myTeam?: Team, msLeft = 0, nextMap = '', report: Report | null = null, wallet = 0, roster?: Map<number, RosterEntry>) {
    const el = $('results');
    el.style.display = show ? 'flex' : 'none';
    if (!show || !res) return;
    const key = JSON.stringify(res.board.map((b) => b.id)) + res.winner + res.n + '|' + (report ? report.xp + ':' + report.coins : '');
    if (el.dataset.key !== key) {
      el.dataset.key = key;
      const won = (res.winner === 'props' && myTeam === 'prop') || (res.winner === 'hunters' && myTeam === 'hunter');
      const title = res.winner === 'props' ? 'PROPS WIN!' : 'HUNTERS WIN!';
      const sub = myTeam === 'spec' ? (res.final ? 'You watched this one. You are in the next game!' : 'You watched this one. You are in next round!') : won ? 'Nicely done.' : res.winner === 'props' ? 'The props got away this time.' : 'Every last prop was found.';
      const awards = res.awards.map((a) => `<div class="award"><div class="at">${esc(a.title.toUpperCase())}</div><div class="an">${esc(a.name)}</div><div class="ad">${esc(a.detail)}</div></div>`).join('');
      const rows = res.board.map((r) => `<tr class="${r.id === me ? 'me' : ''}"><td>${this.ident(r.name, roster?.get(r.id))}${this.tags(r, r.survived || r.team !== 'prop')}</td><td class="n">${r.round >= 0 ? '+' : ''}${r.round}</td><td class="n">${r.total}</td></tr>`).join('');
      // after the last round the game is settled too: who won it, and the final standings
      const f = res.final;
      const podium = f ? `<div class="final"><div class="finalT">GAME OVER · ${res.rounds === 1 ? '1 ROUND' : `${res.rounds} ROUNDS`}</div><div class="champ">${esc(f[0]?.name ?? '')} wins the game</div><div class="places">${f.slice(0, 3).map((r, i) => `<div class="place p${i}${r.id === me ? ' me' : ''}"><b>${i + 1}</b><span>${esc(r.name)}</span><small>${r.total}</small></div>`).join('')}</div></div>` : '';
      const pay = report ? this.progress(report, wallet) : '';
      el.innerHTML = `<h2 class="${res.winner}">${title}</h2><div class="resSub">${sub}</div>${podium}${awards && (!f || res.board.length <= 6) ? `<div class="awards">${awards}</div>` : ''}<table class="board"><tr><th>PLAYER</th><th style="text-align:right">ROUND</th><th style="text-align:right">TOTAL</th></tr>${rows}</table>${pay}<div class="nextIn" id="nextIn"></div>`;
    }
    const n = document.getElementById('nextIn');
    const secs = Math.max(0, Math.ceil(msLeft / 1000));
    if (n) n.textContent = res.final ? `Back to the lobby in ${secs}…` : `Round ${res.round + 1} of ${res.rounds} in ${secs}…${nextMap ? ` on ${nextMap}.` : ''} Roles rotate!`;
  }

  /** Under the board: what this round did for the player's profile. */
  private progress(r: Report, wallet: number): string {
    const lo = levelXp(r.levelTo), hi = levelXp(r.levelTo + 1), pct = Math.min(100, Math.max(0, ((this.xpNow - lo) / (hi - lo)) * 100));
    const up = r.levelTo > r.levelFrom;
    const chips: string[] = [];
    for (const f of r.feats) chips.push(`<span class="chip ft">FEAT · ${esc(FEATS[FEAT_INDEX[f]]?.name ?? f)} · new title</span>`);
    if (r.shift) chips.push(`<span class="chip ft">FULL SHIFT · all three odd jobs · +${SHIFT_BONUS.coins}</span>`);
    for (const st of r.stamps.slice(0, 4)) chips.push(`<span class="chip g${st.grade}">${st.grade === 1 ? 'NEW STAMP' : GRADE_NAMES[st.grade].toUpperCase()} · ${STAMP_SIDES[st.side]}: ${esc(PROPS_NAME(st.prop))}</span>`);
    if (r.stamps.length > 4) chips.push(`<span class="chip g1">+${r.stamps.length - 4} more stamps</span>`);
    for (const id of r.unlocked) chips.push(`<span class="chip un">UNLOCKED · ${esc(ITEMS[id].name)}</span>`);
    const jobs = r.jobs.map((j) => `<span class="job${j.done ? ' done' : ''}${j.doneNow ? ' now' : ''}" title="${esc(j.text)}">${j.done ? '✓' : `${j.have}/${j.goal}`} ${esc(j.text)}</span>`).join('');
    return `<div class="prog"><div class="progTop"><span class="lv big${up ? ' up' : ''}">${r.levelTo}</span><div class="progMid"><div class="progLine"><b>+${r.xp} XP</b><span>${up ? `LEVEL UP · ${esc(rankOf(r.levelTo).name)}` : esc(rankOf(r.levelTo).name)}</span></div><div class="lvlBar"><i style="width:${pct.toFixed(1)}%"></i></div></div>`
      + `<div class="progCoins"><span><i class="coin"></i> <b>+${r.coins}</b></span><small>${r.coins > r.coinsPlay ? `${r.coinsPlay} play + ${r.coins - r.coinsPlay} bonus` : 'coins'} · wallet ${wallet.toLocaleString('en-US')}</small></div></div>`
      + `${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}<div class="jobs"><span class="jobsT">ODD JOBS</span>${jobs}</div></div>`;
  }
  /** The player's XP right now, set by the game before results are drawn (for the level bar). */
  xpNow = 0;

  chatMenu(show: boolean) {
    const el = $('chatMenu');
    el.style.display = show ? 'flex' : 'none';
    if (show && !el.childElementCount) el.innerHTML = QUICK_CHAT.map((c, i) => `<div><b>${i + 1}</b>${esc(c)}</div>`).join('');
  }
}
