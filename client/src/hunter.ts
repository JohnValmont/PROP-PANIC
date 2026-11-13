/**
 * The hunters: the Emporium's staff (a night guard, Granny Tumbleton, a bear mascot...) and the original
 * security robot, with whatever they are holding as a blaster. Built from smooth primitives with physically
 * based materials and posed procedurally every frame, so there is no rigged asset to download. The player's
 * kit picks the character, blaster, paint and hat (shared/progress.ts); every character shares one skeleton,
 * so the pose code and the hit box are the same whoever you are.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CHARS, EYES, GUNS, HATS, PAINTS } from '../../shared/progress';

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

export function buildHat(i: number, accent: THREE.Material): THREE.Group {
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

// ============================================================================ shared helpers

const skinMat = (hex: number) => G2(`skin${hex}`, () => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.55, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffd0c0) }));
const cloth = (hex: number, rough = 0.85) => G2(`cloth${hex}_${rough}`, () => new THREE.MeshStandardMaterial({ color: hex, roughness: rough }));
const plastic = (hex: number) => G2(`plastic${hex}`, () => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
const glow = (r: number, g: number, b: number) => G2(`glow${r}_${g}_${b}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) }));
const shoeMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1512, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.3 });
const eyeWhiteMat = new THREE.MeshPhysicalMaterial({ color: 0xfbfaf6, roughness: 0.2, clearcoat: 1 });
const pupilMat = new THREE.MeshStandardMaterial({ color: 0x15110e, roughness: 0.2 });
const lipMat = new THREE.MeshStandardMaterial({ color: 0x8c3a33, roughness: 0.5 });

/** A capsule from a to b (any direction): arms and legs that do not sit on an axis. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = mesh(capsule(r, Math.max(0.001, len)), mat);
  m.position.copy(a).lerp(b, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ============================================================================ blasters

/** Every blaster: barrel along -Z, grip at the origin, and an empty node named 'muzzle' where the shot leaves. */
function withMuzzle(g: THREE.Group, z: number, y = 0.005): THREE.Group {
  const m = new THREE.Object3D(); m.name = 'muzzle'; m.position.set(0, y, z); g.add(m);
  return g;
}
const rz = (m: THREE.Mesh) => { m.rotation.x = Math.PI / 2; return m; };
const pistolGrip = (mat: THREE.Material = rubber) => { const grip = mesh(rbox(0.058, 0.15, 0.07, 0.02), mat, 0, -0.09, -0.02); grip.rotation.x = 0.28; return grip; };

/** The standard Zapper (and, in gold, the champion's). */
export function buildBlaster(accent: THREE.Material = paint(0xff6b35), golden = false): THREE.Group {
  const g = new THREE.Group();
  const shell = golden ? gold : white, metal = golden ? gold : darkSteel, coil = golden ? glowGold : glowCyan;
  g.add(mesh(rbox(0.075, 0.1, 0.3, 0.022), shell, 0, 0.012, -0.12)); // body shell
  g.add(mesh(rbox(0.079, 0.035, 0.2, 0.012), golden ? felt : accent, 0, 0.045, -0.13)); // top stripe
  g.add(rz(mesh(tube(0.03, 0.034, 0.2), metal, 0, 0.005, -0.33))); // barrel
  g.add(rz(mesh(tube(0.041, 0.041, 0.035), steel, 0, 0.005, -0.42))); // muzzle ring
  for (const z of [-0.27, -0.31, -0.35]) g.add(rz(mesh(G('coil', () => new THREE.TorusGeometry(0.039, 0.007, 8, 24).rotateX(Math.PI / 2)), coil, 0, 0.005, z)));
  g.add(pistolGrip(golden ? felt : rubber));
  g.add(mesh(rbox(0.05, 0.06, 0.09, 0.016), metal, 0, -0.045, -0.2)); // battery
  g.add(mesh(ball(0.016), glowAmber, 0.041, 0.02, -0.06));
  g.add(mesh(rbox(0.02, 0.03, 0.05, 0.008), metal, 0, 0.078, -0.03)); // rear sight
  return withMuzzle(g, -0.44);
}

