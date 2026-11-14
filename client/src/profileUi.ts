/**
 * The profile screen on the main menu (Overview, Characters, Hunter locker, Prop wardrobe, Catalogue, Feats)
 * and the summary on the menu card.
 * Pure DOM: reads and changes `game.profile` through the rules in shared/progress.ts, then saves via game.applyKit().
 * When signed in, each change is also sent to the server (client/src/account.ts), whose answer is the final word.
 */
import {
  CHARS, DEPARTMENTS, FEATS, FEAT_INDEX, GRADES, GRADE_NAMES, GUNS, HATS, ITEMS, KIT, POPS, SLOTS, STAMPS_MAX, applyChange, exportCode, gradeOf, importCode,
  jobsFor, kitToWire, levelXp, msToNextDay, newProfile, owns, rankOf, rollJobs, stampCount, unlockText, utcDay, xpLevel,
  type Change, type Char, type Gun, type Item, type Paint, type Pop, type Slot, type Trail,
} from '../../shared/progress';
import { PROVIDER_NAMES, type Account } from './account';
import { saveProfile } from './profile';
import { HunterRig, buildGun, buildHat, buildViewmodel, paintMat } from './hunter';
import { Thumbs } from './thumbs';
import { PROPS, PROP_INDEX } from '../../shared/props';
import { esc } from './hud';
import type { Game } from './game';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const n = (v: number) => Math.floor(v).toLocaleString('en-US');
type Tab = 'overview' | 'chars' | 'hunter' | 'props' | 'catalogue' | 'feats';
const HUNTER_SLOTS: Slot[] = ['gun', 'trail', 'hat', 'paint'];
const PROP_SLOTS: Slot[] = ['eyes', 'pop'];

