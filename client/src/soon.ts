/**
 * Coming soon: new game modes, presented as boxed games on the stock-room shelf.
 *
 * - the Play card's mode row: Classic (on sale now) and the boxed modes, each with a COMING SOON price tag
 * - the Coming soon page: a shelf of boxes; click one to unbox it (how it plays, players, why it is different)
 * - a teaser on the hero and a line in the private-room lobby
 *
 * Every mode here was picked because it changes what a player decides during a round, reuses systems the game
 * already has (roles, Focus, decoys, the catalogue's objects, haunting), and is fun with a small group. Nothing has a
 * date. "Want it" is kept in this browser only (`pp_wants`), so no counts are shown.
 * Bump SOON_VERSION whenever the list changes: the NEW badge on the menu tab comes back for everyone.
 *
 * The box art is drawn here in SVG in the game's own style: thick ink outlines, flat colour, googly eyes.
 */
import type { Game } from './game';

export const SOON_VERSION = '2';

// ------------------------------------------------------------------------------------------------ the box art kit
const INK = '#22223b', WHITE = '#fffdf6', GOLD = '#f2b544', WOOD = '#c8894f', WOOD2 = '#a86d3a', ROBOT = '#e9ecf5', ACC = '#ff6b35';
/** A group at (x, y), scaled, whose children inherit one ink outline that stays 3 units wide whatever the scale. */
const g = (x: number, y: number, s: number, inner: string, rot = 0) =>
  `<g transform="translate(${x} ${y})${rot ? ` rotate(${rot})` : ''} scale(${s})" stroke="${INK}" stroke-width="${(3 / s).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round">${inner}</g>`;
/** A googly eye: the pupil sits (dx, dy) off centre, as a fraction of the room it has. */
const eye = (x: number, y: number, r: number, dx = 0, dy = 0) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x + dx * r * 0.45}" cy="${y + dy * r * 0.45}" r="${r * 0.5}" fill="${INK}" stroke="none"/>`;
const eyes = (x: number, y: number, r: number, dx = 0, dy = 0, gap = 2.15) => eye(x - r * gap / 2, y, r, dx, dy) + eye(x + r * gap / 2, y, r, dx, dy);
const shadow = (x: number, y: number, rx: number) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx * 0.2}" fill="rgba(0,0,0,0.2)" stroke="none"/>`;
// the floor runs well past the canvas, so a scene fitted into a wider or taller frame never shows its edge
const floor = (y = 100) => `<rect x="-400" y="${y}" width="960" height="400" fill="rgba(0,0,0,0.14)" stroke="none"/><path d="M-400 ${y}H560" stroke="rgba(0,0,0,0.22)" stroke-width="2" fill="none"/>`;
const sparkle = (x: number, y: number, r: number, c = '#fff') => `<path d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}Z" fill="${c}" stroke="none"/>`;
const drop = (x: number, y: number, s = 1) => g(x, y, s, '<path d="M0 -7C3 -2 5 1 5 3.5A5 5 0 0 1 -5 3.5C-5 1 -3 -2 0 -7Z" fill="#9be7ff"/>');
const motion = (x: number, y: number, n = 3) => Array.from({ length: n }, (_, i) => `<path d="M${x} ${y + i * 7}h${-10 + i * 3}" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" opacity="0.55"/>`).join('');
const reticle = (x: number, y: number, r: number, c = '#ef476f') => `<g stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"><circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x} ${y - r - 5}v8M${x} ${y + r - 3}v8M${x - r - 5} ${y}h8M${x + r - 3} ${y}h8"/></g>`;

