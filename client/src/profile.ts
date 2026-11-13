/**
 * The player's profile in this browser: one JSON record under `pp_profile` (the rules are in shared/progress.ts).
 * A 2.6 browser's separate XP, coins and look keys are folded into it once, then left alone so a downgrade still works.
 */
import { migrateLegacy, newProfile, sanitizeProfile, type Profile } from '../../shared/progress';

const KEY = 'pp_profile';

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeProfile(JSON.parse(raw));
    const xp = Number(localStorage.getItem('pp_xp')) || 0, coins = Number(localStorage.getItem('pp_coins')) || 0;
    const p = xp || coins || localStorage.getItem('pp_look') !== null
      ? migrateLegacy(xp, coins, Number(localStorage.getItem('pp_look')) || 0, localStorage.getItem('pp_paid') ?? '')
      : newProfile();
    saveProfile(p);
    return p;
  } catch {
    return newProfile(); // storage blocked or corrupt: play on with a fresh profile for this visit
  }
}

export function saveProfile(p: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage full or blocked: progress lasts this visit only */ }
}
