/**
 * The hunters: store security robots. Built from smooth primitives with physically based materials
 * (clear-coated paint, brushed metal, rubber, a glowing visor) and posed procedurally every frame,
 * so there is no rigged asset to download. The player's kit picks a paint and a hat (shared/progress.ts).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EYES, HATS, PAINTS } from '../../shared/progress';

const cache = new Map<string, THREE.BufferGeometry>();
function G(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
}

const rubber = new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.82, metalness: 0.05 });
const steel = new THREE.MeshStandardMaterial({ color: 0xc3c8cf, roughness: 0.28, metalness: 1 });
const darkSteel = new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.38, metalness: 1 });
const glass = new THREE.MeshPhysicalMaterial({ color: 0x06080c, roughness: 0.06, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.04 });
const white = new THREE.MeshPhysicalMaterial({ color: 0xf1efe9, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 });
const gold = new THREE.MeshStandardMaterial({ color: 0xffc64a, roughness: 0.22, metalness: 1 });
const felt = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.95 });
/** Brighter than white so the bloom pass picks them up. */
const glowCyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.6, 3.2) });
const glowAmber = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 1.7, 0.35) });
const glowRed = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.4, 0.3) });

const paints = new Map<number, THREE.MeshPhysicalMaterial>();
function paint(hex: number): THREE.MeshPhysicalMaterial {
  let m = paints.get(hex);
  if (!m) paints.set(hex, (m = new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.36, metalness: 0.08, clearcoat: 0.85, clearcoatRoughness: 0.18 })));
  return m;
}
/** A body finish from the wardrobe: plain paints, plus pearl, chrome, opal and gold. */
const finishes = new Map<number, THREE.MeshPhysicalMaterial>();
function finish(i: number): THREE.MeshPhysicalMaterial {
  const d = PAINTS[i] ?? PAINTS[0];
  let m = finishes.get(i);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color: d.hex, roughness: d.rough, metalness: d.metal, clearcoat: d.metal > 0.5 ? 0.3 : 0.85, clearcoatRoughness: 0.18 });
    if (d.iri) { m.iridescence = d.iri; m.iridescenceIOR = 1.6; m.iridescenceThicknessRange = [180, 520]; }
    finishes.set(i, m);
  }
  return m;
}
const matte = (hex: number, rough = 0.9) => G2(`matte${hex}_${rough}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: rough }));
const mats = new Map<string, THREE.Material>();
function G2<T extends THREE.Material>(key: string, make: () => T): T { let m = mats.get(key) as T | undefined; if (!m) mats.set(key, (m = make())); return m; }
const glowGold = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.5, 0.9) });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const capsule = (r: number, len: number) => G(`cap${r}_${len}`, () => new THREE.CapsuleGeometry(r, len, 8, 20));
const ball = (r: number) => G(`ball${r}`, () => new THREE.SphereGeometry(r, 24, 16));
const tube = (r0: number, r1: number, h: number, open = false) => G(`tube${r0}_${r1}_${h}_${open}`, () => new THREE.CylinderGeometry(r0, r1, h, 24, 1, open));
const rbox = (w: number, h: number, d: number, r: number) => G(`rbox${w}_${h}_${d}_${r}`, () => new RoundedBoxGeometry(w, h, d, 4, r));

function buildHat(i: number, accent: THREE.Material): THREE.Group {
  const id = (HATS[i] ?? HATS[0]).id.slice(4);
  const g = new THREE.Group();
  const dome = (r: number) => G(`dome${r}`, () => new THREE.SphereGeometry(r, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  // the origin is the centre of the skull (radius ~0.15), so domes can wrap the top of the head
  switch (id) {
    case 'cap': {
      const brim = mesh(tube(0.115, 0.115, 0.012), accent, 0, 0.045, 0.15); brim.scale.set(1, 1, 0.85); brim.rotation.x = 0.12;
      g.add(mesh(dome(0.159), accent, 0, 0.012, 0), brim, mesh(ball(0.016), white, 0, 0.172, 0));
      break;
    }
    case 'hardhat': {
      const hi = paint(0xffc61a);
      const rim = mesh(tube(0.2, 0.2, 0.014), hi, 0, 0.05, 0.02); rim.scale.z = 1.12;
      g.add(mesh(dome(0.166), hi, 0, 0.03, 0), rim, mesh(rbox(0.04, 0.03, 0.3, 0.012), hi, 0, 0.19, 0));
      break;
    }
    case 'party': {
      const cone = mesh(G('pcone', () => new THREE.ConeGeometry(0.095, 0.27, 24)), paint(0xff4f8b), 0, 0.255, 0);
      g.add(cone, mesh(ball(0.032), white, 0, 0.395, 0), mesh(G('pband', () => new THREE.TorusGeometry(0.094, 0.012, 8, 24).rotateX(Math.PI / 2)), gold, 0, 0.125, 0));
      g.rotation.z = -0.1;
      break;
    }
    case 'propeller': {
      const spin = new THREE.Group(); spin.position.y = 0.225; spin.name = 'spin';
      for (const s of [1, -1]) { const b = mesh(rbox(0.13, 0.008, 0.045, 0.004), paint(s > 0 ? 0xff4f4f : 0xffd23f), s * 0.07, 0, 0); b.rotation.x = 0.35 * s; spin.add(b); }
      const d = mesh(dome(0.158), paint(0x2f7fe0), 0, 0.03, 0); d.scale.y = 0.9;
      g.add(d, mesh(tube(0.008, 0.008, 0.06), steel, 0, 0.195, 0), spin, mesh(ball(0.016), gold, 0, 0.232, 0));
      break;
    }
    case 'tophat': {
      g.add(mesh(tube(0.105, 0.098, 0.21), felt, 0, 0.225, 0), mesh(tube(0.168, 0.168, 0.014), felt, 0, 0.12, 0), mesh(tube(0.101, 0.101, 0.035), accent, 0, 0.147, 0));
      break;
    }
    case 'crown': {
      g.add(mesh(tube(0.118, 0.11, 0.075), gold, 0, 0.135, 0));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const spike = mesh(G('spike', () => new THREE.ConeGeometry(0.026, 0.07, 12)), gold, Math.cos(a) * 0.112, 0.205, Math.sin(a) * 0.112);
        g.add(spike, mesh(ball(0.014), k % 2 ? glowRed : glowCyan, Math.cos(a) * 0.112, 0.247, Math.sin(a) * 0.112));
      }
      break;
    }
    case 'beanie': {
      const knit = matte(0xd64550, 0.95), rib = matte(0xf2e9dc, 0.95);
      const d = mesh(dome(0.163), knit, 0, 0.01, 0); d.scale.y = 1.12;
      g.add(d, mesh(tube(0.166, 0.166, 0.055), rib, 0, 0.03, 0), mesh(ball(0.042), rib, 0, 0.2, 0));
      break;
    }
    case 'cone': {
      const orange = paint(0xff6a13);
      g.add(mesh(rbox(0.26, 0.025, 0.26, 0.01), orange, 0, 0.13, 0), mesh(G('tcone', () => new THREE.ConeGeometry(0.105, 0.32, 24)), orange, 0, 0.3, 0));
      g.add(mesh(tube(0.07, 0.081, 0.05, true), white, 0, 0.27, 0), mesh(tube(0.043, 0.053, 0.04, true), white, 0, 0.35, 0));
      g.rotation.z = 0.12;
      break;
    }
    case 'chef': {
      g.add(mesh(tube(0.125, 0.118, 0.13), white, 0, 0.17, 0));
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.add(mesh(ball(0.075), white, Math.cos(a) * 0.075, 0.27, Math.sin(a) * 0.075)); }
      g.add(mesh(ball(0.085), white, 0, 0.3, 0));
      break;
    }
    case 'cowboy': {
      const leather = matte(0x7a4a24, 0.7), band = matte(0x2a1a10, 0.6);
      const brim = mesh(G('cbrim', () => new THREE.CylinderGeometry(0.27, 0.25, 0.014, 32)), leather, 0, 0.11, 0); brim.scale.z = 0.85;
      const top = mesh(tube(0.1, 0.125, 0.14), leather, 0, 0.19, 0); top.scale.z = 0.85;
      const b = mesh(tube(0.127, 0.127, 0.03), band, 0, 0.135, 0); b.scale.z = 0.86;
      g.add(brim, top, b);
      for (const s of [1, -1]) { const curl = mesh(rbox(0.04, 0.05, 0.36, 0.01), leather, s * 0.255, 0.13, 0); curl.rotation.z = s * -0.6; g.add(curl); }
      break;
    }
    case 'wizard': {
      const cloth = matte(0x2b2d8f, 0.85);
      const cone = mesh(G('wcone', () => new THREE.ConeGeometry(0.15, 0.42, 28)), cloth, 0, 0.33, -0.02); cone.rotation.x = -0.18;
      g.add(mesh(tube(0.23, 0.23, 0.012), cloth, 0, 0.12, 0), cone);
      for (const [x, y, z] of [[0.07, 0.24, 0.1], [-0.06, 0.33, 0.06], [0.02, 0.42, 0.02]]) g.add(mesh(ball(0.016), glowAmber, x, y, z));
      break;
    }
    case 'viking': {
      const brass = new THREE.MeshStandardMaterial({ color: 0xb8863b, roughness: 0.3, metalness: 1 });
      const ivory = matte(0xf2ead6, 0.5);
      g.add(mesh(dome(0.168), steel, 0, 0.015, 0), mesh(tube(0.17, 0.17, 0.04), brass, 0, 0.03, 0), mesh(rbox(0.03, 0.17, 0.02, 0.008), brass, 0, 0.1, 0.16));
      for (const s of [1, -1]) {
        const horn = mesh(G('horn', () => new THREE.ConeGeometry(0.035, 0.19, 16)), ivory, s * 0.19, 0.13, 0); horn.rotation.z = s * -0.95;
        g.add(horn);
      }
      break;
    }
    case 'lampshade': {
      const fabric = G2('shade', () => new THREE.MeshStandardMaterial({ color: 0xf2e2b8, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffc870, emissiveIntensity: 0.25 }));
      const shade = mesh(G('lshade', () => new THREE.CylinderGeometry(0.1, 0.2, 0.22, 28, 1, true)), fabric, 0, 0.2, 0);
      g.add(shade, mesh(G('lrim', () => new THREE.TorusGeometry(0.2, 0.008, 6, 32).rotateX(Math.PI / 2)), gold, 0, 0.09, 0), mesh(G('lrim2', () => new THREE.TorusGeometry(0.1, 0.008, 6, 28).rotateX(Math.PI / 2)), gold, 0, 0.31, 0));
      g.rotation.z = -0.14;
      break;
    }
    case 'duck': {
      const yellow = paint(0xffd23f), beak = paint(0xff8c1a);
      const body = mesh(ball(0.1), yellow, 0, 0.2, -0.01); body.scale.set(1, 0.75, 1.25);
      const tail = mesh(G('dtail', () => new THREE.ConeGeometry(0.04, 0.08, 12)), yellow, 0, 0.24, -0.13); tail.rotation.x = -1.1;
      const bk = mesh(G('dbeak', () => new THREE.ConeGeometry(0.03, 0.07, 12)), beak, 0, 0.3, 0.12); bk.rotation.x = Math.PI / 2;
      g.add(body, tail, mesh(ball(0.065), yellow, 0, 0.3, 0.06), bk, mesh(ball(0.012), felt, 0.035, 0.32, 0.105), mesh(ball(0.012), felt, -0.035, 0.32, 0.105));
      break;
    }
    case 'halo': {
      const ring = mesh(G('halo', () => new THREE.TorusGeometry(0.12, 0.016, 10, 40).rotateX(Math.PI / 2)), glowGold, 0, 0.32, 0);
      ring.name = 'bob'; ring.castShadow = false;
      g.add(ring);
      break;
    }
  }
  return g;
}

/** The hand blaster. Barrel along -Z, grip at the origin. Used on the robot's arm and as the first-person viewmodel. */
export function buildBlaster(accent: THREE.Material = paint(0xff6b35)): THREE.Group {
  const g = new THREE.Group();
  const rz = (m: THREE.Mesh) => { m.rotation.x = Math.PI / 2; return m; };
  g.add(mesh(rbox(0.075, 0.1, 0.3, 0.022), white, 0, 0.012, -0.12)); // body shell
  g.add(mesh(rbox(0.079, 0.035, 0.2, 0.012), accent, 0, 0.045, -0.13)); // top stripe
  g.add(rz(mesh(tube(0.03, 0.034, 0.2), darkSteel, 0, 0.005, -0.33))); // barrel
  g.add(rz(mesh(tube(0.041, 0.041, 0.035), steel, 0, 0.005, -0.42))); // muzzle ring
  for (const z of [-0.27, -0.31, -0.35]) g.add(rz(mesh(G('coil', () => new THREE.TorusGeometry(0.039, 0.007, 8, 24).rotateX(Math.PI / 2)), glowCyan, 0, 0.005, z)));
  const grip = mesh(rbox(0.058, 0.15, 0.07, 0.02), rubber, 0, -0.09, -0.02); grip.rotation.x = 0.28; g.add(grip);
  g.add(mesh(rbox(0.05, 0.06, 0.09, 0.016), darkSteel, 0, -0.045, -0.2)); // battery
  g.add(mesh(ball(0.016), glowAmber, 0.041, 0.02, -0.06));
  g.add(mesh(rbox(0.02, 0.03, 0.05, 0.008), darkSteel, 0, 0.078, -0.03)); // rear sight
  return g;
}

export interface Pose { time: number; stepT: number; move: number; pitch: number; air: boolean; dizzy: boolean; kick: number; }

export class HunterRig {
  root = new THREE.Group();
  private torso = new THREE.Group(); private head = new THREE.Group();
  private armR = new THREE.Group(); private armL = new THREE.Group(); private foreR = new THREE.Group(); private foreL = new THREE.Group();
  private legL = new THREE.Group(); private legR = new THREE.Group(); private shinL = new THREE.Group(); private shinR = new THREE.Group();
  private spin: THREE.Object3D | null = null;
  private bob: THREE.Object3D | null = null;

  /** `paintIx` and `hat` index PAINTS and HATS (a player's kit). */
  constructor(paintIx = 0, hat = 0) {
    const body = finish(paintIx);

    // legs
    for (const [leg, shin, sx] of [[this.legL, this.shinL, -1], [this.legR, this.shinR, 1]] as [THREE.Group, THREE.Group, number][]) {
      leg.position.set(sx * 0.115, 0.83, 0);
      leg.add(mesh(ball(0.092), rubber), mesh(capsule(0.078, 0.2), white, 0, -0.2, 0));
      shin.position.y = -0.4;
      shin.add(mesh(ball(0.074), rubber), mesh(tube(0.074, 0.058, 0.27), body, 0, -0.18, 0), mesh(ball(0.056), rubber, 0, -0.34, 0));
      shin.add(mesh(rbox(0.13, 0.085, 0.27, 0.035), darkSteel, 0, -0.385, 0.045), mesh(rbox(0.134, 0.05, 0.1, 0.022), body, 0, -0.372, 0.135));
      leg.add(shin);
      this.root.add(leg);
    }
    // pelvis and torso
    const pelvis = mesh(capsule(0.105, 0.15), rubber, 0, 0.84, 0); pelvis.rotation.z = Math.PI / 2;
    this.root.add(pelvis);
    this.torso.position.y = 0.86;
    const chestGeo = G('chest', () => {
      const pts = [[0.001, 0.08], [0.13, 0.08], [0.175, 0.14], [0.215, 0.28], [0.228, 0.4], [0.2, 0.5], [0.13, 0.565], [0.001, 0.58]].map(([r, y]) => new THREE.Vector2(r, y));
      const spline = new THREE.SplineCurve(pts).getPoints(28);
      return new THREE.LatheGeometry(spline, 32).scale(1, 1, 0.8);
    });
    this.torso.add(mesh(tube(0.13, 0.115, 0.13), rubber, 0, 0.06, 0), mesh(chestGeo, body));
    this.torso.add(mesh(rbox(0.19, 0.12, 0.03, 0.012), glass, 0, 0.4, 0.168), mesh(ball(0.017), glowAmber, -0.055, 0.4, 0.186), mesh(rbox(0.07, 0.014, 0.01, 0.004), glowCyan, 0.03, 0.4, 0.186));
    this.torso.add(mesh(rbox(0.25, 0.3, 0.12, 0.04), darkSteel, 0, 0.36, -0.2), mesh(tube(0.03, 0.03, 0.22), steel, 0.07, 0.37, -0.27), mesh(tube(0.03, 0.03, 0.22), steel, -0.07, 0.37, -0.27));
    const collar = mesh(G('collar', () => new THREE.TorusGeometry(0.085, 0.022, 10, 28).rotateX(Math.PI / 2)), steel, 0, 0.575, 0);
    this.torso.add(collar);
    this.root.add(this.torso);
    // head
    this.head.position.y = 0.6;
    this.head.add(mesh(tube(0.05, 0.058, 0.07), rubber, 0, 0.015, 0));
    const skull = mesh(G('skull', () => new THREE.SphereGeometry(0.152, 36, 24)), white, 0, 0.16, 0); skull.scale.set(1, 0.95, 0.98);
    const visor = mesh(G('visor', () => new THREE.SphereGeometry(0.1555, 32, 10, Math.PI / 2 - 1.25, 2.5, 1.2, 0.66)), glass, 0, 0.16, 0); visor.scale.copy(skull.scale);
    const eye = G('eye', () => new THREE.SphereGeometry(0.026, 16, 12).scale(1, 1.25, 0.5));
    this.head.add(skull, visor, mesh(eye, glowCyan, -0.058, 0.158, 0.146), mesh(eye, glowCyan, 0.058, 0.158, 0.146));
    for (const sx of [-1, 1]) { const ear = mesh(tube(0.05, 0.05, 0.03), body, sx * 0.152, 0.155, 0); ear.rotation.z = Math.PI / 2; this.head.add(ear); }
    this.head.add(mesh(tube(0.007, 0.007, 0.11), steel, -0.1, 0.31, -0.02), mesh(ball(0.02), glowRed, -0.1, 0.37, -0.02));
    const hatGroup = buildHat(hat, body); hatGroup.position.y = 0.16; this.head.add(hatGroup);
    this.spin = hatGroup.getObjectByName('spin') ?? null;
    this.bob = hatGroup.getObjectByName('bob') ?? null;
    this.torso.add(this.head);
    // arms (gun arm on +X)
    for (const [arm, fore, sx] of [[this.armL, this.foreL, -1], [this.armR, this.foreR, 1]] as [THREE.Group, THREE.Group, number][]) {
      arm.position.set(sx * 0.272, 0.5, 0);
      arm.add(mesh(ball(0.088), body), mesh(capsule(0.056, 0.16), white, 0, -0.16, 0));
      fore.position.y = -0.3;
      fore.add(mesh(ball(0.058), rubber), mesh(tube(0.055, 0.066, 0.22), body, 0, -0.14, 0), mesh(ball(0.066), rubber, 0, -0.29, 0));
      arm.add(fore);
      this.torso.add(arm);
    }
    const blaster = buildBlaster(body); blaster.rotation.x = -Math.PI / 2; blaster.position.set(0, -0.3, 0.03);
    this.foreR.add(blaster);
    this.pose({ time: 0, stepT: 0, move: 0, pitch: 0, air: false, dizzy: false, kick: 0 });
  }

  pose(p: Pose) {
    const ph = p.stepT * 0.8, s = Math.sin(ph), c = Math.cos(ph), m = p.move;
    // legs: swing from the hip, fold the knee on the way forward; tuck both in the air
    const air = p.air ? 1 : 0;
    this.legL.rotation.x = -s * 0.75 * m - air * 0.5; this.legR.rotation.x = s * 0.75 * m - air * 0.25;
    this.shinL.rotation.x = Math.max(0, c) * 1.05 * m + air * 0.9; this.shinR.rotation.x = Math.max(0, -c) * 1.05 * m + air * 0.5;
    // torso: lean into the run, counter-rotate against the legs, breathe when idle
    const breathe = Math.sin(p.time * 2.1) * 0.012 * (1 - m);
    this.torso.position.y = 0.86 + breathe - Math.abs(c) * 0.025 * m;
    this.torso.rotation.set(0.1 * m + (p.dizzy ? Math.sin(p.time * 7) * 0.2 : 0), s * 0.12 * m, p.dizzy ? Math.cos(p.time * 6) * 0.18 : 0);
    this.head.rotation.set(-p.pitch * 0.55 + (p.dizzy ? Math.sin(p.time * 9) * 0.25 : 0), -s * 0.1 * m, 0);
    // gun arm tracks the aim; the other swings with the stride
    this.armR.rotation.set(-Math.PI / 2 - p.pitch + 0.1 * m - p.kick * 0.5, -0.08, 0.05);
    this.foreR.rotation.x = -0.05 - p.kick * 0.25;
    this.armL.rotation.set(s * 0.7 * m + 0.12, 0, -0.12);
    this.foreL.rotation.x = -0.35 - Math.max(0, s) * 0.5 * m;
    if (this.spin) this.spin.rotation.y = p.time * (4 + m * 14);
    if (this.bob) this.bob.position.y = 0.32 + Math.sin(p.time * 2.4) * 0.012;
  }
}

/**
 * Googly eyes that pop out of a disguise when it gives itself away. `style` indexes EYES (the player's kit):
 * they only ever show on a prop that has already been revealed, so a style gives nothing away.
 */
const eyeWhite = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.15, clearcoat: 1 });
const eyePupil = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.2 });
const lidMat = new THREE.MeshStandardMaterial({ color: 0xd8c9b4, roughness: 0.6 });
const pinkPupil = new THREE.MeshStandardMaterial({ color: 0xff2f7a, roughness: 0.25, emissive: 0x6a0a2a });
export function buildEyes(style = 0): THREE.Group {
  const id = (EYES[style] ?? EYES[0]).id.slice(5);
  const g = new THREE.Group();
  const whiteGeo = G('eyeW', () => new THREE.SphereGeometry(0.1, 24, 16).scale(1, 1, 0.6));
  const pupilGeo = G('eyeP', () => new THREE.SphereGeometry(0.045, 16, 12).scale(1, 1, 0.5));
  const plain = (m: THREE.Mesh) => { m.castShadow = false; return m; };
  const eye = (x: number, k: number, px: number, py: number, pupil: THREE.Material = eyePupil) => {
    const w = plain(new THREE.Mesh(whiteGeo, eyeWhite)); w.position.x = x; w.scale.setScalar(k);
    const p = plain(new THREE.Mesh(pupilGeo, pupil)); p.position.set(x + px * k, py * k, 0.05 * k); p.scale.setScalar(k * (id === 'love' ? 1.35 : 1));
    g.add(w, p);
  };
  if (id === 'cyclops') { eye(0, 1.6, 0.01, -0.01); return g; }
  const k = id === 'wide' ? 1.3 : id === 'beady' ? 0.62 : 1;
  const sx = 0.11 * (id === 'wide' ? 1.25 : id === 'beady' ? 0.75 : 1);
  const lookDown = id === 'sleepy' ? -0.035 : 0;
  eye(-sx, k, 0.01, -0.02 + lookDown, id === 'love' ? pinkPupil : eyePupil);
  eye(sx, k, 0.01, 0.01 + lookDown, id === 'love' ? pinkPupil : eyePupil);
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const m = plain(new THREE.Mesh(G(`ebox${w}_${h}_${d}`, () => new THREE.BoxGeometry(w, h, d)), mat)); m.position.set(x, y, z); m.rotation.z = rz; g.add(m); return m;
  };
  switch (id) {
    case 'angry': for (const s of [-1, 1]) box(0.13, 0.03, 0.03, eyePupil, s * sx, 0.1, 0.05, s * 0.45); break;
    case 'sleepy': for (const s of [-1, 1]) { const lid = plain(new THREE.Mesh(G('lid', () => new THREE.SphereGeometry(0.104, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1, 0.62)), lidMat)); lid.position.x = s * sx; lid.rotation.x = 0.35; g.add(lid); } break;
    case 'lashes': for (const s of [-1, 1]) for (const a of [-0.5, 0, 0.5]) box(0.012, 0.06, 0.012, eyePupil, s * sx + Math.sin(a) * 0.09, 0.1 + Math.cos(a) * 0.01, 0.02, -a); break;
    case 'shades': {
      const lens = G2('lens', () => new THREE.MeshPhysicalMaterial({ color: 0x0a0a10, roughness: 0.05, metalness: 0.5, clearcoat: 1 }));
      for (const s of [-1, 1]) box(0.17, 0.11, 0.02, lens, s * sx, 0, 0.075);
      box(0.08, 0.02, 0.02, lens, 0, 0.03, 0.075);
      break;
    }
    case 'monocle': {
      const ring = plain(new THREE.Mesh(G('mono', () => new THREE.TorusGeometry(0.105, 0.012, 8, 28)), gold)); ring.position.set(sx, 0, 0.065); g.add(ring);
      box(0.008, 0.16, 0.008, gold, sx + 0.1, -0.12, 0.06, 0.3);
      break;
    }
  }
  return g;
}