// objects, drawn with the bottom centre at (0, 0)
const vase = (fill: string) => `<path d="M-8 0H8C10 -6 17 -12 17 -21C17 -28 11 -31 9 -35H-9C-11 -31 -17 -28 -17 -21C-17 -12 -10 -6 -8 0Z" fill="${fill}"/><rect x="-11.5" y="-41" width="23" height="6.5" rx="3" fill="${fill}"/><path d="M-13 -19C-6 -16 6 -16 13 -19" fill="none" stroke-width="2" opacity="0.5"/>`;
const stool = (fill = WOOD) => `<path d="M-13 -23L-9 -23L-12 0L-17 0Z" fill="${WOOD2}"/><path d="M13 -23L9 -23L12 0L17 0Z" fill="${WOOD2}"/><path d="M-12 -10H12" fill="none"/><rect x="-18" y="-31" width="36" height="9" rx="4" fill="${fill}"/>`;
const crate = (fill = WOOD) => `<rect x="-18" y="-34" width="36" height="34" rx="2.5" fill="${fill}"/><path d="M-18 -23H18M-18 -11H18" fill="none" stroke-width="2" opacity="0.55"/><path d="M-15 -3L15 -31" fill="none" stroke-width="3.5" opacity="0.8"/>`;
const lamp = (shade = '#fff3c4') => `<path d="M-11 0H11L8 -5H-8Z" fill="${WOOD2}"/><rect x="-2" y="-31" width="4" height="27" fill="${WOOD}"/><path d="M-15 -29H15L9 -50H-9Z" fill="${shade}"/>`;
const robot = (paint = ROBOT) => `<rect x="-6" y="-4" width="12" height="8" fill="#8d93a8"/><rect x="-18" y="-33" width="36" height="30" rx="11" fill="${paint}"/><rect x="-20" y="-22" width="5" height="10" rx="2.5" fill="#8d93a8"/><rect x="15" y="-22" width="5" height="10" rx="2.5" fill="#8d93a8"/><rect x="-13" y="-26" width="26" height="12" rx="6" fill="${INK}"/><rect x="-8" y="-22.5" width="5" height="5" rx="1.5" fill="#7ff5e6" stroke="none"/><rect x="3" y="-22.5" width="5" height="5" rx="1.5" fill="#7ff5e6" stroke="none"/>`;
const blaster = (c = ACC) => `<path d="M-1 3L-4 13H2L5 3Z" fill="${INK}"/><rect x="-6" y="-5" width="20" height="9" rx="3.5" fill="${c}"/><rect x="13" y="-3" width="9" height="5" rx="1.5" fill="#cfd4e2"/>`;
const shades = (w = 26) => `<path d="M${-w / 2} -2H${w / 2}" fill="none" stroke-width="2.5"/><rect x="${-w / 2}" y="-3" width="${w / 2 - 1.5}" height="7" rx="3" fill="${INK}"/><rect x="1.5" y="-3" width="${w / 2 - 1.5}" height="7" rx="3" fill="${INK}"/>`;

