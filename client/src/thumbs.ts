/**
 * 3D thumbnails for the shop tiles (characters, blasters, hats): each model is rendered once into a small
 * offscreen canvas and kept as a data URL. A second WebGL context, so the game's renderer state is never
 * touched; one model per animation frame, so opening a tab does not stall; the context is released once the
 * queue has been empty for a while.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type ThumbView = 'char' | 'gun' | 'hat';
interface Job { key: string; make: () => THREE.Object3D; view: ThumbView; }

const SIZE = 192;

export class Thumbs {
  private r: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
  private cache = new Map<string, string>();
  private queue: Job[] = [];
  private queued = new Set<string>();
  private running = false;
  private idleTimer = 0;
  /** Called when a thumbnail is ready: the page swaps it into every <img data-thumb="key">. */
  onReady: (key: string, url: string) => void = (key, url) => {
    for (const img of document.querySelectorAll<HTMLImageElement>(`img[data-thumb="${CSS.escape(key)}"]`)) img.src = url;
  };

  /** The thumbnail for `key` if it is ready (else '' and it is queued). */
  get(key: string, make: () => THREE.Object3D, view: ThumbView): string {
    const hit = this.cache.get(key);
    if (hit) return hit;
    if (!this.queued.has(key)) { this.queued.add(key); this.queue.push({ key, make, view }); }
    if (!this.running) { this.running = true; requestAnimationFrame(() => this.pump()); }
    return '';
  }

  private setup(): THREE.WebGLRenderer | null {
    if (this.r) return this.r;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      r.setSize(SIZE, SIZE, false);
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1.7;
      r.setClearColor(0x000000, 0);
      const pm = new THREE.PMREMGenerator(r);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
      if (!this.scene.children.length) {
        const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(2, 3, 4);
        const rim = new THREE.DirectionalLight(0xbfdcff, 1.0); rim.position.set(-3, 2, -2);
        this.scene.add(key, rim, new THREE.AmbientLight(0xffffff, 0.6));
      }
      this.r = r;
    } catch { this.r = null; }
    return this.r;
  }

  private pump() {
    const job = this.queue.shift();
    if (!job) {
      this.running = false;
      clearTimeout(this.idleTimer);
      this.idleTimer = window.setTimeout(() => this.release(), 8000);
      return;
    }
    const r = this.setup();
    if (!r) { this.queue.length = 0; this.running = false; return; }
    this.queued.delete(job.key);
    const obj = job.make();
    const holder = new THREE.Group(); holder.add(obj);
    if (job.view === 'gun') { obj.rotation.set(0, Math.PI / 2 + 0.35, 0); }
    else if (job.view === 'char') { obj.rotation.y = 0.45; }
    else { obj.rotation.set(0.25, 0.5, 0); }
    this.scene.add(holder);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z * 0.6) * (job.view === 'char' ? 1.04 : 1.08);
    const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
    this.cam.position.set(c.x, c.y + (job.view === 'char' ? 0.05 : span * 0.15), c.z + dist + size.z / 2);
    this.cam.lookAt(c);
    r.render(this.scene, this.cam);
    const url = r.domElement.toDataURL('image/png');
    this.scene.remove(holder);
    this.cache.set(job.key, url);
    this.onReady(job.key, url);
    requestAnimationFrame(() => this.pump());
  }

  private release() {
    if (this.running || !this.r) return;
    this.scene.environment?.dispose(); this.scene.environment = null;
    this.r.dispose(); this.r.forceContextLoss(); this.r = null;
  }
}