function buildGunShape(id: string, accent: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'golden': return buildBlaster(accent, true);
    case 'soaker': {
      const body = plastic(0x22c55e), tankMat = G2('soakTank', () => new THREE.MeshPhysicalMaterial({ color: 0x7cc8ff, roughness: 0.05, transmission: 0.6, thickness: 0.05, transparent: true, opacity: 0.75, clearcoat: 1 }));
      g.add(mesh(rbox(0.08, 0.1, 0.42, 0.03), body, 0, 0.01, -0.17), mesh(rbox(0.084, 0.03, 0.3, 0.012), accent, 0, 0.06, -0.15));
      const tank = mesh(capsule(0.06, 0.16), tankMat, 0, 0.13, -0.08); tank.rotation.x = Math.PI / 2; g.add(tank, mesh(tube(0.025, 0.025, 0.03), plastic(0xffd23f), 0, 0.2, -0.02));
      g.add(rz(mesh(tube(0.018, 0.024, 0.18), plastic(0xffd23f), 0, 0.01, -0.46)));
      g.add(mesh(rbox(0.06, 0.07, 0.13, 0.025), plastic(0xff8c1a), 0, -0.05, -0.3)); // pump
      g.add(pistolGrip(plastic(0xff8c1a)));
      return withMuzzle(g, -0.56, 0.01);
    }
    case 'plunger': {
      const wood = matte(0xb07a45, 0.6), cup = G2('plungerCup', () => new THREE.MeshPhysicalMaterial({ color: 0xc8202a, roughness: 0.45, clearcoat: 0.5 }));
      g.add(mesh(rbox(0.07, 0.09, 0.18, 0.025), accent, 0, 0.01, -0.07), pistolGrip());
      g.add(rz(mesh(tube(0.018, 0.018, 0.34), wood, 0, 0.015, -0.3)));
      const c = mesh(G('pcup', () => new THREE.SphereGeometry(0.075, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), cup, 0, 0.015, -0.47); c.rotation.x = -Math.PI / 2; c.scale.y = 0.75;
      g.add(c, rz(mesh(tube(0.077, 0.077, 0.012, true), cup, 0, 0.015, -0.525)));
      return withMuzzle(g, -0.54, 0.015);
    }
    case 'banana': {
      const peel = G2('banana', () => new THREE.MeshStandardMaterial({ color: 0xffd93b, roughness: 0.55 }));
      const curve = new THREE.CatmullRomCurve3([V(0, -0.12, 0.05), V(0, -0.02, -0.02), V(0, 0.04, -0.16), V(0, 0.03, -0.3), V(0, -0.02, -0.4)]);
      const geo = G('bananaGeo', () => {
        const t = new THREE.TubeGeometry(curve, 24, 0.034, 10, false);
        // taper the ends
        const pos = t.attributes.position, n = 25, ring = 11;
        for (let i = 0; i < n; i++) {
          const k = Math.sin((i / (n - 1)) * Math.PI) * 0.75 + 0.25, c = curve.getPoint(i / (n - 1));
          for (let j = 0; j < ring; j++) { const v = i * ring + j; pos.setXYZ(v, c.x + (pos.getX(v) - c.x) * k, c.y + (pos.getY(v) - c.y) * k, c.z + (pos.getZ(v) - c.z) * k); }
        }
        t.computeVertexNormals();
        return t;
      });
      g.add(mesh(geo, peel), mesh(ball(0.012), matte(0x3b2a1a), 0, -0.02, -0.41), mesh(tube(0.008, 0.012, 0.05), matte(0x5a4426), 0, -0.13, 0.07));
      return withMuzzle(g, -0.42, -0.02);
    }
    case 'dryer': {
      const pink = plastic(0xff7eb6);
      g.add(rz(mesh(tube(0.06, 0.07, 0.24), pink, 0, 0.02, -0.06)), rz(mesh(tube(0.072, 0.072, 0.02), darkSteel, 0, 0.02, 0.065)));
      g.add(rz(mesh(tube(0.035, 0.05, 0.1), pink, 0, 0.02, -0.22)), rz(mesh(tube(0.036, 0.036, 0.012, true), darkSteel, 0, 0.02, -0.275)));
      const grip = mesh(rbox(0.05, 0.17, 0.06, 0.022), pink, 0, -0.1, 0); grip.rotation.x = 0.15; g.add(grip, mesh(rbox(0.02, 0.03, 0.02, 0.006), accent, 0, -0.04, -0.035));
      return withMuzzle(g, -0.28, 0.02);
    }
    case 'baguette': {
      const crust = G2('crust', () => new THREE.MeshStandardMaterial({ color: 0xc98a3c, roughness: 0.75 }));
      const b = mesh(capsule(0.042, 0.55), crust, 0, 0.0, -0.2); b.rotation.x = Math.PI / 2; b.scale.x = 1.15; g.add(b);
      for (let k = 0; k < 5; k++) { const cut = mesh(rbox(0.05, 0.012, 0.03, 0.004), matte(0xf0d7a0, 0.9), 0.0, 0.04, -0.4 + k * 0.1); cut.rotation.y = 0.6; g.add(cut); }
      return withMuzzle(g, -0.5, 0);
    }
    case 'raygun': {
      const body = mesh(ball(0.075), accent, 0, 0.02, -0.06); body.scale.set(0.85, 0.9, 1.35);
      g.add(body, pistolGrip(accent), rz(mesh(tube(0.022, 0.03, 0.22), steel, 0, 0.02, -0.25)));
      for (const [z, r] of [[-0.18, 0.05], [-0.24, 0.042], [-0.3, 0.034]] as const) g.add(rz(mesh(G(`rring${r}`, () => new THREE.TorusGeometry(r, 0.008, 8, 24).rotateX(Math.PI / 2)), steel, 0, 0.02, z)));
      g.add(mesh(ball(0.026), glow(0.5, 3, 1.4), 0, 0.02, -0.37));
      for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) { const fin = mesh(rbox(0.008, 0.07, 0.08, 0.004), steel, Math.sin(a) * 0.06, 0.02 + Math.cos(a) * 0.06, 0.02); fin.rotation.z = -a; g.add(fin); }
      return withMuzzle(g, -0.38, 0.02);
    }
    case 'duck': {
      const yellow = paint(0xffd23f), beak = paint(0xff8c1a);
      g.add(rz(mesh(tube(0.06, 0.07, 0.42), accent, 0, 0.02, -0.2)), rz(mesh(tube(0.08, 0.08, 0.05), darkSteel, 0, 0.02, -0.42)), rz(mesh(tube(0.062, 0.062, 0.02, true), felt, 0, 0.02, -0.445)));
      g.add(pistolGrip(), mesh(rbox(0.05, 0.12, 0.06, 0.02), rubber, 0, -0.07, -0.28));
      const duck = new THREE.Group(); duck.position.set(0, 0.12, -0.12);
      const bd = mesh(ball(0.06), yellow, 0, 0, 0); bd.scale.set(1, 0.8, 1.3);
      const bk = mesh(G('dbeak2', () => new THREE.ConeGeometry(0.02, 0.05, 12)), beak, 0, 0.07, -0.085); bk.rotation.x = -Math.PI / 2;
      duck.add(bd, mesh(ball(0.04), yellow, 0, 0.065, -0.04), bk, mesh(ball(0.008), felt, 0.024, 0.08, -0.07), mesh(ball(0.008), felt, -0.024, 0.08, -0.07));
      g.add(duck);
      return withMuzzle(g, -0.46, 0.02);
    }
    case 'blower': {
      const orange = plastic(0xff7a1a);
      g.add(mesh(rbox(0.16, 0.16, 0.2, 0.04), orange, 0, 0.0, 0.1), mesh(rbox(0.13, 0.03, 0.12, 0.012), darkSteel, 0, 0.09, 0.1));
      g.add(rz(mesh(tube(0.045, 0.06, 0.55), accent, 0, 0.0, -0.25)), rz(mesh(tube(0.05, 0.05, 0.03), darkSteel, 0, 0, -0.53)));
      g.add(mesh(rbox(0.04, 0.1, 0.04, 0.012), rubber, 0, -0.06, -0.02), mesh(rbox(0.04, 0.12, 0.04, 0.012), rubber, 0, -0.07, -0.3));
      return withMuzzle(g, -0.56, 0);
    }
    case 'fish': {
      const scales = G2('fish', () => new THREE.MeshPhysicalMaterial({ color: 0x7d9fb5, roughness: 0.2, metalness: 0.3, clearcoat: 1, iridescence: 0.6, iridescenceIOR: 1.5 }));
      const b = mesh(ball(0.07), scales, 0, 0.01, -0.2); b.scale.set(0.6, 0.95, 2.4); g.add(b);
      const tail = mesh(G('ftail', () => new THREE.ConeGeometry(0.06, 0.09, 4)), scales, 0, 0.01, 0.0); tail.rotation.x = -Math.PI / 2; tail.scale.x = 0.25;
      const fin = mesh(G('ffin', () => new THREE.ConeGeometry(0.03, 0.08, 4)), scales, 0, 0.08, -0.2); fin.scale.x = 0.2;
      g.add(tail, fin, mesh(ball(0.014), eyeWhiteMat, 0.035, 0.03, -0.33), mesh(ball(0.008), pupilMat, 0.044, 0.03, -0.335), mesh(ball(0.014), eyeWhiteMat, -0.035, 0.03, -0.33), mesh(ball(0.008), pupilMat, -0.044, 0.03, -0.335));
      g.add(mesh(rbox(0.03, 0.012, 0.02, 0.005), lipMat, 0, -0.005, -0.365));
      return withMuzzle(g, -0.37, 0);
    }
    case 'remote': {
      g.add(mesh(rbox(0.06, 0.03, 0.26, 0.012), matte(0x1d1f24, 0.5), 0, 0.0, -0.08));
      const cols = [0xff4040, 0x40c040, 0xffd23f, 0x4080ff];
      for (let k = 0; k < 4; k++) g.add(mesh(rbox(0.016, 0.008, 0.016, 0.004), plastic(cols[k]), (k % 2 ? 0.014 : -0.014), 0.017, -0.16 + Math.floor(k / 2) * 0.03));
      for (let k = 0; k < 6; k++) g.add(mesh(rbox(0.012, 0.006, 0.012, 0.003), plastic(0x8a8f99), (k % 3 - 1) * 0.016, 0.017, -0.06 + Math.floor(k / 3) * 0.022));
      g.add(mesh(ball(0.008), glowRed, 0, 0.0, -0.212), mesh(rbox(0.05, 0.004, 0.03, 0.002), accent, 0, 0.017, 0.02));
      return withMuzzle(g, -0.22, 0);
    }
    case 'fingers': return withMuzzle(g, -0.13, 0.0);
  }
  return buildBlaster(accent);
}

