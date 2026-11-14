/**
 * The few Node built-ins the game server touches, for running a practice room inside the browser.
 * vite.config.ts points `node:crypto` here; `Buffer` is only used to compare reconnect tokens, which a practice
 * room never does, but it is provided so nothing can trip over its absence.
 */
export function randomBytes(n: number) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return {
    toString(enc?: string) {
      const s = btoa(String.fromCharCode(...b));
      return enc === 'base64url' ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s;
    },
  };
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const g = globalThis as any;
g.Buffer ??= { from: (s: string) => new TextEncoder().encode(s) };
