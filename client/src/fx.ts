/** Lightweight visual effects: pooled particles, tracers, expanding rings and floating text. */
import * as THREE from 'three';

const texCache = new Map<string, THREE.CanvasTexture>();

export function textTexture(text: string, color = '#ffffff', stroke = '#1b2a4a', px = 56): THREE.CanvasTexture {
  const key = `${text}|${color}|${stroke}|${px}`;
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = `700 ${px}px Fredoka, "Baloo 2", ui-rounded, "Arial Rounded MT Bold", system-ui, sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 28;
  c.width = Math.max(32, w); c.height = px + 28;
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = stroke;
  g.strokeText(text, c.width / 2, c.height / 2 + 2);
  g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

export function textSprite(text: string, color = '#ffffff', height = 0.3, depthTest = true, stroke = '#1b2a4a'): THREE.Sprite {
  const tex = textTexture(text, color, stroke);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest, depthWrite: false });
  const s = new THREE.Sprite(mat);
  const img = tex.image as HTMLCanvasElement;
  s.scale.set((height * img.width) / img.height, height, 1);
  return s;
}

const CAP = 600;
const dummy = new THREE.Object3D();
const col = new THREE.Color();

interface Ring { mesh: THREE.Mesh; floor: THREE.Mesh | null; t: number; maxR: number; speed: number; hold: number; }
interface Tracer { mesh: THREE.Mesh; t: number; }
interface Floater { s: THREE.Sprite; t: number; life: number; vy: number; }

export class Fx {
  private parts: THREE.InstancedMesh;
  private px = new Float32Array(CAP * 3); private pv = new Float32Array(CAP * 3);
  private life = new Float32Array(CAP); private max = new Float32Array(CAP);
  private size = new Float32Array(CAP); private spin = new Float32Array(CAP); private grav = new Float32Array(CAP);
  private cursor = 0; private active = 0;
  private tracers: Tracer[] = [];
  private rings: Ring[] = [];
  private floaters: Floater[] = [];
  private tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  private shellGeo = new THREE.CylinderGeometry(1, 1, 1, 56, 1, true);
  private floorGeo = new THREE.RingGeometry(0.93, 1, 56);
  private sphereGeo = new THREE.SphereGeometry(1, 24, 14);

  constructor(private scene: THREE.Scene) {
    this.parts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshBasicMaterial(), CAP);
    this.parts.frustumCulled = false;
    this.parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    dummy.scale.set(0, 0, 0); dummy.updateMatrix();
    for (let i = 0; i < CAP; i++) { this.parts.setMatrixAt(i, dummy.matrix); this.parts.setColorAt(i, col.set(0xffffff)); }
    scene.add(this.parts);
  }

  burst(x: number, y: number, z: number, n: number, colors: number[], speed = 4, up = 3, size = 1, life = 0.9, gravity = 12) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % CAP;
      const a = Math.random() * Math.PI * 2, r = Math.random() * speed;
      this.px[i * 3] = x; this.px[i * 3 + 1] = y; this.px[i * 3 + 2] = z;
      this.pv[i * 3] = Math.cos(a) * r; this.pv[i * 3 + 1] = Math.random() * up + up * 0.3; this.pv[i * 3 + 2] = Math.sin(a) * r;
      this.life[i] = this.max[i] = life * (0.6 + Math.random() * 0.6);
      this.size[i] = size * (0.6 + Math.random() * 0.9); this.spin[i] = Math.random() * 10; this.grav[i] = gravity;
      this.parts.setColorAt(i, col.set(colors[Math.floor(Math.random() * colors.length)]));
    }
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
    this.active = Math.max(this.active, 1);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xfff27a) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(this.tracerGeo, mat);
    const len = from.distanceTo(to);
    m.position.copy(from).lerp(to, 0.5);
    m.lookAt(to);
    m.scale.set(0.045, 0.045, len);
    this.scene.add(m);
    this.tracers.push({ mesh: m, t: 0 });
  }

  /** Expanding ring. kind 'pulse' = scanner wall sweeping outwards, 'shock' = blast dome. */
  ring(x: number, y: number, z: number, maxR: number, speed: number, color: number, kind: 'pulse' | 'shock') {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'pulse' ? 0.28 : 0.4, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(kind === 'pulse' ? this.shellGeo : this.sphereGeo, mat);
    mesh.position.set(x, kind === 'pulse' ? 1.4 : y + 0.5, z);
    let floor: THREE.Mesh | null = null;
    if (kind === 'pulse') {
      floor = new THREE.Mesh(this.floorGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
      floor.rotation.x = -Math.PI / 2; floor.position.set(x, 0.04, z);
      this.scene.add(floor);
    }
    this.scene.add(mesh);
    this.rings.push({ mesh, floor, t: 0, maxR, speed, hold: kind === 'pulse' ? 0.35 : 0.05 });
  }

  floater(x: number, y: number, z: number, text: string, color = '#ffffff', height = 0.5, depthTest = true, life = 1.3) {
    const s = textSprite(text, color, height, depthTest);
    s.position.set(x, y, z);
    this.scene.add(s);
    this.floaters.push({ s, t: 0, life, vy: 0.9 });
  }

  update(dt: number) {
    if (this.active) {
      let alive = 0;
      for (let i = 0; i < CAP; i++) {
        if (this.life[i] <= 0) continue;
        this.life[i] -= dt;
        if (this.life[i] <= 0) { dummy.scale.set(0, 0, 0); dummy.position.set(0, -10, 0); dummy.updateMatrix(); this.parts.setMatrixAt(i, dummy.matrix); continue; }
        alive++;
        const j = i * 3;
        this.pv[j + 1] -= this.grav[i] * dt;
        this.px[j] += this.pv[j] * dt; this.px[j + 1] += this.pv[j + 1] * dt; this.px[j + 2] += this.pv[j + 2] * dt;
        if (this.px[j + 1] < 0.04) { this.px[j + 1] = 0.04; this.pv[j + 1] *= -0.4; this.pv[j] *= 0.6; this.pv[j + 2] *= 0.6; }
        const k = Math.min(1, this.life[i] / (this.max[i] * 0.4)) * this.size[i];
        dummy.position.set(this.px[j], this.px[j + 1], this.px[j + 2]);
        dummy.rotation.set(this.spin[i] * this.life[i], this.spin[i] * this.life[i] * 0.7, 0);
        dummy.scale.set(k, k, k);
        dummy.updateMatrix();
        this.parts.setMatrixAt(i, dummy.matrix);
      }
      this.parts.instanceMatrix.needsUpdate = true;
      this.active = alive;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      (tr.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.95 * (1 - tr.t / 0.11));
      if (tr.t > 0.11) { this.scene.remove(tr.mesh); (tr.mesh.material as THREE.Material).dispose(); this.tracers.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const rad = Math.min(r.maxR, Math.max(0.1, r.t * r.speed));
      const done = r.maxR / r.speed, fade = Math.max(0, 1 - Math.max(0, r.t - done) / r.hold);
      if (r.floor) { r.mesh.scale.set(rad, 2.8, rad); r.floor.scale.set(rad, rad, 1); (r.floor.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade; (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.28 * fade; }
      else { r.mesh.scale.set(rad, rad * 0.7, rad); (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - r.t / (done + r.hold)); }
      if (r.t > done + r.hold) {
        this.scene.remove(r.mesh); (r.mesh.material as THREE.Material).dispose();
        if (r.floor) { this.scene.remove(r.floor); (r.floor.material as THREE.Material).dispose(); }
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      f.s.position.y += f.vy * dt;
      f.s.material.opacity = Math.min(1, (f.life - f.t) / 0.4);
      if (f.t > f.life) { this.scene.remove(f.s); f.s.material.dispose(); this.floaters.splice(i, 1); }
    }
  }
}
