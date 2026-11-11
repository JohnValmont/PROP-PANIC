/**
 * Renders a map: textured architecture, instanced scanned props, image-based lighting from an HDR
 * panorama, and each map's set dressing (the emporium's ceiling, lamps and rugs; the meadow's sky,
 * terrain, grass, trees, water and buildings).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PROPS } from '../../shared/props';
import { ZONES, type Box, type Decor, type Feature, type GameMap } from '../../shared/map';
import { rng } from '../../shared/rng';
import { assets, surfaceInfo, type Part } from './assets';

const dummy = new THREE.Object3D();
const SUN_DIR = new THREE.Vector3(0.536, 0.746, 0.395).normalize(); // where the sun sits in the meadow panorama

/** Lighting and atmosphere per map (index = map id). */
const LOOK = [
  { env: 'store', envI: 0.95, sun: 1.5, sunDir: new THREE.Vector3(0.18, 1, 0.26).normalize(), sunCol: 0xffecd2, hemi: 0.32, sky: 0xfff1de, ground: 0x7d6a55, fog: [0.07, 0.06, 0.055], fogNear: 45, fogFar: 120, exposure: 1.02, bgI: 0 },
  { env: 'meadow', envI: 1.0, sun: 3.4, sunDir: SUN_DIR, sunCol: 0xfff2dc, hemi: 0.12, sky: 0xbfd9ff, ground: 0x6f8f4a, fog: [0.66, 0.78, 0.93], fogNear: 70, fogFar: 420, exposure: 0.92, bgI: 1.15 },
];

interface TypeSet { type: number; bins: Map<number, Decor[]>; meshes: THREE.InstancedMesh[]; }
interface DecorRef { d: Decor; set: TypeSet; meshes: THREE.InstancedMesh[]; index: number; }

const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
const col = new THREE.Color();

/** A box with UVs in world metres (so textures tile at a fixed physical size) and a vertex tint. */
function boxGeo(b: Box): THREE.BufferGeometry {
  const sx = b.x1 - b.x0, sy = b.y1 - b.y0, sz = b.z1 - b.z0;
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  const info = surfaceInfo(b.m ?? ''), tile = info.tile;
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const long = sx >= sy && sx >= sz ? 0 : sy >= sz ? 1 : 2;
  // shift each box by a different amount so neighbouring boards don't share the same grain
  const ou = info.grain ? ((b.x0 * 7.31 + b.z0 * 3.17 + b.y0 * 5.3) % 1) : 0, ov = info.grain ? ((b.z1 * 4.77 + b.x1 * 1.93) % 1) : 0;
  const colors = new Float32Array(pos.count * 3);
  col.setHex(b.c);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let a: number, c: number, ax: number, cx: number; // in-plane coordinates and which world axis each one is
    if (Math.abs(nor.getX(i)) > 0.5) { a = z; c = y; ax = 2; cx = 1; }
    else if (Math.abs(nor.getY(i)) > 0.5) { a = x; c = z; ax = 0; cx = 2; }
    else { a = x; c = y; ax = 0; cx = 1; }
    // wood grain runs along V: point V down the box's long axis
    if (info.grain && ax === long && cx !== long) { const t = a; a = c; c = t; }
    uv.setXY(i, a / tile + ou, c / tile + ov);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function tint(g: THREE.BufferGeometry, hex: number, a?: number[]): THREE.BufferGeometry {
  const n = g.attributes.position.count, size = a ? 4 : 3, out = new Float32Array(n * size);
  col.setHex(hex);
  for (let i = 0; i < n; i++) { out[i * size] = col.r; out[i * size + 1] = col.g; out[i * size + 2] = col.b; if (a) out[i * size + 3] = a[i]; }
  g.setAttribute('color', new THREE.BufferAttribute(out, size));
  return g;
}

/** Re-project a geometry's UVs from its world XZ position: ground planes, roofs and discs. */
function planarUV(g: THREE.BufferGeometry, tile: number, axisU: 'x' | 'z' = 'x'): THREE.BufferGeometry {
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    if (axisU === 'x') uv.setXY(i, x / tile, z / tile); else uv.setXY(i, z / tile, x / tile);
  }
  return g;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function rugTexture(a: string, b: string, c: string): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    const R = rng(a.length * 7 + b.length);
    g.fillStyle = a; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = c; g.lineWidth = 14; g.strokeRect(22, 22, 468, 468);
    g.strokeStyle = b; g.lineWidth = 5; g.strokeRect(44, 44, 424, 424); g.strokeRect(60, 60, 392, 392);
    g.save(); g.translate(256, 256);
    for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 12; i++) {
      g.save(); g.rotate((i / 12) * Math.PI * 2 + ring * 0.26); g.translate(0, 60 + ring * 46);
      g.fillStyle = ring % 2 ? b : c; g.beginPath(); g.moveTo(0, -18); g.lineTo(11, 0); g.lineTo(0, 18); g.lineTo(-11, 0); g.fill(); g.restore();
    }
    g.fillStyle = c; g.beginPath(); g.arc(0, 0, 30, 0, 7); g.fill(); g.fillStyle = b; g.beginPath(); g.arc(0, 0, 16, 0, 7); g.fill();
    g.restore();
    // woven noise so it never reads as flat paint
    for (let i = 0; i < 9000; i++) { g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)'; g.fillRect(R() * 512, R() * 512, 2, 1 + R() * 3); }
  });
}

function signTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  return canvasTex(512, 128, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(8, 8, 496, 112);
    g.fillStyle = fg; g.font = '600 58px Fredoka, ui-rounded, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text.toUpperCase(), 256, 68, 470);
  });
}

function softDot(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  });
}

