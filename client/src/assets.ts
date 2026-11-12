/**
 * Loads the scanned models, PBR texture sets and HDR skies in client/public/art (see tools/assets.mjs).
 * Everything streams in after boot: callers get a placeholder first and are called back when the real
 * thing arrives, so the game is playable on a slow connection and survives a failed download.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { PROPS } from '../../shared/props';

export interface Part { geo: THREE.BufferGeometry; mat: THREE.Material; }
interface Manifest { v: string; models: Record<string, { size: number[]; tris: number }>; textures: Record<string, unknown>; hdris: Record<string, unknown>; }

/** Per-surface look: metres per texture repeat, whether the grain runs along a box's long axis, and a colour gain. */
const SURFACES: Record<string, { tile: number; grain?: boolean; gain?: [number, number, number]; rough?: number; metal?: number; flat?: number }> = {
  floor: { tile: 1.9, gain: [1.12, 1.05, 0.98] },
  plaster: { tile: 3, gain: [1.32, 1.28, 1.2] },
  brick: { tile: 2.2, gain: [1.1, 1.05, 1.0] },
  concrete: { tile: 3.5, gain: [1.05, 1.04, 1.02] },
  oak: { tile: 1.3, grain: true, gain: [1.05, 1, 0.95], flat: 0.62 },
  walnut: { tile: 1.3, grain: true, gain: [0.78, 0.7, 0.62], flat: 0.55 },
  metal: { tile: 1.2, gain: [0.9, 0.95, 1.0], metal: 1 },
  grass: { tile: 4.5, gain: [0.78, 1.18, 0.5] },
  dirt: { tile: 3, gain: [1.0, 0.9, 0.72] },
  planks: { tile: 1.8, grain: true, gain: [1.5, 1.4, 1.25] },
  whitewood: { tile: 1.4, grain: true, gain: [1.22, 1.2, 1.14] },
  deck: { tile: 1.6, grain: true, gain: [1.75, 1.6, 1.4] },
  roof: { tile: 2, grain: true, gain: [1.3, 1.3, 1.3], metal: 1 },
  bark: { tile: 1.6, grain: true, gain: [1.1, 1.0, 0.9] },
  thatch: { tile: 2, gain: [1.9, 1.65, 1.15] },
  stonewall: { tile: 2.5 },
};
export const surfaceInfo = (name: string) => SURFACES[name] ?? { tile: 2 };

const BASE = 'art/';
function pixel(css: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const g = c.getContext('2d')!;
  g.fillStyle = css; g.fillRect(0, 0, 2, 2);
  return c;
}
const placeholderMat = new THREE.MeshStandardMaterial({ color: 0xb9a98e, roughness: 0.85 });

class AssetStore {
  manifest: Manifest | null = null;
  maxAniso = 4;
  /** Fast graphics: low-detail models, colour textures only, simple shading. Change it with setLite(). */
  lite = false;
  /** Bumped on every switch, so a download started for the other tier is thrown away when it lands. */
  private tier = 0;

  /**
   * Switch between the fast and the full asset set without reloading the page. Everything built from the
   * old set is released here; the caller then rebuilds the scene, which requests the new set as usual.
   */
  setLite(v: boolean) {
    if (v === this.lite) return;
    this.lite = v; this.tier++;
    const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const;
    for (const parts of this.models.values()) for (const p of parts) {
      p.geo.dispose();
      for (const k of maps) (p.mat as any)[k]?.dispose?.(); // scans carry their own textures: free the video memory
      p.mat.dispose();
    }
    this.models.clear(); this.waiting.clear();
    for (const m of this.matCache.values()) m.dispose(); // surface textures are shared by both tiers and stay
    this.matCache.clear();
  }
  /** Fraction of requested downloads that have finished (for the loading bar). */
  progress = 1;
  private requested = 0; private finished = 0;
  private models = new Map<string, Part[]>();
  private waiting = new Map<string, ((p: Part[]) => void)[]>();
  private texCache = new Map<string, THREE.Texture>();
  private matCache = new Map<string, THREE.MeshStandardMaterial>();
  private placeholders = new Map<string, Part[]>();
  private gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private texLoader = new THREE.TextureLoader();
  private queue: (() => Promise<void>)[] = []; private active = 0;

