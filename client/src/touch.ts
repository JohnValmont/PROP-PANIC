/**
 * Touch controls for phones and tablets: a floating stick under the left thumb, drag anywhere on the
 * right to look, and buttons for everything a keyboard would do. Buttons replay the bound key, so
 * they always do exactly what the keyboard does.
 */
import type { Game } from './game';
import { B } from './keys';

export function isTouchDevice(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has('touch')) return true;
  return matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function initTouch(game: Game, openMenu: () => void) {
  const $ = (id: string) => document.getElementById(id)!;
  const root = $('touch'), stick = $('tStick'), knob = stick.firstElementChild as HTMLElement;
  root.classList.remove('hidden');
  document.body.classList.add('touch');
  game.touch = true; game.helpOn = false;
  const R = 56; // stick travel in px
  let stickId = -1, lookId = -1, sx = 0, sy = 0, lx = 0, ly = 0;

  root.addEventListener('touchstart', (e) => {
    e.preventDefault();
    game.sfx.unlock();
    for (const t of Array.from(e.changedTouches)) {
      if ((t.target as HTMLElement).closest('button')) continue;
      if (t.clientX < innerWidth * 0.45 && stickId < 0) {
        stickId = t.identifier; sx = t.clientX; sy = t.clientY;
        stick.style.left = `${sx}px`; stick.style.top = `${sy}px`; stick.classList.add('on'); knob.style.transform = '';
      } else if (lookId < 0) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: false });
  root.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) {
        let dx = (t.clientX - sx) / R, dy = (t.clientY - sy) / R;
        const len = Math.hypot(dx, dy);
        if (len > 1) { dx /= len; dy /= len; }
        const dead = len < 0.18;
        game.stick.x = dead ? 0 : dx; game.stick.y = dead ? 0 : dy;
        knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
      } else if (t.identifier === lookId) {
        game.turn((t.clientX - lx) * 2.6, (t.clientY - ly) * 2.6);
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: false });
  const end = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === stickId) { stickId = -1; game.stick.x = game.stick.y = 0; stick.classList.remove('on'); }
      if (t.identifier === lookId) lookId = -1;
    }
  };
  root.addEventListener('touchend', end); root.addEventListener('touchcancel', end);

  const key = (code: string, down: boolean) => document.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
  const hold = (id: string, on: () => void, off: () => void) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); game.sfx.unlock(); el.classList.add('down'); on(); }, { passive: false });
    const up = (e: Event) => { e.preventDefault(); el.classList.remove('down'); off(); };
    el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  };
  hold('tAct', () => game.touchFire(true), () => game.touchFire(false));
  hold('tJump', () => key(B.jump, true), () => key(B.jump, false));
  hold('tQ', () => key(B.ab1, true), () => key(B.ab1, false));
  hold('tF', () => key(B.ab2, true), () => key(B.ab2, false));
  hold('tDash', () => key(B.dash, true), () => key(B.dash, false));
  hold('tTaunt', () => key(B.taunt, true), () => key(B.taunt, false));
  hold('tMenu', () => {}, openMenu);

  // labels follow your role
  setInterval(() => {
    const hunter = game.team === 'hunter';
    root.style.visibility = game.inGame ? 'visible' : 'hidden'; // never show through the main menu
    const set = (id: string, text: string, show = true) => { const el = $(id); if (el.textContent !== text) el.textContent = text; el.style.display = show ? '' : 'none'; };
    set('tAct', hunter ? 'ZAP' : 'BECOME');
    set('tQ', hunter ? 'SCAN' : 'DECOY'); set('tF', hunter ? 'SHOCK' : 'GHOST');
    set('tDash', 'DASH', !hunter); set('tTaunt', 'TAUNT', !hunter);
  }, 100);
}
