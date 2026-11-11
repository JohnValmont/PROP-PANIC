/** Renders the toy store: merged static architecture, instanced toys, painted floor, lights and set dressing. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PROP_INDEX } from '../../shared/props';
import { BOUNDS, ZONES, type Decor, type Feature, type GameMap } from '../../shared/map';
import { PROPS } from '../../shared/props';
import { rng } from '../../shared/rng';
import { bakeAO, box, cone, poly, propGeometry, sph, cyl, tor } from './propgeo';

const dummy = new THREE.Object3D();

/** Lighting and atmosphere per map (index = map id). Colours are linear multipliers. */
const LOOK = [
  { hemiHi: 0.8, hemiLo: 1.45, sun: 1.55, env: 0.2, sunPos: [7, 30, 5], sunCol: 0xfff4e0, sky: 0xffffff, ground: 0xcdb9a0, bg: [0.086, 0.13, 0.24], fog: [0.1, 0.12, 0.3], fogNear: 34, fogFar: 95 },
  { hemiHi: 0.95, hemiLo: 1.5, sun: 2.05, env: 0.14, sunPos: [15, 24, 11], sunCol: 0xfff1d6, sky: 0xcfe6ff, ground: 0x86b66a, bg: [0.62, 0.8, 0.95], fog: [0.66, 0.82, 0.95], fogNear: 48, fogFar: 170 },
];

// overhead train loop (a rounded rectangle above the main aisles)
const TX = 9.7, TZ0 = 9.6, TZ1 = 7.6;
function trainPos(dist: number): [number, number, number] {
  const w = TX * 2, h = TZ0 + TZ1, per = 2 * (w + h);
  let d = ((dist % per) + per) % per;
  if (d < w) return [-TX + d, -TZ0, Math.PI / 2];
  d -= w;
  if (d < h) return [TX, -TZ0 + d, 0];
  d -= h;
  if (d < w) return [TX - d, TZ1, -Math.PI / 2];
  d -= w;
  return [-TX, TZ1 - d, Math.PI];
}