const SLOT_INFO: Record<Slot, [label: string, hint: string]> = {
  char: ['Characters', 'Who you are when you hunt. Every character has the same size, speed and hit box: it is only a look.'],
  gun: ['Blasters', 'What you zap with. Every blaster fires the same shot with the same rules; only the look and the flash change.'],
  trail: ['Zap trails', 'The streak your shots leave. Everyone in the room sees it.'],
  paint: ['Paint', 'Your uniform colour (or the robot\'s finish), and the trim on your blaster.'],
  hat: ['Hats', 'Worn by your character while you hunt.'],
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

const thumbs = new Thumbs();
const TIER_NAME = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' };

function itemIcon(it: Item): string {
  if (it.slot === 'paint') {
    const p = it as Paint;
    const shine = p.metal > 0.5 ? 'radial-gradient(circle at 35% 30%, #fff 0, transparent 45%),' : p.iri ? 'linear-gradient(135deg, rgba(255,180,230,.6), rgba(160,255,240,.5), rgba(200,190,255,.6)),' : '';
    return `<i class="sw big" style="background:${shine}${hex(p.hex)}"></i>`;
  }
  if (it.slot === 'eyes') return eyeIcon(it.id);
  if (it.slot === 'pop') return `<span class="dots">${(it as Pop).colors.slice(0, 5).map((c) => `<i style="background:${hex(c)}"></i>`).join('')}</span>`;
  if (it.slot === 'trail') {
    const t = it as Trail, cols = t.colors.length > 1 ? t.colors : [t.colors[0], t.colors[0]];
    const spark = (t.spark ?? []).slice(0, 4).map((c, i) => `<i style="background:${hex(c)};left:${12 + i * 22}%;top:${i % 2 ? 6 : 62}%"></i>`).join('');
    return `<span class="trailIco" style="--h:${(5 * t.width).toFixed(1)}px"><b style="background:linear-gradient(90deg,${cols.map(hex).join(',')})"></b>${spark}</span>`;
  }
  return '';
}

/** A thumbnail <img> that fills in when the 3D render is ready. */
function thumbImg(key: string, url: string, cls: string): string {
  return `<img class="${cls}" data-thumb="${esc(key)}" alt=""${url ? ` src="${url}"` : ''}>`;
}

export class ProfileUi {
  private tab: Tab = 'overview';
  private slot: Slot = 'hat';
  /** An item awaiting a second click to confirm the purchase. */
  private confirm = '';
  private openNow = false;
  /** Optional sign-in (set by main). */
  account: Account | null = null;
  /** An account request is under way: its buttons are disabled meanwhile. */
  private busy = false;

  /** The tile picture for an item: a 3D render for characters, blasters and hats, else a drawn icon. */
  private icon(it: Item): string {
    const w = kitToWire(this.game.profile), paint = w[KIT.paint];
    if (it.slot === 'char') {
      const ci = CHARS.indexOf(it as Char), key = `c${ci}.${paint}.${w[KIT.hat]}.${w[KIT.gun]}`;
      return thumbImg(key, thumbs.get(key, () => { const r = new HunterRig(paint, w[KIT.hat], ci, w[KIT.gun]); r.pose({ time: 0, stepT: 0, move: 0, pitch: 0.2, air: false, dizzy: false, kick: 0 }); return r.root; }, 'char'), 'thumb tall');
    }
    if (it.slot === 'gun') {
      // finger guns are just a hand: show it in your character's hand and sleeve
      const gi = GUNS.indexOf(it as Gun), hand = it.id === 'gun.fingers', key = hand ? `g${gi}.${paint}.${w[KIT.char]}` : `g${gi}.${paint}`;
      return thumbImg(key, thumbs.get(key, () => hand ? buildViewmodel(paint, w[KIT.char], gi) : buildGun(gi, paintMat(paint)), 'gun'), 'thumb wide');
    }
    if (it.slot === 'hat') {
      const hi = HATS.indexOf(it), key = `h${hi}.${paint}`;
      return thumbImg(key, thumbs.get(key, () => buildHat(hi, paintMat(paint)), 'hat'), 'thumb');
    }
    return itemIcon(it);
  }

  constructor(private game: Game) {
    $('profile').addEventListener('click', (e) => this.onClick(e));
    $('profile').addEventListener('change', (e) => this.onChange(e));
    this.renderCard();
    // the reset countdown on the card and the jobs list
    setInterval(() => { if (!this.game.inGame) { this.renderCard(); if (this.openNow && this.tab === 'overview') { const el = document.getElementById('jobReset'); if (el) el.textContent = this.resetIn(); } } }, 30_000);
  }

  get isOpen() { return this.openNow; }
  /** Asked to leave the profile (its close button): the menu decides where to go. */
  onExit: () => void = () => this.close();

  open(tab: Tab = this.tab) {
    this.tab = tab; this.openNow = true; this.confirm = '';
    $('profile').classList.remove('hidden');
    this.render();
  }

  close() {
    this.openNow = false; this.confirm = '';
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
    const on = !!this.account?.on;
    $('profBtn').classList.toggle('acct', on);
    $('profBtn').title = on ? 'Your profile, saved to your account' : 'Your profile, wardrobe, catalogue and feats';
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
    const tabs: [Tab, string][] = [['overview', 'Overview'], ['chars', 'Characters'], ['hunter', 'Hunter locker'], ['props', 'Prop wardrobe'], ['catalogue', 'Catalogue'], ['feats', 'Feats']];
    // the googly-eyed box beside the hunter only matters for the prop's looks
    this.game.showcaseOn = this.tab === 'props';
    const t = this.tab;
    const body = t === 'overview' ? this.overview() : t === 'chars' ? this.characters() : t === 'hunter' ? this.wardrobe(HUNTER_SLOTS) : t === 'props' ? this.wardrobe(PROP_SLOTS) : t === 'catalogue' ? this.catalogue() : this.featsTab();
    $('profile').innerHTML = `<div class="profHead"><div class="profTabs">${tabs.map(([t, l]) => `<button class="ptab${t === this.tab ? ' on' : ''}" data-tab="${t}">${l}</button>`).join('')}</div>`
      + `<span class="wallet"><i class="coin"></i><b>${n(this.game.profile.coins)}</b></span><button class="iconBtn" data-act="close" title="Close (Esc)" aria-label="Close">✕</button></div><div class="profBody">${body}</div>`;
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
    return this.accountSect() + `<div class="ovTop"><div class="bigTag"><b>${lvl}</b><small>${esc(rank.name)}</small></div><div class="ovMid">`
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
      + `<li><b>Characters and the Hunter locker:</b> who you hunt as and what you zap with. Looks only: every hunter plays the same.</li>`
      + `<li><b>Prop wardrobe:</b> googly eyes and catch pops. None of them can give a hiding prop away.</li>`
      + `<li><b>Catalogue:</b> a stamp for every object you survive as, and every one you catch.</li>`
      + `<li><b>Feats:</b> milestones that pay out and give you a title to wear.</li></ul></div>`
      + `<div class="sect"><div class="sectHead"><span>LIFETIME</span><small>since ${new Date(p.since).toLocaleDateString()}</small></div><div class="stats">${stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div></div>`
      + (this.account?.on
        ? `<div class="sect"><div class="sectHead"><span>BACKUP</span></div><div class="dim small">Your account's profile is kept on the server. A save code is a copy of it as a guest profile, for a browser where you do not sign in.</div>`
          + `<div class="row"><button class="btn small teal" data-act="export">Copy save code</button></div></div>`
        : `<div class="sect"><div class="sectHead"><span>BACKUP</span></div><div class="dim small">Your profile lives in this browser only. Copy a save code to move it to another browser or keep it safe.</div>`
          + `<div class="row"><button class="btn small teal" data-act="export">Copy save code</button><button class="btn small ghost" data-act="import">Restore from a code</button></div></div>`);
  }

  // ------------------------------------------------------------------ account (optional)
  private accountSect(): string {
    const a = this.account;
    if (!a || a.state === 'off') return '';
    const dis = this.busy ? ' disabled' : '';
    const err = a.error ? `<div class="acctErr">${esc(a.error)}</div>` : '';
    const sect = (head: string, body: string, cls = '') => `<div class="sect acct${cls}"><div class="sectHead"><span>${head}</span></div>${body}</div>`;
    if (a.state === 'guest') {
      const btns = (a.cfg?.providers ?? []).map((pv) => `<button class="btn small prov prov-${esc(pv)}" data-act="signin" data-prov="${esc(pv)}"${dis}>Continue with ${esc(PROVIDER_NAMES[pv] ?? pv)}</button>`).join('');
      return sect('SAVE YOUR PROGRESS · OPTIONAL', `<div class="dim small">Right now your profile lives only in this browser. Clearing its data, a private window or another device starts you again at level 1. `
        + `Sign in to keep it on the server and pick it up anywhere. You never need an account to play.</div>${err}<div class="row">${btns}</div>`
        + `<div class="dim small">Kept: your profile and an account id. Your name and email are never shown to other players; you choose your in-game name as before.</div>`);
    }
    if (a.state === 'loading') return sect('ACCOUNT', `<div class="dim small">Loading your account…</div>`);
    if (a.state === 'error') {
      return sect('ACCOUNT', `<div class="dim small">Signed in as <b>${esc(a.who)}</b>.</div>${err}<div class="row"><button class="btn small teal" data-act="retry"${dis}>Try again</button><button class="btn small ghost" data-act="signout"${dis}>Sign out</button></div>`, ' warn');
    }
    if (a.state === 'choose') {
      const g = this.game.guest, lvl = xpLevel(g.xp), has = g.xp > 0 || g.coins > 0 || g.life.rounds > 0;
      return sect('NEW ACCOUNT', `<div class="dim small">Signed in as <b>${esc(a.who)}</b>. This account has no profile yet.</div>${err}`
        + (has ? `<div class="dim small">Bring this browser's profile into it? <b>Level ${lvl}</b>, ${n(g.coins)} coins, ${stampCount(g)} stamps, ${g.feats.length} feats. `
          + `It can be brought in only once, and this browser then starts a fresh guest profile.</div>`
          + `<div class="row"><button class="btn small teal" data-act="startImport"${dis}>Bring my progress</button><button class="btn small ghost" data-act="startFresh"${dis}>Start fresh</button><button class="btn small ghost" data-act="signout"${dis}>Cancel</button></div>`
          : `<div class="row"><button class="btn small teal" data-act="startFresh"${dis}>Start my profile</button><button class="btn small ghost" data-act="signout"${dis}>Cancel</button></div>`), ' warn');
    }
    return sect('ACCOUNT', `<div class="dim small">Signed in as <b>${esc(a.who)}</b>. Your profile is saved on the server after every round, and goes wherever you sign in. `
      + `Practice games while you wait in line are not saved to it.</div>${err}`
      + `<div class="row"><button class="btn small ghost" data-act="signout"${dis}>Sign out</button><button class="btn small ghost danger" data-act="deleteAcct"${dis}>Delete account</button></div>`);
  }

  private async accountAct(act: string, el: HTMLElement) {
    const a = this.account, g = this.game;
    if (!a || this.busy) return;
    g.sfx.play('click');
    if (act === 'signin') { void a.signIn(el.dataset.prov ?? ''); return; }
    if (act === 'deleteAcct') {
      if (!confirm('Delete your account? Your level, coins, wardrobe, catalogue and feats in it are removed from the server for good.')) return;
      if (!confirm('Last check: this cannot be undone. Delete the account?')) return;
    }
    this.busy = true; this.render();
    try {
      if (act === 'signout') await a.signOut();
      else if (act === 'retry') await a.load();
      else if (act === 'startFresh') await a.start(null);
      else if (act === 'startImport') {
        // the guest profile goes into the account once; this browser then starts over, so it cannot be brought in twice
        if (await a.start(g.guest)) { g.guest = newProfile(); saveProfile(g.guest); }
      } else if (act === 'deleteAcct') { if (await a.deleteAccount()) this.toast('Your account has been deleted.'); }
    } finally { this.busy = false; g.useProfile(); this.render(); }
  }

  /**
   * Make a change to the profile (buy, wear, title): at once here, and on the server when signed in. If the server
   * says no, its copy comes back and replaces this one.
   */
  private commit(c: Change): boolean {
    const g = this.game, r = applyChange(g.profile, c);
    if (!r.ok) { g.sfx.play('deny'); this.toast(r.why ?? ''); return false; }
    g.applyKit();
    const a = this.account;
    if (a?.on) void a.change(c).then((res) => { if (!res.ok) { g.sfx.play('deny'); this.toast(res.why ?? 'That change was not saved.'); void a.load(); } });
    return true;
  }

  /** The buy / wear / locked label on a tile. */
  private state(it: Item): string {
    const p = this.game.profile, have = owns(p, it.id), on = p.kit[it.slot] === it.id, price = 'price' in it.how ? it.how.price : 0;
    return on ? '<em class="st on">WEARING</em>'
      : have ? '<em class="st">WEAR</em>'
      : price ? (this.confirm === it.id ? `<em class="st buy go">BUY FOR ${n(price)}?</em>` : `<em class="st buy${p.coins < price ? ' poor' : ''}"><i class="coin"></i>${n(price)}</em>`)
      : `<em class="st lock">${esc(unlockText(it))}</em>`;
  }

  // ------------------------------------------------------------------ characters
  private characters(): string {
    const p = this.game.profile, ownedN = CHARS.filter((c) => owns(p, c.id)).length;
    const cards = CHARS.map((c) => {
      const have = owns(p, c.id), on = p.kit.char === c.id;
      return `<div class="charCard t-${c.tier}${on ? ' on' : ''}${have ? '' : ' locked'}" data-item="${c.id}">${this.icon(c)}`
        + `<span class="tier">${TIER_NAME[c.tier]}</span><b class="cname">${esc(c.name)}</b><small class="blurb">${esc(c.blurb)}</small>${this.state(c)}</div>`;
    }).join('');
    return `<div class="dim small">${SLOT_INFO.char[1]} Your paint colours their uniform. <b>${ownedN}/${CHARS.length}</b> owned.</div><div class="chars">${cards}</div>`
      + `<div class="dim small">Rarity is just a label. Some characters can only be earned through feats.</div>`;
  }

  // ------------------------------------------------------------------ hunter locker and prop wardrobe
  private wardrobe(slotList: Slot[]): string {
    const p = this.game.profile;
    if (!slotList.includes(this.slot)) this.slot = slotList[0];
    const slots = slotList.map((s) => `<button class="ptab sm${s === this.slot ? ' on' : ''}" data-slot="${s}">${SLOT_INFO[s][0]}</button>`).join('');
    const items = SLOTS[this.slot].map((it) => {
      const have = owns(p, it.id), on = p.kit[it.slot] === it.id;
      const pv = it.slot === 'pop' ? `<span class="pv" data-pv="${POPS.indexOf(it as Pop)}" title="Preview">▶</span>` : '';
      const tier = (it as Gun).tier ? ` t-${(it as Gun).tier}` : '';
      const tip = (it as Gun).blurb ? ` title="${esc((it as Gun).blurb)}"` : '';
      return `<div class="item${tier}${on ? ' on' : ''}${have ? '' : ' locked'}" data-item="${it.id}"${tip}>${this.icon(it)}<span class="iname">${esc(it.name)}</span>${this.state(it)}${pv}</div>`;
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
    if (wear) { if (this.commit({ op: 'title', id: wear })) g.sfx.play('click'); this.render(); return; }
    const actEl = t.closest<HTMLElement>('[data-act]'), act = actEl?.dataset.act;
    if (act === 'close') { this.onExit(); return; }
    if (act && actEl && ['signin', 'signout', 'retry', 'startFresh', 'startImport', 'deleteAcct'].includes(act)) { void this.accountAct(act, actEl); return; }
    if (act === 'export') { void this.exportSave(t); return; }
    if (act === 'import') { this.importSave(); return; }
    const id = t.closest<HTMLElement>('[data-item]')?.dataset.item;
    if (!id) return;
    const it = ITEMS[id];
    const show = () => { if (it.slot === 'pop') g.previewPop(POPS.indexOf(it as Pop)); else if (it.slot === 'gun' || it.slot === 'trail' || it.slot === 'char') g.previewShot(); };
    if (owns(p, id)) {
      this.confirm = '';
      if (this.commit({ op: 'equip', id })) { g.sfx.play('click'); show(); }
    } else if ('price' in it.how) {
      if (this.confirm !== id) { this.confirm = id; g.sfx.play(p.coins >= it.how.price ? 'click' : 'deny'); }
      else {
        this.confirm = '';
        if (this.commit({ op: 'buy', id })) { g.sfx.play('levelup'); show(); }
      }
    } else { g.sfx.play('deny'); this.toast(`Unlocks at: ${unlockText(it)}`); }
    this.render();
  }

  private onChange(e: Event) {
    const t = e.target as HTMLSelectElement;
    if (t.dataset.act === 'title' && this.commit({ op: 'title', id: t.value })) this.game.sfx.play('click');
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
    if (this.account?.on) { this.toast('Save codes restore a guest profile. Sign out first.'); return; }
    const code = prompt('Paste a save code (it starts with PP1.):');
    if (!code) return;
    const next = importCode(code);
    if (!next) { this.toast('That is not a valid save code.'); this.game.sfx.play('deny'); return; }
    const a = xpLevel(this.game.profile.xp), b = xpLevel(next.xp);
    if (!confirm(`Replace the profile in this browser (level ${a}, ${n(this.game.profile.coins)} coins) with the one in the code (level ${b}, ${n(next.coins)} coins)?`)) return;
    this.game.guest = this.game.profile = next;
    this.game.applyKit();
    this.game.sfx.play('levelup');
    this.render();
  }
}

