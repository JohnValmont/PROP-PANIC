/**
 * The profile screen on the main menu (Overview, Wardrobe, Catalogue, Feats) and the summary on the menu card.
 * Pure DOM: reads and changes `game.profile` through the rules in shared/progress.ts, then saves via game.applyKit().
 */
import {
  DEPARTMENTS, FEATS, FEAT_INDEX, GRADES, GRADE_NAMES, ITEMS, POPS, SLOTS, STAMPS_MAX, buyItem, equip, exportCode, gradeOf, importCode,
  jobsFor, levelXp, msToNextDay, owns, rankOf, rollJobs, stampCount, unlockText, utcDay, xpLevel, type Item, type Paint, type Pop, type Slot,
} from '../../shared/progress';
import { PROPS, PROP_INDEX } from '../../shared/props';
import { esc } from './hud';
import type { Game } from './game';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const n = (v: number) => Math.floor(v).toLocaleString('en-US');
type Tab = 'overview' | 'wardrobe' | 'catalogue' | 'feats';

const SLOT_INFO: Record<Slot, [label: string, hint: string]> = {
  paint: ['Paint', 'Your robot\'s finish. Everyone sees it while you hunt.'],
  hat: ['Hats', 'Worn by your robot while you hunt.'],
  eyes: ['Eyes', 'Pop out of your disguise only when you taunt, panic or get scanned, so they never give you away.'],
  pop: ['Catch pop', 'The burst everyone sees when you get caught. Go out in style.'],
};

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');

/** Tiny pictures for the eye styles, so a tile reads at a glance. */
function eyeIcon(id: string): string {
  const w = (x: number, r: number, py = 0, pupil = '#111', pr = r * 0.45) => `<circle cx="${x}" cy="12" r="${r}" fill="#fff" stroke="#1b2a4a" stroke-width="1.2"/><circle cx="${x + 1}" cy="${12 + py}" r="${pr}" fill="${pupil}"/>`;
  const k = id.slice(5);
  let s = '';
  if (k === 'cyclops') s = w(16, 9, 0, '#111', 4);
  else {
    const r = k === 'wide' ? 7.5 : k === 'beady' ? 3.5 : 5.5, gap = k === 'wide' ? 8.5 : k === 'beady' ? 5 : 7;
    s = w(16 - gap, r, k === 'sleepy' ? 1.6 : 0, k === 'love' ? '#ff2f7a' : '#111', k === 'love' ? r * 0.6 : r * 0.45) + w(16 + gap, r, k === 'sleepy' ? 1.6 : 0, k === 'love' ? '#ff2f7a' : '#111', k === 'love' ? r * 0.6 : r * 0.45);
    if (k === 'angry') s += `<path d="M4 4 L13 8 M28 4 L19 8" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>`;
    if (k === 'sleepy') s += `<path d="M3.5 12 A5.5 5.5 0 0 1 14.5 12 Z M17.5 12 A5.5 5.5 0 0 1 28.5 12 Z" fill="#d8c9b4" stroke="#1b2a4a" stroke-width="1"/>`;
    if (k === 'lashes') s += `<path d="M6 6 L5 3 M9 5.5 L9 2.5 M12 6 L13 3 M20 6 L19 3 M23 5.5 L23 2.5 M26 6 L27 3" stroke="#111" stroke-width="1.4" stroke-linecap="round"/>`;
    if (k === 'shades') s += `<rect x="2" y="8" width="11" height="8" rx="2" fill="#0a0a10"/><rect x="19" y="8" width="11" height="8" rx="2" fill="#0a0a10"/><path d="M13 10 H19" stroke="#0a0a10" stroke-width="2"/>`;
    if (k === 'monocle') s += `<circle cx="23" cy="12" r="7" fill="none" stroke="#ffc64a" stroke-width="1.8"/><path d="M29 16 L31 23" stroke="#ffc64a" stroke-width="1.2"/>`;
  }
  return `<svg viewBox="0 0 32 24" class="ico">${s}</svg>`;
}