/** A blaster by index into GUNS. */
export function buildGun(ix: number, accent: THREE.Material = paint(0xff6b35)): THREE.Group {
  const id = (GUNS[ix] ?? GUNS[0]).id.slice(4);
  const g = id === 'zapper' ? buildBlaster(accent) : buildGunShape(id, accent);
  g.userData.fingers = id === 'fingers';
  g.userData.two = !!GUNS[ix]?.two;
  return g;
}

// ============================================================================ characters

type Hair = 'short' | 'slick' | 'bun' | 'bald' | 'curly' | 'none';
interface Spec {
  skin: number;
  /** -1 = the player's paint */
  top: number; sleeve?: number; pants: number; shoes?: number; glove?: number;
  hair: Hair; hairColor: number; brow: number;
  nose?: number; mustache?: number; bigMustache?: boolean; beard?: number; bigBeard?: boolean;
  eyewear?: 'round' | 'shades' | 'mask';
  belly?: number; skirt?: number; coat?: number;
  extras: string[];
  /** Shoulder half-width. */
  shoulder: number;
}
const ACCENT = -1;
const SPECS: Record<string, Spec> = {
  guard: { skin: 0xe0ac8a, top: ACCENT, pants: 0x1f2a44, hair: 'short', hairColor: 0x3b2a1e, brow: 0x2a1d14, mustache: 0x3b2a1e, extras: ['belt', 'badge', 'tie', 'radio', 'torch'], shoulder: 0.215 },
  granny: { skin: 0xf0c8a8, top: ACCENT, pants: 0x8d7fb3, skirt: 0x8d7fb3, shoes: 0x6b4a3a, hair: 'bun', hairColor: 0xdedbd6, brow: 0xbdb8b0, eyewear: 'round', extras: ['pearls', 'handbag', 'buttons'], shoulder: 0.19, belly: 0.3 },
  janitor: { skin: 0xc68a62, top: 0x7aa0c4, pants: ACCENT, hair: 'bald', hairColor: 0x4a3626, brow: 0x3a2a1c, beard: 0x4a3626, nose: 1.3, extras: ['overalls', 'keys', 'mop'], shoulder: 0.225, belly: 0.9 },
  exterminator: { skin: 0xd9a27e, top: 0xf2c230, pants: 0xf2c230, shoes: 0x22252b, glove: 0x22252b, hair: 'none', hairColor: 0, brow: 0x2a1d14, eyewear: 'mask', extras: ['hood', 'tank', 'stripes'], shoulder: 0.225 },
  detective: { skin: 0xe8b896, top: 0x9b7b52, pants: 0x4a3f35, coat: 0x9b7b52, hair: 'slick', hairColor: 0x2b1f17, brow: 0x2b1f17, nose: 1.9, mustache: 0x2b1f17, bigMustache: true, extras: ['scarf', 'collar'], shoulder: 0.215 },
  agent: { skin: 0x8a5a3c, top: 0x16181d, pants: 0x16181d, hair: 'short', hairColor: 0x111111, brow: 0x111111, eyewear: 'shades', extras: ['shirt', 'tie', 'earpiece'], shoulder: 0.225 },
  santa: { skin: 0xf2c2a0, top: 0xc8202a, pants: 0xc8202a, shoes: 0x16181d, glove: 0x16181d, hair: 'curly', hairColor: 0xf4f4f4, brow: 0xf4f4f4, beard: 0xf4f4f4, bigBeard: true, mustache: 0xf4f4f4, nose: 1.3, extras: ['santaBelt', 'fur'], shoulder: 0.22, belly: 1.4 },
  mascot: { skin: 0x8a5a33, top: 0x8a5a33, pants: 0x8a5a33, shoes: 0x8a5a33, glove: 0x8a5a33, hair: 'none', hairColor: 0, brow: 0, extras: ['tummy', 'shirtAccent'], shoulder: 0.23, belly: 1.3 },
};