/** One scene per mode, on a 160 x 120 canvas. The box colour shows through behind it. */
const ART: Record<string, () => string> = {
  classic: () => floor()
    + shadow(62, 101, 22) + g(62, 101, 1.15, stool() + eyes(0, -36, 6.5, 0.7, -0.4))
    + g(128, 104, 1.25, robot('#9b5de5'), -6) + g(104, 66, 1, blaster(), 196)
    + reticle(62, 62, 13),

  turncoat: () => `<path d="M-162 248L322 -128V400H-162Z" fill="#ef476f" stroke="none"/><path d="M-2 124L162 -4" stroke="${INK}" stroke-width="3" stroke-dasharray="7 6" fill="none" opacity="0.6"/>` + floor(102)
    // the lamp has just been caught: it wears the robot visor now and points a blaster at its old friend
    + shadow(62, 103, 20) + g(62, 103, 1.2, lamp() + `<rect x="-12" y="-46" width="24" height="10" rx="5" fill="${INK}"/><rect x="-7" y="-43" width="4.5" height="4" rx="1.4" fill="#7ff5e6" stroke="none"/><rect x="2.5" y="-43" width="4.5" height="4" rx="1.4" fill="#7ff5e6" stroke="none"/>`)
    + g(86, 76, 1, blaster())
    + shadow(132, 103, 15) + g(132, 103, 0.85, crate() + eyes(0, -20, 6, -0.9, 0)) + drop(146, 70, 0.9) + motion(154, 80)
    + `<path d="M30 30q14-16 30-6" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M56 18l5 6-7 3" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,

  paranoia: () => floor()
    + shadow(34, 101, 17) + g(34, 101, 1.05, lamp() + eyes(0, -40, 5.5, 1, 0)) + g(56, 70, 0.7, blaster())
    + shadow(126, 101, 18) + g(126, 101, 1.05, vase('#7bdff2') + eyes(0, -22, 5.5, -1, 0)) + g(104, 72, 0.7, blaster(), 180)
    + shadow(80, 101, 18) + g(80, 101, 1, crate() + eyes(0, -21, 5.5, -1, -0.3)) + drop(97, 66, 0.85)
    + `<text x="34" y="22" font-family="Fredoka, system-ui, sans-serif" font-weight="700" font-size="22" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke" text-anchor="middle">?</text>`
    + `<text x="126" y="34" font-family="Fredoka, system-ui, sans-serif" font-weight="700" font-size="22" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke" text-anchor="middle">!</text>`
    + `<text x="80" y="44" font-family="Fredoka, system-ui, sans-serif" font-weight="700" font-size="18" fill="#fff" stroke="${INK}" stroke-width="3" paint-order="stroke" text-anchor="middle">?!</text>`,

  clearance: () => {
    // three shelves of the same vase; one of them is a player
    let s = '';
    for (let r = 0; r < 3; r++) {
      const y = 40 + r * 33;
      s += `<rect x="4" y="${y}" width="152" height="5" rx="2" fill="${WOOD2}" stroke="${INK}" stroke-width="2.5"/>`;
      for (let c = 0; c < 6; c++) {
        const x = 18 + c * 25 + (r % 2) * 6, me = r === 1 && c === 3;
        s += g(x, y, 0.56, vase('#fff3c4') + (me ? eyes(0, -22, 6, -0.8, 0.3) : ''), me ? -5 : 0);
      }
    }
    return s + drop(108, 50, 0.7)
      + `<g transform="translate(118 2) rotate(10)"><path d="M0 0H36V18H0L-8 9Z" fill="#fff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="-1" cy="9" r="2" fill="${INK}"/><text x="18" y="13.5" font-family="Fredoka, system-ui, sans-serif" font-weight="700" font-size="12" fill="#ef476f" text-anchor="middle">-90%</text></g>`;
  },

  priceless: () => floor()
    + `<path d="M58 101V80H102V101Z" fill="#7a2e3b" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M54 80Q80 70 106 80Z" fill="#c0392b" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`
    + g(80, 76, 1, vase(GOLD) + eyes(0, -22, 5.5, 0.2, -1) + `<path d="M-9 -41L-11 -51L-4 -46L0 -54L4 -46L11 -51L9 -41Z" fill="#ffd166"/>`)
    + sparkle(50, 60, 6) + sparkle(112, 34, 6) + sparkle(106, 58, 4)
    + shadow(28, 101, 17) + g(28, 101, 1, crate() + g(0, -22, 1, shades()))
    + shadow(132, 101, 17) + g(132, 101, 1, crate() + g(0, -22, 1, shades()))
    + reticle(48, 26, 9),

  discount: () => floor()
    // a hunter's search beam sweeps the floor; the gold-tagged pot tiptoes to the till behind it
    + `<path d="M8 -4L40 101H86L22 -4Z" fill="rgba(255,250,210,0.45)" stroke="none"/>`
    + `<g fill="rgba(34,34,59,0.35)" stroke="none">${[0, 1, 2, 3].map((i) => `<ellipse cx="${30 + i * 14}" cy="${108 - (i % 2) * 4}" rx="4" ry="2"/>`).join('')}</g>`
    + g(132, 101, 1, `<path d="M-22 0V-26H22V0Z" fill="#6c757d"/><path d="M-18 -26L-14 -40H14L18 -26Z" fill="#adb5bd"/><rect x="-10" y="-52" width="20" height="12" rx="2" fill="${INK}"/><text x="0" y="-43" font-family="monospace" font-size="8" fill="#7ff5e6" stroke="none" text-anchor="middle">000</text><rect x="-18" y="-14" width="36" height="7" rx="2" fill="#adb5bd"/>`)
    + shadow(94, 101, 14) + g(94, 101, 1, `<path d="M-5 -4L-8 0M5 -4L8 0" fill="none"/>` + `<path d="M-14 -4H14L17 -28H-17Z" fill="${GOLD}"/><rect x="-19" y="-33" width="38" height="7" rx="3" fill="${GOLD}"/>` + eyes(0, -16, 5, 1, -0.2) + `<path d="M-15 -31l-7 -9" fill="none" stroke-width="2"/><path d="M-20 -50H-36V-40H-20L-16 -45Z" fill="#fff"/><circle cx="-19" cy="-45" r="1.4" fill="${INK}" stroke="none"/>`, -6)
    + sparkle(78, 56, 5) + motion(76, 76, 2),

  stopwatch: () => floor()
    + g(80, 98, 1, `<rect x="-6" y="-84" width="12" height="9" rx="2" fill="#adb5bd"/><rect x="-10" y="-88" width="20" height="6" rx="3" fill="#ef476f"/><path d="M26 -70l7 -7" fill="none" stroke-width="5"/><circle cx="0" cy="-42" r="36" fill="#ffd166"/><circle cx="0" cy="-42" r="28" fill="#fff"/>`
      + Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2, r1 = i % 3 ? 24 : 21; return `<path d="M${(Math.sin(a) * r1).toFixed(1)} ${(-42 - Math.cos(a) * r1).toFixed(1)}L${(Math.sin(a) * 26).toFixed(1)} ${(-42 - Math.cos(a) * 26).toFixed(1)}" stroke-width="1.6" fill="none"/>`; }).join('')
      + `<path d="M0 -42L13 -55" fill="none" stroke="#ef476f" stroke-width="3"/><circle cx="0" cy="-42" r="3" fill="${INK}"/>` + eyes(0, -30, 5, 0.6, 0.2))
    + shadow(24, 101, 15) + g(24, 101, 0.9, stool() + eyes(0, -36, 5.5, 1, 0))
    + g(140, 103, 0.95, robot('#2ec4b6'), 6)
    + `<text x="80" y="117" font-family="Fredoka, system-ui, sans-serif" font-weight="700" font-size="11" fill="#fff" text-anchor="middle" letter-spacing="1">1 v 1</text>`,
};
/** `slice` fills a thumbnail or box; `meet` shows the whole scene (the unboxed view). */
const art = (id: string, fit: 'slice' | 'meet' = 'slice') => `<svg class="art" viewBox="0 0 160 120" preserveAspectRatio="xMidYMid ${fit}" aria-hidden="true">${ART[id]()}</svg>`;

