/** Entry point: menu flow and the glue between DOM buttons and the Game. */
import './style.css';
import { Game } from './game';
import { assets } from './assets';
import { initTouch, isTouchDevice } from './touch';
import { AudioEngine, renderWav } from './audio';
import { SFX } from './sound/dsp';
import { STINGS } from './sound/songs';

declare const __BUILD__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
try { assets.lite = localStorage.getItem('pp_quality') === 'low'; } catch { /* default */ }
await assets.init(); // the asset manifest: which models, textures and skies exist
const game = new Game($<HTMLCanvasElement>('c'));
// the web font loads without blocking first paint: switch it on once it has arrived
for (const l of document.querySelectorAll<HTMLLinkElement>('link[data-async]')) { if (l.sheet) l.media = 'all'; else l.addEventListener('load', () => { l.media = 'all'; }); }
// debugging and automated tests reach the game through ?debug; normal play exposes nothing on window
try {
  if (new URLSearchParams(location.search).has('debug')) sessionStorage.setItem('pp_debug', '1'); // survives the URL being rewritten to the room link
  if (sessionStorage.getItem('pp_debug') === '1') { (window as any).__pp = game; (window as any).__assets = assets; (window as any).__audio = { renderWav, AudioEngine }; }
} catch { /* storage blocked: no debug handle */ }

const menu = $('menu'), pause = $('pause'), conn = $('conn');
const nameInput = $<HTMLInputElement>('nameInput'), codeInput = $<HTMLInputElement>('codeInput'), err = $('menuError');
const FUN = ['Duck', 'Teddy', 'Rocket', 'Wobble', 'Sneaky', 'Biscuit', 'Gumball', 'Cone'];

nameInput.value = localStorage.getItem('pp_name') ?? `${FUN[Math.floor(Math.random() * FUN.length)]}${Math.floor(10 + Math.random() * 90)}`;
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) codeInput.value = roomParam.toUpperCase().slice(0, 4);

let connecting = false;
function setBusy(b: boolean) {
  connecting = b;
  for (const id of ['quickBtn', 'createBtn', 'joinBtn']) $<HTMLButtonElement>(id).disabled = b;
  if (b) err.textContent = 'Connecting…';
}

function play(mode: 'quick' | 'create' | 'join') {
  if (connecting) return;
  const name = nameInput.value.trim() || 'Player';
  localStorage.setItem('pp_name', name);
  const code = codeInput.value.trim().toUpperCase();
  if (mode === 'join' && code.length !== 4) { err.textContent = 'Enter the 4-letter room code.'; return; }
  game.sfx.unlock(); game.sfx.play('click');
  go('play');
  setBusy(true);
  game.join(name, mode, code);
}

$('quickBtn').onclick = () => play('quick');
$('createBtn').onclick = () => play('create');
$('joinBtn').onclick = () => play('join');
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') play('join'); });
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(codeInput.value.trim().length === 4 ? 'join' : 'quick'); });

function toMenu(message = '') {
  game.leave();
  game.net.forget();
  showPause(false);
  menu.classList.remove('hidden'); conn.classList.add('hidden'); document.body.classList.remove('ingame');
  go('play');
  setBusy(false);
  err.textContent = message;
  history.replaceState(null, '', location.pathname);
  game.sfx.music('lobby');
  game.onMenu();
}

game.net.onState = (s, info) => {
  if (s === 'open') {
    setBusy(false); err.textContent = '';
    menu.classList.add('hidden'); conn.classList.add('hidden'); document.body.classList.add('ingame');
    history.replaceState(null, '', `?room=${game.net.code}`);
    // after a refresh the browser will not hand the mouse back without a click: say so instead of looking frozen
    // (not in the lobby, where the mouse is needed for the buttons)
    if (resuming && !isTouchDevice()) setTimeout(() => { if (game.inGame && game.phase !== 'lobby' && !game.locked) showPause(true); }, 50);
  } else if (s === 'reconnecting') {
    conn.classList.remove('hidden');
  } else toMenu(resuming ? '' : info ?? 'Disconnected.');
  resuming = false;
};

// a refresh mid-game puts you straight back in your seat
let resuming = game.net.resume();
if (resuming) setBusy(true);