/** Four sprigs of small leaves with alpha (a 2x2 atlas), shared by every tree canopy. */
function leafTexture(): THREE.CanvasTexture {
  return canvasTex(512, 512, (g) => {
    const R = rng(11);
    for (let cell = 0; cell < 4; cell++) {
      const cx = 128 + (cell % 2) * 256, cy = 128 + Math.floor(cell / 2) * 256;
      // twigs first, then leaves from the outside in so the centre reads densest
      g.strokeStyle = '#3b2c1c'; g.lineWidth = 2.2;
      for (let i = 0; i < 7; i++) { const a = R() * 6.28, l = 50 + R() * 55; g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a + 0.4) * l * 0.5, cy + Math.sin(a + 0.4) * l * 0.5, cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke(); }
      for (let i = 0; i < 150; i++) {
        const a = R() * 6.28, d = Math.sqrt(R()) * 108, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const l = 9 + R() * 8, w = l * (0.36 + R() * 0.16), hue = 78 + R() * 32, lum = 17 + R() * 22 + (1 - d / 108) * 6;
        g.save(); g.translate(x, y); g.rotate(a + (R() - 0.5) * 1.6);
        g.fillStyle = `hsl(${hue} ${46 + R() * 22}% ${lum}%)`;
        g.beginPath(); g.moveTo(-l, 0); g.quadraticCurveTo(0, -w * 1.5, l, 0); g.quadraticCurveTo(0, w * 1.5, -l, 0); g.fill();
        g.strokeStyle = `hsl(${hue} 40% ${lum + 12}%)`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-l * 0.9, 0); g.lineTo(l * 0.9, 0); g.stroke();
        g.restore();
      }
    }
  });
}