const fur = (hex: number) => G2(`fur${hex}`, () => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 1, sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color(hex).multiplyScalar(1.6) }));

/** What a character's hands and sleeves look like (the first-person arms use it too). */
function handMats(charIx: number, paintIx: number): { hand: THREE.Material; sleeve: THREE.Material; robot: boolean; cuff?: THREE.Material } {
  const id = (CHARS[charIx] ?? CHARS[0]).id.slice(5);
  if (id === 'robot') return { hand: rubber, sleeve: finish(paintIx), robot: true };
  const sp = SPECS[id], acc = finish(paintIx);
  const pick = (hex: number | undefined, fallback: number) => { const h = hex ?? fallback; return h === ACCENT ? acc : id === 'mascot' ? fur(h) : cloth(h); };
  return { hand: sp.glove !== undefined ? (id === 'mascot' ? fur(sp.glove) : cloth(sp.glove, 0.6)) : skinMat(sp.skin), sleeve: pick(sp.sleeve, sp.top), robot: false, cuff: id === 'santa' ? fur(0xf4f4f4) : undefined };
}

/** A closed fist around a grip (right hand), in forearm space: the forearm runs along -Y, the grip along +Z. */
function fist(mat: THREE.Material, fingers: boolean, mirror = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(rbox(0.075, 0.085, 0.085, 0.03), mat, 0, -0.03, -0.01));
  const thumb = mesh(capsule(0.016, 0.035), mat, 0.035 * mirror, -0.05, 0.02); thumb.rotation.x = fingers ? Math.PI / 2 : -0.5; g.add(thumb);
  if (fingers) { g.add(mesh(capsule(0.016, 0.07), mat, 0, -0.1, 0.01)); thumb.position.set(0.012 * mirror, -0.045, 0.05); }
  return g;
}

