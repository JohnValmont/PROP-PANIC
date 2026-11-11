/** Renders the toy store: merged static architecture, instanced toys, painted floor, lights and set dressing. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BOUNDS, ZONES, type Decor, type GameMap } from '../../shared/map';
import { PROPS } from '../../shared/props';
import { rng } from '../../shared/rng';
import { box, propGeometry, sph, cyl, tor } from './propgeo';

const dummy = new THREE.Object3D();

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
  material = new THREE.MeshLambertMaterial({ vertexColors: true });
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
    sc.left = -27; sc.right = 27; sc.top = 20; sc.bottom = -20; sc.near = 5; sc.far = 45;
    this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    for (const [x, z, col] of [[-19, 6, 0xff4fd8], [-14, 13, 0x00e5ff]] as [number, number, number][]) {
      const l = new THREE.PointLight(col, 26, 13, 1.6);
      l.position.set(x, 2.6, z);
      this.neon.push(l); scene.add(l);
    }
    this.root.add(this.decorGroup);
  }

  setShadows(on: boolean) { this.sun.castShadow = on; }

  load(map: GameMap) {
    if (!this.builtStatics) { this.buildStatics(map); this.builtStatics = true; }
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
    this.hemi.intensity = 1.25 * lit;
    this.sun.intensity = 1.55 * (1 - this.dark * 0.985);
    this.panelMat.color.setRGB(1 * (1 - this.dark * 0.94), 0.96 * (1 - this.dark * 0.94), 0.84 * (1 - this.dark * 0.9));
    this.bgColor.setRGB(0.086 * lit, 0.13 * lit, 0.24 * lit);
    this.neon[0].intensity = 22 + Math.sin(this.time * 3) * 5;
    this.neon[1].intensity = 22 + Math.cos(this.time * 2.3) * 5;
    for (const s of this.spinners) s.rotation.y += dt * 0.25;
  }

  private buildStatics(map: GameMap) {
    const parts: THREE.BufferGeometry[] = [];
    for (const b of [...map.statics, ...map.visuals]) {
      if (b.hidden) continue;
      parts.push(box(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0, b.c, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2));
    }
    const statics = new THREE.Mesh(mergeGeometries(parts, false)!, this.material);
    statics.castShadow = true; statics.receiveShadow = true;
    this.root.add(statics);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(49, 35), new THREE.MeshLambertMaterial({ map: floorTexture() }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.root.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(49, 35), new THREE.MeshBasicMaterial({ map: ceilingTexture() }));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = BOUNDS.wallH;
    this.root.add(ceil);

    // ceiling light panels
    const panels: THREE.BufferGeometry[] = [];
    for (let x = -20; x <= 20; x += 8) for (let z = -13.5; z <= 13.5; z += 6.75) {
      const g = new THREE.BoxGeometry(2.6, 0.06, 0.7); g.translate(x, BOUNDS.wallH - 0.04, z); panels.push(g);
    }
    this.root.add(new THREE.Mesh(mergeGeometries(panels, false)!, this.panelMat));

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
    this.root.add(bunting);

    // hanging planets & a paper moon, purely for charm
    const planet = (x: number, y: number, z: number, r: number, c: number, ring?: number) => {
      const g = [sph(r, c, 0, 0, 0), cyl(0.01, 0.01, BOUNDS.wallH - y, 0xffffff, 0, (BOUNDS.wallH - y) / 2, 0, 0, 0, 5)];
      if (ring) g.push(tor(r * 1.5, r * 0.09, ring, 0, 0, 0, Math.PI / 2 + 0.3));
      const m = new THREE.Mesh(mergeGeometries(g, false)!, this.material);
      m.position.set(x, y, z);
      this.spinners.push(m); this.root.add(m);
    };
    planet(0, 3.7, 9, 0.5, 0xffd166, 0xf78c2b); planet(-6, 3.8, -5, 0.35, 0xef476f); planet(6.5, 3.75, 0, 0.42, 0x48cae4, 0xffffff);
    planet(17.5, 3.8, -6, 0.5, 0x9b5de5, 0xffd166); planet(-17.5, 3.8, -10, 0.45, 0xff9ecd); planet(18, 3.9, 8.5, 0.38, 0x06d6a0);

    // hanging zone signs
    const sign = (text: string, bg: string, x: number, z: number, ry: number) => { const s = signMesh(text, bg); s.position.set(x, 3.45, z); s.rotation.y = ry; this.root.add(s); };
    sign('CHECKOUT', '#6c5ce7', 0, 8.6, 0); sign('STOCK ROOM', '#5c677d', -7, -10.2, 0); sign('STOCK ROOM', '#5c677d', 7, -10.2, 0);
    sign('PLUSH CORNER', '#ff6fa8', -10.9, -6.5, Math.PI / 2); sign('ARCADE', '#7b2ff7', -10.9, 3.5, Math.PI / 2); sign('ARCADE', '#7b2ff7', -10.9, 12.5, Math.PI / 2);
    sign('BLOCK CASTLE', '#06a77d', 10.9, -7.5, Math.PI / 2); sign('BALL PIT', '#0096c7', 10.9, 2.5, Math.PI / 2); sign('BALL PIT', '#0096c7', 10.9, 11.5, Math.PI / 2);
    const title = signMesh("TUMBLETON'S", '#ef476f'); title.scale.set(1.6, 1.6, 1); title.position.set(0, 3.75, 16.9); title.rotation.y = Math.PI; this.root.add(title);
  }

  decorDef(id: number) { const r = this.refs[id]; return r ? { d: r.d, def: PROPS[r.d.type] } : null; }
}
