/** Location scouting: stills from candidate camera positions on both maps, HUD hidden.  node scout.cjs <outdir> */
const path = require('node:path');
const fs = require('node:fs');
const { boot, stepWorld } = require('./lib.cjs');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const BUNDLE = process.env.TRAILER_BUNDLE;

const POSES = {
  0: {
    overview: [[21, 4.1, 15.5], [0, 0.3, -2]],
    aisle: [[0.2, 1.5, 7.5], [0, 0.9, -8]],
    aisleLow: [[-2.2, 0.5, 4], [-2.2, 0.6, -6]],
    furniture: [[-11.5, 2.2, -3], [-18, 0.4, -12]],
    curios: [[-11.5, 2.2, 1], [-19, 0.6, 10]],
    fort: [[11.5, 2.6, -2.5], [18, 1, -11]],
    bargain: [[11.5, 2.4, 1.5], [19, 0.4, 11]],
    stock: [[0, 2.4, -10], [0, 0.3, -16]],
    checkout: [[-9, 2.2, 15.5], [3, 0.8, 10]],
  },
  1: {
    overview: [[21, 9, 16], [-2, 0, -4]],
    barn: [[-9, 2.5, -4], [-17.5, 1.5, -12]],
    pond: [[-10, 2.2, 7], [-18, 0, 0]],
    camp: [[10, 2.5, -4], [17, 0.5, -11]],
    market: [[6, 2.5, 7], [16, 0.8, 14]],
    garden: [[11, 2.2, 3], [18, 0.4, 0]],
    fort: [[2, 2.2, 6], [8, 1, 1]],
    lawn: [[-5, 2.2, 9], [-15, 0.5, 14]],
    gate: [[0, 1.8, 15], [0, 1, 0]],
  },
};

(async () => {
  const { server, browser, client } = await boot({ bundle: BUNDLE, port: 8121, width: 960, height: 540 });
  const ff = async (ms) => { await client.eval(() => { window.__pp.renderEvery = 1e9; }); for (let t = 0; t < ms; t += 50) await stepWorld(server, client, 50); await client.eval(() => { window.__pp.renderEvery = 1; }); };
  for (const map of [0, 1]) {
    console.log(await server.eval(`const r = H.R(); r.botsWanted = 5; r.balanceBots(); r.mapPref = ${map + 1}; r.startRound(); H.cast([H.bots()[0].id]); return H.all().length`));
    await ff(24000);
    await client.eval(() => window.__hud(false));
    for (const [name, [p, l]] of Object.entries(POSES[map])) {
      await client.eval(([p, l]) => { window.__cine = { p, l, fov: 55 }; }, [p, l]);
      await stepWorld(server, client, 33);
      await stepWorld(server, client, 33);
      await client.grab(path.join(OUT, `m${map}-${name}.jpg`), 85);
      console.log('shot', map, name);
    }
    console.log(JSON.stringify(await server.eval('return H.summary()')));
  }
  console.log('errors', client.errors.slice(0, 5));
  await browser.close(); server.stop(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
