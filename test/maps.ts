/** Structural checks for every map: deterministic, spawns are free, bots can path around, sane toy counts.  Run: npm run test:maps */
import { buildMap, MAP_NAMES } from '../shared/map';
import { World } from '../shared/physics';
import { PROPS, propBody } from '../shared/props';
import { NavGrid } from '../server/bots';

let failures = 0;
const ok = (c: unknown, label: string) => { if (c) console.log('  ✓', label); else { failures++; console.log('  ✗ FAIL:', label); } };

for (let id = 0; id < MAP_NAMES.length; id++) {
  console.log(MAP_NAMES[id]);
  let minDecor = 1e9, maxDecor = 0, badSpawn = 0, reach = 0, tested = 0, missingStarter = 0;
  for (const seed of [1, 7, 42, 1234, 99999, 31337]) {
    const m = buildMap(seed, id);
    if (JSON.stringify(buildMap(seed, id)) !== JSON.stringify(m)) { failures++; console.log('  ✗ FAIL: not deterministic for seed', seed); }
    const w = new World(m);
    minDecor = Math.min(minDecor, m.decor.length); maxDecor = Math.max(maxDecor, m.decor.length);
    for (const [x, z] of m.hunterSpawns) if (!w.fits(x, 0, z, 0.32, 1.75)) badSpawn++;
    for (const [x, z] of m.propSpawns) if (!w.fits(x, 0, z, 0.5, 1.0)) badSpawn++;
    const types = new Set(m.decor.map((d) => d.type));
    for (const s of m.starters) { if (!types.has(s)) missingStarter++; const b = propBody(PROPS[s]); if (b.h > 1) missingStarter++; }
    const nav = new NavGrid(w);
    for (let i = 0; i < 40; i++) { const [x, z] = nav.randomFree(); tested++; if (nav.path(0, 14, x, z)) reach++; }
    // every floor toy a bot might pick must be approachable
    for (const d of m.decor) if (d.y === 0 && nav.nearestFree(d.x, d.z, 6) < 0) { failures++; console.log('  ✗ FAIL: unreachable toy', PROPS[d.type].id, d.x, d.z); }
  }
  ok(badSpawn === 0, 'all spawn points are free');
  ok(minDecor >= 150 && maxDecor <= 320, `toy count in a searchable range (${minDecor}–${maxDecor})`);
  ok(reach / tested > 0.93, `bots can reach ${Math.round((100 * reach) / tested)}% of open floor from the entrance`);
  ok(missingStarter === 0, 'every starting disguise exists on the map and is small');
}
console.log(failures ? `\n${failures} FAILED` : '\nAll map checks passed.');
process.exit(failures ? 1 : 0);