function itemIcon(it: Item): string {
  if (it.slot === 'paint') {
    const p = it as Paint;
    const shine = p.metal > 0.5 ? 'radial-gradient(circle at 35% 30%, #fff 0, transparent 45%),' : p.iri ? 'linear-gradient(135deg, rgba(255,180,230,.6), rgba(160,255,240,.5), rgba(200,190,255,.6)),' : '';
    return `<i class="sw big" style="background:${shine}${hex(p.hex)}"></i>`;
  }
  if (it.slot === 'eyes') return eyeIcon(it.id);
  if (it.slot === 'pop') return `<span class="dots">${(it as Pop).colors.slice(0, 5).map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</span>`;
  return `<span class="hatIco">${esc(it.name.split(' ')[0].slice(0, 1))}</span>`;
}

export class ProfileUi {
  private tab: Tab = 'overview';
  private slot: Slot = 'hat';
  /** An item awaiting a second click to confirm the purchase. */
  private confirm = '';
  private openNow = false;

  constructor(private game: Game) {
    $('profile').addEventListener('click', (e) => this.onClick(e));
    $('profile').addEventListener('change', (e) => this.onChange(e));
    $('profBtn').onclick = () => this.open('overview');
    $('jobsMini').onclick = () => this.open('overview');
    document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.openNow) this.close(); });
    this.renderCard();
    // the reset countdown on the card and the jobs list
    setInterval(() => { if (!this.game.inGame) { this.renderCard(); if (this.openNow && this.tab === 'overview') { const el = document.getElementById('jobReset'); if (el) el.textContent = this.resetIn(); } } }, 30_000);
  }

  get isOpen() { return this.openNow; }

  open(tab: Tab = this.tab) {
    this.tab = tab; this.openNow = true; this.confirm = '';
    $('menu').classList.add('prof');
    $('profile').classList.remove('hidden');
    this.game.showcaseOn = true;
    this.render();
  }

  close() {
    this.openNow = false; this.confirm = '';
    $('menu').classList.remove('prof');
    $('profile').classList.add('hidden');
    this.game.showcaseOn = false;
  }

  private resetIn(): string {
    const m = Math.ceil(msToNextDay() / 60_000);
    return m >= 60 ? `New jobs in ${Math.floor(m / 60)} h ${m % 60} min` : `New jobs in ${m} min`;
  }

  /** The menu card: price tag, XP bar, wallet, and today's odd jobs in three lines. */
  renderCard() {
    const p = this.game.profile, lvl = xpLevel(p.xp), lo = levelXp(lvl), hi = levelXp(lvl + 1), rank = rankOf(lvl);
    $('lvlBadge').innerHTML = `<b>${lvl}</b><small>${esc(rank.name)}</small>`;
    $('coinN').textContent = n(p.coins);
    $('lvlXp').textContent = `${n(p.xp - lo)} / ${n(hi - lo)} XP`;
    $('lvlFill').style.width = `${Math.min(100, ((p.xp - lo) / (hi - lo)) * 100)}%`;
    const day = utcDay();
    rollJobs(p, day);
    const jobs = jobsFor(day), done = p.jobs.done.filter(Boolean).length;
    $('jobsMini').innerHTML = `<div class="jmHead"><span>ODD JOBS · ${done}/3</span><small>${this.resetIn()}</small></div>`
      + jobs.map((j, i) => `<div class="jm${p.jobs.done[i] ? ' done' : ''}"><i>${p.jobs.done[i] ? '✓' : ''}</i><span>${esc(j.text)}</span><b>${p.jobs.done[i] ? 'done' : `${n(p.jobs.have[i])}/${n(j.goal)}`}</b></div>`).join('');
  }

  render() {
    this.renderCard();
    if (!this.openNow) return;
    const tabs: [Tab, string][] = [['overview', 'Overview'], ['wardrobe', 'Wardrobe'], ['catalogue', 'Catalogue'], ['feats', 'Feats']];
    const body = this.tab === 'overview' ? this.overview() : this.tab === 'wardrobe' ? this.wardrobe() : this.tab === 'catalogue' ? this.catalogue() : this.featsTab();
    $('profile').innerHTML = `<div class="profHead"><div class="profTabs">${tabs.map(([t, l]) => `<button class="ptab${t === this.tab ? ' on' : ''}" data-tab="${t}">${l}</button>`).join('')}</div>`
      + `<span class="wallet"><i class="coin"></i><b>${n(this.game.profile.coins)}</b></span><button class="btn tiny" data-act="close" title="Close (Esc)">✕</button></div><div class="profBody">${body}</div>`;
  }

  // ------------------------------------------------------------------ overview
  private overview(): string {
    const p = this.game.profile, L = p.life, lvl = xpLevel(p.xp), lo = levelXp(lvl), hi = levelXp(lvl + 1), rank = rankOf(lvl);
    const day = utcDay(), jobs = jobsFor(day);
    rollJobs(p, day);
    const side = { prop: 'AS A PROP', hunter: 'AS A HUNTER', any: 'ANY ROLE' };
    const titles = p.feats.map((id) => FEATS[FEAT_INDEX[id]]).filter(Boolean);
    const pct = (a: number, b: number) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '–');
    const stats: [string, string][] = [
      ['Rounds played', n(L.rounds)], ['Rounds won', `${n(L.wins)} (${pct(L.wins, L.rounds)})`], ['Games finished', n(L.games)], ['Games won', n(L.champs)],
      ['Podium finishes', n(L.podiums)], ['Survived as a prop', `${n(L.survived)} of ${n(L.propRounds)}`], ['Props caught', n(L.catches)], ['Accuracy', pct(L.hits, L.shots)],
      ['Great escapes', n(L.escapes)], ['Head bonks', n(L.bonks)], ['Decoys that worked', n(L.decoys)], ['Hunters spooked', n(L.spooks)],
      ['Turned into a duck', n(L.ducks)], ['Taunts', n(L.taunts)], ['Best round', n(L.best)], ['Points, all time', n(L.points)],
    ];
    return `<div class="ovTop"><div class="bigTag"><b>${lvl}</b><small>${esc(rank.name)}</small></div><div class="ovMid">`
      + `<div class="ovName">Level ${lvl} · ${esc(rank.name)}</div><div class="lvlBar"><i style="width:${Math.min(100, ((p.xp - lo) / (hi - lo)) * 100)}%"></i></div>`
      + `<div class="dim small">${n(p.xp - lo)} / ${n(hi - lo)} XP to level ${lvl + 1}${rank.next ? ` · <b>${esc(rank.next)}</b> at level ${rank.nextAt}` : ''}</div>`
      + `<label class="titleSel">Title <select data-act="title"><option value="">None</option>${titles.map((f) => `<option value="${f.id}"${p.kit.title === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select>`
      + `${titles.length ? '' : '<span class="dim small">Earn feats to unlock titles</span>'}</label></div></div>`
      + `<div class="sect"><div class="sectHead"><span>TODAY'S ODD JOBS</span><small id="jobReset">${this.resetIn()}</small></div>`
      + jobs.map((j, i) => `<div class="jobRow${p.jobs.done[i] ? ' done' : ''}"><span class="side">${side[j.side]}</span><span class="jt">${esc(j.text)}</span>`
        + `<div class="lvlBar"><i style="width:${Math.min(100, (p.jobs.have[i] / j.goal) * 100)}%"></i></div><b>${p.jobs.done[i] ? '✓' : `${n(p.jobs.have[i])}/${n(j.goal)}`}</b><span class="rw"><i class="coin"></i>${j.coins}</span></div>`).join('')
      + `<div class="dim small">${p.jobs.shift ? 'Full shift done: bonus paid. ' : 'Finish all three for a 75-coin bonus. '}Everyone gets the same three jobs each day (UTC).</div></div>`
      + `<div class="sect"><div class="sectHead"><span>HOW IT WORKS</span></div><ul class="how">`
      + `<li><b>Level:</b> every point you score is XP. Each level pays coins and raises your price tag.</li>`
      + `<li><b>Wardrobe:</b> spend coins on looks. None of them can give a hiding prop away.</li>`
      + `<li><b>Catalogue:</b> a stamp for every object you survive as, and every one you catch.</li>`
      + `<li><b>Feats:</b> milestones that pay out and give you a title to wear.</li></ul></div>`
      + `<div class="sect"><div class="sectHead"><span>LIFETIME</span><small>since ${new Date(p.since).toLocaleDateString()}</small></div><div class="stats">${stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div></div>`
      + `<div class="sect"><div class="sectHead"><span>BACKUP</span></div><div class="dim small">Your profile lives in this browser only. Copy a save code to move it to another browser or keep it safe.</div>`
      + `<div class="row"><button class="btn small teal" data-act="export">Copy save code</button><button class="btn small ghost" data-act="import">Restore from a code</button></div></div>`;
  }

  // ------------------------------------------------------------------ wardrobe
  private wardrobe(): string {
    const p = this.game.profile;
    const slots = (Object.keys(SLOTS) as Slot[]).map((s) => `<button class="ptab sm${s === this.slot ? ' on' : ''}" data-slot="${s}">${SLOT_INFO[s][0]}</button>`).join('');
    const items = SLOTS[this.slot].map((it) => {
      const have = owns(p, it.id), on = p.kit[it.slot] === it.id, price = 'price' in it.how ? it.how.price : 0;
      const state = on ? '<em class="st on">WEARING</em>'
        : have ? '<em class="st">WEAR</em>'
        : price ? (this.confirm === it.id ? `<em class="st buy go">BUY FOR ${n(price)}?</em>` : `<em class="st buy${p.coins < price ? ' poor' : ''}"><i class="coin"></i>${n(price)}</em>`)
        : `<em class="st lock">${esc(unlockText(it))}</em>`;
      const pv = it.slot === 'pop' ? `<span class="pv" data-pv="${POPS.indexOf(it as Pop)}" title="Preview">▶</span>` : '';
      return `<div class="item${on ? ' on' : ''}${have ? '' : ' locked'}" data-item="${it.id}">${itemIcon(it)}<span class="iname">${esc(it.name)}</span>${state}${pv}</div>`;
    }).join('');
    const ownedN = SLOTS[this.slot].filter((it) => owns(p, it.id)).length;
    return `<div class="slotTabs">${slots}</div><div class="dim small">${SLOT_INFO[this.slot][1]} <b>${ownedN}/${SLOTS[this.slot].length}</b> owned.</div><div class="items">${items}</div>`
      + `<div class="dim small">Coins come from every round, level-ups, odd jobs, catalogue stamps and feats. Some looks can only be earned.</div>`;
  }

  // ------------------------------------------------------------------ catalogue
  private catalogue(): string {
    const p = this.game.profile, total = stampCount(p);
    const featOf = (id: string) => FEATS[FEAT_INDEX[id]];
    const stamp = (count: number, side: number) => { const g = gradeOf(count); return `<i class="stamp g${g}" title="${side ? 'Caught' : 'Hid'}: ${count}×${g ? ` (${GRADE_NAMES[g]})` : ''}">${side ? 'C' : 'H'}</i>`; };
    const depts = DEPARTMENTS.map((d) => {
      const hid = d.props.filter((id) => (p.cat[id]?.[0] ?? 0) > 0).length, f = featOf(d.feat), done = p.feats.includes(d.feat);
      const reward = f.reward.item ? ITEMS[f.reward.item] : null;
      const tiles = d.props.map((id) => {
        const c = p.cat[id] ?? [0, 0];
        return `<div class="obj${c[0] || c[1] ? '' : ' none'}"><span>${esc(PROPS[PROP_INDEX[id]].name)}</span>${stamp(c[0], 0)}${stamp(c[1], 1)}</div>`;
      }).join('');
      return `<div class="sect"><div class="sectHead"><span>${esc(d.name.toUpperCase())}</span><small>${done ? `✓ ${esc(f.name)}` : `Hid ${hid}/${d.props.length}`}${reward ? ` · reward: ${esc(reward.name)}` : ''}</small></div><div class="objs">${tiles}</div></div>`;
    }).join('');
    return `<div class="catTop"><b>${total}</b><span>/ ${STAMPS_MAX} stamps</span><div class="lvlBar"><i style="width:${(total / STAMPS_MAX) * 100}%"></i></div></div>`
      + `<div class="dim small"><i class="stamp g1">H</i> <b>Hid:</b> survive a round disguised as it (and wearing it for the last 20 seconds). <i class="stamp g1">C</i> <b>Caught:</b> catch a prop disguised as it. `
      + `Stamps turn <span class="gs g2">silver</span> at ${GRADES[1]} and <span class="gs g3">gold</span> at ${GRADES[2]}; every new stamp pays XP and coins. Hide as everything in a department to earn its look.</div>${depts}`;
  }

  // ------------------------------------------------------------------ feats
  private featsTab(): string {
    const p = this.game.profile;
    const groups = [...new Set(FEATS.map((f) => f.group))];
    const done = p.feats.length;
    return `<div class="catTop"><b>${done}</b><span>/ ${FEATS.length} feats</span><div class="lvlBar"><i style="width:${(done / FEATS.length) * 100}%"></i></div></div>`
      + `<div class="dim small">Every feat pays out once and unlocks its name as a title, shown next to yours in the lobby and on the scoreboard.</div>`
      + groups.map((g) => `<div class="sect"><div class="sectHead"><span>${g.toUpperCase()}</span></div><div class="feats">${FEATS.filter((f) => f.group === g).map((f) => {
        const have = p.feats.includes(f.id), v = Math.min(f.goal, f.progress(p));
        const reward = [f.reward.coins ? `<i class="coin"></i>${f.reward.coins}` : '', f.reward.item ? esc(ITEMS[f.reward.item].name) : ''].filter(Boolean).join(' · ');
        const wear = have ? (p.kit.title === f.id ? '<em class="st on">WEARING</em>' : `<button class="st" data-wear="${f.id}">WEAR TITLE</button>`) : '';
        return `<div class="feat2${have ? ' done' : ''}"><div class="fh"><b>${esc(f.name)}</b>${wear}</div><small>${esc(f.desc)}</small>`
          + `<div class="fp"><div class="lvlBar"><i style="width:${(v / f.goal) * 100}%"></i></div><span>${have ? '✓' : `${n(v)}/${n(f.goal)}`}</span></div><div class="fr">Reward: ${reward}</div></div>`;
      }).join('')}</div></div>`).join('');
  }

  // ------------------------------------------------------------------ input
  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement, g = this.game, p = g.profile;
    const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
    if (tab) { this.tab = tab; this.confirm = ''; g.sfx.play('click'); this.render(); return; }
    const slot = t.closest<HTMLElement>('[data-slot]')?.dataset.slot as Slot | undefined;
    if (slot) { this.slot = slot; this.confirm = ''; g.sfx.play('click'); this.render(); return; }
    const pv = t.closest<HTMLElement>('[data-pv]')?.dataset.pv;
    if (pv !== undefined) { g.previewPop(Number(pv)); return; }
    const wear = t.closest<HTMLElement>('[data-wear]')?.dataset.wear;
    if (wear) { p.kit.title = wear; g.applyKit(); g.sfx.play('click'); this.render(); return; }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'close') { this.close(); return; }
    if (act === 'export') { void this.exportSave(t); return; }
    if (act === 'import') { this.importSave(); return; }
    const id = t.closest<HTMLElement>('[data-item]')?.dataset.item;
    if (!id) return;
    const it = ITEMS[id];
    if (owns(p, id)) {
      equip(p, id); this.confirm = ''; g.applyKit(); g.sfx.play('click');
      if (it.slot === 'pop') g.previewPop(POPS.indexOf(it as Pop));
    } else if ('price' in it.how) {
      if (this.confirm !== id) { this.confirm = id; g.sfx.play(p.coins >= it.how.price ? 'click' : 'deny'); }
      else {
        const r = buyItem(p, id);
        this.confirm = '';
        if (r.ok) { equip(p, id); g.applyKit(); g.sfx.play('levelup'); if (it.slot === 'pop') g.previewPop(POPS.indexOf(it as Pop)); }
        else { g.sfx.play('deny'); this.toast(r.why ?? ''); }
      }
    } else { g.sfx.play('deny'); this.toast(`Unlocks at: ${unlockText(it)}`); }
    this.render();
  }

  private onChange(e: Event) {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.act === 'title') { this.game.profile.kit.title = t.value; this.game.applyKit(); this.game.sfx.play('click'); }
  }

  private toast(msg: string) {
    const el = document.createElement('div');
    el.className = 'profToast'; el.textContent = msg;
    $('profile').appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  private async exportSave(btn: HTMLElement) {
    const code = exportCode(this.game.profile);
    try { await navigator.clipboard.writeText(code); btn.textContent = 'Copied!'; setTimeout(() => this.render(), 1500); }
    catch { prompt('Copy this save code and keep it somewhere safe:', code); }
  }

  private importSave() {
    const code = prompt('Paste a save code (it starts with PP1.):');
    if (!code) return;
    const next = importCode(code);
    if (!next) { this.toast('That is not a valid save code.'); this.game.sfx.play('deny'); return; }
    const a = xpLevel(this.game.profile.xp), b = xpLevel(next.xp);
    if (!confirm(`Replace the profile in this browser (level ${a}, ${n(this.game.profile.coins)} coins) with the one in the code (level ${b}, ${n(next.coins)} coins)?`)) return;
    this.game.profile = next;
    this.game.applyKit();
    this.game.sfx.play('levelup');
    this.render();
  }
}

