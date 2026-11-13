/** Rebindable keyboard and mouse-button controls, saved in the browser. Mouse buttons are stored as 'Mouse<button>'. */
export const ACTIONS: [id: string, label: string, def: string][] = [
  ['fwd', 'Move forward', 'KeyW'], ['back', 'Move back', 'KeyS'], ['left', 'Move left', 'KeyA'], ['right', 'Move right', 'KeyD'],
  ['jump', 'Jump', 'Space'], ['dash', 'Dash (prop)', 'ShiftLeft'], ['act', 'Become toy (prop)', 'KeyE'],
  ['ab1', 'Decoy / Scanner', 'KeyQ'], ['ab2', 'Vanish / Shockwave', 'KeyF'], ['taunt', 'Taunt (prop)', 'KeyT'], ['help', 'Show / hide controls', 'KeyH'],
];

export const B: Record<string, string> = {};
const RESERVED = new Set(['Escape', 'Enter', 'Tab', 'MetaLeft', 'MetaRight']);

export function loadBinds() {
  for (const [id, , def] of ACTIONS) B[id] = def;
  try {
    const saved = JSON.parse(localStorage.getItem('pp_keys') ?? '{}');
    for (const [id] of ACTIONS) if (typeof saved[id] === 'string') B[id] = saved[id];
  } catch { /* keep defaults */ }
}

/** Bind an action to a key. A key already used elsewhere is swapped, so nothing ends up unbound. */
export function setBind(id: string, code: string): boolean {
  if (RESERVED.has(code)) return false;
  for (const [other] of ACTIONS) if (other !== id && B[other] === code) B[other] = B[id];
  B[id] = code;
  try { localStorage.setItem('pp_keys', JSON.stringify(B)); } catch { /* ignore */ }
  return true;
}

export function resetBinds() {
  try { localStorage.removeItem('pp_keys'); } catch { /* ignore */ }
  loadBinds();
}

/** Short label for a key code, as shown on HUD buttons. */
export function keyLabel(code: string): string {
  if (code.startsWith('Mouse')) return ['L-Click', 'M-Click', 'R-Click', 'Mouse 4', 'Mouse 5'][Number(code.slice(5))] ?? `Mouse ${Number(code.slice(5)) + 1}`;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  const map: Record<string, string> = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'Alt', AltRight: 'R-Alt', CapsLock: 'Caps', Backquote: '`' };
  return map[code] ?? code.replace('Numpad', 'Num ');
}

/** True when some action is bound to this code (used to let a bound mouse button replace its default use). */
export function isBound(code: string): boolean {
  return ACTIONS.some(([id]) => B[id] === code);
}

loadBinds();