function buildHumanHead(head: THREE.Group, sp: Spec, id: string): { hatY: number; hatScale: number } {
  if (id === 'mascot') {
    const f = fur(0x8a5a33), tan = fur(0xe0b07a);
    head.add(mesh(tube(0.06, 0.07, 0.07), f, 0, 0.0, 0));
    const big = mesh(ball(0.24), f, 0, 0.2, 0); big.scale.set(1, 0.92, 0.95); head.add(big);
    for (const s of [-1, 1]) { head.add(mesh(ball(0.075), f, s * 0.17, 0.39, -0.02), mesh(ball(0.045), tan, s * 0.17, 0.39, 0.03)); }
    const snout = mesh(ball(0.11), tan, 0, 0.12, 0.17); snout.scale.set(1.1, 0.8, 0.8); head.add(snout);
    head.add(mesh(ball(0.035), pupilMat, 0, 0.16, 0.255));
    for (const s of [-1, 1]) { head.add(mesh(ball(0.045), eyeWhiteMat, s * 0.085, 0.25, 0.19), mesh(ball(0.026), pupilMat, s * 0.08, 0.25, 0.228)); }
    const smile = mesh(G('msmile', () => new THREE.TorusGeometry(0.05, 0.008, 6, 16, Math.PI)), pupilMat, 0, 0.1, 0.245); smile.rotation.z = Math.PI; head.add(smile);
    return { hatY: 0.25, hatScale: 1.55 };
  }
  const skin = skinMat(sp.skin), C = 0.16;
  head.add(mesh(tube(0.05, 0.056, 0.08), skin, 0, 0.01, 0));
  const skull = mesh(G('hskull', () => new THREE.SphereGeometry(0.125, 36, 24)), skin, 0, C, 0); skull.scale.set(0.94, 1.08, 1); head.add(skull);
  const jaw = mesh(ball(0.095), skin, 0, C - 0.055, 0.025); jaw.scale.set(1, 0.85, 1); head.add(jaw);
  for (const s of [-1, 1]) { const ear = mesh(ball(0.028), skin, s * 0.118, C - 0.005, -0.005); ear.scale.set(0.45, 1, 0.75); head.add(ear); }
  // face
  const eyeY = C + 0.015;
  if (sp.eyewear !== 'mask') for (const s of [-1, 1]) {
    const w = mesh(ball(0.021), eyeWhiteMat, s * 0.042, eyeY, 0.104); w.scale.set(1, 0.9, 0.55);
    head.add(w, mesh(ball(0.011), pupilMat, s * 0.042, eyeY, 0.114));
    const brow = mesh(rbox(0.048, 0.013, 0.016, 0.005), cloth(sp.brow, 0.95), s * 0.044, eyeY + 0.038, 0.108); brow.rotation.z = s * -0.12; head.add(brow);
  }
  const nose = mesh(ball(0.022 * (sp.nose ?? 1)), skin, 0, C - 0.02, 0.12 + 0.008 * ((sp.nose ?? 1) - 1)); nose.scale.set(0.8, 1, 1.15); head.add(nose);
  if (sp.eyewear !== 'mask') head.add(mesh(rbox(0.042, 0.009, 0.012, 0.004), lipMat, 0, C - 0.072, 0.105));
  if (sp.beard !== undefined) {
    const bm = cloth(sp.beard, 0.95);
    if (sp.bigBeard) { const b = mesh(ball(0.115), bm, 0, C - 0.11, 0.05); b.scale.set(1.05, 1.25, 0.8); head.add(b); }
    else { const b = mesh(ball(0.085), bm, 0, C - 0.085, 0.045); b.scale.set(1.05, 0.85, 0.8); head.add(b); }
  }
  if (sp.mustache !== undefined) for (const s of [-1, 1]) {
    const big = sp.bigMustache ? 1.5 : 1;
    const m = mesh(capsule(0.011 * big, 0.035 * big), cloth(sp.mustache, 0.9), s * 0.022 * big, C - 0.052, 0.113); m.rotation.z = s * (Math.PI / 2 - 0.35); head.add(m);
  }
  // hair
  const hm = cloth(sp.hairColor, 0.9);
  const cap = G('hairCap', () => new THREE.SphereGeometry(0.131, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.42));
  if (sp.hair === 'short' || sp.hair === 'slick' || sp.hair === 'bun') {
    const h = mesh(cap, hm, 0, C + 0.008, -0.01); h.scale.set(0.97, 1.1, 1.04); h.rotation.x = -0.32; head.add(h);
    const back = mesh(ball(0.118), hm, 0, C + 0.0, -0.035); back.scale.set(0.98, 1.0, 0.95); head.add(back);
    if (sp.hair === 'slick') { const q = mesh(capsule(0.03, 0.08), hm, 0.04, C + 0.115, 0.06); q.rotation.z = Math.PI / 2; q.rotation.y = 0.4; head.add(q); }
    if (sp.hair === 'bun') head.add(mesh(ball(0.055), hm, 0, C + 0.12, -0.08));
  } else if (sp.hair === 'bald') {
    for (const s of [-1, 1]) { const t = mesh(ball(0.05), hm, s * 0.1, C + 0.0, -0.045); t.scale.set(0.55, 0.8, 1); head.add(t); }
  } else if (sp.hair === 'curly') {
    for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2; head.add(mesh(ball(0.045), hm, Math.cos(a) * 0.105, C + 0.0 + (Math.sin(a) > 0 ? -0.02 : 0.03), Math.sin(a) * 0.1 - 0.02)); }
  }
  // eyewear
  if (sp.eyewear === 'round') {
    for (const s of [-1, 1]) head.add(mesh(G('glassRing', () => new THREE.TorusGeometry(0.026, 0.004, 8, 24)), gold, s * 0.044, eyeY, 0.122));
    head.add(mesh(rbox(0.03, 0.004, 0.004, 0.001), gold, 0, eyeY + 0.005, 0.124));
  } else if (sp.eyewear === 'shades') {
    for (const s of [-1, 1]) head.add(mesh(rbox(0.055, 0.032, 0.008, 0.008), glass, s * 0.043, eyeY, 0.118));
    head.add(mesh(rbox(0.05, 0.008, 0.008, 0.002), glass, 0, eyeY + 0.01, 0.12));
    for (const s of [-1, 1]) head.add(mesh(rbox(0.006, 0.006, 0.12, 0.002), glass, s * 0.11, eyeY + 0.008, 0.06));
  } else if (sp.eyewear === 'mask') {
    const mk = cloth(0x2b2f36, 0.6);
    const face = mesh(ball(0.11), mk, 0, C - 0.02, 0.03); face.scale.set(1.0, 1.0, 0.9); head.add(face);
    for (const s of [-1, 1]) { head.add(rz(mesh(tube(0.032, 0.032, 0.03), mk, s * 0.045, eyeY, 0.11)), rz(mesh(tube(0.026, 0.026, 0.004), glass, s * 0.045, eyeY, 0.126))); }
    head.add(rz(mesh(tube(0.035, 0.04, 0.05), mk, 0, C - 0.06, 0.12)));
    for (const s of [-1, 1]) { const f = mesh(tube(0.03, 0.03, 0.05), plastic(0x9aa3ad), s * 0.06, C - 0.075, 0.11); f.rotation.z = s * 1.1; f.rotation.x = 0.4; head.add(f); }
  }
  if (sp.extras.includes('hood')) { const h = mesh(ball(0.142), cloth(sp.top, 0.6), 0, C + 0.01, -0.02); h.scale.set(1, 1.08, 1.05); head.add(h); }
  if (sp.extras.includes('earpiece')) head.add(mesh(ball(0.012), plastic(0x2a2d33), 0.122, C - 0.01, 0.0), mesh(tube(0.003, 0.003, 0.12), plastic(0xd8dde4), 0.12, C - 0.08, -0.02));
  return { hatY: C + 0.02, hatScale: 0.9 };
}

export interface Pose { time: number; stepT: number; move: number; pitch: number; air: boolean; dizzy: boolean; kick: number; }

export class HunterRig {
  root = new THREE.Group();
  private torso = new THREE.Group(); private head = new THREE.Group();
  private armR = new THREE.Group(); private armL = new THREE.Group(); private foreR = new THREE.Group(); private foreL = new THREE.Group();
  private legL = new THREE.Group(); private legR = new THREE.Group(); private shinL = new THREE.Group(); private shinR = new THREE.Group();
  private spin: THREE.Object3D | null = null;
  private bob: THREE.Object3D | null = null;
  private torsoY = 0.86;
  /** Held in both hands: the other arm reaches for the front of the blaster. */
  private two = false;
  /** Where the shot leaves the blaster (world position via getWorldPosition). */
  muzzle: THREE.Object3D;

  /** `paintIx`, `hat`, `charIx` and `gunIx` index PAINTS, HATS, CHARS and GUNS (a player's kit). */
  constructor(paintIx = 0, hat = 0, charIx = 0, gunIx = 0) {
    const body = finish(paintIx);
    const id = (CHARS[charIx] ?? CHARS[0]).id.slice(5);
    const gun = buildGun(gunIx, body);
    this.two = !!gun.userData.two;
    if (id === 'robot') this.buildRobot(body, hat);
    else this.buildHuman(SPECS[id] ?? SPECS.guard, id, body, hat, charIx, paintIx, !!gun.userData.fingers);
    // barrel along the forearm (-Y), grip towards forearm -Z, which is down while the arm is raised to aim
    gun.rotation.set(Math.PI / 2, Math.PI, 0); gun.position.set(0, id === 'robot' ? -0.28 : -0.265, id === 'robot' ? 0.08 : 0.07);
    this.foreR.add(gun);
    this.muzzle = gun.getObjectByName('muzzle') ?? gun;
    this.pose({ time: 0, stepT: 0, move: 0, pitch: 0, air: false, dizzy: false, kick: 0 });
  }