// ---------------------------------------------------------------- pause overlay
// a slim card (resume, settings, how to play, leave); Settings and How to play are the same sheets the menu shows
let pauseOpen = false;
type SheetName = 'settings' | 'guide';
const sheetHome: Record<SheetName, HTMLElement> = { settings: $('pgSettings'), guide: $('pgGuide') };
const sheetEl: Record<SheetName, HTMLElement> = { settings: $('settings'), guide: $('howto') };
let sheetIn: SheetName | '' = '';
function openSheet(n: SheetName) {
  closeSheet();
  pause.querySelector('.sheetSlot')!.appendChild(sheetEl[n]);
  pause.classList.add('sheetOn'); sheetIn = n; syncSettings();
}
function closeSheet() {
  if (!sheetIn) return;
  sheetHome[sheetIn].appendChild(sheetEl[sheetIn]);
  pause.classList.remove('sheetOn'); sheetIn = '';
  stopSoundTest();
}
function showPause(v: boolean) {
  pauseOpen = v; game.touchPaused = v; pause.classList.toggle('hidden', !v);
  if (!v) closeSheet(); else syncSettings();
}
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('c');
  if (locked) showPause(false);
  else if (game.inGame && game.phase !== 'lobby') showPause(true);
});
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (game.inGame) { if (!game.locked) { if (sheetIn) closeSheet(); else showPause(!pauseOpen); } }
  else if (page !== 'play') go('play');
});
// a pause panel left open (or raised by a reload during the results) must not cover the lobby after a game
game.onLobby = () => { if (pauseOpen) showPause(false); };
$('resumeBtn').onclick = () => { showPause(false); game.requestLock(); };
$('leaveBtn').onclick = () => toMenu();
$('pSetBtn').onclick = () => openSheet('settings');
$('pHowBtn').onclick = () => openSheet('guide');
if (isTouchDevice()) initTouch(game, () => showPause(true));

