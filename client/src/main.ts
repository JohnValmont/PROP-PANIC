/** Entry point: menu flow and the glue between DOM buttons and the Game. */
import './style.css';
import { Game } from './game';

declare const __BUILD__: string;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const game = new Game($<HTMLCanvasElement>('c'));
(window as any).__pp = game; // handy for debugging and automated tests; the server remains authoritative

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
  menu.classList.remove('hidden'); pause.classList.add('hidden'); conn.classList.add('hidden');
  setBusy(false);
  err.textContent = message;
  history.replaceState(null, '', location.pathname);
  game.sfx.music('lobby');
  game.onMenu();
}

game.net.onState = (s, info) => {
  if (s === 'open') {
    setBusy(false); err.textContent = '';
    menu.classList.add('hidden'); conn.classList.add('hidden');
    history.replaceState(null, '', `?room=${game.net.code}`);
  } else if (s === 'reconnecting') {
    conn.classList.remove('hidden');
  } else toMenu(resuming ? '' : info ?? 'Disconnected.');
  resuming = false;
};

// a refresh mid-game puts you straight back in your seat
let resuming = game.net.resume();
if (resuming) setBusy(true);

// ---------------------------------------------------------------- pause overlay
let pauseOpen = false;
function showPause(v: boolean) { pauseOpen = v; pause.classList.toggle('hidden', !v); if (v && game.inGame) { pause.classList.remove('menuMode'); $('pauseTitle').textContent = 'Paused'; } }
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('c');
  if (locked) showPause(false);
  else if (game.inGame && game.phase !== 'lobby') showPause(true);
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game.inGame && !game.locked) showPause(!pauseOpen);
});
$('resumeBtn').onclick = () => { showPause(false); game.requestLock(); };
$('leaveBtn').onclick = () => toMenu();
const gfx = $('gfxBtn'), mute = $('muteBtn');
const label = () => { gfx.textContent = `Graphics: ${game.quality === 'high' ? 'High' : 'Fast'}`; mute.textContent = `Sound: ${game.sfx.muted ? 'Off' : 'On'}`; };
gfx.onclick = () => { game.setQuality(game.quality === 'high' ? 'low' : 'high'); label(); };
mute.onclick = () => { const m = game.sfx.toggleMute(); localStorage.setItem('pp_mute', m ? '1' : '0'); label(); };
label();

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

// ---------------------------------------------------------------- profile: level, hunter colour and hat
import { HATS, HAT_LEVEL, HUNTER_COLORS, levelXp, xpLevel } from '../../shared/constants';
function renderProfile() {
  const lvl = xpLevel(game.xp), lo = levelXp(lvl), hi = levelXp(lvl + 1);
  $('lvlBadge').textContent = String(lvl);
  $('lvlXp').textContent = `${Math.round(game.xp - lo)} / ${hi - lo} XP`;
  $('lvlFill').style.width = `${Math.min(100, ((game.xp - lo) / (hi - lo)) * 100)}%`;
  const color = game.look >> 3, hat = game.look & 7;
  $('swatches').innerHTML = HUNTER_COLORS.map((c, i) => `<div class="sw${i === color ? ' on' : ''}" data-c="${i}" style="background:#${c.toString(16).padStart(6, '0')}"></div>`).join('');
  $('hats').innerHTML = HATS.map((h, i) => `<button class="hat${i === hat ? ' on' : ''}" data-h="${i}" ${lvl < HAT_LEVEL[i] ? 'disabled' : ''}>${h}${lvl < HAT_LEVEL[i] ? ` · Lv ${HAT_LEVEL[i]}` : ''}</button>`).join('');
}
$('swatches').onclick = (e) => { const c = (e.target as HTMLElement).dataset.c; if (c !== undefined) { game.setLook(Number(c) * 8 + (game.look & 7)); game.sfx.play('click'); renderProfile(); } };
$('hats').onclick = (e) => { const h = (e.target as HTMLElement).dataset.h; if (h !== undefined) { game.setLook((game.look >> 3) * 8 + Number(h)); game.sfx.play('click'); renderProfile(); } };
if (xpLevel(game.xp) < HAT_LEVEL[game.look & 7]) game.setLook((game.look >> 3) * 8);
renderProfile();
game.onMenu = renderProfile;

// ---------------------------------------------------------------- settings sliders
const sens = $<HTMLInputElement>('sensRange'), fov = $<HTMLInputElement>('fovRange'), vol = $<HTMLInputElement>('volRange');
sens.value = String(game.sens / 0.0022); fov.value = String(game.baseFov); vol.value = String(game.sfx.volume);
sens.oninput = () => { game.sens = Number(sens.value) * 0.0022; localStorage.setItem('pp_sens', String(game.sens)); };
fov.oninput = () => { game.baseFov = Number(fov.value); localStorage.setItem('pp_fov', fov.value); };
vol.oninput = () => { game.sfx.setVolume(Number(vol.value)); localStorage.setItem('pp_vol', vol.value); };

// ---------------------------------------------------------------- live player count + boot splash
fetch('/health').then((r) => r.json()).then((h) => { if (h.humans > 0) $('online').textContent = `● ${h.humans} playing right now`; }).catch(() => {});
requestAnimationFrame(() => requestAnimationFrame(() => { $('boot').classList.add('done'); setTimeout(() => $('boot').remove(), 600); }));

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
$('setBtn').onclick = () => { pause.classList.add('menuMode'); $('pauseTitle').textContent = 'Settings'; showPause(true); };
$('closeSettings').onclick = () => { showPause(false); pause.classList.remove('menuMode'); $('pauseTitle').textContent = 'Paused'; };
$('howBtn').onclick = () => $('howto').classList.remove('hidden');
$('howClose').onclick = () => $('howto').classList.add('hidden');
if (!localStorage.getItem('pp_seen')) { localStorage.setItem('pp_seen', '1'); $('howto').classList.remove('hidden'); }
$('build').textContent = `build ${__BUILD__}`;

// first interaction unlocks audio and starts the menu tune
window.addEventListener('pointerdown', () => { game.sfx.unlock(); if (!game.inGame) game.sfx.music('lobby'); }, { once: true });
