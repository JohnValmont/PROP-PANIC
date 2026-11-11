#!/usr/bin/env node
/**
 * Asset pipeline. Downloads CC0 assets from Poly Haven (https://polyhaven.com) and
 * optimises them for the browser: meshes are simplified and meshopt-compressed,
 * textures resized and converted to WebP. Output goes to client/public/art.
 *
 * The output is committed, so this only needs re-running when the lists change:
 *   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
 *   node tools/assets.mjs            # everything missing
 *   node tools/assets.mjs --force barrel,duck
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, flatten, join, weld, simplify, prune, center, textureCompress, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';
import { MODELS, TEXTURES, HDRIS } from './asset-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client/public/art');
const CACHE = process.env.ASSET_CACHE || path.join(ROOT, '.asset-cache');
const API = 'https://api.polyhaven.com';
const UA = { 'User-Agent': 'asset-fetch/1.0' };
const args = process.argv.slice(2);
const force = new Set((args[args.indexOf('--force') + 1] || '').split(',').filter(Boolean));
const forceAll = args.includes('--all');

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function download(url, file) {
  if (existsSync(file)) return file;
  await fs.mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      await fs.writeFile(file + '.part', Buffer.from(await r.arrayBuffer()));
      await fs.rename(file + '.part', file);
      return file;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
}

async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: n }, async () => {
    while (queue.length) {
      const it = queue.shift();
      try { await fn(it); } catch (e) { console.error('FAILED', Array.isArray(it) ? it[0] : it, e.message); process.exitCode = 1; }
    }
  }));
}

function triCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return Math.round(n);
}

async function buildModel([id, src, tris, tex, flat], manifest) {
  const out = path.join(OUT, 'models', id + '.glb'), lite = path.join(OUT, 'lite', id + '.glb');
  const redo = force.has(id) || forceAll;
  const needMain = redo || !(existsSync(out) && manifest.models[id]), needLite = redo || !existsSync(lite);
  if (!needMain && !needLite) return;
  const files = await getJson(`${API}/files/${src}`);
  const g = files.gltf['1k'].gltf;
  const dir = path.join(CACHE, 'models', src);
  const main = await download(g.url, path.join(dir, path.basename(g.url)));
  await Promise.all(Object.entries(g.include).map(([rel, f]) => download(f.url, path.join(dir, rel))));

  await MeshoptDecoder.ready; await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const before = triCount(await io.read(main));
  const make = async (budget, texSize) => {
    let doc; let after = 0;
    // tighten the error bound until the triangle budget is met
    for (const error of [0.004, 0.012, 0.03, 0.08, 0.25]) {
      doc = await io.read(main);
      doc.setLogger(new Logger(Logger.Verbosity.ERROR));
      await doc.transform(dedup(), flatten(), join(), weld());
      if (before > budget * 1.15) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / before, error, lockBorder: false }));
      after = triCount(doc);
      if (after <= budget * 1.3) break;
    }
    if (flat) {
      const sc = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
      const pivot = doc.createNode('pivot').setRotation([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
      for (const child of sc.listChildren()) { sc.removeChild(child); pivot.addChild(child); }
      sc.addChild(pivot);
    }
    await doc.transform(
      center({ pivot: 'below' }),
      flatten(),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 84 }),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
    const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
    return { glb: await io.writeBinary(doc), after, b: getBounds(scene) };
  };
  if (needMain) {
    const { glb, after, b } = await make(tris, tex);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, glb);
    manifest.models[id] = { src, size: [0, 1, 2].map((i) => +(b.max[i] - b.min[i]).toFixed(3)), tris: after, kb: Math.round(glb.byteLength / 1024) };
  }
  if (needLite) {
    // the low-detail twin used by Fast graphics: a fifth of the triangles, small colour texture only matters
    const { glb, after } = await make(Math.max(180, Math.round(tris * 0.2)), 256);
    await fs.mkdir(path.dirname(lite), { recursive: true });
    await fs.writeFile(lite, glb);
    manifest.models[id].lite = after; manifest.models[id].liteKb = Math.round(glb.byteLength / 1024);
  }
  console.log(`model ${id.padEnd(14)} ${String(before).padStart(8)} -> ${manifest.models[id].tris} / ${manifest.models[id].lite} tris  ${manifest.models[id].kb} / ${manifest.models[id].liteKb} KB`);
}

const MAPS = { d: ['Diffuse', 'diff', 'Base Color'], n: ['nor_gl'], a: ['arm'] };

async function buildTexture([id, src, size], manifest) {
  const done = ['d', 'n', 'a'].every((k) => existsSync(path.join(OUT, 'tex', `${id}_${k}.webp`)));
  if (done && manifest.textures[id] && !force.has(id) && !forceAll) return;
  const files = await getJson(`${API}/files/${src}`);
  let kb = 0;
  for (const [k, names] of Object.entries(MAPS)) {
    const key = names.find((n) => files[n]);
    if (!key) throw new Error(`${src}: no ${k} map`);
    const f = files[key]['1k'].jpg;
    const raw = await download(f.url, path.join(CACHE, 'tex', path.basename(f.url)));
    const out = path.join(OUT, 'tex', `${id}_${k}.webp`);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await sharp(raw).resize(size, size).webp({ quality: k === 'n' ? 88 : 82 }).toFile(out);
    kb += (await fs.stat(out)).size / 1024;
  }
  manifest.textures[id] = { src, kb: Math.round(kb) };
  console.log(`texture ${id.padEnd(12)} ${Math.round(kb)} KB`);
}

async function buildHdri([id, src, bg], manifest) {
  const out = path.join(OUT, 'hdr', id + '.hdr');
  if (existsSync(out) && manifest.hdris[id] && !force.has(id) && !forceAll) return;
  const files = await getJson(`${API}/files/${src}`);
  const f = files.hdri['1k'].hdr;
  const raw = await download(f.url, path.join(CACHE, 'hdr', path.basename(f.url)));
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.copyFile(raw, out);
  let kb = (await fs.stat(out)).size / 1024;
  if (bg) {
    // a tone-mapped panorama for the visible sky; lighting still comes from the HDR
    const jpg = await download(files.tonemapped.url, path.join(CACHE, 'hdr', src + '.jpg'));
    const o2 = path.join(OUT, 'hdr', id + '_bg.jpg');
    await sharp(jpg, { limitInputPixels: false }).resize(bg, bg / 2).jpeg({ quality: 86, mozjpeg: true }).toFile(o2);
    kb += (await fs.stat(o2)).size / 1024;
  }
  manifest.hdris[id] = { src, kb: Math.round(kb) };
  console.log(`hdri ${id.padEnd(12)} ${Math.round(kb)} KB`);
}

const manifestFile = path.join(OUT, 'manifest.json');
const manifest = existsSync(manifestFile) ? JSON.parse(await fs.readFile(manifestFile, 'utf8')) : {};
delete manifest.v;
manifest.models ||= {}; manifest.textures ||= {}; manifest.hdris ||= {};
for (const k of Object.keys(manifest.textures)) if (!TEXTURES.some((t) => t[0] === k)) { delete manifest.textures[k]; for (const m of ['d', 'n', 'a']) await fs.rm(path.join(OUT, 'tex', `${k}_${m}.webp`), { force: true }); }
for (const k of Object.keys(manifest.models)) if (!MODELS.some((m) => m[0] === k)) { delete manifest.models[k]; await fs.rm(path.join(OUT, 'models', k + '.glb'), { force: true }); }

await pool(HDRIS, 2, (h) => buildHdri(h, manifest));
await pool(TEXTURES, 4, (t) => buildTexture(t, manifest));
await pool(MODELS, 4, (m) => buildModel(m, manifest));

const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const body = { models: sorted(manifest.models), textures: sorted(manifest.textures), hdris: sorted(manifest.hdris) };
// cache-busting version: changes whenever any asset does
const v = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 8);
await fs.writeFile(manifestFile, JSON.stringify({ v, ...body }, null, 1));
const total = [...Object.values(manifest.models), ...Object.values(manifest.textures), ...Object.values(manifest.hdris)].reduce((s, v) => s + v.kb, 0);
console.log(`\n${Object.keys(manifest.models).length} models, ${Object.keys(manifest.textures).length} texture sets, ${Object.keys(manifest.hdris).length} HDRIs — ${(total / 1024).toFixed(1)} MB`);