  async init(): Promise<void> {
    // ?noart keeps the plain placeholders: the automated browser test checks game logic, not art, on a machine with no GPU
    try {
      if (new URLSearchParams(location.search).has('noart')) sessionStorage.setItem('pp_noart', '1');
      if (sessionStorage.getItem('pp_noart') === '1') return;
    } catch { /* storage blocked */ }
    try { this.manifest = await (await fetch(BASE + 'manifest.json', { cache: 'no-cache' })).json(); }
    catch { this.manifest = null; }
  }

  private url(p: string) { return `${BASE}${p}?v=${this.manifest?.v ?? '0'}`; }

  /** At most six downloads at a time, in request order, so the map being played always wins. */
  private enqueue(job: () => Promise<void>) {
    this.requested++; this.progress = this.finished / this.requested;
    const run = () => {
      const next = this.queue.shift();
      if (!next) return;
      this.active++;
      next().catch(() => {}).then(() => { this.active--; this.finished++; this.progress = this.finished / this.requested; run(); });
    };
    this.queue.push(job);
    if (this.active < 6) run();
  }

  // ------------------------------------------------------------------ models

  /** The model scaled to `size` with its origin at the bottom centre, or null while it downloads. */
  model(id: string): Part[] | null { return this.models.get(id) ?? null; }

  /** A plain box of the right size, shown until the scan arrives. */
  placeholder(id: string, size: number[]): Part[] {
    let p = this.placeholders.get(id);
    if (!p) {
      const geo = new THREE.BoxGeometry(size[0] * 0.92, size[1] * 0.96, size[2] * 0.92).translate(0, size[1] * 0.48, 0);
      this.placeholders.set(id, (p = [{ geo, mat: placeholderMat }]));
    }
    return p;
  }

  /**
   * Call back with the model: at once if it is loaded, otherwise when it arrives.
   * `size` is the target box in metres; a single number means "this tall, keep proportions".
   */
  want(id: string, size: number[] | number, cb: (p: Part[]) => void) {
    const have = this.models.get(id);
    if (have) { cb(have); return; }
    const list = this.waiting.get(id);
    if (list) { list.push(cb); return; }
    this.waiting.set(id, [cb]);
    if (!this.manifest?.models[id]) return; // unknown or manifest missing: keep the placeholder
    const tier = this.tier;
    this.enqueue(async () => {
      if (tier !== this.tier) return; // the graphics setting changed while this waited in the queue
      const gltf = await this.gltf.loadAsync(this.url(`${this.lite ? 'lite' : 'models'}/${id}.glb`));
      if (tier !== this.tier) return;
      const parts = this.normalise(gltf.scene, size);
      this.models.set(id, parts);
      for (const f of this.waiting.get(id) ?? []) f(parts);
      this.waiting.delete(id);
    });
  }

  /** Disguise `type` from the catalogue. */
  wantProp(type: number, cb: (p: Part[]) => void) {
    const d = PROPS[type];
    this.want(d.id, [d.w, d.h, d.d], cb);
  }
  propParts(type: number): Part[] {
    const d = PROPS[type];
    return this.models.get(d.id) ?? this.placeholder(d.id, [d.w, d.h, d.d]);
  }

  /** A ready-to-add object for one disguise; it swaps itself from placeholder to scan when the download lands. */
  propObject(type: number, shadows = true): THREE.Group {
    const g = new THREE.Group();
    const fill = (parts: Part[]) => {
      g.clear();
      for (const p of parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = shadows; m.receiveShadow = true; m.userData.mat = p.mat; g.add(m); }
    };
    fill(this.propParts(type));
    if (!this.models.has(PROPS[type].id)) this.wantProp(type, fill);
    return g;
  }