// ------------------------------------------------------------------------------------------------ the modes
interface Mode { id: string; name: string; tag: string; players: string; color: string; steps: [string, string, string]; hook: string }
const CLASSIC: Mode = {
  id: 'classic', name: 'Classic', tag: 'Blend in. Don’t get caught.', players: '2–12', color: '#ffd166',
  steps: ['Props hide.', 'Hunters zap.', 'The caught come back as ghosts.'], hook: '',
};
export const MODES: Mode[] = [
  {
    id: 'turncoat', name: 'Turncoat', tag: 'Get caught, switch sides.', players: '4–12', color: '#2ec4b6',
    steps: ['Props hide and hunters hunt, same as ever, at first.', 'Get caught and you join the hunters on the spot, blaster and all.', 'The last prop standing faces the whole shop, with every ability recharged.'],
    hook: 'Nobody sits out, and every catch makes the hunt bigger.',
  },
  {
    id: 'paranoia', name: 'Paranoia', tag: 'Everyone hides. Everyone hunts.', players: '3–8', color: '#9b5de5',
    steps: ['Every player is an object, and every object has a blaster.', 'Zap another player to score. Zap the furniture and you lose Focus; run dry and you are a duck.', 'Hunting means moving, and moving gets you spotted. Most catches at the bell wins.'],
    hook: 'No hunters and no waiting: every player hides and hunts at once.',
  },
  {
    id: 'clearance', name: 'Clearance', tag: 'Forty vases. Four of them are breathing.', players: '4–12', color: '#ef476f',
    steps: ['Each round the shop is restocked with one object, everywhere.', 'Every prop has to be that object, so the shape gives nothing away.', 'Hunters go on behaviour alone: a twitch, a wobble, a vase facing the wrong way.'],
    hook: 'A pure spot-the-fake round: the best actor wins, not the best hiding place.',
  },
  {
    id: 'priceless', name: 'Priceless', tag: 'Guard the heirloom.', players: '5–12', color: '#f2b544',
    steps: ['One prop is secretly the Heirloom: slower, no Vanish, and worth the whole round.', 'The others guard it with decoys, taunts and head bonks that drag the hunters away.', 'Catch the Heirloom and the hunters win outright. Keep it safe and the props do.'],
    hook: 'Team play, where the bravest prop is the one who gets caught on purpose.',
  },
  {
    id: 'discount', name: 'Five-Finger Discount', tag: 'Standing still won’t save you.', players: '4–10', color: '#f78c2b',
    steps: ['Gold-tagged stock is scattered round the shop.', 'Disguise as a gold item and carry it to the till without getting zapped.', 'Hunters know where the gold started. Anything gold on the move is a suspect.'],
    hook: 'Props have a job to do, so hiding in a corner all round is not an option.',
  },
  {
    id: 'stopwatch', name: 'Stopwatch', tag: 'Hide. Seek. Swap. Beat the clock.', players: '2–4', color: '#4361ee',
    steps: ['You hide while your friend counts. Then they hunt, and the clock runs.', 'Swap sides and do it again.', 'Whoever found the other faster takes the round. Best of five.'],
    hook: 'Made for two: a whole game with just you and a friend, no bots needed.',
  },
];

