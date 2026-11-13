/**
 * Coming soon: the game-mode picker on the Play card (Classic is live, the rest are locked teasers), the
 * "Coming soon" menu page (modes, maps, features), the teaser on the hero and the line in the lobby.
 *
 * Nothing here is a promise with a date. Every card says "Coming soon", and "Want it" is kept in this browser only
 * (`pp_wants`); no counts are shown, because there are none to show yet.
 * Bump SOON_VERSION whenever the list changes: the NEW badge on the menu tab comes back for everyone.
 */
import type { Game } from './game';

export const SOON_VERSION = '1';

type Kind = 'mode' | 'map' | 'feature';
interface Item { id: string; kind: Kind; name: string; short?: string; line: string; color: string; icon: string; secret?: boolean }

const I = {
  classic: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>',
  infection: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  copycat: '<rect x="3" y="7" width="10" height="10" rx="2"/><rect x="11" y="4" width="10" height="10" rx="2"/>',
  blitz: '<path d="M13 2 4.5 13.5H11L10 22l9-12h-6.5z"/>',
  duos: '<circle cx="8" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.8"/><path d="M2.5 20c0-3.6 2.4-6 5.5-6s5.5 2.4 5.5 6M14 14.4c3.4-.6 7 1.4 7 5.6"/>',
  lights: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.6 6.6 0 0 0 10 10z"/>',
  attic: '<path d="M2.5 12 12 3.5l9.5 8.5M5 10v10h14V10"/><path d="M10 20v-5h4v5"/><circle cx="12" cy="10" r="1.4"/>',
  pier: '<circle cx="12" cy="9" r="5.5"/><path d="M12 3.5v11M6.5 9h11M8.1 5.1l7.8 7.8M15.9 5.1l-7.8 7.8M2 20c2.5-2 5-2 7.5 0s5 2 7.5 0 3.5-1.4 5-.6"/>',
  secret: '<path d="M8.6 8.6a3.6 3.6 0 1 1 5 3.3c-1 .5-1.6 1.2-1.6 2.3v.8"/><circle cx="12" cy="18.6" r=".9" fill="currentColor"/>',
  friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20.5c0-4 2.8-6.5 6.5-6.5s6.5 2.5 6.5 6.5"/><path d="M18 8v6M15 11h6"/>',
  seasons: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2"/>',
  replay: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M10 9v6l5-3z" fill="currentColor"/>',
  rules: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2.4"/><circle cx="10" cy="12" r="2.4"/><circle cx="17.6" cy="18" r="2.4"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.5 9.6 4.5 4.5 0 0 0 7 18.5z"/><path d="M12 15.5v-5M9.8 12.6 12 10.4l2.2 2.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  heart: '<path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6.1-8 11-8 11z"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>',
};
const svg = (p: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

/** Classic is the game as it is today; it is the only live mode. */
const CLASSIC: Item = { id: 'classic', kind: 'mode', name: 'Classic Hunt', short: 'Classic', line: 'Props hide, hunters zap, the caught come back as ghosts. The full Prop Panic.', color: '#ffd166', icon: I.classic };

export const SOON: Item[] = [
  { id: 'infection', kind: 'mode', name: 'Infection', line: 'Every prop that gets caught joins the hunters. The last one still hiding is a legend.', color: '#2ec4b6', icon: I.infection },
  { id: 'copycat', kind: 'mode', name: 'Copycat', line: 'Every prop hides as the same object. Find the one that is breathing.', color: '#ef476f', icon: I.copycat },
  { id: 'blitz', kind: 'mode', name: 'Blitz', line: 'Sixty-second rounds and a chaos event every twenty seconds. No time to think.', color: '#f78c2b', icon: I.blitz },
  { id: 'duos', kind: 'mode', name: 'Duos', line: 'Hide in pairs. If your partner is caught, you have ten seconds to break them out.', color: '#9b5de5', icon: I.duos },
  { id: 'lights', kind: 'mode', name: 'Lights Out', line: 'The whole round in the dark. Hunters get a torch. Props get brave.', color: '#4361ee', icon: I.lights },
  { id: 'attic', kind: 'map', name: "Grandma's Attic", line: 'Cramped, dusty and stacked to the rafters with things that creak when you move.', color: '#c08552', icon: I.attic },
  { id: 'pier', kind: 'map', name: 'Sunset Pier', line: 'Arcade, carousel and a fish stall on a seaside pier. A lot of buckets. Some of them are people.', color: '#ff7f6b', icon: I.pier },
  { id: 'vault', kind: 'map', name: '████████', line: 'Classified. All we can say is that the Emporium has a basement, and something down there keeps moving.', color: '#3a3f6b', icon: I.secret, secret: true },
  { id: 'friends', kind: 'feature', name: 'Friends & parties', line: 'Add friends, see when they are online and jump into public games together.', color: '#06d6a0', icon: I.friends },
  { id: 'seasons', kind: 'feature', name: 'Seasons', line: 'A new theme every season: limited looks, seasonal disguises and a free reward track.', color: '#7bdff2', icon: I.seasons },
  { id: 'replay', kind: 'feature', name: 'Catch cam', line: 'The final catch of every round, replayed through the hunter’s eyes. Gloating encouraged.', color: '#ffd166', icon: I.replay },
  { id: 'rules', kind: 'feature', name: 'House rules', line: 'Private rooms set their own round length, number of hunters, Focus drain and chaos.', color: '#f15bb5', icon: I.rules },
  { id: 'cloud', kind: 'feature', name: 'Cloud saves', line: 'Sign in and take your level, coins and catalogue to any device.', color: '#a0c4ff', icon: I.cloud },
];
const MODES = SOON.filter((s) => s.kind === 'mode');
const KIND_LABEL: Record<Kind, string> = { mode: 'NEW MODE', map: 'NEW MAP', feature: 'NEW FEATURE' };
const COUNT = (k: Kind) => SOON.filter((s) => s.kind === k).length;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export class SoonUi {
  private wants = new Set<string>();
  private filter: Kind | 'all' = 'all';
  private peek = 'classic';

  constructor(private game: Game) {
    try { const w = JSON.parse(read('pp_wants') ?? '[]'); if (Array.isArray(w)) for (const id of w) if (SOON.some((s) => s.id === id)) this.wants.add(id); } catch { /* fresh */ }
    this.renderModes();
    this.renderPage();
    this.renderTeaser();
    $('lobbySoon').innerHTML = `<i class="lsTag">COMING SOON</i> New modes: ${MODES.map((m) => `<b>${m.name}</b>`).join(' · ')}`;
    this.syncFresh();

    $('modes').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
      if (!b) return;
      const id = b.dataset.mode!;
      if (id === 'classic') this.game.sfx.play('click');
      else { this.game.sfx.play('deny'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }
      this.peek = id; this.renderModeInfo();
      for (const t of $('modes').querySelectorAll<HTMLElement>('[data-mode]')) t.classList.toggle('peek', t.dataset.mode === id && id !== 'classic');
    });
    $('modeInfo').addEventListener('click', (e) => this.onWant(e));
    $('soonBody').addEventListener('click', (e) => {
      const f = (e.target as HTMLElement).closest<HTMLElement>('[data-filter]')?.dataset.filter as Kind | 'all' | undefined;
      if (f && f !== this.filter) { this.game.sfx.play('click'); this.filter = f; this.renderPage(); return; }
      if ((e.target as HTMLElement).closest('#soonShare')) { this.share(); return; }
      this.onWant(e);
    });
  }

  /** The menu calls this when the Coming soon page opens: the NEW badge goes until the list changes. */
  opened() { write('pp_soon_seen', SOON_VERSION); this.syncFresh(); }

  private syncFresh() {
    const fresh = read('pp_soon_seen') !== SOON_VERSION;
    for (const n of document.querySelectorAll<HTMLElement>('.nav[data-go="soon"]')) n.classList.toggle('fresh', fresh);
  }

  private onWant(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-want]');
    if (!b) return;
    const id = b.dataset.want!;
    if (this.wants.has(id)) { this.wants.delete(id); this.game.sfx.play('click'); }
    else { this.wants.add(id); this.game.sfx.play('pop'); }
    write('pp_wants', JSON.stringify([...this.wants]));
    // every Want button for this item (the play card and the page) flips together
    for (const w of document.querySelectorAll<HTMLElement>(`[data-want="${id}"]`)) {
      const on = this.wants.has(id);
      w.classList.toggle('on', on); w.setAttribute('aria-pressed', String(on));
      w.querySelector('.wl')!.textContent = on ? 'Wanted' : 'Want it';
      if (on) { w.classList.remove('burst'); void w.offsetWidth; w.classList.add('burst'); }
    }
    this.renderWantCount();
  }

  private wantBtn(id: string) {
    const on = this.wants.has(id);
    return `<button class="want${on ? ' on' : ''}" data-want="${id}" aria-pressed="${on}" title="Mark it: kept in this browser">${svg(I.heart)}<span class="wl">${on ? 'Wanted' : 'Want it'}</span></button>`;
  }

  // ------------------------------------------------------------------ play card: the mode picker
  private renderModes() {
    const tile = (m: Item, live: boolean) => `<button class="mode${live ? ' on' : ' soon'}" data-mode="${m.id}" style="--c:${m.color}" aria-label="${m.name}${live ? '' : ': coming soon'}">`
      + `<i class="mIco">${svg(m.icon)}</i><b>${m.short ?? m.name}</b>`
      + (live ? '<small class="live"><i></i>LIVE</small>' : `<small class="soonTag">SOON</small><span class="mLock">${svg(I.lock)}</span>`)
      + '</button>';
    $('modes').innerHTML = tile(CLASSIC, true) + MODES.map((m) => tile(m, false)).join('');
    this.renderModeInfo();
  }

  private renderModeInfo() {
    const m = this.peek === 'classic' ? CLASSIC : SOON.find((s) => s.id === this.peek)!;
    $('modeInfo').innerHTML = m === CLASSIC
      ? `<span class="miTxt"><b>${m.name}</b> ${m.line}</span>`
      : `<span class="miTxt"><i class="stampSm">COMING SOON</i> <b>${m.name}</b> ${m.line}</span>${this.wantBtn(m.id)}`;
    $('modeInfo').classList.toggle('isSoon', m !== CLASSIC);
  }

  // ------------------------------------------------------------------ hero: one line pointing at the page
  private renderTeaser() {
    $('soonTeaser').innerHTML = `<span class="stTag">NEW STOCK INCOMING</span>`
      + `<span class="stTxt">${plural(COUNT('mode'), 'new mode')}, ${plural(COUNT('map'), 'map')} and more are on the way</span>`
      + `<span class="stGo">See what’s coming <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>`;
  }

  // ------------------------------------------------------------------ the Coming soon page
  private renderPage() {
    const chips: [Kind | 'all', string, number][] = [['all', 'Everything', SOON.length], ['mode', 'Modes', COUNT('mode')], ['map', 'Maps', COUNT('map')], ['feature', 'Features', COUNT('feature')]];
    const list = SOON.filter((s) => this.filter === 'all' || s.kind === this.filter);
    const card = (s: Item) => `<article class="soonCard${s.secret ? ' secret' : ''}" style="--c:${s.color}">`
      + `<div class="scArt"><i class="scIco">${svg(s.icon)}</i><span class="scKind">${s.secret ? 'NEW MAP?' : KIND_LABEL[s.kind]}</span></div>`
      + `<div class="scBody"><h3>${s.name}</h3><p>${s.line}</p></div>`
      + `<div class="scFoot"><span class="scStamp">${s.secret ? 'TOP SECRET' : 'COMING SOON'}</span>${this.wantBtn(s.id)}</div>`
      + '</article>';
    $('soonBody').innerHTML = `
      <div class="soonHero">
        <div class="crate" aria-hidden="true"><span class="crTxt">FRAGILE</span><span class="crArrow">THIS WAY UP ▲</span><i class="crPeek goo"><b></b></i></div>
        <div class="shTxt">
          <div class="shKicker">NEW STOCK INCOMING</div>
          <div class="shTitle">The Emporium is expanding</div>
          <p>New ways to hide, new places to hide in, and new ways to play with your crew are being built. Mark the ones you cannot wait for.</p>
          <div class="shStats"><span><b>${COUNT('mode')}</b> modes</span><span><b>${COUNT('map')}</b> maps</span><span><b>${COUNT('feature')}</b> features</span></div>
        </div>
        <button id="soonShare" class="btn small yellow">${svg(I.share)}<span>Tell your crew</span></button>
      </div>
      <div class="soonChips" role="tablist">${chips.map(([k, l, n]) => `<button class="soonChip${k === this.filter ? ' on' : ''}" data-filter="${k}">${l}<i>${n}</i></button>`).join('')}</div>
      <div class="soonGrid">${list.map(card).join('')}</div>
      <div class="soonFoot" id="soonWants"></div>`;
    this.renderWantCount();
  }

  private renderWantCount() {
    const el = document.getElementById('soonWants');
    if (!el) return;
    const n = this.wants.size;
    el.innerHTML = n ? `${svg(I.heart)} You are waiting for <b>${plural(n, 'thing')}</b>. They are saved in this browser.` : 'Tap <b>Want it</b> on anything you are waiting for.';
    el.classList.toggle('has', n > 0);
  }

  private async share() {
    const url = `${location.origin}${location.pathname}`;
    const text = `Prop Panic: hide as everyday objects, hunt the fakes. Free in the browser, and ${MODES.slice(0, 3).map((m) => m.name).join(', ')} and more modes are coming.`;
    const btn = $('soonShare'), label = btn.querySelector('span')!;
    this.game.sfx.play('click');
    if (navigator.share) { try { await navigator.share({ title: 'Prop Panic', text, url }); } catch { /* cancelled */ } return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); label.textContent = 'Copied! Paste it to your crew'; }
    catch { prompt('Share this with your crew:', `${text} ${url}`); }
    setTimeout(() => { label.textContent = 'Tell your crew'; }, 2200);
  }
}
