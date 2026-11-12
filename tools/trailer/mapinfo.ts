/** Print the loose props of a map layout near a point:  npx tsx mapinfo.ts <map> <seed> <x> <z> <r> [ymin] */
import { buildMap } from '../../shared/map';
import { PROPS } from '../../shared/props';
const [map, seed, x, z, r, ymin] = process.argv.slice(2).map(Number);
const m = buildMap(seed, map);
const near = m.decor.filter((d) => Math.hypot(d.x - x, d.z - z) <= r && d.y >= (ymin || 0)).sort((a, b) => a.z - b.z || a.x - b.x);
for (const d of near) console.log(d.id, PROPS[d.type].id.padEnd(12), d.x.toFixed(2), d.y.toFixed(2), d.z.toFixed(2), 'yaw', d.yaw.toFixed(2), 'h', PROPS[d.type].h);
console.log(near.length, 'of', m.decor.length);
