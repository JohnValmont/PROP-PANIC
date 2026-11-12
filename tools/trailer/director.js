// Staging helpers, evaluated once inside the trailer server (see server-entry.ts: `room`, `rooms`, `H`,
// CFG, CHAOS_WEIGHTS, PROPS, PROP_INDEX are in scope). They set scenes up and call the room's own
// methods (fire, transform, ability, taunt, haunt, triggerChaos); game rules are never changed.
const R = () => [...rooms].find((r) => !r.closed);
H.R = R;
H.all = () => [...R().players.values()];
H.human = () => H.all().find((p) => p.ws);
H.bots = () => H.all().filter((p) => !p.ws);
H.byName = (n) => H.all().find((p) => p.name === n);
H.get = (id) => R().players.get(id);

/** Stop a bot's brain (it stands still), drive it from a script, or hand it back to its brain. */
H.freeze = (p) => { if (!p.__brain) p.__brain = p.bot; p.bot = { update() {} }; };
H.puppet = (p, fn) => { if (!p.__brain) p.__brain = p.bot; p.bot = { update: (room, q, t, dt) => { try { fn(room, q, t, dt); } catch (e) { console.error('[puppet]', e); } } }; };
/** Stand still but keep physics running (so a shockwave or a sneeze can still throw it). */
H.hold = (p) => H.puppet(p, (room, q, t, dt) => H.step(room, q, dt, {}));
H.free = (p) => { if (p.__brain) { p.bot = p.__brain; p.__brain = null; } };
H.freeAll = () => H.all().forEach(H.free);

/** One physics step for a puppet: move along yaw (mz forward, mx strafe), optional jump/dash. */
H.step = (room, p, dt, o = {}) => {
  room.applyCmd(p, { dt, mx: o.mx ?? 0, mz: o.mz ?? 0, yaw: o.yaw ?? p.yaw, jump: !!o.jump, dash: !!o.dash }, o.pitch ?? p.pitch, o.facing ?? o.yaw ?? p.facing, room.now);
};
/** Puppet that walks to (x, z) and stops; optional face direction once there. */
H.walkTo = (p, x, z, o = {}) => H.puppet(p, (room, q, t, dt) => {
  const dx = x - q.body.x, dz = z - q.body.z, d = Math.hypot(dx, dz);
  const yaw = d > 0.25 ? Math.atan2(-dx, -dz) : (o.face ?? q.yaw);
  H.step(room, q, dt, { mz: d > 0.25 ? Math.min(1, d) * (o.speed ?? 1) : 0, yaw, pitch: o.pitch ?? 0, jump: !!o.hop && q.body.ground && d > 0.5 });
});

H.place = (p, x, z, yaw = p.yaw, y = 0) => {
  const b = p.body; b.x = x; b.y = y; b.z = z; b.vx = b.vy = b.vz = 0; b.ground = y === 0; p.yaw = p.facing = yaw; p.hist.length = 0;
};
H.disguise = (p, type) => {
  const t = typeof type === 'string' ? PROP_INDEX[type] : type;
  const nb = propBody(PROPS[t]);
  p.disguise = t; p.body.hw = nb.hw; p.body.h = nb.h; R().rosterDirty = true;
};

/** Teams for the round in progress: ids in `hunters` hunt, everyone else hides. */
H.cast = (hunters) => {
  const room = R();
  for (const p of room.players.values()) { p.playing = true; if (!hunters.includes(p.id)) { p.disguise = room.map.starters[0]; room.spawnProp(p); } }
  for (const p of room.players.values()) if (hunters.includes(p.id)) room.spawnHunter(p);
  room.rosterDirty = true;
};

/** A chaos event of this kind, now. */
H.chaos = (kind) => {
  const room = R(), saved = { ...CHAOS_WEIGHTS };
  for (const k of Object.keys(CHAOS_WEIGHTS)) CHAOS_WEIGHTS[k] = k === kind ? 1 : 0;
  room.lastEventKind = ''; room.event = null;
  room.triggerChaos();
  Object.assign(CHAOS_WEIGHTS, saved);
};

/** Skip ahead in the current phase: leave `ms` on the clock. */
H.phaseLeft = (ms) => { const room = R(); room.phaseEnds = room.now + ms; room.rosterDirty = true; /* the client arms its role card on a phase message and shows it on the next roster: let that happen now, not mid-shot */ room.broadcast({ t: 'phase', phase: room.phase, ends: room.phaseEnds, round: room.round, rounds: room.rounds, seed: room.seed, map: room.mapId, next: room.nextMap(), results: undefined }); };

/** Decor near a point, nearest first: [{ id, type, name, x, y, z, d }]. */
H.decorNear = (x, z, r = 4, y = null) => R().map.decor
  .map((d) => ({ id: d.id, type: d.type, name: PROPS[d.type].id, x: d.x, y: d.y, z: d.z, d: Math.hypot(d.x - x, d.z - z) + (y === null ? 0 : Math.abs(d.y - y)) }))
  .filter((d) => d.d <= r).sort((a, b) => a.d - b.d);

/** Aim angles from a player's eye to a point (yaw, pitch as the game measures them). */
H.aim = (p, x, y, z) => {
  const eye = p.body.y + (p.team === 'hunter' ? CFG.HUNTER_EYE : p.body.h * 0.6);
  const dx = x - p.body.x, dy = y - eye, dz = z - p.body.z;
  return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))];
};
H.shootAt = (p, x, y, z) => { const [yaw, pitch] = H.aim(p, x, y, z); p.yaw = p.facing = yaw; p.pitch = pitch; p.nextFireAt = 0; R().fire(p, yaw, pitch, R().now); };

/**
 * Start a round on `map` with the loose props laid out from `seed` (so the layout can be studied offline with
 * buildMap), randomness reseeded, and the given hunters. Returns the cast.
 */
H.start = ({ map = 0, seed = 101, rng = seed, hunters = 1, bots = 5 }) => {
  const room = R();
  room.botsWanted = bots; room.balanceBots();
  reseed(rng);
  room.mapPref = map + 1;
  room.round = 1; // every staged round reads as round 2 of 3, not round 14 of 3
  const load = room.loadMap;
  room.loadMap = (s, id) => { room.loadMap = load; return load.call(room, seed, id); };
  room.startRound();
  const ids = typeof hunters === 'number' ? H.bots().slice(0, hunters).map((p) => p.id) : hunters;
  H.cast(ids);
  return H.summary();
};

H.summary = () => H.all().map((p) => ({ id: p.id, name: p.name, team: p.team, alive: p.alive, x: +p.body.x.toFixed(2), y: +p.body.y.toFixed(2), z: +p.body.z.toFixed(2), dis: PROPS[p.disguise].id, human: !!p.ws, focus: Math.round(p.focus) }));
return 'director ready';