  private normalise(scene: THREE.Object3D, size: number[] | number): Part[] {
    scene.updateMatrixWorld(true);
    const parts: Part[] = [];
    const box = new THREE.Box3();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.geometry;
      const geo = new THREE.BufferGeometry();
      // meshopt output is quantised to integers: lift positions and normals to floats before transforming
      for (const name of ['position', 'normal'] as const) {
        const a = src.getAttribute(name);
        if (!a) continue;
        const out = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) { out[i * 3] = a.getX(i); out[i * 3 + 1] = a.getY(i); out[i * 3 + 2] = a.getZ(i); }
        geo.setAttribute(name, new THREE.BufferAttribute(out, 3));
      }
      if (src.getAttribute('uv')) geo.setAttribute('uv', src.getAttribute('uv'));
      if (src.index) geo.setIndex(src.index);
      geo.applyMatrix4(mesh.matrixWorld);
      if (!geo.getAttribute('normal')) geo.computeVertexNormals();
      geo.computeBoundingBox();
      box.union(geo.boundingBox!);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap]) if (t) t.anisotropy = this.maxAniso;
      if (mat.transparent && !mat.alphaTest) { mat.transparent = false; mat.alphaTest = 0.5; } // leaves: cut-out, not blended
      if (mat.alphaTest) mat.side = THREE.DoubleSide;
      // fast graphics: one colour texture and per-vertex lighting instead of the full physically based shader
      parts.push({ geo, mat: this.lite ? new THREE.MeshLambertMaterial({ map: mat.map, color: mat.color, alphaTest: mat.alphaTest, side: mat.side }) : mat });
    });
    const s = box.getSize(new THREE.Vector3());
    const k = typeof size === 'number' ? [size / s.y, size / s.y, size / s.y] : [size[0] / s.x, size[1] / s.y, size[2] / s.z];
    const m = new THREE.Matrix4().makeScale(k[0], k[1], k[2]).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
    for (const p of parts) { p.geo.applyMatrix4(m); p.geo.computeBoundingBox(); p.geo.computeBoundingSphere(); }
    return parts;
  }

  // ------------------------------------------------------------------ textures and surfaces

  /** One map of a texture set: 'd' colour, 'n' normal, 'a' occlusion/roughness/metalness. Fills in when downloaded. */
  texture(name: string, kind: 'd' | 'n' | 'a'): THREE.Texture {
    const key = name + '_' + kind;
    let t = this.texCache.get(key);
    if (t) return t;
    // a flat stand-in until the image lands: white colour, flat normal, fully rough and unoccluded
    t = new THREE.Texture(pixel(kind === 'd' ? '#ffffff' : kind === 'n' ? '#8080ff' : '#ffff00'));
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = this.maxAniso;
    if (kind === 'd') t.colorSpace = THREE.SRGBColorSpace;
    this.texCache.set(key, t);
    const tex = t;
    if (this.manifest?.textures[name]) this.enqueue(async () => {
      const img = await this.texLoader.loadAsync(this.url(`tex/${key}.webp`));
      tex.dispose(); tex.image = img.image; tex.needsUpdate = true; // dispose: the size changed
    });
    return t;
  }

  /** Shared PBR material for a named surface. UVs are expected in world metres divided by the surface's tile size. */
  surface(name: string): THREE.MeshStandardMaterial {
    let m = this.matCache.get(name);
    if (m) return m;
    const info = surfaceInfo(name);
    if (this.lite) {
      const lm = new THREE.MeshLambertMaterial({ map: this.texture(name, 'd'), vertexColors: true }) as unknown as THREE.MeshStandardMaterial;
      if (info.gain) lm.color.setRGB(info.gain[0], info.gain[1], info.gain[2]);
      this.matCache.set(name, lm);
      return lm;
    }
    const arm = this.texture(name, 'a');
    m = new THREE.MeshStandardMaterial({
      map: this.texture(name, 'd'), normalMap: this.texture(name, 'n'),
      aoMap: arm, roughnessMap: info.flat ? null : arm, metalnessMap: info.metal ? arm : null,
      roughness: info.flat ?? info.rough ?? 1, metalness: info.metal ?? 0, vertexColors: true,
    });
    if (info.gain) m.color.setRGB(info.gain[0], info.gain[1], info.gain[2]);
    this.matCache.set(name, m);
    return m;
  }

  hdr(id: string): Promise<THREE.DataTexture> {
    return new Promise((resolve, reject) => {
      if (!this.manifest?.hdris[id] || this.lite) { reject(new Error('no hdr')); return; }
      this.enqueue(async () => {
        try { const t = await new RGBELoader().loadAsync(this.url(`hdr/${id}.hdr`)); t.mapping = THREE.EquirectangularReflectionMapping; resolve(t); }
        catch (e) { reject(e); }
      });
    });
  }

  image(path: string): THREE.Texture {
    const t = new THREE.Texture(pixel('#9db8d0'));
    t.needsUpdate = true;
    this.enqueue(async () => { const img = await this.texLoader.loadAsync(this.url(path)); t.dispose(); t.image = img.image; t.needsUpdate = true; });
    return t;
  }
}

export const assets = new AssetStore();
