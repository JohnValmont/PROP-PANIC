/**
 * The trailer's shots. Each one stages a real round and films it. The director only places players,
 * freezes or steers bots, sets a cooldown or a clock, and calls the room's own actions (fire, transform,
 * ability, taunt, haunt, chaos); everything that then happens on screen is the game.
 *   setup(D)          stage the scene; D.ff() fast-forwards without rendering
 *   frame(D, i, t)    per frame, before the world steps: camera moves and timed actions
 */
const lerp = (a, b, k) => a + (b - a) * k;
const clamp01 = (k) => Math.min(1, Math.max(0, k));
const ease = (k) => { k = clamp01(k); return k * k * (3 - 2 * k); };
const easeOut = (k) => 1 - Math.pow(1 - clamp01(k), 3);
const linear = (k) => clamp01(k);
const mix = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
/** Camera from pose A to pose B, eased: { p, l, fov }. */
const move = (A, B, k, f = ease) => ({ p: mix(A.p, B.p, f(k)), l: mix(A.l, B.l, f(k)), fov: lerp(A.fov ?? 50, B.fov ?? A.fov ?? 50, f(k)) });
const cam = (D, c, extra) => D.cam(c.p, c.l, c.fov, extra);
const at = (D, sec) => D.i === Math.round(sec * 30); // true on the frame nearest `sec`
const HUNTER_EYE = 1.58;

// ---------------------------------------------------------------- staging building blocks
/** A round in progress: `me` hunts or hides; hiding skipped after `hideMs`; role and release banners left behind. */
async function round(D, { map = 0, seed = 309, me = 'prop', hunters = 1, hideMs = 20000, hunt = true, stage = '' }) {
  await D.srv(`
    { const r = H.R(); r.botsWanted = 5; r.balanceBots(); } // bots first: the hunters are picked from them
    const meId = H.human().id;
    const hs = ${me === 'hunter' ? '[meId]' : `H.bots().slice(0, ${hunters}).map((p) => p.id)`};
    H.start({ map: ${map}, seed: ${seed}, hunters: hs });
    globalThis.ME = H.human(); globalThis.BOTS = H.bots();
    globalThis.HUNTERS = H.all().filter((p) => p.team === 'hunter' && !p.ws);
    globalThis.PROPBOTS = H.all().filter((p) => p.team === 'prop' && !p.ws);
    ${stage}
  `);
  await D.ff(hideMs);
  if (hunt) { await D.srv(`H.phaseLeft(0)`); await D.ff(4200); }
}
/** Cooldowns ready (a real round starts them a few seconds into the hunt). */
const ready = `for (const p of H.all()) { p.cd = { decoy: 0, ghost: 0, taunt: 0, pulse: 0, shock: 0, haunt: 0 }; p.cdDirty = true; }`;

// ---------------------------------------------------------------- the opening: a shelf in Tumbleton's Emporium
// Seed 309 stocks the shelf row at z=4.4 (its south face is z=4.025) with cats, alarm clocks, lanterns and
// brass vases. One bot sits on the middle board as a second cat, beside the real one at x=-5.5.
const SHELF_Z = 4.025;
async function stageShelf(D) {
  await round(D, {
    map: 0, seed: 309, hideMs: 22000, hunt: false, stage: `
      const [hunter, cat] = BOTS;
      H.place(ME, 22.5, -15.5, 0);
      H.freeze(hunter); H.place(hunter, 21, 15, 0);
      H.freeze(cat); H.disguise(cat, 'cat'); H.place(cat, -4.62, ${SHELF_Z}, 0, 0.95);
      globalThis.CAT = cat;`,
  });
  await D.srv(`H.phaseLeft(60000)`);
  await D.hud(false); await D.labels(false);
}