// ---------------------------------------------------------------- lobby panel
$('startBtn').onclick = () => { game.net.send({ t: 'start' }); game.requestLock(); };
$('botsPlus').onclick = () => game.net.send({ t: 'bots', n: game.lobbyInfo.bots + 1 });
$('botsMinus').onclick = () => game.net.send({ t: 'bots', n: Math.max(0, game.lobbyInfo.bots - 1) });
$('copyLink').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${game.code}`;
  try { await navigator.clipboard.writeText(url); $('copyLink').textContent = 'Link copied!'; }
  catch { prompt('Share this link with friends:', url); }
  setTimeout(() => ($('copyLink').textContent = 'Copy invite link'), 1800);
};

// HUD buttons give focus straight back so game keys can't re-trigger them
for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>('#hud button, #pause button'))) b.addEventListener('click', () => b.blur());

// ---------------------------------------------------------------- profile: level, wardrobe, catalogue, feats, odd jobs
import { ROUND_CHOICES } from '../../shared/constants';
import type { Quality } from './game';
import { ProfileUi } from './profileUi';
const profileUi = new ProfileUi(game);
game.onMenu = () => profileUi.render();
game.onBanked = () => profileUi.renderCard();

// ---------------------------------------------------------------- settings
const sens = $<HTMLInputElement>('sensRange'), fov = $<HTMLInputElement>('fovRange'), vol = $<HTMLInputElement>('volRange');
const mus = $<HTMLInputElement>('musRange'), invY = $<HTMLInputElement>('invY'), hud = $<HTMLInputElement>('hudRange');
const soundT = $<HTMLInputElement>('soundToggle'), calmT = $<HTMLInputElement>('calmToggle'), fsT = $<HTMLInputElement>('fsToggle');
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
sens.value = String(game.sens / 0.0022); fov.value = String(game.baseFov); vol.value = String(game.sfx.volume);
mus.value = String(game.sfx.musicVol); invY.checked = game.invertY; hud.value = String(game.hudScale);
sens.oninput = () => { game.sens = Number(sens.value) * 0.0022; store('pp_sens', String(game.sens)); };
fov.oninput = () => { game.baseFov = Number(fov.value); store('pp_fov', fov.value); };
vol.oninput = () => { game.sfx.setVolume(Number(vol.value)); store('pp_vol', vol.value); };
mus.oninput = () => { game.sfx.setMusicVolume(Number(mus.value)); store('pp_mus', mus.value); };
hud.oninput = () => { game.hudScale = Number(hud.value); store('pp_hud', hud.value); game.relayout(); };
invY.onchange = () => { game.invertY = invY.checked; store('pp_invy', invY.checked ? '1' : '0'); };
soundT.onchange = () => { if (soundT.checked === game.sfx.muted) { const m = game.sfx.toggleMute(); store('pp_mute', m ? '1' : '0'); } syncSettings(); };
$('muteBtn').onclick = () => { const m = game.sfx.toggleMute(); store('pp_mute', m ? '1' : '0'); syncSettings(); };
{
  let calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { const c = localStorage.getItem('pp_calm'); if (c) calm = c === '1'; } catch { /* default */ }
  document.body.classList.toggle('calm', calm); calmT.checked = calm;
  calmT.onchange = () => { document.body.classList.toggle('calm', calmT.checked); store('pp_calm', calmT.checked ? '1' : '0'); };
}
// graphics: three presets side by side instead of a button that cycles
const gfxSeg = $('gfxSeg');
gfxSeg.onclick = (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-q]'), q = b?.dataset.q as Quality | undefined;
  if (!b || !q || q === game.quality) return;
  // say so first, then apply on the next frame: rebuilding shadows (or the whole scene, for Fast) takes a moment
  b.classList.add('busy'); b.textContent = '…';
  setTimeout(() => { game.setQuality(q); b.classList.remove('busy'); b.textContent = q === 'low' ? 'Fast' : q === 'high' ? 'High' : 'Ultra'; syncSettings(); }, 60);
};
game.onQuality = () => syncSettings();
// settings tabs
$('settings').querySelector('.setTabs')!.addEventListener('click', (e) => {
  const st = (e.target as HTMLElement).closest<HTMLElement>('[data-st]')?.dataset.st;
  if (!st) return;
  game.sfx.play('click');
  for (const t of $('settings').querySelectorAll<HTMLElement>('.stab')) t.classList.toggle('on', t.dataset.st === st);
  for (const g of $('settings').querySelectorAll<HTMLElement>('.sg')) g.hidden = g.dataset.sg !== st;
});
// the number beside each slider
function syncOutputs() {
  for (const o of document.querySelectorAll<HTMLOutputElement>('#settings output[data-for]')) {
    const v = Number($<HTMLInputElement>(o.dataset.for!).value);
    o.textContent = 'pct' in o.dataset ? `${Math.round(v * 100)}%` : 'x' in o.dataset ? `${v.toFixed(2)}×` : `${v}°`;
  }
}
$('settings').addEventListener('input', syncOutputs);
function syncSettings() {
  for (const b of gfxSeg.querySelectorAll<HTMLElement>('[data-q]')) b.classList.toggle('on', b.dataset.q === game.quality);
  soundT.checked = !game.sfx.muted;
  $('muteBtn').textContent = `Sound: ${game.sfx.muted ? 'Off' : 'On'}`;
  syncOutputs();
}

// ---------------------------------------------------------------- full screen (laptops, PCs and phones)
{
  const root = document.documentElement as any, doc = document as any;
  const can = !!(root.requestFullscreen || root.webkitRequestFullscreen);
  const isFs = () => !!(document.fullscreenElement || doc.webkitFullscreenElement);
  document.body.classList.toggle('noFs', !can); // iPhone Safari: Add to Home Screen is the only way
  const toggle = (on = !isFs()) => {
    try {
      if (!on) { if (isFs()) Promise.resolve((document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document)).catch(() => {}); }
      else if (!isFs()) Promise.resolve((root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root, { navigationUI: 'hide' })).catch(() => {});
    } catch { /* refused */ }
    if (isTouchDevice()) store('pp_autofs', on ? '1' : '0');
  };
  const sync = () => {
    const on = isFs();
    document.body.classList.toggle('isFs', on); fsT.checked = on;
    $('pFsBtn').textContent = on ? 'Exit full screen' : 'Full screen';
    $('fsBtn').title = on ? 'Leave full screen' : 'Full screen';
  };
  $('fsBtn').onclick = () => toggle();
  $('pFsBtn').onclick = () => toggle();
  fsT.onchange = () => toggle(fsT.checked);
  document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
  sync();
}

// ---------------------------------------------------------------- menu pages: Play, Profile, Settings, How to play
type Page = 'play' | 'profile' | 'settings' | 'guide';
let page: Page = 'play';
function go(p: Page, tab?: 'overview') {
  if (p !== 'settings') stopSoundTest();
  page = p; menu.dataset.page = p;
  for (const b of menu.querySelectorAll<HTMLElement>('.nav')) b.classList.toggle('on', b.dataset.go === p);
  if (p === 'profile') profileUi.open(tab); else if (profileUi.isOpen) profileUi.close();
  if (p === 'settings') syncSettings();
  game.menuShift = p === 'profile' ? 1 : 0;
}
menu.addEventListener('click', (e) => {
  const to = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go as Page | undefined;
  if (to && to !== page) { game.sfx.play('click'); go(to); }
});
$('profBtn').onclick = () => { game.sfx.play('click'); go('profile', 'overview'); };
$('jobsMini').onclick = () => go('profile', 'overview');
profileUi.onExit = () => go('play');
$('closeSettings').onclick = () => { if (sheetIn) closeSheet(); else go('play'); };
$('howClose').onclick = $('howGo').onclick = () => { if (sheetIn) closeSheet(); else go('play'); };
// your name on the chip in the top bar
const meName = () => { $('meName').textContent = nameInput.value.trim() || 'Player'; };
nameInput.addEventListener('input', meName); meName();
$('mapBtn').onclick = () => game.net.send({ t: 'map', m: (game.lobbyInfo.map + 1) % 3 });
$('roundsBtn').onclick = () => game.net.send({ t: 'rounds', n: ROUND_CHOICES[(ROUND_CHOICES.indexOf(game.lobbyInfo.rounds) + 1) % ROUND_CHOICES.length] });
// soft tick when the pointer moves onto anything clickable
let lastHover: Element | null = null;
document.addEventListener('mouseover', (e) => {
  const el = (e.target as HTMLElement).closest?.('.btn, .ptab, .item, .bind button') ?? null;
  if (el && el !== lastHover && !(el as HTMLButtonElement).disabled) game.sfx.play('hover');
  lastHover = el;
});

// ---------------------------------------------------------------- live player count + boot splash
fetch('/health').then((r) => r.json()).then((h) => { if (h.humans > 0) $('online').textContent = `● ${h.humans} playing right now`; }).catch(() => {});
{
  // hold the splash until the first map's models and textures are in (or ten seconds, on a slow line)
  const boot = $('boot'), bar = boot.querySelector<HTMLElement>('.bootBar i'), t0 = performance.now();
  const tick = () => {
    const waited = performance.now() - t0;
    if (bar) { bar.style.animation = 'none'; bar.style.width = `${Math.round(Math.min(1, assets.progress) * 100)}%`; }
    if ((assets.progress >= 0.999 && waited > 300) || waited > 10000) { boot.classList.add('done'); setTimeout(() => boot.remove(), 600); }
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(() => requestAnimationFrame(tick));
}

// ---------------------------------------------------------------- key bindings, settings from the menu, how-to
import { ACTIONS, B, keyLabel, resetBinds, setBind } from './keys';
let listening = '';
function renderBinds() {
  $('binds').innerHTML = ACTIONS.map(([id, label]) => `<div class="bind"><span>${label}</span><button data-a="${id}" class="${listening === id ? 'listening' : ''}">${listening === id ? 'press a key…' : keyLabel(B[id])}</button></div>`).join('');
}
$('binds').onclick = (e) => { const a = (e.target as HTMLElement).dataset.a; if (a) { listening = a; renderBinds(); } };
$('resetBinds').onclick = () => { resetBinds(); listening = ''; renderBinds(); };
window.addEventListener('keydown', (e) => {
  if (!listening) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (e.code !== 'Escape') setBind(listening, e.code);
  listening = ''; renderBinds();
}, true);
renderBinds();
// ---------------------------------------------------------------- sound test: hear every track and effect
let stopSoundTest = () => {};
{
  const sel = $<HTMLSelectElement>('sndSel');
  const music: [string, string, number][] = [['Menu theme', 'lobby', 0], ['Hiding', 'sneak', 0], ['Hunt (calm)', 'hunt', 0], ['Hunt (close call)', 'hunt', 1], ['Panic time', 'panic', 0]];
  sel.innerHTML = `<optgroup label="Music">${music.map(([l], i) => `<option value="m${i}">${l}</option>`).join('')}</optgroup>`
    + `<optgroup label="Effects">${[...Object.keys(STINGS), ...Object.keys(SFX)].map((n) => `<option value="s:${n}">${n}</option>`).join('')}</optgroup>`;
  let testing = false;
  $('sndPlay').onclick = () => {
    game.sfx.unlock();
    const v = sel.value;
    if (v.startsWith('m')) { const [, mode, i] = music[Number(v.slice(1))]; game.sfx.music('none'); game.sfx.setIntensity(i); game.sfx.music(mode); testing = true; }
    else game.sfx.play(v.slice(2));
  };
  const stop = () => { if (testing) { testing = false; game.sfx.setIntensity(0); game.syncMusic(); } };
  $('sndStop').onclick = stop;
  stopSoundTest = stop;
}
// first visit: open on How to play (unless arriving through an invite link, which should go straight to Join)
if (!localStorage.getItem('pp_seen')) { store('pp_seen', '1'); if (!roomParam && !resuming) go('guide'); }
$('build').textContent = `build ${__BUILD__}`;

// first interaction unlocks audio and starts the menu tune
window.addEventListener('pointerdown', () => { game.sfx.unlock(); if (!game.inGame) game.sfx.music('lobby'); }, { once: true });