/** Tileable ripples as a normal map, for the pond. */
function waterNormals(): THREE.CanvasTexture {
  const N = 256, t = canvasTex(N, N, (g) => {
    const img = g.createImageData(N, N), R = rng(3);
    const waves = Array.from({ length: 9 }, () => ({ kx: Math.round((R() - 0.5) * 14), ky: Math.round((R() - 0.5) * 14), ph: R() * 6.28, a: 0.5 + R() }));
    const h = (x: number, y: number) => { let s = 0; for (const w of waves) s += Math.sin(((x * w.kx + y * w.ky) / N) * Math.PI * 2 + w.ph) * w.a; return s; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), i = (y * N + x) * 4;
      const nx = -dx * 0.9, ny = -dy * 0.9, l = Math.hypot(nx, ny, 1);
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class WorldView {
  root = new THREE.Group();
  hemi = new THREE.HemisphereLight(0xffffff, 0x8a7660, 0.3);
  sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
  /** 0 = lights on, 1 = full blackout (smoothed). */
  dark = 0;
  darkTarget = 0;
  darkFloor = 0.08;
  private quality = 2;
  /** Set dressing is built once per map and then just shown or hidden. */
  private dressed = new Map<number, THREE.Group>();
  private dress = new THREE.Group();
  private mapId = 0;
  private decorGroup = new THREE.Group();
  private refs: DecorRef[] = [];
  private sets = new Map<number, TypeSet>();
  private gen = 0;
  private anims = new Map<number, number>();
  private polter = new Map<number, number>();
  private polterUntil = 0;
  private time = 0;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envs: (THREE.Texture | null)[] = [null, null];
  private fallbackEnv: THREE.Texture | null = null;
  private skyTex: THREE.Texture | null = null;
  private wind = { value: 0 };
  // emissive bits that follow the lights
  private panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  private fireMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private fire: THREE.Object3D | null = null;
  private fireLight: THREE.PointLight | null = null;
  private lampLights: THREE.PointLight[] = [];
  private warm: THREE.PointLight[] = [];
  private blades: THREE.Object3D | null = null;
  private water: THREE.MeshPhysicalMaterial | null = null;
  private motes: THREE.Points[] = [];
  private grass: THREE.Object3D | null = null;
  private sunGlow: THREE.Sprite | null = null;
  private flag: THREE.Mesh | null = null;
  private bgColor = new THREE.Color(0x0b0c10);

  constructor(private scene: THREE.Scene) {
    scene.add(this.root);
    scene.background = this.bgColor;
    scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36; sc.near = 1; sc.far = 150;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.045;
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0x111111, 45, 120);
    for (const [x, z, c] of [[-17.5, -9.5, 0xffb070], [-17.5, 7.5, 0xff9a5a], [17, -8, 0xffc890]] as [number, number, number][]) {
      const l = new THREE.PointLight(c, 0, 16, 1.8);
      l.position.set(x, 3.1, z);
      this.warm.push(l); scene.add(l);
    }
    this.root.add(this.decorGroup);
  }

  /** Set up image-based lighting (needs the renderer). A neutral room lights the scene until the HDR panoramas arrive. */
  initEnv(renderer: THREE.WebGLRenderer) {
    assets.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.fallbackEnv = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.fallbackEnv;
    LOOK.forEach((L, i) => {
      assets.hdr(L.env).then((hdr) => {
        this.envs[i] = this.pmrem!.fromEquirectangular(hdr).texture;
        hdr.dispose();
        if (this.mapId === i) this.scene.environment = this.envs[i];
      }).catch(() => { /* keep the fallback */ });
    });
  }

  /** 0 = fast (no shadows, no grass), 1 = high, 2 = ultra. */
  setQuality(q: number) {
    this.quality = q;
    this.sun.castShadow = q > 0;
    const size = q > 1 ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (this.grass) { this.grass.visible = q > 0; for (const m of this.grass.children as THREE.InstancedMesh[]) m.count = Math.ceil(m.userData.full * (q > 1 ? 1 : 0.5)); }
  }

  load(map: GameMap) {
    // show this map's set dressing, building it the first time it is needed
    this.mapId = map.id;
    for (const [id, g] of this.dressed) g.visible = id === map.id;
    if (!this.dressed.has(map.id)) {
      this.dress = new THREE.Group();
      this.dressed.set(map.id, this.dress);
      this.root.add(this.dress);
      this.buildArchitecture(map);
      if (map.id === 1) this.buildMeadow(map); else this.buildStore();
      this.setQuality(this.quality);
    }
    const L = LOOK[map.id] ?? LOOK[0];
    this.sun.position.copy(L.sunDir).multiplyScalar(70);
    this.sun.color.set(L.sunCol);
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = L.fogNear; fog.far = L.fogFar;
    this.scene.environment = this.envs[map.id] ?? this.fallbackEnv;
    this.scene.background = map.id === 1 && this.skyTex ? this.skyTex : this.bgColor;

    // loose props: one instanced mesh per model part, per type, per patch of floor (so off-screen patches are culled)
    this.gen++;
    for (const s of this.sets.values()) for (const m of s.meshes) { this.decorGroup.remove(m); m.dispose(); }
    this.sets.clear(); this.refs = []; this.anims.clear(); this.polter.clear();
    for (const d of map.decor) {
      let s = this.sets.get(d.type);
      if (!s) this.sets.set(d.type, (s = { type: d.type, bins: new Map(), meshes: [] }));
      const bin = Math.min(3, Math.floor((d.x + 24.5) / 12.25)) + 4 * Math.min(2, Math.floor((d.z + 17.5) / 11.7));
      let list = s.bins.get(bin);
      if (!list) s.bins.set(bin, (list = []));
      list.push(d);
    }
    const gen = this.gen;
    for (const s of this.sets.values()) {
      this.buildSet(s, assets.propParts(s.type));
      if (!assets.model(PROPS[s.type].id)) assets.wantProp(s.type, (parts) => { if (this.gen === gen) this.buildSet(s, parts); });
    }
  }

  private buildSet(s: TypeSet, parts: Part[]) {
    for (const m of s.meshes) { this.decorGroup.remove(m); m.dispose(); }
    s.meshes = [];
    for (const list of s.bins.values()) {
      const meshes = parts.map((p) => {
        const mesh = new THREE.InstancedMesh(p.geo, p.mat, list.length);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.decorGroup.add(mesh); s.meshes.push(mesh);
        return mesh;
      });
      list.forEach((d, i) => { this.refs[d.id] = { d, set: s, meshes, index: i }; this.writeMatrix(d.id, 0, 0, 0); });
      for (const m of meshes) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.computeBoundingBox(); }
    }
  }

  private writeMatrix(id: number, hop: number, tilt: number, squash: number) {
    const r = this.refs[id];
    if (!r) return;
    dummy.position.set(r.d.x, r.d.y + hop, r.d.z);
    dummy.rotation.set(tilt, r.d.yaw, tilt * 0.7, 'YXZ');
    dummy.scale.set(1 + squash, 1 - squash, 1 + squash);
    dummy.updateMatrix();
    for (const m of r.meshes) { m.setMatrixAt(r.index, dummy.matrix); m.instanceMatrix.needsUpdate = true; }
  }

  /** An innocent object got shot (or bumped): make it flinch. */
  wobble(id: number) { if (this.refs[id]) this.anims.set(id, 0); }

  poltergeist(seed: number, ms: number) {
    const R = rng(seed);
    this.polter.clear();
    for (const r of this.refs) if (r && R() < 0.3) this.polter.set(r.d.id, R() * 6.28);
    this.polterUntil = this.time + ms / 1000;
  }
  stopPoltergeist() { for (const id of this.polter.keys()) this.writeMatrix(id, 0, 0, 0); this.polter.clear(); }

  get exposure() { return (LOOK[this.mapId] ?? LOOK[0]).exposure; }

  decorDef(id: number) { const r = this.refs[id]; return r ? { d: r.d, def: PROPS[r.d.type] } : null; }

  update(dt: number) {
    this.time += dt;
    this.wind.value = this.time;
    for (const [id, t0] of this.anims) {
      const t = t0 + dt;
      if (t > 0.55) { this.anims.delete(id); if (!this.polter.has(id)) this.writeMatrix(id, 0, 0, 0); continue; }
      this.anims.set(id, t);
      const k = 1 - t / 0.55;
      this.writeMatrix(id, Math.abs(Math.sin(t * 14)) * 0.12 * k, Math.sin(t * 34) * 0.16 * k, Math.sin(t * 26) * 0.1 * k);
    }
    if (this.polter.size) {
      if (this.time > this.polterUntil) this.stopPoltergeist();
      else for (const [id, ph] of this.polter) {
        const s = Math.sin(this.time * 5.5 + ph);
        this.writeMatrix(id, Math.max(0, s) * 0.28, Math.sin(this.time * 9 + ph) * 0.12, Math.max(0, -s) * 0.12);
      }
    }
    // lights: a blackout (indoors) or an eclipse (outdoors) takes almost everything away
    this.dark += (this.darkTarget - this.dark) * Math.min(1, dt * 5);
    const lit = 1 - this.dark * (1 - this.darkFloor);
    const L = LOOK[this.mapId] ?? LOOK[0];
    const indoor = this.mapId !== 1;
    this.hemi.intensity = (assets.lite ? L.hemi + 0.95 : L.hemi) * lit; // fast graphics has no image-based light to fill the shadows
    this.sun.intensity = L.sun * (1 - this.dark * 0.985);
    this.scene.environmentIntensity = L.envI * lit;
    this.scene.backgroundIntensity = L.bgI * (1 - this.dark * 0.93);
    (this.scene.fog as THREE.Fog).color.setRGB(L.fog[0] * lit, L.fog[1] * lit, L.fog[2] * lit);
    // ceiling panels and bulbs are brighter than white so they bloom; they die in a blackout
    const p = 3.2 * (1 - this.dark * 0.98);
    this.panelMat.color.setRGB(p, p * 0.96, p * 0.86);
    this.bulbMat.color.setRGB(p * 1.5, p * 1.1, p * 0.55);
    for (const l of this.warm) l.intensity = indoor ? 22 * (1 - this.dark) : 0;
    if (assets.lite) for (const l of [...this.warm, ...this.lampLights]) l.visible = false; // every extra light is paid for on every pixel
    // outdoors: lamp posts and the campfire come into their own when the sun goes
    const glow = 0.9 + this.dark * 4;
    this.lampMat.color.setRGB(glow, glow * 0.86, glow * 0.6);
    for (const l of this.lampLights) l.intensity = indoor ? 0 : this.dark * 26;
    if (this.sunGlow) this.sunGlow.visible = !indoor && this.dark < 0.5;
    if (this.blades) this.blades.rotation.z += dt * 0.7;
    if (this.fire) {
      const f = 1 + Math.sin(this.time * 17) * 0.12 + Math.sin(this.time * 29) * 0.08;
      this.fire.scale.set(f, 0.85 + f * 0.25, f); this.fire.rotation.y += dt * 1.3;
      this.fireMat.color.setRGB(2.6 * f, 1.25 * f, 0.35);
      if (this.fireLight) { this.fireLight.intensity = indoor ? 0 : (7 + this.dark * 24) * f; this.fireLight.visible = !assets.lite; }
    }
    if (this.water?.normalMap) { this.water.normalMap.offset.set(this.time * 0.012, this.time * 0.017); }
    if (this.flag) this.flag.rotation.y = Math.sin(this.time * 2.4) * 0.25;
    for (const m of this.motes) { m.rotation.y = this.time * 0.012; m.position.y = Math.sin(this.time * 0.25) * 0.25; }
  }

  // ====================================================================== architecture shared by every map

  private add(geos: THREE.BufferGeometry[], mat: THREE.Material, shadows = true): THREE.Mesh | null {
    if (!geos.length) return null;
    const mesh = new THREE.Mesh(geos.length === 1 ? geos[0] : mergeGeometries(geos, false)!, mat);
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    this.dress.add(mesh);
    return mesh;
  }

  /** Walls, shelves, counters, fences: every visible box, merged into one mesh per surface. */
  private buildArchitecture(map: GameMap) {
    const by = new Map<string, THREE.BufferGeometry[]>();
    for (const b of [...map.statics, ...map.visuals]) {
      if (b.hidden) continue;
      const key = b.m ?? '';
      let list = by.get(key);
      if (!list) by.set(key, (list = []));
      list.push(boxGeo(b));
    }
    for (const [key, list] of by) this.add(list, key ? assets.surface(key) : paintMat);
  }

  /** A model that is set dressing rather than a disguise; appears when its download lands. */
  private placeModel(id: string, size: number[] | number, x: number, y: number, z: number, yaw = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z); g.rotation.y = yaw;
    this.dress.add(g);
    assets.want(id, size, (parts) => { for (const p of parts) { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true; m.receiveShadow = true; g.add(m); } });
    return g;
  }

  private addMotes(color: number, size: number, opacity: number, top: number) {
    const R = rng(5), n = 240, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = -24 + R() * 48; pos[i * 3 + 1] = 0.4 + R() * (top - 0.4); pos[i * 3 + 2] = -17 + R() * 34; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: size * 1.6, map: softDot(), transparent: true, opacity, depthWrite: false, sizeAttenuation: true }));
    this.motes.push(pts); this.dress.add(pts);
  }

  // ====================================================================== Tumbleton's Emporium

  private buildStore() {
    const floorMat = assets.surface('floor');
    const plane = (x0: number, z0: number, x1: number, z1: number, y: number, tile: number, hex = 0xffffff, up = true) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(up ? -Math.PI / 2 : Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
      return tint(planarUV(g, tile, 'z'), hex);
    };
    this.add([plane(-24.5, -17.5, 24.5, 17.5, 0, surfaceInfo('floor').tile)], floorMat, false);
    // the stock room and the crate fort sit on bare concrete
    const conc = assets.surface('concrete').clone(); conc.polygonOffset = true; conc.polygonOffsetFactor = -2; conc.polygonOffsetUnits = -2;
    this.add([plane(-10.35, -17, 10.35, -10.65, 0.002, surfaceInfo('concrete').tile), plane(10.65, -17, 24, -1.15, 0.002, surfaceInfo('concrete').tile, 0xe9e4da)], conc, false);
    // ceiling with exposed beams, recessed light panels and rows of pendant lamps
    const ceil = assets.surface('plaster').clone(); ceil.color.setRGB(1.5, 1.47, 1.4);
    if (assets.lite) ceil.emissive.setRGB(0.42, 0.41, 0.39); // faces away from every light: without image-based lighting it would go black
    this.add([plane(-24.5, -17.5, 24.5, 17.5, 4.5, surfaceInfo('plaster').tile, 0xffffff, false)], ceil, false);
    const beams: THREE.BufferGeometry[] = [], panels: THREE.BufferGeometry[] = [], cords: THREE.BufferGeometry[] = [], shades: THREE.BufferGeometry[] = [], bulbs: THREE.BufferGeometry[] = [];
    for (let x = -21; x <= 21.01; x += 6) beams.push(boxGeo({ x0: x - 0.14, y0: 4.18, z0: -17, x1: x + 0.14, y1: 4.5, z1: 17, c: 0xffffff, m: 'walnut' }));
    for (const z of [-10.5, 8]) beams.push(boxGeo({ x0: -24, y0: 4.26, z0: z - 0.12, x1: 24, y1: 4.5, z1: z + 0.12, c: 0xffffff, m: 'walnut' }));
    for (let x = -18; x <= 18.01; x += 6) for (let z = -13.5; z <= 13.6; z += 4.5) panels.push(new THREE.BoxGeometry(2.2, 0.05, 0.75).translate(x, 4.47, z));
    const shadeGeo = new THREE.LatheGeometry([[0.03, 0.2], [0.05, 0.19], [0.13, 0.1], [0.24, 0], [0.245, -0.012]].map(([r, y]) => new THREE.Vector2(r, y)), 24);
    const pendant = (x: number, z: number, y: number) => {
      cords.push(new THREE.CylinderGeometry(0.008, 0.008, 4.5 - y - 0.19, 6).translate(x, (4.5 + y + 0.19) / 2, z));
      shades.push(shadeGeo.clone().translate(x, y, z));
      bulbs.push(new THREE.SphereGeometry(0.06, 14, 10).translate(x, y + 0.03, z));
    };
    for (const z of [-5.1, -1.3, 2.5]) for (const x of [-7.6, -5.1, -2.6, 2.6, 5.1, 7.6]) pendant(x, z, 3.0);
    for (const x of [-5, 0, 5]) pendant(x, 11.2, 2.75);
    for (const [x, z] of [[-17.5, -9.5], [-20.5, -5], [-14, -13.5], [-17.5, 7.5], [-21, 12], [-14, 3], [17, -8], [20, -3.5], [18, 8.5], [14, 14]]) pendant(x, z, 3.05);
    this.add(beams, assets.surface('walnut'), false);
    this.add(panels, this.panelMat, false);
    this.add(cords, new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.7 }), false);
    const shade = new THREE.MeshStandardMaterial({ color: 0x1f3d36, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
    this.add(shades, shade);
    this.add(bulbs, this.bulbMat, false);
    // rugs
    const rug = (tex: THREE.Texture, x: number, z: number, w: number, d: number, yaw = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      m.position.set(x, 0.004, z); m.rotation.y = yaw; m.receiveShadow = true;
      this.dress.add(m);
    };
    rug(rugTexture('#7a2331', '#e7c98b', '#243a5e'), -17.5, -9.5, 7.5, 5.5);
    rug(rugTexture('#1f4a4a', '#e9d8a6', '#9b2226'), -17.5, 7.5, 6.5, 6.5);
    rug(rugTexture('#2b3a67', '#f1e3c4', '#b5651d'), 0, 15.1, 5.4, 2.4);
    // hanging signs over the doorways into each department
    const board = (text: string, x: number, z: number, yaw: number) => {
      const tex = signTexture(text, '#20140c', '#f3d9a4');
      const g = new THREE.Group();
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
      const f = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.62), face); f.position.z = 0.031;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.62), face); b.position.z = -0.031; b.rotation.y = Math.PI;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.72, 0.06), assets.surface('walnut'));
      tint(slab.geometry, 0xffffff);
      for (const sx of [-1.1, 1.1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.0, 6), shade); c.position.set(sx, 0.86, 0); g.add(c); }
      g.add(slab, f, b);
      g.position.set(x, 3.14, z); g.rotation.y = yaw;
      this.dress.add(g);
    };
    board(ZONES[3].name, -10.5, -6.5, Math.PI / 2); board(ZONES[4].name, -10.5, 3.5, Math.PI / 2);
    board(ZONES[5].name, 10.5, -7.5, Math.PI / 2); board(ZONES[6].name, 10.5, 2.5, Math.PI / 2);
    board(ZONES[2].name, -7, -10.5, 0); board(ZONES[2].name, 7, -10.5, 0); board(ZONES[1].name, 0, 8, 0);
    // pictures, mirrors and clocks on the walls
    const N = 0, S = Math.PI, W = Math.PI / 2, E = -Math.PI / 2;
    for (const [id, h, x, y, z, yaw] of [
      ['frame2', 1.15, -20.6, 1.55, -16.95, N], ['mirror', 1.3, -15.6, 1.4, -16.95, N], ['frame3', 0.8, -12.4, 1.9, -16.95, N],
      ['frame1', 0.95, -23.95, 1.7, -11.5, W], ['wallclock', 0.55, -23.95, 2.25, -13.6, W], ['frame3', 0.8, -23.95, 2.35, 3.6, W], ['frame1', 0.95, -23.95, 2.3, 10.2, W],
      ['mirror', 1.3, -13.4, 2.0, 16.95, S], ['wallclock', 0.55, -3.6, 2.5, 16.95, S], ['frame2', 1.15, 6.4, 1.7, 16.95, S], ['frame3', 0.8, 8.6, 1.9, 16.95, S],
      ['frame2', 1.15, 23.95, 1.7, 9.2, E], ['frame1', 0.95, 23.95, 1.8, 6.6, E], ['wallclock', 0.55, 23.95, 2.3, 1.2, E], ['frame3', 0.8, 14.5, 2.0, -16.95, N],
    ] as [string, number, number, number, number, number][]) this.placeModel(id, h, x, y, z, yaw);
    this.addMotes(0xfff1d6, 0.03, 0.35, 4.2);
  }

  // ====================================================================== Sunny Meadow

  private buildMeadow(map: GameMap) {
    const D = this.dress, R = rng(77);
    if (!this.skyTex) {
      this.skyTex = assets.image('hdr/meadow_bg.jpg');
      this.skyTex.mapping = THREE.EquirectangularReflectionMapping; this.skyTex.colorSpace = THREE.SRGBColorSpace;
    }
    const inPond = (x: number, z: number, k = 1) => ((x + 17.5) / (4.6 * k)) ** 2 + ((z - 1.5) / (3.6 * k)) ** 2 < 1;

    // ---- ground: one big textured lawn with broad colour variation so the tiling never shows
    const lawn = new THREE.PlaneGeometry(900, 900, 90, 90).rotateX(-Math.PI / 2);
    planarUV(lawn, surfaceInfo('grass').tile);
    {
      const pos = lawn.attributes.position, c = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const n = 0.5 + 0.25 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.052) + 0.25 * Math.sin(x * 0.11 + z * 0.09);
        c[i * 3] = 0.82 + n * 0.3; c[i * 3 + 1] = 0.86 + n * 0.24; c[i * 3 + 2] = 0.8 + n * 0.3;
      }
      lawn.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    this.add([lawn], assets.surface('grass'), false);

    // ---- dirt: paths as soft-edged ribbons, plus clearings; drawn just above the lawn
    const dirt = assets.surface('dirt').clone();
    dirt.transparent = true; dirt.depthWrite = false; dirt.polygonOffset = true; dirt.polygonOffsetFactor = -2; dirt.polygonOffsetUnits = -2;
    const dirtGeos: THREE.BufferGeometry[] = [];
    const tile = surfaceInfo('dirt').tile;
    const ribbon = (pts: number[][], w: number) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.4);
      const n = Math.max(8, Math.round(curve.getLength() / 0.7)), P: number[] = [], U: number[] = [], C: number[] = [], I: number[] = [];
      const across = [-0.5, -0.28, 0.28, 0.5], alpha = [0, 1, 1, 0];
      for (let i = 0; i <= n; i++) {
        const p = curve.getPointAt(i / n), t = curve.getTangentAt(i / n), nx = -t.z, nz = t.x;
        const wob = 1 + Math.sin(i * 0.9) * 0.08;
        for (let k = 0; k < 4; k++) {
          const x = p.x + nx * across[k] * w * wob, z = p.z + nz * across[k] * w * wob;
          P.push(x, 0.012, z); U.push(x / tile, z / tile); C.push(1, 1, 1, alpha[k]);
        }
        if (i < n) for (let k = 0; k < 3; k++) { const a = i * 4 + k; I.push(a, a + 4, a + 1, a + 1, a + 4, a + 5); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 4)); g.setIndex(I); g.computeVertexNormals();
      dirtGeos.push(g);
    };
    const patch = (x: number, z: number, rx: number, rz: number, shade = 1) => {
      const g = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), pos = g.attributes.position, C: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const edge = i === 0 ? 1 : 0, wob = 1 + Math.sin(i * 1.7) * 0.06;
        pos.setXYZ(i, x + pos.getX(i) * rx * wob, 0.014, z + pos.getZ(i) * rz * wob);
        C.push(shade, shade, shade, edge);
      }
      // an inner ring keeps the middle fully opaque
      const inner = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), ip = inner.attributes.position, IC: number[] = [];
      for (let i = 0; i < ip.count; i++) { ip.setXYZ(i, x + ip.getX(i) * rx * 0.72, 0.015, z + ip.getZ(i) * rz * 0.72); IC.push(shade, shade, shade, 1); }
      for (const [geo, cc] of [[g, C], [inner, IC]] as [THREE.BufferGeometry, number[]][]) { geo.setAttribute('color', new THREE.Float32BufferAttribute(cc, 4)); planarUV(geo, tile); dirtGeos.push(geo); }
    };
    ribbon([[0, 17.6], [0, 9], [0.3, 2], [0, -5], [0, -10]], 2.4);
    ribbon([[0, -6.5], [-8, -7.2], [-17.5, -7.4]], 1.7); ribbon([[0, -7.5], [9, -8.5], [15.5, -10.4]], 1.7);
    ribbon([[0, 9], [8, 10.6], [15, 11.6], [21, 11.6]], 1.7); ribbon([[0.3, 2], [-6, 2.3], [-11.4, 1.8]], 1.5);
    ribbon([[0.3, 1.6], [4.9, 1.5]], 1.5); ribbon([[0, 9], [-7, 10], [-14, 10.6], [-19, 11.6]], 1.6); ribbon([[0, 0.5], [7, -1.6], [12.6, 0.5]], 1.4);
    ribbon([[0, 17.6], [0, 30], [6, 60]], 2.6);
    patch(-17.5, 1.5, 6, 4.9); patch(17, -10.5, 3.2, 3.2);
    for (const f of map.features) if (f.kind === 'gardenbed') patch(f.x, f.z, 6.2, 5.4, 0.55);
    const dirtMesh = this.add(dirtGeos, dirt, false); if (dirtMesh) dirtMesh.renderOrder = 1;

    // ---- pond
    this.water = new THREE.MeshPhysicalMaterial({ color: 0x143a44, roughness: 0.06, metalness: 0, normalMap: waterNormals(), normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.93, envMapIntensity: 1.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.water.normalMap!.repeat.set(5, 4);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2).scale(4.3, 1, 3.3), this.water);
    pond.position.set(-17.5, 0.03, 1.5); pond.receiveShadow = true; pond.renderOrder = 2;
    D.add(pond);

    // ---- rolling hills beyond the fence
    const hills: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + R() * 0.3, d = 95 + R() * 150, r = 40 + R() * 55, h = 7 + R() * 16;
      const g = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(r, h, r * (0.7 + R() * 0.5)).translate(Math.cos(a) * d, -0.6, Math.sin(a) * d);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k) / 9, pos.getZ(k) / 9);
      hills.push(tint(g, 0xcfe0c0));
    }
    this.add(hills, assets.surface('grass'), false);

    // ---- trees: a bark trunk and a canopy of leaf cards lit as one rounded volume
    const leafTex = leafTexture();
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, roughness: 0.78, vertexColors: true }); // both windings are in the geometry
    const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.45, side: THREE.FrontSide });
    this.windify(leafMat, 0.016, 2.2);
    const canopy = (seed: number, cards: number): THREE.BufferGeometry => {
      const Q = rng(seed), P: number[] = [], N: number[] = [], U: number[] = [], C: number[] = [], I: number[] = [];
      const blobs = Array.from({ length: 7 }, (_, i) => ({ x: i ? (Q() - 0.5) * 3.8 : 0, y: i ? 3.3 + Q() * 2.1 : 5.1, z: i ? (Q() - 0.5) * 3.8 : 0, r: i ? 0.95 + Q() * 0.75 : 1.5 }));
      const centre = new THREE.Vector3(0, 4.3, 0), v = new THREE.Vector3(), nrm = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
      for (let i = 0; i < cards; i++) {
        const b = blobs[i % blobs.length];
        const th = Q() * Math.PI * 2, ph = Math.acos(1 - 2 * Q()), rr = b.r * (0.55 + Q() * 0.5);
        v.set(b.x + Math.sin(ph) * Math.cos(th) * rr, b.y + Math.cos(ph) * rr * 0.8, b.z + Math.sin(ph) * Math.sin(th) * rr);
        nrm.copy(v).sub(centre).normalize();
        right.set(Q() - 0.5, Q() - 0.5, Q() - 0.5).cross(nrm).normalize(); up.copy(nrm).cross(right);
        const s = 0.7 + Q() * 0.45, u0 = Math.floor(Q() * 2) * 0.5, v0 = Math.floor(Q() * 2) * 0.5, base = P.length / 3;
        const depth = Math.min(1, v.distanceTo(centre) / 2.8), shade = 0.5 + depth * 0.6;
        for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          P.push(v.x + (right.x * a + up.x * c) * s, v.y + (right.y * a + up.y * c) * s, v.z + (right.z * a + up.z * c) * s);
          N.push(nrm.x, nrm.y * 0.8 + 0.35, nrm.z); U.push(u0 + (a + 1) * 0.25, v0 + (c + 1) * 0.25); C.push(shade * 0.92, shade, shade * 0.8);
        }
        I.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
      return g;
    };
    const trunk = (seed: number): THREE.BufferGeometry => {
      const Q = rng(seed), parts: THREE.BufferGeometry[] = [];
      const limb = (from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number) => {
        const len = from.distanceTo(to), g = new THREE.CylinderGeometry(r1, r0, len, 12, 3).translate(0, len / 2, 0);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.2, uv.getY(i) * len * 0.7);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        parts.push(g.applyQuaternion(q).translate(from.x, from.y, from.z));
      };
      const top = new THREE.Vector3((Q() - 0.5) * 0.4, 3.1, (Q() - 0.5) * 0.4);
      limb(new THREE.Vector3(0, -0.1, 0), top, 0.3, 0.19);
      parts.push(new THREE.CylinderGeometry(0.32, 0.5, 0.35, 12).translate(0, 0.1, 0)); // root flare
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + Q(); limb(new THREE.Vector3(top.x, 2.5 + Q() * 0.5, top.z), new THREE.Vector3(Math.cos(a) * 1.5, 4.1 + Q() * 0.9, Math.sin(a) * 1.5), 0.12, 0.05); }
      limb(top, new THREE.Vector3(top.x * 1.5, 4.8, top.z * 1.5), 0.18, 0.06);
      return tint(mergeGeometries(parts, false)!, 0xffffff);
    };
    const near = map.features.filter((f) => f.kind === 'tree');
    const far: Feature[] = [];
    for (let i = 0; i < (assets.lite ? 45 : 130); i++) {
      const a = R() * Math.PI * 2, d = 30 + R() * 85, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.85;
      if (Math.abs(x) < 27 && Math.abs(z) < 20) continue;
      if (Math.abs(x) < 4 && z > 17) continue; // keep the lane out of the gate clear
      far.push({ kind: 'tree', x, z, s: 0.9 + R() * 0.9, yaw: R() * 6.28 });
    }
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Feature[], shadows: boolean, depth?: THREE.Material) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((f, i) => { dummy.position.set(f.x, 0, f.z); dummy.rotation.set(0, f.yaw, 0); dummy.scale.setScalar(f.s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
      m.castShadow = shadows; m.receiveShadow = true;
      if (depth) m.customDepthMaterial = depth;
      m.computeBoundingSphere();
      D.add(m);
    };
    for (let v = 0; v < 2; v++) {
      instanced(trunk(40 + v), assets.surface('bark'), near.filter((_, i) => i % 2 === v), true);
      instanced(canopy(60 + v, 420), leafMat, near.filter((_, i) => i % 2 === v), true, leafDepth);
      instanced(trunk(40 + v), assets.surface('bark'), far.filter((_, i) => i % 2 === v), false);
      instanced(canopy(80 + v, 110), leafMat, far.filter((_, i) => i % 2 === v), false);
    }

    // ---- grass: thousands of blades in clumps, swaying in the wind, kept ankle-high so nothing hides in it
    this.grass = new THREE.Group(); D.add(this.grass);
    {
      const P: number[] = [], N: number[] = [], C: number[] = [], I: number[] = [], Q = rng(9);
      for (let b = 0; b < 7; b++) {
        const a = Q() * 6.28, r = Q() * 0.13, bx = Math.cos(a) * r, bz = Math.sin(a) * r, h = 0.11 + Q() * 0.1, w = 0.012 + Q() * 0.008, lean = (Q() - 0.5) * 0.09, yaw = Q() * 6.28;
        const dx = Math.cos(yaw) * w, dz = Math.sin(yaw) * w, lx = Math.cos(yaw + 1.57) * lean, lz = Math.sin(yaw + 1.57) * lean, base = P.length / 3;
        P.push(bx - dx, 0, bz - dz, bx + dx, 0, bz + dz, bx - dx * 0.6 + lx * 0.4, h * 0.55, bz - dz * 0.6 + lz * 0.4, bx + dx * 0.6 + lx * 0.4, h * 0.55, bz + dz * 0.6 + lz * 0.4, bx + lx, h, bz + lz);
        for (let k = 0; k < 5; k++) N.push(0, 1, 0);
        C.push(0.09, 0.17, 0.045, 0.09, 0.17, 0.045, 0.17, 0.3, 0.075, 0.17, 0.3, 0.075, 0.27, 0.43, 0.11);
        I.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4, base, base + 2, base + 1, base + 1, base + 2, base + 3, base + 2, base + 4, base + 3);
      }
      const clump = new THREE.BufferGeometry();
      clump.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); clump.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      clump.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); clump.setIndex(I);
      const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }); // both windings are in the geometry
      this.windify(grassMat, 0.35, 1);
      const blocked = (x: number, z: number) => {
        if (inPond(x, z, 1.05)) return true;
        if (Math.abs(x) < 1.2 && z > -10 && z < 17.5) return true;
        for (const s of map.statics) if (!s.hidden && s.y0 < 0.1 && x > s.x0 - 0.1 && x < s.x1 + 0.1 && z > s.z0 - 0.1 && z < s.z1 + 0.1) return true;
        return false;
      };
      const cells = new Map<number, number[][]>();
      for (let i = 0; i < (assets.lite ? 0 : 21000); i++) {
        const x = -27 + R() * 54, z = -20 + R() * 40;
        if (blocked(x, z)) continue;
        const key = Math.floor((x + 27) / 9) + 16 * Math.floor((z + 20) / 8);
        let list = cells.get(key); if (!list) cells.set(key, (list = []));
        list.push([x, z, 0.8 + R() * 0.9, R() * 6.28, 0.8 + R() * 0.45]);
      }
      const gc = new THREE.Color();
      for (const list of cells.values()) {
        const m = new THREE.InstancedMesh(clump, grassMat, list.length);
        list.forEach(([x, z, s, yaw, shade], i) => {
          dummy.position.set(x, 0, z); dummy.rotation.set(0, yaw, 0); dummy.scale.set(s, s * (0.8 + shade * 0.3), s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
          m.setColorAt(i, gc.setRGB(shade * 0.95, shade, shade * 0.85));
        });
        m.receiveShadow = true; m.computeBoundingSphere(); m.userData.full = list.length;
        this.grass.add(m);
      }
    }

    // ---- buildings and landmarks placed by the map
    const roofMat = assets.surface('roof'), plank = assets.surface('planks');
    for (const f of map.features) {
      if (f.kind === 'barnroof') {
        // a gable roof: two corrugated slopes over the plank walls, with plank gable ends
        const x0 = -22.6, x1 = -12.4, z0 = -16.1, z1 = -7.4, y = 3.45, ridge = 5.6, zm = (z0 + z1) / 2, tl = surfaceInfo('roof').tile;
        const slope = (za: number, zb: number) => {
          const g = new THREE.BufferGeometry(), len = Math.hypot(zb - za, ridge - y);
          g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, za, x1, y, za, x1, ridge, zb, x0, ridge, zb], 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, (x1 - x0) / tl, 0, (x1 - x0) / tl, len / tl, 0, len / tl], 2));
          g.setIndex(za < zb ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
          return tint(g, 0x9aa3ab);
        };
        const roof = this.add([slope(z0, zm), slope(z1, zm)], roofMat.clone());
        if (roof) (roof.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        const gable = (x: number) => {
          const g = new THREE.BufferGeometry(), pt = surfaceInfo('planks').tile;
          g.setAttribute('position', new THREE.Float32BufferAttribute([x, y, z0 + 0.3, x, y, z1 - 0.3, x, ridge - 0.12, zm], 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute([(z0 + 0.3) / pt, y / pt, (z1 - 0.3) / pt, y / pt, zm / pt, ridge / pt], 2));
          g.setIndex([0, 1, 2]); g.computeVertexNormals();
          return tint(g, 0xb9503c);
        };
        const ends = this.add([gable(-22.15), gable(-12.85)], plank.clone());
        if (ends) (ends.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      } else if (f.kind === 'bandroof') {
        const g = new THREE.ConeGeometry(4.3, 1.5, 8, 1).rotateY(Math.PI / 8).translate(f.x, 3.08 + 0.75, f.z);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 8, uv.getY(i) * 2);
        this.add([tint(g, 0x4ecdc4)], roofMat);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffc64a, roughness: 0.25, metalness: 1 }));
        ball.position.set(f.x, 4.7, f.z); ball.castShadow = true; D.add(ball);
      } else if (f.kind === 'campfire') {
        this.placeModel('firepit', [1.15, 0.3, 1.15], f.x, 0, f.z);
        const flame = canvasTex(64, 128, (g) => {
          const grad = g.createRadialGradient(32, 96, 2, 32, 80, 60);
          grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.25, 'rgba(255,220,120,0.9)'); grad.addColorStop(0.6, 'rgba(255,110,20,0.45)'); grad.addColorStop(1, 'rgba(255,60,0,0)');
          g.fillStyle = grad; g.beginPath(); g.moveTo(32, 2); g.quadraticCurveTo(62, 70, 46, 118); g.quadraticCurveTo(32, 128, 18, 118); g.quadraticCurveTo(2, 70, 32, 2); g.fill();
        });
        this.fireMat.map = flame;
        this.fire = new THREE.Group();
        for (let i = 0; i < 3; i++) { const q = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.95), this.fireMat); q.position.y = 0.5; q.rotation.y = (i / 3) * Math.PI; this.fire.add(q); }
        this.fire.position.set(f.x, 0.16, f.z); D.add(this.fire);
        this.fireLight = new THREE.PointLight(0xff8a3c, 8, 14, 1.7); this.fireLight.position.set(f.x, 0.9, f.z); this.scene.add(this.fireLight);
      } else if (f.kind === 'picnictable') {
        this.placeModel('picnictable', [1.7, 0.78, 2.05], f.x, 0, f.z, Math.PI / 2);
      } else if (f.kind === 'ladder') {
        const l = this.placeModel('ladder', [0.75, 1.62, 0.6], f.x, 0, f.z, f.yaw); l.rotation.z = 0;
      } else if (f.kind === 'lamp') {
        this.placeModel('streetlamp', 3.5, f.x, 0, f.z, f.yaw);
        const head = new THREE.Vector3(Math.cos(f.yaw) * 0.42, 3.22, -Math.sin(f.yaw) * 0.42).add(new THREE.Vector3(f.x, 0, f.z));
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), this.lampMat); bulb.position.copy(head); D.add(bulb);
        const light = new THREE.PointLight(0xffd9a0, 0, 15, 1.6); light.position.copy(head).y -= 0.2; this.lampLights.push(light); this.scene.add(light);
      } else if (f.kind === 'flag') {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 2.2, 10), new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.3, metalness: 1 }));
        pole.position.set(f.x, 2.25 + 1.1, f.z); pole.castShadow = true; D.add(pole);
        this.flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 8, 1).translate(0.45, 0, 0), new THREE.MeshStandardMaterial({ color: 0xd8343f, roughness: 0.8, side: THREE.DoubleSide }));
        this.flag.position.set(f.x, 4.1, f.z); this.flag.castShadow = true; D.add(this.flag);
      } else if (f.kind === 'gatesign') {
        const tex = signTexture('Sunny Meadow', '#f3ead6', '#3a2a1a');
        for (const s of [1, -1]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.82), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })); m.position.set(f.x, 2.55, 16.95 + s * 0.215); if (s < 0) m.rotation.y = Math.PI; D.add(m); }
        const slab = new THREE.Mesh(tint(new THREE.BoxGeometry(4.8, 1.0, 0.4), 0xffffff), assets.surface('walnut')); slab.position.set(f.x, 2.55, 16.95); slab.castShadow = true; D.add(slab);
      } else if (f.kind === 'windmill') {
        const g = new THREE.Group(); g.position.set(f.x, 0, f.z); g.rotation.y = f.yaw;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.6, 10, 20), new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.85 })); body.position.y = 5;
        const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2, 20), new THREE.MeshStandardMaterial({ color: 0x8c3b2e, roughness: 0.7 })); cap.position.y = 11;
        this.blades = new THREE.Group(); this.blades.position.set(0, 9.6, 1.9);
        for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 6.4, 0.08).translate(0, 3.4, 0), new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 })); b.rotation.z = (i / 4) * Math.PI * 2; this.blades.add(b); }
        g.add(body, cap, this.blades); D.add(g);
      }
    }
    // the sun itself, bright enough to bloom
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: new THREE.Color(7, 6.2, 4.6), blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.sunGlow.position.copy(SUN_DIR).multiplyScalar(600); this.sunGlow.scale.setScalar(95);
    D.add(this.sunGlow);
    this.addMotes(0xfffbe0, 0.035, 0.4, 3);
  }

  /** Make a material sway in the wind: displacement grows with height above the instance's base. */
  private windify(mat: THREE.MeshStandardMaterial, amount: number, heightScale: number) {
    const wind = this.wind;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;').replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 wBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 wBase = vec3(0.0);
        #endif
        float wH = max(0.0, position.y) / ${heightScale.toFixed(2)};
        float wS = sin(uWind * 1.6 + wBase.x * 0.31 + wBase.z * 0.23) * 0.6 + sin(uWind * 3.3 + wBase.x * 1.1 + position.y * 0.8) * 0.4;
        transformed.x += wS * ${amount.toFixed(3)} * wH * wH;
        transformed.z += wS * ${(amount * 0.6).toFixed(3)} * wH * wH;`);
    };
  }
}