// ---------------------------------------------------------------- the meadow barrel yard (seed 202)
// Empty cells in the cask grid: (-8.12,-4) (-6.96,-4) (-10.44,-2) (-4.64,-2). Props sit there as casks.
const YARD = `
  const casks = [['winebarrel', -8.12, -4], ['barrel', -6.96, -4], ['oildrum', -10.44, -2], ['winebarrel', -4.64, -2]];
  PROPBOTS.forEach((p, i) => { H.hold(p); const c = casks[i % casks.length]; H.disguise(p, c[0]); H.place(p, c[1], c[2], i); });
  H.place(ME, 22, 15, 0);`;

const SHOTS = [
  // ============================================================ cold open
  {
    name: 'open_shelf', seconds: 5.2,
    async setup(D) { await stageShelf(D); },
    frame(D, i, t) { return cam(D, move({ p: [-9.4, 1.36, 2.0], l: [-7.6, 1.12, SHELF_Z], fov: 44 }, { p: [-6.3, 1.3, 2.15], l: [-5.0, 1.12, SHELF_Z], fov: 40 }, t / 5.2, linear)); },
  },
  {
    name: 'open_cat', seconds: 5.2,
    async setup(D) { await stageShelf(D); },
    async frame(D, i, t) {
      const A = { p: [-5.06, 1.24, 2.35], l: [-5.06, 1.17, SHELF_Z], fov: 36 };
      await cam(D, t < 2.3 ? move(A, { p: [-5.06, 1.235, 2.45], l: [-5.06, 1.17, SHELF_Z], fov: 36 }, t / 2.3, linear)
        : move({ p: [-5.06, 1.235, 2.45], l: [-5.06, 1.17, SHELF_Z], fov: 36 }, { p: [-4.72, 1.24, 2.95], l: [-4.66, 1.2, SHELF_Z], fov: 34 }, (t - 2.3) / 2.0, ease));
      if (at(D, 2.2)) await D.srv(`H.R().taunt(CAT, 0)`);
    },
  },
  // ============================================================ title backdrop: Sunny Meadow from above
  {
    name: 'title_meadow', seconds: 4.8,
    async setup(D) {
      await round(D, { map: 1, seed: 202, hideMs: 14000, hunt: false, stage: `H.place(ME, 0, 16, 0);` });
      await D.srv(`H.phaseLeft(60000)`);
      await D.hud(false); await D.labels(false);
    },
    frame(D, i, t) { return cam(D, move({ p: [20, 6.5, 17.5], l: [-3, 0.5, -3], fov: 52 }, { p: [15, 8.2, 18.5], l: [-4, 0.2, -5], fov: 50 }, t / 4.8, linear)); },
  },
  // ============================================================ props: become anything
  {
    name: 'prop_transform', seconds: 4.8,
    async setup(D) {
      // furniture hall: an armchair (182), an oil lamp (194) and a chair (190) around the spot
      await round(D, { map: 0, seed: 309, hideMs: 3000, hunt: false, stage: `H.place(ME, -18.6, -10.4, 0.6); H.place(HUNTERS[0], 20, 14);` });
      await D.srv(`H.phaseLeft(60000); ${ready}`);
      await D.cli(() => { const g = window.__pp; g.yaw = 0.9; g.pitch = -0.1; g.camDist *= 0.8; });
      await D.ff(6500);
      await D.labels(false);
    },
    async frame(D, i, t) {
      // turn to the armchair, become it; to the lamp; to the chair
      const look = t < 1.5 ? [-20.48, 0.5, -11.39] : t < 3.0 ? [-15.01, 0.6, -12.02] : [-17.27, 0.5, -8.93];
      await D.aim(...look, 0.16);
      if (at(D, 0.9)) await D.send({ t: 'tf', d: 182 });
      if (at(D, 2.4)) await D.send({ t: 'tf', d: 194 });
      if (at(D, 3.9)) await D.send({ t: 'tf', d: 190 });
    },
  },
  // ============================================================ hunters: zap the fakes (three hits to catch)
  {
    name: 'hunter_hit', seconds: 4.8,
    async setup(D) {
      await round(D, {
        map: 0, seed: 309, me: 'hunter', hideMs: 20000, stage: `
          const t = PROPBOTS[0]; H.freeze(t); H.disguise(t, 'box'); H.place(t, -3.6, -1.1, 0.3); globalThis.TARGET = t;
          H.place(ME, 0.4, -1.3, Math.PI / 2);`,
      });
      await D.srv(`H.place(ME, 0.4, -1.3, Math.PI / 2); H.place(TARGET, -3.6, -1.1, 0.3); ${ready}`);
      await D.cli(() => { const g = window.__pp; g.yaw = Math.PI / 2; g.pitch = -0.12; });
      await D.ff(400);
      D.target = await D.srv(`return TARGET.id`);
    },
    async frame(D, i, t) {
      const e = await D.entPos(D.target);
      if (e) await D.aim(e[0], e[1] + 0.3, e[2], t < 0.5 ? 0.12 : 0.35);
      if (at(D, 0.75)) { await D.fire(); }
      if (at(D, 0.85)) await D.srv(`H.walkTo(TARGET, -9.5, -1.3, { speed: 1, hop: false })`); // it bolts
      if (at(D, 1.75)) await D.fire();
      if (at(D, 2.6)) await D.fire();
    },
  },
  // ============================================================ ...and the price of guessing: QUACK
  {
    name: 'hunter_quack', seconds: 6.6,
    async setup(D) {
      await round(D, { map: 0, seed: 309, me: 'hunter', hideMs: 20000, stage: `H.place(ME, -5.0, 2.35, Math.PI);` });
      await D.srv(`H.place(ME, -5.0, 2.35, Math.PI); ME.focus = 21; ${ready}`);
      await D.cli(() => { const g = window.__pp; g.yaw = Math.PI; g.pitch = -0.05; });
      await D.ff(400);
    },
    async frame(D, i, t) {
      // innocent objects on the shelf: the lantern, the cats, the alarm clock
      const shots = [[0.45, -7.2, 1.85], [0.85, -5.5, 1.15], [1.25, -4.6, 1.85], [1.65, -2.9, 1.15]];
      const next = shots.find((s) => t < s[0] + 0.05) ?? shots[shots.length - 1];
      if (t < 2.0) await D.aim(next[1], next[2], SHELF_Z, 0.3);
      for (const [s] of shots) if (at(D, s)) await D.fire();
      if (at(D, 2.6)) await D.cli(() => { const g = window.__pp; g.keys.add('KeyW'); });
      if (t > 2.6) await D.cli((t) => { const g = window.__pp; g.yaw += 0.007 * Math.sin(t * 3); }, t);
    },
  },
  // ============================================================ gadgets
  {
    name: 'gadget_scanner', seconds: 3.4,
    async setup(D) {
      await round(D, {
        map: 0, seed: 309, me: 'hunter', hideMs: 20000, stage: `
          const t = PROPBOTS[1]; H.freeze(t); H.disguise(t, 'basket'); H.place(t, -7.2, -0.7, 0); globalThis.RUNNER = t;`,
      });
      await D.srv(`H.place(ME, 0.4, -1.3, Math.PI / 2); H.place(RUNNER, -4.3, -2.1, 0); ${ready}`);
      await D.cli(() => { const g = window.__pp; g.yaw = Math.PI / 2; g.pitch = -0.08; });
      await D.ff(300);
    },
    async frame(D, i, t) {
      if (at(D, 0.3)) await D.ab('pulse');
      if (at(D, 0.4)) await D.srv(`H.walkTo(RUNNER, -4.3, -0.4, { speed: 0.5 })`); // a nervous prop shuffles as the ring passes
    },
  },
  {
    name: 'gadget_shock', seconds: 3.4,
    async setup(D) {
      await round(D, { map: 1, seed: 202, hideMs: 12000, stage: YARD + ` H.freeze(HUNTERS[0]); H.place(HUNTERS[0], -7.5, -3.05, Math.PI / 2);` });
      await D.srv(`${ready} H.place(HUNTERS[0], -7.6, -3.0, -Math.PI / 2); H.walkTo(HUNTERS[0], -7.6, -3.0, { face: -Math.PI / 2 })`);
      await D.hud(false); await D.labels(false);
    },
    async frame(D, i, t) {
      await cam(D, move({ p: [-3.2, 2.2, 3.4], l: [-7.6, 0.9, -3.4], fov: 46 }, { p: [-3.5, 2.3, 3.0], l: [-7.6, 1.3, -3.4], fov: 46 }, t / 3.4));
      if (at(D, 0.8)) await D.srv(`H.R().ability(HUNTERS[0], 'shock')`);
    },
  },
  {
    name: 'gadget_decoy', seconds: 3.4,
    async setup(D) {
      await round(D, {
        map: 0, seed: 309, me: 'hunter', hideMs: 18000, stage: `
          const p = PROPBOTS[2]; H.freeze(p); H.disguise(p, 'tv'); H.place(p, -3.3, -1.2, 0);`,
      });
      // the prop drops a decoy of itself and slips away before the hunter turns the corner
      await D.srv(`const p = PROPBOTS[2]; p.cd.decoy = 0; H.R().ability(p, 'decoy'); H.place(p, -8.3, -16, 0); H.place(ME, 0.4, -1.3, Math.PI / 2); ${ready}`);
      await D.cli(() => { const g = window.__pp; g.yaw = Math.PI / 2 - 0.25; g.pitch = -0.1; });
      await D.ff(500);
    },
    async frame(D, i, t) {
      await D.aim(-3.3, 0.25, -1.2, t < 0.9 ? 0.1 : 0.4);
      if (at(D, 1.35)) await D.fire();
    },
  },
  // ============================================================ caught? haunt the round
  {
    name: 'haunt', seconds: 4.8,
    async setup(D) {
      await round(D, { map: 0, seed: 309, hideMs: 18000, stage: `H.freeze(HUNTERS[0]); H.place(HUNTERS[0], -2.5, 5.6, Math.PI);` });
      // the camera player is caught (three real hits), so it comes back as a ghost
      await D.srv(`const h = HUNTERS[0]; H.place(ME, -1.0, 5.6, 0); for (let k = 0; k < 3; k++) H.shootAt(h, ME.body.x, ME.body.y + 0.2, ME.body.z);`);
      await D.ff(5500);
      // a hunter comes down the aisle towards us; the cat on the middle board (x -5.5) is what the ghost rattles
      await D.srv(`${ready} H.place(HUNTERS[0], -9.2, 1.75, -Math.PI / 2); H.walkTo(HUNTERS[0], -4.2, 1.75, { speed: 0.42 })`);
      await D.labels(false);
    },
    async frame(D, i, t) {
      await cam(D, move({ p: [-1.2, 1.75, 1.55], l: [-6.4, 1.0, 3.4], fov: 50 }, { p: [-1.5, 1.7, 1.6], l: [-6.2, 1.0, 3.5], fov: 48 }, t / 4.8));
      if (at(D, 1.1)) await D.send({ t: 'haunt', d: await D.srv(`return H.decorNear(-5.5, ${SHELF_Z}, 0.3, 0.95)[0]?.id ?? -1`) });
      if (at(D, 1.75)) await D.srv(`const d = H.decorNear(-5.5, ${SHELF_Z}, 0.3, 0.95)[0]; H.freeze(HUNTERS[0]); H.shootAt(HUNTERS[0], d.x, d.y + 0.25, d.z);`);
    },
  },
  // ============================================================ chaos events
  {
    name: 'chaos_blackout', seconds: 3.6,
    async setup(D) {
      await round(D, { map: 0, seed: 309, me: 'hunter', hideMs: 20000 });
      await D.srv(`H.place(ME, -1.0, 2.4, Math.PI / 2); ${ready}`);
      await D.cli(() => { const g = window.__pp; g.yaw = Math.PI / 2; g.pitch = -0.1; });
      await D.ff(300);
    },
    async frame(D, i, t) {
      if (at(D, 0.15)) await D.srv(`H.chaos('blackout')`);
      await D.cli((t) => { const g = window.__pp; g.yaw = Math.PI / 2 + 0.38 * Math.sin(t * 1.1); g.pitch = -0.22 + 0.04 * Math.sin(t * 1.7); }, t);
    },
  },
  {
    name: 'chaos_moon', seconds: 3.6,
    async setup(D) {
      await round(D, {
        map: 1, seed: 202, hideMs: 10000, stage: `
          H.place(ME, 22, 15, 0);
          const spots = [[-0.5, 3.2], [0.5, 1.6], [-0.4, 0], [0.5, -1.6], [-0.3, -3.2]];
          H.all().filter((p) => !p.ws).forEach((p, i) => { H.freeze(p); H.place(p, spots[i][0], spots[i][1], i); });`,
      });
      await D.srv(`H.chaos('moon');
        H.all().filter((p) => !p.ws).forEach((p, i) => H.puppet(p, (room, q, t, dt) => H.step(room, q, dt, { yaw: q.yaw + dt * 0.6, mz: 0.25, jump: q.body.ground && (t / 1000 + i * 0.37) % 1.6 < 0.1 })));`);
      await D.ff(800);
      await D.hud('cine'); await D.labels(false);
    },
    frame(D, i, t) { return cam(D, move({ p: [0, 1.15, 8.8], l: [0, 2.5, -0.5], fov: 54 }, { p: [0, 1.05, 8.0], l: [0, 2.9, -0.5], fov: 54 }, t / 3.6)); },
  },
  {
    name: 'chaos_shuffle', seconds: 3.0,
    async setup(D) {
      await round(D, { map: 1, seed: 202, hideMs: 10000, stage: YARD + ` H.freeze(HUNTERS[0]); H.place(HUNTERS[0], 20, -14);` });
      await D.hud('cine'); await D.labels(false);
    },
    async frame(D, i, t) {
      await cam(D, move({ p: [-3.4, 2.1, 1.6], l: [-7.6, 0.6, -3.2], fov: 46 }, { p: [-3.8, 2.0, 1.2], l: [-7.6, 0.6, -3.2], fov: 46 }, t / 3.0));
      if (at(D, 0.5)) await D.srv(`H.chaos('shuffle')`);
    },
  },
  {
    name: 'chaos_polter', seconds: 3.0,
    async setup(D) {
      await round(D, { map: 0, seed: 309, hideMs: 18000, stage: `H.place(ME, 22.5, -15.5, 0); H.freeze(HUNTERS[0]); H.place(HUNTERS[0], 21, 15);` });
      await D.srv(`H.chaos('poltergeist')`);
      await D.ff(400);
      await D.hud('cine'); await D.labels(false);
    },
    frame(D, i, t) { return cam(D, move({ p: [-9.0, 1.5, 1.9], l: [-5.0, 1.0, SHELF_Z], fov: 50 }, { p: [-8.2, 1.45, 2.0], l: [-4.4, 1.0, SHELF_Z], fov: 50 }, t / 3.0)); },
  },
  {
    name: 'chaos_sneeze', seconds: 3.0,
    async setup(D) {
      await round(D, { map: 1, seed: 202, hideMs: 10000, stage: YARD + ` H.freeze(HUNTERS[0]); H.place(HUNTERS[0], 20, -14);` });
      await D.srv(`H.all().filter((p) => p.team === 'prop' && !p.ws).forEach((p) => H.puppet(p, (room, q, t, dt) => H.step(room, q, dt, {})));`); // physics on, standing still
      await D.hud('cine'); await D.labels(false);
    },
    async frame(D, i, t) {
      await cam(D, move({ p: [-2.2, 1.9, 1.9], l: [-7.6, 0.9, -3.2], fov: 46 }, { p: [-2.6, 2.0, 1.6], l: [-7.6, 1.0, -3.2], fov: 46 }, t / 3.0));
      if (at(D, 0.5)) await D.srv(`H.chaos('sneeze')`);
    },
  },
  // ============================================================ the last 30 seconds
  {
    name: 'panic_time', seconds: 3.6,
    async setup(D) {
      await round(D, { map: 1, seed: 202, me: 'hunter', hideMs: 12000 });
      await D.srv(`H.place(ME, 0.2, 8.5, 0); ${ready} H.phaseLeft(30600);`);
      await D.cli(() => { const g = window.__pp; g.yaw = 0.55; g.pitch = -0.08; g.keys.add('KeyW'); });
      await D.ff(200);
    },
    async frame(D, i, t) { await D.cli((t) => { const g = window.__pp; g.yaw = 0.55 + 0.12 * Math.sin(t * 0.9); }, t); },
  },
  // ============================================================ the round ends: survivors light up, then the board
  {
    name: 'reveal', seconds: 6.6,
    async setup(D) {
      await round(D, { map: 1, seed: 202, hideMs: 16000, stage: `H.place(ME, 0, 15.5, 0);` });
      await D.srv(`H.freeze(HUNTERS[0]); H.place(HUNTERS[0], 0, 9, 0); const v = PROPBOTS[0]; for (let k = 0; k < 3; k++) H.shootAt(HUNTERS[0], v.body.x, v.body.y + 0.2, v.body.z); H.phaseLeft(4300);`);
      await D.ff(3300);
      await D.hud('cine');
      await D.labels(false);
    },
    frame(D, i, t) { return cam(D, move({ p: [19.5, 7.2, 16.5], l: [-2, 0.8, -3], fov: 56 }, { p: [17.5, 8.4, 17.5], l: [-3, 0.8, -4], fov: 56 }, t / 6.6)); },
  },
  // ============================================================ two maps
  {
    name: 'map_emporium', seconds: 3.0,
    async setup(D) {
      await round(D, { map: 0, seed: 309, hideMs: 14000, hunt: false, stage: `H.place(ME, 22.5, -15.5, 0);` });
      await D.srv(`H.phaseLeft(60000)`);
      await D.hud(false); await D.labels(false);
    },
    frame(D, i, t) { return cam(D, move({ p: [-9.4, 2.3, 15.6], l: [3, 0.9, 9.5], fov: 56 }, { p: [-8.2, 2.2, 15.3], l: [4, 0.9, 8.5], fov: 54 }, t / 3.0, linear)); },
  },
  {
    name: 'map_meadow', seconds: 3.0,
    async setup(D) {
      await round(D, { map: 1, seed: 202, hideMs: 14000, hunt: false, stage: `H.place(ME, 0, 16, 0);` });
      await D.srv(`H.phaseLeft(60000)`);
      await D.hud(false); await D.labels(false);
    },
    frame(D, i, t) { return cam(D, move({ p: [-9.5, 2.3, 8.5], l: [-17.5, 0.2, 0.5], fov: 54 }, { p: [-10.6, 2.0, 7.4], l: [-18, 0.2, 0], fov: 52 }, t / 3.0, linear)); },
  },
  // ============================================================ friends: a private room
  {
    name: 'lobby', seconds: 4.5,
    async setup(D) {
      await D.srv(`const r = H.R(); r.botsWanted = 5; r.balanceBots(); r.toLobby();`);
      await D.ff(6000);
      await D.cli(() => { window.__pp.locked = false; });
    },
  },
];

module.exports = SHOTS;