  private buildRobot(body: THREE.Material, hat: number) {
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
    this.addHat(hat, body, 0.16, 1);
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
  }

  private buildHuman(sp: Spec, id: string, accent: THREE.Material, hat: number, charIx: number, paintIx: number, fingers: boolean) {
    const mascot = id === 'mascot';
    const mat = (hex: number, rough = 0.85) => (hex === ACCENT ? accent : mascot ? fur(hex) : cloth(hex, rough));
    const top = mat(sp.top), pants = mat(sp.pants), shoes = sp.shoes !== undefined ? (mascot ? fur(sp.shoes) : cloth(sp.shoes, 0.4)) : shoeMat;
    const hm = handMats(charIx, paintIx);
    // legs
    for (const [leg, shin, sx] of [[this.legL, this.shinL, -1], [this.legR, this.shinR, 1]] as [THREE.Group, THREE.Group, number][]) {
      leg.position.set(sx * 0.1, 0.83, 0);
      leg.add(mesh(ball(0.085), pants), mesh(capsule(0.076, 0.24), pants, 0, -0.2, 0));
      shin.position.y = -0.4;
      shin.add(mesh(ball(0.068), pants), mesh(tube(0.066, 0.054, 0.3), pants, 0, -0.17, 0));
      const shoe = mesh(rbox(0.11, 0.075, mascot ? 0.27 : 0.24, 0.035), shoes, 0, -0.375, 0.04); shin.add(shoe);
      if (id === 'santa') shin.add(mesh(tube(0.07, 0.07, 0.07), shoes, 0, -0.3, 0));
      leg.add(shin);
      this.root.add(leg);
    }
    // hips; a skirt or a coat hangs from them
    const pelvis = mesh(capsule(0.11, 0.1), pants, 0, 0.85, 0); pelvis.rotation.z = Math.PI / 2; pelvis.scale.z = 0.9; this.root.add(pelvis);
    if (sp.skirt !== undefined) this.root.add(mesh(G('skirt', () => new THREE.CylinderGeometry(0.15, 0.25, 0.42, 28, 1, true)), mat(sp.skirt), 0, 0.68, 0));
    if (sp.coat !== undefined) {
      const c = mesh(G('coat', () => new THREE.CylinderGeometry(0.17, 0.23, 0.48, 28, 1, true, 0.35, Math.PI * 2 - 0.7)), mat(sp.coat), 0, 0.64, 0);
      c.material = G2(`coatD${sp.coat}`, () => { const m = (mat(sp.coat!) as THREE.MeshStandardMaterial).clone(); m.side = THREE.DoubleSide; return m; });
      this.root.add(c);
    }
    // torso
    this.torsoY = 0.86;
    this.torso.position.y = this.torsoY;
    const w = sp.shoulder / 0.215, bl = sp.belly ?? 0;
    const chestGeo = G(`hchest${w.toFixed(3)}_${bl}`, () => {
      const pts = [[0.001, 0.0], [0.15 + 0.02 * bl, 0.0], [0.155 + 0.05 * bl, 0.1], [0.165 + 0.045 * bl, 0.22], [0.19 + 0.01 * bl, 0.38], [0.2, 0.445], [0.15, 0.5], [0.07, 0.53], [0.001, 0.535]].map(([r, y]) => new THREE.Vector2(r, y));
      const geo = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(24), 28).scale(w, 1, 0.68);
      // push the belly forward (front half only), so it reads from the side without widening the back
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i), y = pos.getY(i); if (z > 0) pos.setZ(i, z * (1 + 0.32 * bl * Math.max(0, 1 - Math.abs(y - 0.16) / 0.22))); }
      geo.computeVertexNormals();
      return geo;
    });
    this.torso.add(mesh(chestGeo, top));
    const front = 0.11 + bl * 0.07;
    const X = sp.extras;
    if (X.includes('belt') || X.includes('santaBelt')) {
      const belt = mesh(G('belt', () => new THREE.TorusGeometry(0.15, 0.022, 8, 28).rotateX(Math.PI / 2)), cloth(0x17181c, 0.4), 0, 0.03, 0.0); belt.scale.set(w * 1.03, 1, 0.75 + (sp.belly ?? 0) * 0.12); this.torso.add(belt);
      this.torso.add(mesh(rbox(X.includes('santaBelt') ? 0.07 : 0.045, 0.045, 0.012, 0.006), gold, 0, 0.03, 0.12 + (sp.belly ?? 0) * 0.04));
    }
    if (X.includes('badge')) this.torso.add(mesh(G('badge', () => new THREE.CylinderGeometry(0.022, 0.022, 0.008, 6).rotateX(Math.PI / 2)), gold, -0.075, 0.38, 0.118));
    if (X.includes('radio')) this.torso.add(mesh(rbox(0.035, 0.05, 0.02, 0.008), plastic(0x22252b), 0.085, 0.4, 0.112), mesh(tube(0.004, 0.004, 0.04), plastic(0x22252b), 0.095, 0.44, 0.112));
    if (X.includes('torch')) this.torso.add(mesh(rbox(0.03, 0.09, 0.03, 0.01), plastic(0x2a2d33), -0.15, -0.0, 0.07));
    if (X.includes('shirt')) this.torso.add(mesh(rbox(0.07, 0.17, 0.01, 0.004), cloth(0xf4f4f0, 0.6), 0, 0.42, 0.115));
    if (X.includes('tie')) { const t = mesh(rbox(0.032, 0.2, 0.01, 0.006), cloth(id === 'agent' ? 0x0d0e10 : 0x7a1f2a, 0.5), 0, 0.37, 0.124); t.rotation.x = -0.06; this.torso.add(t, mesh(rbox(0.03, 0.025, 0.014, 0.006), t.material as THREE.Material, 0, 0.47, 0.12)); }
    if (X.includes('pearls')) for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; this.torso.add(mesh(ball(0.011), eyeWhiteMat, Math.cos(a) * 0.075, 0.5 - Math.max(0, Math.sin(a)) * 0.02, Math.sin(a) * 0.065)); }
    if (X.includes('buttons')) for (let k = 0; k < 4; k++) this.torso.add(mesh(ball(0.009), gold, 0, 0.12 + k * 0.09, front + 0.02 + (k === 0 ? 0.02 : 0)));
    if (X.includes('overalls')) {
      this.torso.add(mesh(rbox(0.17, 0.2, 0.02, 0.01), accent, 0, 0.2, front + 0.02), mesh(rbox(0.06, 0.04, 0.008, 0.004), cloth(0xf4f4f0, 0.5), 0, 0.25, front + 0.035));
      for (const s of [-1, 1]) this.torso.add(mesh(rbox(0.035, 0.24, 0.012, 0.004), accent, s * 0.075, 0.4, 0.11));
    }
    if (X.includes('keys')) for (let k = 0; k < 3; k++) { const key = mesh(rbox(0.01, 0.04, 0.004, 0.002), gold, 0.14 + k * 0.012, -0.02 - k * 0.006, 0.08); key.rotation.z = (k - 1) * 0.4; this.torso.add(key); }
    if (X.includes('mop')) {
      const mop = new THREE.Group(); mop.position.set(0, 0.25, -0.14); mop.rotation.z = 0.6;
      mop.add(mesh(tube(0.012, 0.012, 1.0), matte(0xc8a06a, 0.6), 0, 0, 0));
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; const s = mesh(capsule(0.016, 0.14), cloth(0xe8e0cc, 1), Math.cos(a) * 0.03, -0.56, Math.sin(a) * 0.03); s.rotation.z = Math.cos(a) * 0.3; mop.add(s); }
      this.torso.add(mop);
    }
    if (X.includes('tank')) {
      this.torso.add(mesh(capsule(0.07, 0.22), accent, 0.0, 0.3, -0.16), mesh(rbox(0.2, 0.03, 0.03, 0.01), cloth(0x2b2f36, 0.5), 0, 0.18, -0.12));
      this.torso.add(limb(V(0.05, 0.16, -0.18), V(0.17, 0.02, -0.02), 0.012, cloth(0x2b2f36, 0.5)));
    }
    if (X.includes('stripes')) for (const y of [0.05, 0.3]) { const r = mesh(G('stripe', () => new THREE.TorusGeometry(0.16, 0.012, 6, 28).rotateX(Math.PI / 2)), glow(2.2, 2.2, 2.0), 0, y, 0); r.scale.set(w * 1.02 + (y < 0.1 ? -0.03 : 0.12), 1, 0.72); this.torso.add(r); }
    if (X.includes('scarf')) { this.torso.add(mesh(G('scarf', () => new THREE.TorusGeometry(0.075, 0.03, 10, 24).rotateX(Math.PI / 2)), accent, 0, 0.51, 0.005)); const tail = mesh(rbox(0.05, 0.2, 0.02, 0.01), accent, 0.06, 0.4, 0.1); tail.rotation.z = 0.15; this.torso.add(tail); }
    if (X.includes('collar')) for (const s of [-1, 1]) { const c = mesh(rbox(0.08, 0.1, 0.012, 0.006), mat(sp.coat ?? sp.top), s * 0.07, 0.5, 0.06); c.rotation.set(-0.5, 0, s * 0.5); this.torso.add(c); }
    if (X.includes('fur')) {
      const f = fur(0xf4f4f4);
      const hem = mesh(G('furHem', () => new THREE.TorusGeometry(0.16, 0.03, 8, 28).rotateX(Math.PI / 2)), f, 0, -0.03, 0.01); hem.scale.set(w * 1.08, 1, 0.95); this.torso.add(hem);
      this.torso.add(mesh(rbox(0.05, 0.42, 0.02, 0.01), f, 0, 0.27, front + 0.03));
    }
    if (X.includes('tummy')) { const t = mesh(ball(0.13), fur(0xe0b07a), 0, 0.18, front - 0.04); t.scale.set(1, 1.1, 0.45); this.torso.add(t); }
    if (X.includes('shirtAccent')) { const s = mesh(G('mshirt', () => new THREE.TorusGeometry(0.155, 0.04, 8, 28).rotateX(Math.PI / 2)), accent, 0, 0.42, 0); s.scale.set(w * 1.05, 1, 0.75); this.torso.add(s); }
    this.root.add(this.torso);
    // head
    this.head.position.y = 0.52;
    const { hatY, hatScale } = buildHumanHead(this.head, sp, id);
    this.addHat(hat, accent, hatY, hatScale);
    this.torso.add(this.head);
    // arms
    for (const [arm, fore, sx] of [[this.armL, this.foreL, -1], [this.armR, this.foreR, 1]] as [THREE.Group, THREE.Group, number][]) {
      arm.position.set(sx * sp.shoulder, 0.455, 0);
      arm.add(mesh(ball(0.06), hm.sleeve), mesh(capsule(0.056, 0.17), hm.sleeve, 0, -0.14, 0));
      fore.position.y = -0.29;
      fore.add(mesh(ball(0.05), hm.sleeve), mesh(tube(0.05, 0.044, 0.22), hm.sleeve, 0, -0.12, 0));
      if (hm.cuff) fore.add(mesh(tube(0.056, 0.056, 0.04), hm.cuff, 0, -0.22, 0));
      fore.add(mesh(tube(0.033, 0.036, 0.05), hm.hand, 0, -0.24, 0)); // wrist
      const f = fist(hm.hand, sx > 0 && fingers, sx); f.position.set(0, -0.255, 0.0); fore.add(f);
      arm.add(fore);
      this.torso.add(arm);
    }
    if (X.includes('handbag')) {
      const bag = new THREE.Group(); bag.position.set(0, -0.2, 0.0);
      bag.add(mesh(G('strap', () => new THREE.TorusGeometry(0.05, 0.006, 6, 20, Math.PI)), cloth(0x5a2a3a, 0.5), 0, -0.04, 0));
      bag.add(mesh(rbox(0.14, 0.1, 0.06, 0.02), cloth(0x8a2f4a, 0.45), 0, -0.12, 0), mesh(ball(0.01), gold, 0, -0.08, 0.032));
      this.foreL.add(bag);
    }
  }

  private addHat(hat: number, accent: THREE.Material, y: number, scale: number) {
    const hatGroup = buildHat(hat, accent); hatGroup.position.y = y; hatGroup.scale.setScalar(scale); this.head.add(hatGroup);
    this.spin = hatGroup.getObjectByName('spin') ?? null;
    this.bob = hatGroup.getObjectByName('bob') ?? null;
  }

  pose(p: Pose) {
    const ph = p.stepT * 0.8, s = Math.sin(ph), c = Math.cos(ph), m = p.move;
    // legs: swing from the hip, fold the knee on the way forward; tuck both in the air
    const air = p.air ? 1 : 0;
    this.legL.rotation.x = -s * 0.75 * m - air * 0.5; this.legR.rotation.x = s * 0.75 * m - air * 0.25;
    this.shinL.rotation.x = Math.max(0, c) * 1.05 * m + air * 0.9; this.shinR.rotation.x = Math.max(0, -c) * 1.05 * m + air * 0.5;
    // torso: lean into the run, counter-rotate against the legs, breathe when idle
    const breathe = Math.sin(p.time * 2.1) * 0.012 * (1 - m);
    this.torso.position.y = this.torsoY + breathe - Math.abs(c) * 0.025 * m;
    this.torso.rotation.set(0.1 * m + (p.dizzy ? Math.sin(p.time * 7) * 0.2 : 0), s * 0.12 * m, p.dizzy ? Math.cos(p.time * 6) * 0.18 : 0);
    this.head.rotation.set(-p.pitch * 0.55 + (p.dizzy ? Math.sin(p.time * 9) * 0.25 : 0), -s * 0.1 * m, 0);
    // gun arm tracks the aim; the other swings with the stride, or steadies a two-handed blaster
    this.armR.rotation.set(-Math.PI / 2 - p.pitch + 0.1 * m - p.kick * 0.5, -0.08, 0.05);
    this.foreR.rotation.x = -0.05 - p.kick * 0.25;
    if (this.two) {
      this.armL.rotation.set(-Math.PI / 2 - p.pitch + 0.25 - p.kick * 0.4, 0, 0.62);
      this.foreL.rotation.x = -0.45 - p.kick * 0.2;
    } else {
      this.armL.rotation.set(s * 0.7 * m + 0.12, 0, -0.12);
      this.foreL.rotation.x = -0.35 - Math.max(0, s) * 0.5 * m;
    }
    if (this.spin) this.spin.rotation.y = p.time * (4 + m * 14);
    if (this.bob) this.bob.position.y = 0.32 + Math.sin(p.time * 2.4) * 0.012;
  }
}