function floorTexture(): THREE.CanvasTexture {
  const W = 2048, H = Math.round((2048 * 35) / 49);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => ((x + 24.5) / 49) * W, Z = (z: number) => ((z + 17.5) / 35) * H, S = W / 49;
  const R = rng(7);
  g.fillStyle = '#f4ead5'; g.fillRect(0, 0, W, H);
  for (const zone of ZONES) {
    g.fillStyle = zone.color;
    g.fillRect(X(zone.x0), Z(zone.z0), (zone.x1 - zone.x0) * S, (zone.z1 - zone.z0) * S);
  }
  // main aisles + checkout: soft checker tiles
  for (let x = -10.5; x < 10.5; x += 1.5) for (let z = -10.5; z < 17; z += 1.5) {
    if ((Math.round(x / 1.5) + Math.round(z / 1.5)) % 2) continue;
    g.fillStyle = z >= 8 ? 'rgba(255,170,90,0.28)' : 'rgba(255,255,255,0.55)';
    g.fillRect(X(x), Z(z), 1.5 * S, 1.5 * S);
  }
  // guide arrows down the central aisle
  g.fillStyle = '#ff8fab';
  for (let z = 6; z > -9; z -= 2.4) { g.beginPath(); g.moveTo(X(0), Z(z - 0.5)); g.lineTo(X(0.45), Z(z + 0.2)); g.lineTo(X(-0.45), Z(z + 0.2)); g.fill(); }
  // welcome mat
  g.fillStyle = '#2ec4b6'; g.fillRect(X(-2.6), Z(15.2), 5.2 * S, 1.6 * S);
  g.fillStyle = '#ffffff'; g.font = `700 ${0.75 * S}px Fredoka, ui-rounded, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.translate(X(0), Z(16)); g.rotate(Math.PI); g.fillText('WELCOME!', 0, 0); g.restore();
  // stock room: concrete speckle + hazard stripes at the doors
  for (let i = 0; i < 900; i++) { g.fillStyle = R() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)'; g.fillRect(X(-10.5 + R() * 21), Z(-17 + R() * 6.5), 3 + R() * 6, 3 + R() * 6); }
  for (const dx of [-7, 7]) for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#22223b' : '#ffd166'; g.fillRect(X(dx - 1 + i * 0.25), Z(-10.75), 0.25 * S, 0.5 * S); }
  // plush corner: polka dots + round rug
  for (let i = 0; i < 160; i++) { g.fillStyle = 'rgba(255,255,255,0.6)'; g.beginPath(); g.arc(X(-24 + R() * 13.5), Z(-17 + R() * 15), 0.14 * S, 0, 7); g.fill(); }
  ['#ff8fab', '#ffe5ec', '#ff8fab', '#ffb3c6'].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(X(-17.5), Z(-9.5), (3.2 - i * 0.7) * S, 0, 7); g.fill(); });
  // arcade: classic loud carpet
  const neon = ['#00f5d4', '#f15bb5', '#fee440', '#9b5de5', '#00bbf9'];
  for (let i = 0; i < 260; i++) {
    const x = X(-24 + R() * 13.5), z = Z(-2 + R() * 19), s = (0.15 + R() * 0.3) * S;
    g.strokeStyle = g.fillStyle = neon[Math.floor(R() * neon.length)]; g.lineWidth = 0.06 * S;
    const k = R();
    g.save(); g.translate(x, z); g.rotate(R() * 6.28);
    if (k < 0.33) { g.beginPath(); g.moveTo(0, -s); g.lineTo(s, s); g.lineTo(-s, s); g.closePath(); g.stroke(); }
    else if (k < 0.66) { g.beginPath(); g.moveTo(-s, 0); g.quadraticCurveTo(-s / 2, -s, 0, 0); g.quadraticCurveTo(s / 2, s, s, 0); g.stroke(); }
    else g.fillRect(-s / 4, -s / 4, s / 2, s / 2);
    g.restore();
  }
  // block castle: hopscotch
  g.lineWidth = 0.08 * S; g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'; g.font = `700 ${0.6 * S}px Fredoka, ui-rounded, system-ui, sans-serif`;
  for (let i = 0; i < 7; i++) { const x = 11.6 + i * 0.95; g.strokeRect(X(x), Z(-4.4), 0.95 * S, 0.95 * S); g.fillText(String(i + 1), X(x + 0.47), Z(-3.9)); }
  for (let i = 0; i < 60; i++) { g.fillStyle = ['#06d6a0', '#ffd166', '#ef476f', '#118ab2'][i % 4] + '55'; g.fillRect(X(10.8 + R() * 12.8), Z(-16.8 + R() * 15.4), 0.5 * S, 0.5 * S); }
  // ball pit
  g.fillStyle = '#0096c7'; g.fillRect(X(14.3), Z(4.3), 7.9 * S, 8.4 * S);
  for (let i = 0; i < 300; i++) { g.fillStyle = ['#ef476f', '#ffd166', '#06d6a0', '#f8f9fa', '#9b5de5'][i % 5]; g.beginPath(); g.arc(X(14.4 + R() * 7.7), Z(4.4 + R() * 8.2), (0.1 + R() * 0.12) * S, 0, 7); g.fill(); }
  for (let i = 0; i < 12; i++) { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 0.05 * S; g.beginPath(); g.arc(X(11 + R() * 12.5), Z(-0.5 + R() * 4), (0.3 + R() * 0.5) * S, 0, 7); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Painted ground for Sunny Meadow: mottled grass, mown stripes, dirt paths, pond bank, pumpkin-patch soil. */
function meadowTexture(): THREE.CanvasTexture {
  const W = 2048, H = Math.round((2048 * 35) / 49), c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!, R = rng(31);
  const X = (x: number) => ((x + 24.5) / 49) * W, Z = (z: number) => ((z + 17.5) / 35) * H, S = W / 49;
  g.fillStyle = '#7cc36a'; g.fillRect(0, 0, W, H);
  // mown stripes, fading out before the edge so the play area melts into the lawn beyond
  for (let i = 0; i < 16; i++) if (i % 2) { g.fillStyle = 'rgba(255,255,255,0.045)'; g.fillRect(X(-22.5 + i * 2.8), Z(-15.5), 2.8 * S, 31 * S); }
  for (let i = 0; i < 1500; i++) {
    const x = X(-23.5 + R() * 47), z = Z(-16.5 + R() * 33), r = (0.25 + R() * 0.9) * S;
    g.fillStyle = R() < 0.5 ? 'rgba(40,110,50,0.07)' : 'rgba(190,240,150,0.07)';
    g.beginPath(); g.ellipse(x, z, r, r * (0.5 + R() * 0.5), R() * 3.14, 0, 7); g.fill();
  }
  // dirt paths
  const path = (pts: number[][], w: number) => {
    for (const [col, k] of [['#b89a63', 1.18], ['#dcc48e', 1], ['rgba(255,255,255,0.12)', 0.45]] as [string, number][]) {
      g.strokeStyle = col; g.lineWidth = w * k * S; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(X(pts[0][0]), Z(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Z(pts[i][1]));
      g.stroke();
    }
  };
  path([[0, 17.4], [0, 9], [0.3, 2], [0, -5], [0, -10]], 2.1);
  path([[0, -6.5], [-8, -7.2], [-17.5, -7.4]], 1.5); path([[0, -7.5], [9, -8.5], [15.5, -10.4]], 1.5);
  path([[0, 9], [8, 10.6], [15, 11.6], [21, 11.6]], 1.5); path([[0.3, 2], [-6, 2.3], [-11.4, 1.8]], 1.3);
  path([[0.3, 1.6], [4.9, 1.5]], 1.3); path([[0, 9], [-7, 10], [-14, 10.6], [-19, 11.6]], 1.4); path([[0, 0.5], [7, -1.6], [12.6, 0.5]], 1.2);
  // pond bank, campfire clearing, pumpkin-patch soil
  g.fillStyle = '#e3d3a0'; g.beginPath(); g.ellipse(X(-17.5), Z(1.5), 5 * S, 3.95 * S, 0, 0, 7); g.fill();
  g.fillStyle = '#2f8fbf'; g.beginPath(); g.ellipse(X(-17.5), Z(1.5), 4.3 * S, 3.3 * S, 0, 0, 7); g.fill();
  g.fillStyle = '#c9b182'; g.beginPath(); g.arc(X(17), Z(-10.5), 2.6 * S, 0, 7); g.fill();
  g.fillStyle = '#8a6748'; g.fillRect(X(12.95), Z(-3.76), 9.7 * S, 8.5 * S);
  for (let z = -3.4; z < 4.6; z += 0.8) { g.fillStyle = 'rgba(60,40,25,0.35)'; g.fillRect(X(13.1), Z(z), 9.4 * S, 0.3 * S); }
  g.fillStyle = '#c4a877'; g.fillRect(X(-21.7), Z(-15.2), 8.4 * S, 6.9 * S); // barn floor
  for (let i = 0; i < 700; i++) { g.fillStyle = ['#ffffff', '#ffe08a', '#ffb3c6'][i % 3]; g.globalAlpha = 0.55; g.beginPath(); g.arc(X(-23.5 + R() * 47), Z(-16.5 + R() * 33), (0.04 + R() * 0.04) * S, 0, 7); g.fill(); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Toy-shop wallpaper: candy-stripe wainscot below, a scatter of pastel shapes above. Tiles horizontally. */
function wallTexture(): THREE.CanvasTexture {
  const W = 1024, H = 576, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!, R = rng(23);
  g.fillStyle = '#fff3dc'; g.fillRect(0, 0, W, H);
  const cols = ['#ffd1dc', '#c8f0d0', '#bfe6ff', '#ffe3a3', '#e2d3ff'];
  for (let i = 0; i < 90; i++) {
    const x = R() * W, y = 30 + R() * (H * 0.66), r = 9 + R() * 16;
    g.fillStyle = cols[i % cols.length]; g.globalAlpha = 0.9;
    for (const ox of [0, -W, W]) {
      g.save(); g.translate(x + ox, y); g.rotate(R() * 6.28);
      const k = i % 4;
      if (k === 0) { g.beginPath(); g.arc(0, 0, r * 0.7, 0, 7); g.fill(); }
      else if (k === 1) { g.beginPath(); for (let j = 0; j < 10; j++) { const a = (j * Math.PI) / 5, rr = j % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.fill(); }
      else if (k === 2) { g.beginPath(); g.moveTo(0, -r); g.lineTo(r, r * 0.8); g.lineTo(-r, r * 0.8); g.fill(); }
      else g.fillRect(-r * 0.6, -r * 0.6, r * 1.2, r * 1.2);
      g.restore();
    }
  }
  g.globalAlpha = 1;
  // picture rail, wainscot stripes, skirting
  const top = H * 0.72;
  g.fillStyle = '#2ec4b6'; g.fillRect(0, top - 26, W, 14);
  for (let x = 0; x < W; x += 64) { g.fillStyle = (x / 64) % 2 ? '#ff8fa3' : '#ffb3c1'; g.fillRect(x, top - 12, 64, H - top + 12); }
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(0, top - 12, W, 10);
  g.fillStyle = '#7a3b52'; g.fillRect(0, H - 22, W, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function ceilingTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1b2350'; g.fillRect(0, 0, 1024, 1024);
  const R = rng(11);
  for (let i = 0; i < 150; i++) {
    const x = 20 + R() * 984, y = 20 + R() * 984, r = 1.5 + R() * 2.5;
    g.fillStyle = ['#fff', '#ffd166', '#bde0fe'][i % 3];
    g.globalAlpha = 0.4 + R() * 0.6;
    if (i % 9 === 0) { g.beginPath(); for (let k = 0; k < 10; k++) { const a = (k * Math.PI) / 5, rr = k % 2 ? r * 2 : r * 5; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); }
    else { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 3); // tiled so the stars stay crisp from the shop floor
  t.anisotropy = 4;
  return t;
}

function signMesh(text: string, bg: string): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.beginPath(); g.roundRect(4, 4, 504, 120, 28); g.fill();
  g.lineWidth = 8; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#ffffff'; g.font = '700 64px Fredoka, ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  // two single-sided faces back to back, so the text reads correctly from either side
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true });
  const sign = new THREE.Group();
  const front = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), mat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), mat);
  back.rotation.y = Math.PI;
  sign.add(front, back);
  return sign;
}

interface DecorRef { mesh: THREE.InstancedMesh; index: number; d: Decor; }

export class WorldView {
  root = new THREE.Group();
  /** High quality: glossy toy plastic lit by an environment map. Low: plain diffuse, far cheaper. */
  private matHi = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.46, metalness: 0.02 });
  private matLo = new THREE.MeshLambertMaterial({ vertexColors: true });
  material: THREE.Material = this.matHi;
  private floorHi!: THREE.MeshStandardMaterial; private floorLo!: THREE.MeshLambertMaterial; private floor!: THREE.Mesh;
  private hi = true;
  private train: THREE.Mesh[] = [];
  /** Set dressing is built once per map and then just shown or hidden. */
  private dressed = new Map<number, THREE.Group>();
  private dress = new THREE.Group();
  private mapId = 0;
  private floors: [THREE.Mesh, THREE.Material, THREE.Material][] = [];
  private skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  private cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  private lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  private fireMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private clouds: THREE.Object3D[] = [];
  private blades: THREE.Object3D | null = null;
  private fire: THREE.Object3D | null = null;
  private sunDisc: THREE.Object3D | null = null;
  private motes: THREE.Points[] = [];
  hemi = new THREE.HemisphereLight(0xffffff, 0xcdb9a0, 1.25);
  sun = new THREE.DirectionalLight(0xfff4e0, 1.55);
  /** 0 = lights on, 1 = full blackout (smoothed). */
  dark = 0;
  darkTarget = 0;
  darkFloor = 0.08;
  private decorGroup = new THREE.Group();
  private refs: DecorRef[] = [];
  private anims = new Map<number, number>();
  private polter = new Map<number, number>();
  private polterUntil = 0;
  private builtStatics = false;
  private panelMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  private bgColor = new THREE.Color(0x16213e);
  private neon: THREE.PointLight[] = [];
  private spinners: THREE.Object3D[] = [];
  private time = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.root);
    scene.background = this.bgColor;
    scene.add(this.hemi);
    this.sun.position.set(7, 30, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    for (const [x, z, col] of [[-19, 6, 0xff4fd8], [-14, 13, 0x00e5ff]] as [number, number, number][]) {
      const l = new THREE.PointLight(col, 26, 13, 1.6);
      l.position.set(x, 2.6, z);
      this.neon.push(l); scene.add(l);
    }
    this.root.add(this.decorGroup);
  }

  /** Build the reflection environment once (needs the renderer). */
  initEnv(renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.fog = new THREE.Fog(0x2a2f6a, 34, 95);
  }

  setQuality(hi: boolean) {
    this.hi = hi;
    this.sun.castShadow = hi;
    const from = hi ? this.matLo : this.matHi;
    this.material = hi ? this.matHi : this.matLo;
    this.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material === from) m.material = this.material; });
    for (const [mesh, a, b] of this.floors) mesh.material = hi ? a : b;
  }

  load(map: GameMap) {
    // show this map's set dressing, building it the first time it is needed
    this.mapId = map.id;
    for (const [id, g] of this.dressed) g.visible = id === map.id;
    if (!this.dressed.has(map.id)) {
      this.dress = new THREE.Group();
      this.dressed.set(map.id, this.dress);
      this.root.add(this.dress);
      this.buildStatics(map);
    }
    const L = LOOK[map.id] ?? LOOK[0];
    this.sun.position.set(L.sunPos[0], L.sunPos[1], L.sunPos[2]);
    this.sun.color.set(L.sunCol);
    this.hemi.color.set(L.sky); this.hemi.groundColor.set(L.ground);
    if (this.scene.fog) { (this.scene.fog as THREE.Fog).near = L.fogNear; (this.scene.fog as THREE.Fog).far = L.fogFar; }
    for (const r of new Set(this.refs.map((x) => x.mesh))) { this.decorGroup.remove(r); r.dispose(); }
    this.refs = []; this.anims.clear(); this.polter.clear();
    const byType = new Map<number, Decor[]>();
    for (const d of map.decor) { let a = byType.get(d.type); if (!a) byType.set(d.type, (a = [])); a.push(d); }
    for (const [type, list] of byType) {
      const mesh = new THREE.InstancedMesh(propGeometry(type), this.material, list.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      list.forEach((d, i) => { this.refs[d.id] = { mesh, index: i, d }; this.writeMatrix(d.id, 0, 0, 0); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.decorGroup.add(mesh);
    }
  }

  private writeMatrix(id: number, hop: number, tilt: number, squash: number) {
    const r = this.refs[id];
    if (!r) return;
    dummy.position.set(r.d.x, r.d.y + hop, r.d.z);
    dummy.rotation.set(tilt, r.d.yaw, tilt * 0.7, 'YXZ');
    dummy.scale.set(1 + squash, 1 - squash, 1 + squash);
    dummy.updateMatrix();
    r.mesh.setMatrixAt(r.index, dummy.matrix);
    r.mesh.instanceMatrix.needsUpdate = true;
  }

  /** An innocent toy got shot (or bumped): make it flinch. */
  wobble(id: number) { if (this.refs[id]) this.anims.set(id, 0); }

  poltergeist(seed: number, ms: number) {
    const R = rng(seed);
    this.polter.clear();
    for (const r of this.refs) if (r && R() < 0.3) this.polter.set(r.d.id, R() * 6.28);
    this.polterUntil = this.time + ms / 1000;
  }
  stopPoltergeist() { for (const id of this.polter.keys()) this.writeMatrix(id, 0, 0, 0); this.polter.clear(); }

  update(dt: number) {
    this.time += dt;
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
    // lights
    this.dark += (this.darkTarget - this.dark) * Math.min(1, dt * 5);
    const lit = 1 - this.dark * (1 - this.darkFloor);
    const L = LOOK[this.mapId] ?? LOOK[0];
    this.hemi.intensity = (this.hi ? L.hemiHi : L.hemiLo) * lit;
    this.sun.intensity = L.sun * (1 - this.dark * 0.985);
    this.scene.environmentIntensity = L.env * lit;
    // light panels are brighter than white so they bloom; they die in a blackout
    const p = 2.3 * (1 - this.dark * 0.97);
    this.panelMat.color.setRGB(p, p * 0.95, p * 0.8);
    this.bgColor.setRGB(L.bg[0] * lit, L.bg[1] * lit, L.bg[2] * lit);
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.setRGB(L.fog[0] * lit, L.fog[1] * lit, L.fog[2] * lit);
    // outdoor sky, clouds, lamps, campfire and windmill
    const day = 1 - this.dark * 0.92;
    this.skyMat.color.setRGB(day, day, Math.min(1, day + this.dark * 0.1));
    this.cloudMat.color.setScalar(0.97 * day);
    if (this.sunDisc) this.sunDisc.visible = this.dark < 0.4;
    this.lampMat.color.setRGB(0.95 + this.dark * 3.4, 0.9 + this.dark * 2.5, 0.72 + this.dark * 1.1);
    for (let i = 0; i < this.clouds.length; i++) { const c = this.clouds[i]; c.position.x += dt * (0.5 + (i % 3) * 0.25); if (c.position.x > 120) c.position.x = -120; }
    if (this.blades) this.blades.rotation.z += dt * 0.7;
    if (this.fire) { const f = 1 + Math.sin(this.time * 17) * 0.12 + Math.sin(this.time * 29) * 0.08; this.fire.scale.set(f, 0.85 + f * 0.25, f); this.fireMat.color.setScalar(1.8 + this.dark * 1.4 + (f - 1) * 2); }
    for (const m of this.motes) { m.rotation.y = this.time * 0.012; m.position.y = Math.sin(this.time * 0.25) * 0.25; }
    // the overhead toy train does laps of the main aisles
    for (let i = 0; i < this.train.length; i++) {
      const [x, z, yaw] = trainPos(this.time * 2.6 - i * 1.25);
      this.train[i].position.set(x, 3.02 + Math.sin(this.time * 9 + i) * 0.012, z);
      this.train[i].rotation.y = yaw;
    }
    const indoor = this.mapId === 0 ? 1 : 0;
    this.neon[0].intensity = (22 + Math.sin(this.time * 3) * 5) * indoor;
    this.neon[1].intensity = (22 + Math.cos(this.time * 2.3) * 5) * indoor;
    for (const s of this.spinners) s.rotation.y += dt * 0.25;
  }

  private buildStatics(map: GameMap) {
    if (map.id === 1) { this.buildMeadow(map); return; }
    const parts: THREE.BufferGeometry[] = [];
    for (const b of [...map.statics, ...map.visuals]) {
      if (b.hidden) continue;
      const g = box(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, b.c, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      // ground everything that stands on the floor with a soft dark gradient
      if (b.y0 < 0.05 && b.y1 - b.y0 > 0.3) bakeAO(g, Math.min(2.4, b.y1 - b.y0), 0.3);
      parts.push(g);
    }
    // partitions get a cap rail and skirting so they read as built walls, not coloured slabs
    for (const b of map.statics) {
      if (b.y1 !== 3 || Math.min(b.x1 - b.x0, b.z1 - b.z0) > 0.35) continue;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, w = b.x1 - b.x0, d = b.z1 - b.z0;
      parts.push(box(w + 0.12, 0.1, d + 0.12, 0xffffff, cx, 3.05, cz), box(w + 0.07, 0.22, d + 0.07, 0x5c4a72, cx, 0.11, cz), box(w + 0.04, 0.06, d + 0.04, 0xffffff, cx, 1.15, cz));
    }
    // elevated train track around the main aisles, hung from the ceiling
    const RAIL = 0x5c677d, TIE = 0xc9a66b;
    for (const [x0, z0, x1, z1] of [[-TX, -TZ0, TX, -TZ0], [-TX, TZ1, TX, TZ1], [-TX, -TZ0, -TX, TZ1], [TX, -TZ0, TX, TZ1]]) {
      const alongX = z0 === z1, len = alongX ? x1 - x0 : z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      parts.push(box(alongX ? len + 0.7 : 0.7, 0.07, alongX ? 0.7 : len + 0.7, TIE, cx, 2.95, cz));
      for (const o of [-0.22, 0.22]) parts.push(box(alongX ? len + 0.6 : 0.06, 0.05, alongX ? 0.06 : len + 0.6, RAIL, cx + (alongX ? 0 : o), 3.0, cz + (alongX ? o : 0)));
      for (let k = 0.5; k < len; k += 4) parts.push(cyl(0.025, 0.025, 1.5, 0xffffff, alongX ? x0 + k : cx, 3.72, alongX ? cz : z0 + k, 0, 0, 5));
    }
    const statics = new THREE.Mesh(mergeGeometries(parts, false)!, this.material);
    statics.castShadow = true; statics.receiveShadow = true;
    this.dress.add(statics);

    const ftex = floorTexture();
    this.floorHi = new THREE.MeshStandardMaterial({ map: ftex, roughness: 0.34, metalness: 0.0 });
    this.floorLo = new THREE.MeshLambertMaterial({ map: ftex });
    const floor = this.floor = new THREE.Mesh(new THREE.PlaneGeometry(49, 35), this.hi ? this.floorHi : this.floorLo);
    this.floors.push([floor, this.floorHi, this.floorLo]);
    this.addMotes(0xfff1c9, 0.045, 0.35, 4.2);
    for (let i = 0; i < 4; i++) {
      const car = new THREE.Mesh(propGeometry(PROP_INDEX[i === 0 ? 'train' : i === 3 ? 'gift' : 'crate']), this.material);
      if (i > 0) car.scale.set(0.5, 0.5, 0.9);
      car.castShadow = true;
      this.train.push(car); this.dress.add(car);
    }
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.dress.add(floor);
    // wallpaper on the four outer walls
    const wtex = wallTexture();
    for (const [x, z, ry, len] of [[0, -16.985, 0, 48], [0, 16.985, Math.PI, 48], [-23.985, 0, Math.PI / 2, 34], [23.985, 0, -Math.PI / 2, 34]] as number[][]) {
      const t = wtex.clone(); t.needsUpdate = true; t.repeat.set(len / 8, 1);
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, BOUNDS.wallH), new THREE.MeshLambertMaterial({ map: t }));
      wall.position.set(x, BOUNDS.wallH / 2, z); wall.rotation.y = ry; wall.receiveShadow = true;
      this.dress.add(wall);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(49, 35), new THREE.MeshBasicMaterial({ map: ceilingTexture() }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = BOUNDS.wallH;
    this.dress.add(ceil);

    // ceiling light panels
    const panels: THREE.BufferGeometry[] = [];
    for (let x = -20; x <= 20; x += 8) for (let z = -13.5; z <= 13.5; z += 6.75) {
      const g = new THREE.BoxGeometry(2.6, 0.06, 0.7); g.translate(x, BOUNDS.wallH - 0.04, z); panels.push(g);
    }
    this.dress.add(new THREE.Mesh(mergeGeometries(panels, false)!, this.panelMat));

    // pennant bunting
    const flags: THREE.BufferGeometry[] = [];
    const cols = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf78c2b];
    const string = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(len / 0.55);
      const yaw = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
      for (let i = 0; i <= n; i++) {
        const k = i / n, sag = Math.sin(k * Math.PI) * 0.45;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.2, 0, 0, 0.2, 0, 0, 0, -0.42, 0]), 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
        const c = new THREE.Color(cols[i % cols.length]);
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array([c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b]), 3));
        g.rotateY(yaw); g.translate(x0 + (x1 - x0) * k, y - sag, z0 + (z1 - z0) * k);
        flags.push(g);
      }
    };
    string(-10, -9, 10, -9, 4.1); string(-10, -1.3, 10, -1.3, 4.1); string(-10, 6, 10, 6, 4.1); string(-10, 13, 10, 13, 4.1);
    string(-23.5, -9, -11, -9, 4.0); string(11, -9, 23.5, -5, 4.0); string(11, 8, 23.5, 8, 4.0); string(-23.5, 8, -11, 5, 4.0);
    const bunting = new THREE.Mesh(mergeGeometries(flags, false)!, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.dress.add(bunting);

    // hanging planets & a paper moon, purely for charm
    const planet = (x: number, y: number, z: number, r: number, c: number, ring?: number) => {
      const g = [sph(r, c, 0, 0, 0), cyl(0.01, 0.01, BOUNDS.wallH - y, 0xffffff, 0, (BOUNDS.wallH - y) / 2, 0, 0, 0, 5)];
      if (ring) g.push(tor(r * 1.5, r * 0.09, ring, 0, 0, 0, Math.PI / 2 + 0.3));
      const m = new THREE.Mesh(mergeGeometries(g, false)!, this.material);
      m.position.set(x, y, z);
      this.spinners.push(m); this.dress.add(m);
    };
    planet(4.2, 3.8, 12.2, 0.5, 0xffd166, 0xf78c2b); planet(-6, 3.8, -5, 0.35, 0xef476f); planet(6.5, 3.75, 0, 0.42, 0x48cae4, 0xffffff);
    planet(17.5, 3.8, -6, 0.5, 0x9b5de5, 0xffd166); planet(-17.5, 3.8, -10, 0.45, 0xff9ecd); planet(18, 3.9, 8.5, 0.38, 0x06d6a0);

    // hanging zone signs
    const sign = (text: string, bg: string, x: number, z: number, ry: number) => { const s = signMesh(text, bg); s.position.set(x, 3.45, z); s.rotation.y = ry; this.dress.add(s); };
    sign('CHECKOUT', '#6c5ce7', 0, 8.6, 0); sign('STOCK ROOM', '#5c677d', -7, -10.2, 0); sign('STOCK ROOM', '#5c677d', 7, -10.2, 0);
    sign('PLUSH CORNER', '#ff6fa8', -10.9, -6.5, Math.PI / 2); sign('ARCADE', '#7b2ff7', -10.9, 3.5, Math.PI / 2); sign('ARCADE', '#7b2ff7', -10.9, 12.5, Math.PI / 2);
    sign('BLOCK CASTLE', '#06a77d', 10.9, -7.5, Math.PI / 2); sign('BALL PIT', '#0096c7', 10.9, 2.5, Math.PI / 2); sign('BALL PIT', '#0096c7', 10.9, 11.5, Math.PI / 2);
    const title = signMesh("TUMBLETON'S", '#ef476f'); title.scale.set(1.6, 1.6, 1); title.position.set(0, 3.75, 16.9); title.rotation.y = Math.PI; this.dress.add(title);
  }

  private addMotes(color: number, size: number, opacity: number, top: number) {
    const R = rng(5), n = 260, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { pos[i * 3] = -24 + R() * 48; pos[i * 3 + 1] = 0.4 + R() * (top - 0.4); pos[i * 3 + 2] = -17 + R() * 34; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    // a soft round dot instead of the default square point
    const dot = document.createElement('canvas'); dot.width = dot.height = 32;
    const dg = dot.getContext('2d')!, grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    dg.fillStyle = grad; dg.fillRect(0, 0, 32, 32);
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: size * 1.6, map: new THREE.CanvasTexture(dot), transparent: true, opacity, depthWrite: false, sizeAttenuation: true }));
    this.motes.push(pts); this.dress.add(pts);
  }

  /** Sunny Meadow: sky, rolling hills, trees, painted ground, grass, pond, barn roof, campfire, lamps, windmill. */
  private buildMeadow(map: GameMap) {
    const D = this.dress, R = rng(77);
    const place = (gs: THREE.BufferGeometry[], x: number, y: number, z: number, ry = 0, sc = 1) => { for (const g of gs) { g.scale(sc, sc, sc); g.rotateY(ry); g.translate(x, y, z); } return gs; };
    const parts: THREE.BufferGeometry[] = [], backdrop: THREE.BufferGeometry[] = [], bulbs: THREE.BufferGeometry[] = [];
    for (const b of [...map.statics, ...map.visuals]) {
      if (b.hidden) continue;
      const g = box(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, b.c, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
      if (b.y0 < 0.05 && b.y1 - b.y0 > 0.3) bakeAO(g, Math.min(2.4, b.y1 - b.y0), 0.3);
      parts.push(g);
    }
    const tree = (style: number, distant = false): THREE.BufferGeometry[] => {
      // trees beyond the fence are only ever seen from far away, so they get a fraction of the polygons
      if (distant) {
        const lo = (r: number, c: number, x: number, y: number, z: number) => { const q = new THREE.SphereGeometry(r, 7, 5).toNonIndexed(); q.translate(x, y, z); const col = new THREE.Color(c), n = q.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } q.setAttribute('color', new THREE.BufferAttribute(a, 3)); return q; };
        const d = style % 3 === 2
          ? [cyl(0.2, 0.25, 1.7, 0x7a5236, 0, 0.85, 0, 0, 0, 5), cone(1.5, 2.6, 0x2d6a4f, 0, 2.7, 0, 0, 0, 6), cone(1.0, 2.0, 0x40916c, 0, 4.1, 0, 0, 0, 6)]
          : [cyl(0.22, 0.32, 2.7, 0x8a5a3c, 0, 1.35, 0, 0, 0, 5), lo(1.4, style % 3 ? 0x3a9d5d : 0x4caf6a, 0, 3.5, 0), lo(1.0, 0x52b788, 0.8, 3.1, 0.3), lo(0.9, 0x2d8a4e, -0.7, 3.2, -0.4)];
        for (const x of d) bakeAO(x, 6.5, 0.4);
        return d;
      }
      const g = style % 3 === 2
        ? [cyl(0.16, 0.25, 1.7, 0x7a5236, 0, 0.85, 0, 0, 0, 7), cone(1.5, 1.9, 0x2d6a4f, 0, 2.4, 0, 0, 0, 8), cone(1.2, 1.7, 0x40916c, 0, 3.4, 0, 0, 0, 8), cone(0.85, 1.5, 0x52b788, 0, 4.35, 0, 0, 0, 8)]
        : [cyl(0.2, 0.32, 2.7, 0x8a5a3c, 0, 1.35, 0, 0, 0, 8), cyl(0.08, 0.12, 1.1, 0x8a5a3c, 0.45, 2.5, 0, 0, -0.8, 6), sph(1.3, style % 3 ? 0x3a9d5d : 0x4caf6a, 0, 3.5, 0), sph(0.95, 0x52b788, 0.85, 3.05, 0.3), sph(0.9, 0x2d8a4e, -0.75, 3.15, -0.4), sph(0.8, 0x74c69d, 0.1, 4.3, -0.2), sph(0.7, 0x3a9d5d, -0.2, 3.2, 0.8)];
      for (const x of g) bakeAO(x, 6.5, 0.4);
      return g;
    };
    for (const f of map.features as Feature[]) {
      if (f.kind === 'tree') parts.push(...place(tree(Math.floor(f.yaw * 10)), f.x, 0, f.z, f.yaw, f.s));
      else if (f.kind === 'lamp') {
        parts.push(...place([cyl(0.06, 0.09, 3, 0x3d405b, 0, 1.5, 0, 0, 0, 7), cyl(0.14, 0.14, 0.06, 0x3d405b, 0, 0.03, 0, 0, 0, 8), box(0.34, 0.06, 0.34, 0x3d405b, 0, 3.36, 0), cone(0.2, 0.18, 0x3d405b, 0, 3.48, 0, 0, 0, 4)], f.x, 0, f.z));
        bulbs.push(...place([new THREE.SphereGeometry(0.16, 10, 8)], f.x, 3.18, f.z));
      } else if (f.kind === 'barnroof') {
        const g = [box(5.35, 0.16, 8.6, 0x5b3a29, -2.4, 4.42, 0, 0, 0, 0.395), box(5.35, 0.16, 8.6, 0x5b3a29, 2.4, 4.42, 0, 0, 0, -0.395), box(0.3, 0.2, 8.7, 0xfff8ec, 0, 5.42, 0)];
        for (let i = 0; i < 5; i++) for (const z of [-3.72, 3.72]) g.push(box(9 * (1 - (i + 0.5) / 5), 0.4, 0.3, 0xc8553d, 0, 3.65 + i * 0.4, z));
        g.push(cyl(0.5, 0.5, 0.06, 0xfff8ec, 0, 4.35, 3.89, Math.PI / 2, 0, 14), cyl(0.36, 0.36, 0.08, 0x3d405b, 0, 4.35, 3.9, Math.PI / 2, 0, 14));
        parts.push(...place(g, f.x, 0, f.z));
      } else if (f.kind === 'bandroof') parts.push(...place([cone(4.3, 1.5, 0x2ec4b6, 0, 3.83, 0, 0, 0, 8), sph(0.2, 0xffd166, 0, 4.66, 0), cyl(4.32, 4.32, 0.1, 0xfff8ec, 0, 3.1, 0, 0, 0, 8)], f.x, 0, f.z, Math.PI / 8));
      else if (f.kind === 'campfire') {
        const g: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 9; i++) g.push(poly(0.16, i % 2 ? 0x9aa5b1 : 0x7d8894, Math.cos(i * 0.7) * 0.5, 0.1, Math.sin(i * 0.7) * 0.5, 1, 0.8, 1, i));
        g.push(cyl(0.07, 0.07, 0.7, 0x5c3d2e, 0, 0.14, 0, Math.PI / 2, 0, 6), cyl(0.07, 0.07, 0.7, 0x5c3d2e, 0, 0.2, 0, Math.PI / 2 - 0.3, Math.PI / 2, 6), cyl(0.45, 0.45, 0.04, 0x4a4036, 0, 0.02, 0, 0, 0, 10));
        parts.push(...place(g, f.x, 0, f.z));
        const flame = new THREE.Mesh(mergeGeometries([cone(0.3, 0.55, 0xff7b00, 0, 0.3, 0, 0, 0, 7), cone(0.18, 0.7, 0xffc300, 0.03, 0.4, 0.02, 0, 0, 6), cone(0.1, 0.5, 0xfff3b0, -0.02, 0.36, -0.02, 0, 0, 5)], false)!, this.fireMat);
        flame.position.set(f.x, 0.1, f.z);
        this.fire = flame; D.add(flame);
      } else if (f.kind === 'pond') {
        const water = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshStandardMaterial({ color: 0x3aa7d6, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.86 }));
        water.rotation.x = -Math.PI / 2; water.scale.set(4.3, 3.3, 1); water.position.set(f.x, 0.035, f.z); water.receiveShadow = true;
        D.add(water);
        for (let i = 0; i < 7; i++) { const a = R() * 6.28, r = 0.3 + R() * 0.55; parts.push(...place([cyl(0.28, 0.28, 0.02, 0x52b788, 0, 0.05, 0, 0, 0, 9), ...(i % 3 === 0 ? [sph(0.07, 0xff8fab, 0.05, 0.1, 0)] : [])], f.x + Math.cos(a) * 4.3 * r, 0, f.z + Math.sin(a) * 3.3 * r, a)); }
        for (let i = 0; i < 16; i++) { const a = R() * 6.28; parts.push(...place([cone(0.035, 0.9 + R() * 0.5, 0x4f9d69, 0, 0.5, 0, 0, 0, 4), cyl(0.04, 0.04, 0.2, 0x7a5236, 0, 0.95, 0, 0, 0, 5)], f.x + Math.cos(a) * 4.25, 0, f.z + Math.sin(a) * 3.25)); }
      } else if (f.kind === 'flag') parts.push(...place([cyl(0.035, 0.035, 2.2, 0xfff8ec, 0, 3.35, 0, 0, 0, 6), box(0.7, 0.42, 0.03, 0xef476f, 0.37, 4.2, 0), box(0.7, 0.14, 0.035, 0xffd166, 0.37, 4.2, 0), sph(0.06, 0xffd166, 0, 4.48, 0)], f.x, 0, f.z));
      else if (f.kind === 'gatesign') { const sign = signMesh('SUNNY MEADOW', '#2a9d8f'); sign.scale.set(1.5, 1.5, 1); sign.position.set(f.x, 3.3, f.z - 0.02); D.add(sign); }
      else if (f.kind === 'windmill') {
        const g = new THREE.Group();
        const tower = new THREE.Mesh(mergeGeometries([cyl(1.5, 2.7, 9, 0xfff3dc, 0, 4.5, 0, 0, 0, 10), cone(1.9, 2.2, 0xc8553d, 0, 10.1, 0, 0, 0, 10), box(1, 1.6, 0.2, 0x8a6748, 0, 0.8, 2.55), box(0.7, 0.9, 0.2, 0x8fd3f4, 0, 5.5, 1.95)], false)!, this.material);
        const blades = new THREE.Group();
        const bg: THREE.BufferGeometry[] = [sph(0.4, 0x8a6748)];
        for (let i = 0; i < 4; i++) { const b = box(0.9, 6, 0.08, 0xfff8ec, 0, 3.4, 0); b.rotateZ((i * Math.PI) / 2); const sp = box(0.12, 6.6, 0.12, 0x8a6748, 0, 3.3, -0.05); sp.rotateZ((i * Math.PI) / 2); bg.push(b, sp); }
        blades.add(new THREE.Mesh(mergeGeometries(bg, false)!, this.material));
        blades.position.set(0, 8.6, 2.0);
        g.add(tower, blades); g.position.set(f.x, 0, f.z); g.rotation.y = f.yaw + 0.5; g.scale.setScalar(1.5);
        this.blades = blades; D.add(g);
      }
    }
    const arch = new THREE.Mesh(mergeGeometries(parts, false)!, this.material);
    arch.castShadow = true; arch.receiveShadow = true;
    D.add(arch);
    if (bulbs.length) D.add(new THREE.Mesh(mergeGeometries(bulbs, false)!, this.lampMat));

    // ground: painted play area on top of an endless lawn
    const gtex = meadowTexture();
    const gHi = new THREE.MeshStandardMaterial({ map: gtex, roughness: 0.95, metalness: 0 }), gLo = new THREE.MeshLambertMaterial({ map: gtex });
    const oHi = new THREE.MeshStandardMaterial({ color: 0x7cc36a, roughness: 0.95, metalness: 0 }), oLo = new THREE.MeshLambertMaterial({ color: 0x7cc36a });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(49, 35), this.hi ? gHi : gLo);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), this.hi ? oHi : oLo);
    lawn.rotation.x = -Math.PI / 2; lawn.position.y = -0.03; lawn.receiveShadow = true;
    this.floors.push([ground, gHi, gLo], [lawn, oHi, oLo]);
    D.add(ground, lawn);

    // backdrop: hills and woodland beyond the fence (no shadows, softened by fog)
    for (let i = 0; i < 13; i++) { const a = (i / 13) * 6.28 + R() * 0.3, d = 66 + R() * 34, r = 20 + R() * 20; backdrop.push(sph(r, [0x6fbf73, 0x5aa469, 0x86c98a][i % 3], Math.cos(a) * d, -r * 0.1, Math.sin(a) * d * 0.85, 1, 0.34 + R() * 0.14, 1)); }
    for (let i = 0; i < 64; i++) {
      const x = -62 + R() * 124, z = -54 + R() * 108;
      if (Math.abs(x) < 26.5 && Math.abs(z) < 19.5) continue;
      if (Math.hypot(x + 34 * 1, z + 24) < 9) continue;
      backdrop.push(...place(tree(Math.floor(R() * 9), true), x, 0, z, R() * 6.28, 0.9 + R() * 0.9));
    }
    const far = new THREE.Mesh(mergeGeometries(backdrop, false)!, this.material);
    far.receiveShadow = true;
    D.add(far);

    // sky dome with a horizon gradient, a sun bright enough to bloom, and drifting clouds
    const sg = new THREE.SphereGeometry(300, 24, 14);
    const sp = sg.attributes.position, sc = new Float32Array(sp.count * 3);
    const top = new THREE.Color(0x2f7fd8), mid = new THREE.Color(0x8cc8f5), low = new THREE.Color(0xdff1fb), tmp = new THREE.Color();
    for (let i = 0; i < sp.count; i++) {
      const h = Math.max(0, sp.getY(i) / 300);
      if (h < 0.18) tmp.copy(low).lerp(mid, h / 0.18); else tmp.copy(mid).lerp(top, Math.min(1, (h - 0.18) / 0.6));
      sc[i * 3] = tmp.r; sc[i * 3 + 1] = tmp.g; sc[i * 3 + 2] = tmp.b;
    }
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    const sky = new THREE.Mesh(sg, this.skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    D.add(sky);
    const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(13, 16, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.4, 3), fog: false }));
    sunDisc.position.set(15, 24, 11).normalize().multiplyScalar(270);
    this.sunDisc = sunDisc; D.add(sunDisc);
    for (let i = 0; i < 11; i++) {
      const g: THREE.BufferGeometry[] = [];
      const n = 3 + Math.floor(R() * 3);
      for (let k = 0; k < n; k++) { const s = new THREE.SphereGeometry(5 + R() * 5, 9, 6); s.scale(1.5, 0.55, 1); s.translate((k - n / 2) * 7, R() * 2, R() * 4); g.push(s); }
      const c = new THREE.Mesh(mergeGeometries(g, false)!, this.cloudMat);
      c.position.set(-120 + R() * 240, 46 + R() * 26, -130 + R() * 230);
      this.clouds.push(c); D.add(c);
    }

    // grass tufts and wild flowers give the lawn some depth up close
    const blade = mergeGeometries([cone(0.03, 0.2, 0x8fd67a, 0, 0.1, 0, 0.15, 0, 3), cone(0.026, 0.15, 0xa6e38f, 0.045, 0.075, 0.03, -0.2, 0.25, 3), cone(0.026, 0.17, 0x7fcf70, -0.045, 0.085, -0.02, 0.1, -0.3, 3)], false)!;
    const grassMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const tufts = new THREE.InstancedMesh(blade, grassMat, 1500);
    const head = mergeGeometries([cone(0.014, 0.22, 0x4f9d69, 0, 0.11, 0, 0, 0, 3), cone(0.06, 0.05, 0xffffff, 0, 0.235, 0, Math.PI, 0, 5), cone(0.025, 0.03, 0xffd166, 0, 0.25, 0, 0, 0, 4)], false)!;
    const flowers = new THREE.InstancedMesh(head, grassMat, 420);
    const onPath = (x: number, z: number) => (Math.abs(x) < 1.3 && z > -10.2) || (x > -22.2 && x < -12.8 && z > -15.7 && z < -7.8) || ((x + 17.5) / 4.5) ** 2 + ((z - 1.5) / 3.5) ** 2 < 1 || (x > 12.8 && x < 22.8 && z > -3.9 && z < 4.9);
    const col = new THREE.Color();
    let nt = 0, nf = 0;
    for (let i = 0; i < 9000 && (nt < 1500 || nf < 420); i++) {
      const x = -23.8 + R() * 47.6, z = -16.8 + R() * 33.6;
      if (onPath(x, z)) continue;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, R() * 6.28, 0); const k = 0.7 + R() * 0.9; dummy.scale.set(k, k, k); dummy.updateMatrix();
      if (i % 6 === 0 && nf < 420) { flowers.setMatrixAt(nf, dummy.matrix); flowers.setColorAt(nf, col.set([0xffffff, 0xffd166, 0xff8fab, 0xc8a8ff, 0xffffff][nf % 5])); nf++; }
      else if (nt < 1500) tufts.setMatrixAt(nt++, dummy.matrix);
    }
    tufts.count = nt; flowers.count = nf;
    tufts.receiveShadow = true;
    D.add(tufts, flowers);
    this.addMotes(0xfffbe0, 0.06, 0.55, 5);
  }

  decorDef(id: number) { const r = this.refs[id]; return r ? { d: r.d, def: PROPS[r.d.type] } : null; }
}
