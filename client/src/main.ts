/** Entry point: menu flow and the glue between DOM buttons and the Game. */
import './style.css';
import { Game } from './game';

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
function showPause(v: boolean) { pauseOpen = v; pause.classList.toggle('hidden', !v); }
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

// first interaction unlocks audio and starts the menu tune
window.addEventListener('pointerdown', () => { game.sfx.unlock(); if (!game.inGame) game.sfx.music('lobby'); }, { once: true });