/**
 * The first-person view: the blaster with the hand that holds it and the forearm running off the bottom right
 * of the screen (and, for a two-handed blaster, the other hand on the front of it), in the character's sleeves.
 * The blaster's muzzle node is kept, so the flash can sit on it.
 */
export function buildViewmodel(paintIx = 0, charIx = 0, gunIx = 0): THREE.Group {
  const g = new THREE.Group();
  const gun = buildGun(gunIx, finish(paintIx));
  g.add(gun);
  const hm = handMats(charIx, paintIx);
  const fingers = !!gun.userData.fingers, two = !!gun.userData.two;
  // the right hand closes around the grip; the wrist and forearm run back and down out of frame
  const hand = new THREE.Group(); hand.position.set(0.0, -0.085, -0.02); hand.rotation.x = fingers ? 0 : 0.28; // follows the grip's rake
  if (hm.robot) hand.add(mesh(ball(0.062), hm.hand, 0, 0, 0));
  else {
    hand.add(mesh(rbox(0.088, 0.125, 0.094, 0.038), hm.hand, 0.003, -0.01, 0.0));
    if (fingers) {
      const f = mesh(capsule(0.017, 0.08), hm.hand, 0.0, 0.07, -0.05); f.rotation.x = Math.PI / 2; hand.add(f);
      const t = mesh(capsule(0.017, 0.04), hm.hand, -0.034, 0.08, 0.0); hand.add(t);
    } else {
      const t = mesh(capsule(0.017, 0.05), hm.hand, -0.046, 0.045, -0.03); t.rotation.x = Math.PI / 2 - 0.25; hand.add(t);
      for (let k = 0; k < 3; k++) { const f = mesh(capsule(0.016, 0.05), hm.hand, 0.004, 0.03 - k * 0.03, -0.05); f.rotation.z = Math.PI / 2; hand.add(f); }
    }
  }
  g.add(hand);
  const wrist = V(0.01, -0.13, 0.05), cuffAt = V(0.04, -0.16, 0.11), elbow = V(0.32, -0.34, 0.4);
  g.add(limb(wrist, cuffAt, hm.robot ? 0.05 : 0.036, hm.hand));
  g.add(limb(cuffAt, elbow, hm.robot ? 0.06 : 0.055, hm.sleeve));
  if (hm.cuff) g.add(limb(cuffAt, V(0.04, -0.19, 0.15), 0.062, hm.cuff));
  if (two) {
    const fz = gunIx >= 0 && GUNS[gunIx]?.id === 'gun.blower' ? -0.3 : -0.27;
    const lh = mesh(hm.robot ? ball(0.055) : rbox(0.075, 0.07, 0.1, 0.03), hm.hand, -0.035, -0.07, fz); g.add(lh);
    g.add(limb(V(-0.05, -0.1, fz + 0.05), V(-0.3, -0.36, 0.25), hm.robot ? 0.058 : 0.05, hm.sleeve));
  }
  // the big ones sit further out, so they do not fill the screen
  const blower = GUNS[gunIx]?.id === 'gun.blower', reach = blower ? 0.22 : two ? 0.1 : 0;
  g.position.set(-reach * 0.15, blower ? 0.03 : 0, -reach);
  if (blower) g.scale.setScalar(0.7);
  g.traverse((o) => { o.castShadow = false; });
  return g;
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

/** A wardrobe paint as a material (for thumbnails). */
export const paintMat = (ix: number): THREE.Material => finish(ix);