const ICO = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-8-4.9-8-11A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5c0 6.1-8 11-8 11z"/></svg>',
  people: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="8" r="3.2"/><circle cx="16.5" cy="9" r="2.6"/><path d="M3 20c0-3.6 2.4-6 5.5-6s5.5 2.4 5.5 6M14.5 14.3c3.2-.5 6.5 1.5 6.5 5.7"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export class SoonUi {
  private wants = new Set<string>();
  private peek = 'classic';
  private open = -1; // index of the unboxed mode on the page, -1 when the shelf is showing

  constructor(private game: Game) {
    try { const w = JSON.parse(read('pp_wants') ?? '[]'); if (Array.isArray(w)) for (const id of w) if (MODES.some((m) => m.id === id)) this.wants.add(id); } catch { /* fresh */ }
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
    $('modeInfo').addEventListener('click', (e) => {
      if (this.onWant(e)) return;
      const d = (e.target as HTMLElement).closest<HTMLElement>('[data-unbox]');
      if (d) { this.pendingUnbox = d.dataset.unbox!; (document.querySelector('.nav[data-go="soon"]') as HTMLElement).click(); }
    });
    $('soon').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (this.onWant(e)) return;
      if (t.closest('#soonShare')) { this.share(); return; }
      const box = t.closest<HTMLElement>('[data-box]');
      if (box) { this.unbox(MODES.findIndex((m) => m.id === box.dataset.box)); return; }
      if (t.closest('[data-step="-1"]')) { this.step(-1); return; }
      if (t.closest('[data-step="1"]')) { this.step(1); return; }
      if (t.closest('.ubClose') || t.classList.contains('unbox')) this.rebox();
    });
    window.addEventListener('keydown', (e) => {
      if (this.open < 0 || this.game.inGame) return;
      if (e.code === 'ArrowLeft') this.step(-1); else if (e.code === 'ArrowRight') this.step(1);
    });
  }

  private pendingUnbox = '';

  /** The menu calls this when the Coming soon page opens: the NEW badge goes until the list changes. */
  opened() {
    write('pp_soon_seen', SOON_VERSION); this.syncFresh();
    if (this.pendingUnbox) { const i = MODES.findIndex((m) => m.id === this.pendingUnbox); this.pendingUnbox = ''; if (i >= 0) this.unbox(i); }
  }
  /** Leaving the page puts the open box back. */
  closed() { if (this.open >= 0) this.rebox(true); }
  /** Esc on the page: closes an open box first. True if it did. */
  escape() { if (this.open < 0) return false; this.rebox(); return true; }

  private syncFresh() {
    const fresh = read('pp_soon_seen') !== SOON_VERSION;
    for (const n of document.querySelectorAll<HTMLElement>('.nav[data-go="soon"]')) n.classList.toggle('fresh', fresh);
  }

  /** Want it, wherever the button is. True if the click was one. */
  private onWant(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-want]');
    if (!b) return false;
    const id = b.dataset.want!;
    if (this.wants.has(id)) { this.wants.delete(id); this.game.sfx.play('click'); }
    else { this.wants.add(id); this.game.sfx.play('pop'); }
    write('pp_wants', JSON.stringify([...this.wants]));
    const on = this.wants.has(id);
    for (const w of document.querySelectorAll<HTMLElement>(`[data-want="${id}"]`)) {
      w.classList.toggle('on', on); w.setAttribute('aria-pressed', String(on));
      const l = w.querySelector('.wl'); if (l) l.textContent = on ? 'Wanted' : 'Want it';
      if (on) { w.classList.remove('burst'); void w.offsetWidth; w.classList.add('burst'); }
    }
    for (const bx of document.querySelectorAll<HTMLElement>(`[data-box="${id}"]`)) bx.classList.toggle('wanted', on);
    this.renderWantCount();
    return true;
  }

  private wantBtn(id: string, big = false) {
    const on = this.wants.has(id);
    return `<button class="want${big ? ' big' : ''}${on ? ' on' : ''}" data-want="${id}" aria-pressed="${on}" title="Kept in this browser">${ICO.heart}<span class="wl">${on ? 'Wanted' : 'Want it'}</span></button>`;
  }
  private priceTag(text: string, cls = '') { return `<span class="ptag ${cls}"><span class="ptIn"><i></i>${text}</span></span>`; }

  // ------------------------------------------------------------------ play card: the mode row
  private renderModes() {
    const tile = (m: Mode, live: boolean) => `<button class="mode${live ? ' on' : ' soon'}" data-mode="${m.id}" style="--c:${m.color}" aria-label="${m.name}${live ? ', on sale now' : ', coming soon'}">`
      + `<span class="mThumb">${art(m.id)}</span><b>${m.name === 'Five-Finger Discount' ? '5-Finger' : m.name}</b>`
      + (live ? '<small class="live"><i></i>PLAY NOW</small>' : this.priceTag('SOON', 'mini'))
      + '</button>';
    $('modes').innerHTML = tile(CLASSIC, true) + MODES.map((m) => tile(m, false)).join('');
    this.renderModeInfo();
  }

  private renderModeInfo() {
    const m = this.peek === 'classic' ? CLASSIC : MODES.find((s) => s.id === this.peek)!;
    $('modeInfo').innerHTML = m === CLASSIC
      ? `<span class="miTxt"><b>Classic</b> Props hide, hunters zap, the caught come back as ghosts. On sale now.</span>`
      : `<span class="miTxt"><i class="stampSm">COMING SOON</i> <b>${m.name}</b> ${m.tag} <button class="miMore" data-unbox="${m.id}">How it plays ${ICO.arrow}</button></span>${this.wantBtn(m.id)}`;
    $('modeInfo').classList.toggle('isSoon', m !== CLASSIC);
  }

  // ------------------------------------------------------------------ hero: a stack of boxes pointing at the page
  private renderTeaser() {
    $('soonTeaser').innerHTML = `<span class="stBoxes">${MODES.slice(0, 3).map((m) => `<i style="--c:${m.color}">${art(m.id)}</i>`).join('')}</span>`
      + `<span class="stMid"><span class="stTag">COMING SOON</span><span class="stTxt">${plural(MODES.length, 'new mode')}, still in their boxes</span></span>`
      + `<span class="stGo">${ICO.arrow}</span>`;
  }

  // ------------------------------------------------------------------ the page: a shelf of boxed games
  private box(m: Mode, i: number) {
    return `<div class="slot" style="--i:${i}"><button class="gbox${this.wants.has(m.id) ? ' wanted' : ''}" data-box="${m.id}" style="--c:${m.color}" aria-label="${m.name}: coming soon. Open the box.">`
      + `<span class="gbLid"><span>PROP PANIC</span><span>GAME MODE</span></span>`
      + `<span class="gbArt">${art(m.id)}</span>`
      + `<span class="gbTitle">${m.name}</span>`
      + `<span class="gbFoot"><span class="gbTag">${m.tag}</span><span class="gbPlayers">${ICO.people}${m.players}</span></span>`
      + `<span class="gbHeart">${ICO.heart}</span>`
      + '</button>' + this.priceTag('COMING SOON', 'shelfTag') + '</div>';
  }

  private renderPage() {
    $('soonBody').innerHTML = `
      <div class="notice">
        <i class="tape t1"></i><i class="tape t2"></i>
        <div class="ntKick">STAFF NOTICE · TUMBLETON’S EMPORIUM</div>
        <div class="ntTitle">New games are in the back room</div>
        <p>${plural(MODES.length, 'new way')} to play Prop Panic, still sealed in their boxes. Each one changes what you do in a round, not just how long it lasts. Open a box to see how it plays, and mark the ones you want unpacked first.</p>
        <button id="soonShare" class="btn small">${ICO.share}<span>Tell your crew</span></button>
      </div>
      <div class="shelf">${MODES.map((m, i) => this.box(m, i)).join('')}</div>
      <div class="soonFoot" id="soonWants"></div>`;
    this.renderWantCount();
  }

  private unbox(i: number) {
    if (i < 0) return;
    const m = MODES[i], el = $('unbox'), first = this.open < 0;
    this.open = i;
    this.game.sfx.play(first ? 'pop' : 'click');
    el.hidden = false;
    el.innerHTML = `<div class="ubCard${first ? ' fresh' : ''}" style="--c:${m.color}" role="dialog" aria-label="${m.name}">
        <button class="iconBtn ubClose" aria-label="Back to the shelf">✕</button>
        <div class="ubArt">${art(m.id, 'meet')}${this.priceTag('COMING SOON', 'ubTag')}</div>
        <div class="ubInfo">
          <div class="ubKick">NEW GAME MODE · <span>${ICO.people}${m.players} players</span></div>
          <h3>${m.name}</h3>
          <div class="ubTagline">${m.tag}</div>
          <ol class="ubSteps">${m.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
          <div class="ubHook"><b>Why it’s different</b>${m.hook}</div>
          <div class="ubAct">${this.wantBtn(m.id, true)}<span class="ubNav"><button class="iconBtn" data-step="-1" aria-label="Previous mode">${ICO.left}</button><span>${i + 1} / ${MODES.length}</span><button class="iconBtn" data-step="1" aria-label="Next mode">${ICO.right}</button></span></div>
        </div>
      </div>`;
    $('soon').classList.add('unboxed');
  }
  private step(d: number) { if (this.open >= 0) this.unbox((this.open + d + MODES.length) % MODES.length); }
  private rebox(quiet = false) {
    this.open = -1;
    const el = $('unbox'); el.hidden = true; el.innerHTML = '';
    $('soon').classList.remove('unboxed');
    if (!quiet) this.game.sfx.play('click');
  }

  private renderWantCount() {
    const el = document.getElementById('soonWants');
    if (!el) return;
    const n = this.wants.size;
    el.innerHTML = n ? `${ICO.heart} You want <b>${plural(n, 'mode')}</b> unpacked. Saved in this browser.` : 'Open a box and tap <b>Want it</b> on the modes you would play first.';
    el.classList.toggle('has', n > 0);
  }

  private async share() {
    const url = `${location.origin}${location.pathname}`;
    const text = `Prop Panic: hide as everyday objects, hunt the fakes, free in the browser. New modes coming: ${MODES.slice(0, 3).map((m) => m.name).join(', ')} and more.`;
    const label = $('soonShare').querySelector('span')!;
    this.game.sfx.play('click');
    if (navigator.share) { try { await navigator.share({ title: 'Prop Panic', text, url }); } catch { /* cancelled */ } return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); label.textContent = 'Copied! Paste it to your crew'; }
    catch { prompt('Share this with your crew:', `${text} ${url}`); }
    setTimeout(() => { label.textContent = 'Tell your crew'; }, 2200);
  }
}
