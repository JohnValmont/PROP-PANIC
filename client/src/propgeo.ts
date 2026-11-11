/**
 * Procedural toy models. Every prop is a handful of primitives merged into ONE vertex-coloured
 * geometry, so a whole store of toys renders in ~30 instanced draw calls and the game ships with
 * zero downloaded art assets. Each model is normalised to exactly fill its catalog box, so what
 * you see is precisely what the server hit-tests. Front of every model faces +Z.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROPS, PROP_INDEX } from '../../shared/props';
import { HATS, HUNTER_COLORS } from '../../shared/constants';

type G = THREE.BufferGeometry;
const tmpC = new THREE.Color();
const E = new THREE.Euler();
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const S = new THREE.Vector3();

function fin(g: G, color: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): G {
  const out = g.index ? g.toNonIndexed() : g;
  M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz));
  out.applyMatrix4(M);
  tmpC.set(color);
  const n = out.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = tmpC.r; arr[i * 3 + 1] = tmpC.g; arr[i * 3 + 2] = tmpC.b; }
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}

export const box = (w: number, h: number, d: number, c: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) =>
  fin(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);
export const cyl = (rt: number, rb: number, h: number, c: number, x = 0, y = 0, z = 0, rx = 0, rz = 0, seg = 11) =>
  fin(new THREE.CylinderGeometry(rt, rb, h, seg), c, x, y, z, rx, 0, rz);
export const sph = (r: number, c: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) =>
  fin(new THREE.SphereGeometry(r, 11, 7), c, x, y, z, rx, 0, rz, sx, sy, sz);
export const cone = (r: number, h: number, c: number, x = 0, y = 0, z = 0, rx = 0, rz = 0, seg = 9) =>
  fin(new THREE.ConeGeometry(r, h, seg), c, x, y, z, rx, 0, rz);
export const tor = (R: number, r: number, c: number, x = 0, y = 0, z = 0, rx = Math.PI / 2) =>
  fin(new THREE.TorusGeometry(R, r, 6, 14), c, x, y, z, rx);

const RED = 0xef476f, BLUE = 0x118ab2, YEL = 0xffd166, GRN = 0x06d6a0, PUR = 0x9b5de5, ORG = 0xf78c2b;
const WHT = 0xfdfdfd, BLK = 0x22223b, CREAM = 0xfff3d6, TAN = 0xd9a86c, TAN2 = 0xb98a50, BROWN = 0x9c6644, GREY = 0x8d99ae, DGREY = 0x4a4e69;
const H = Math.PI / 2;

function teddy(fur: number, belly: number, bow: number): G[] {
  return [
    sph(0.3, fur, 0, 0.36, 0, 1, 1.1, 0.85), sph(0.17, belly, 0, 0.36, 0.17, 1, 1.1, 0.6),
    sph(0.22, fur, 0, 0.8, 0.02), sph(0.09, fur, -0.17, 0.97, 0), sph(0.09, fur, 0.17, 0.97, 0),
    sph(0.05, belly, -0.17, 0.97, 0.05), sph(0.05, belly, 0.17, 0.97, 0.05),
    sph(0.1, belly, 0, 0.75, 0.19, 1, 0.8, 0.8), sph(0.035, BLK, 0, 0.79, 0.27),
    sph(0.028, BLK, -0.08, 0.86, 0.2), sph(0.028, BLK, 0.08, 0.86, 0.2),
    sph(0.11, fur, -0.33, 0.45, 0.06, 0.8, 1.5, 0.8, 0, 0.5), sph(0.11, fur, 0.33, 0.45, 0.06, 0.8, 1.5, 0.8, 0, -0.5),
    sph(0.13, fur, -0.18, 0.1, 0.2, 1, 0.75, 1.4), sph(0.13, fur, 0.18, 0.1, 0.2, 1, 0.75, 1.4),
    sph(0.07, belly, -0.18, 0.1, 0.36, 1, 1, 0.4), sph(0.07, belly, 0.18, 0.1, 0.36, 1, 1, 0.4),
    box(0.2, 0.08, 0.05, bow, 0, 0.6, 0.22), sph(0.04, bow, 0, 0.6, 0.25),
  ];
}

function block(frame: number, panel: number, mark: number, s: number): G[] {
  const h = s / 2, i = s * 0.74, t = 0.012;
  const out = [box(s, s, s, frame, 0, h, 0)];
  out.push(box(i, i, t, panel, 0, h, h), box(i, i, t, panel, 0, h, -h), box(t, i, i, panel, h, h, 0), box(t, i, i, panel, -h, h, 0), box(i, t, i, panel, 0, s, 0));
  out.push(cyl(s * 0.2, s * 0.2, t * 3, mark, 0, h, h, H), cyl(s * 0.2, s * 0.2, t * 3, mark, 0, h, -h, H));
  out.push(box(t * 3, s * 0.4, s * 0.12, mark, h, h, 0), box(t * 3, s * 0.12, s * 0.4, mark, h, h, 0));
  out.push(box(t * 3, s * 0.4, s * 0.12, mark, -h, h, 0), box(t * 3, s * 0.12, s * 0.4, mark, -h, h, 0));
  out.push(box(s * 0.4, t * 3, s * 0.12, mark, 0, s, 0), box(s * 0.12, t * 3, s * 0.4, mark, 0, s, 0));
  return out;
}

function ball(): G[] {
  const g = new THREE.SphereGeometry(0.3, 18, 9).toNonIndexed();
  const pos = g.attributes.position;
  const cols = [RED, WHT, BLUE, WHT, YEL, WHT].map((c) => new THREE.Color(c));
  const arr = new Float32Array(pos.count * 3);
  for (let t = 0; t < pos.count; t += 3) {
    const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3, cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const c = cols[Math.floor(((Math.atan2(cz, cx) + Math.PI) / (Math.PI * 2)) * 6 - 1e-6) % 6];
    for (let k = 0; k < 3; k++) { arr[(t + k) * 3] = c.r; arr[(t + k) * 3 + 1] = c.g; arr[(t + k) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.translate(0, 0.3, 0);
  return [g, cyl(0.05, 0.05, 0.02, WHT, 0, 0.6, 0)];
}

const BUILD: Record<string, () => G[]> = {
  duck: () => [
    sph(0.25, YEL, 0, 0.2, -0.02, 0.95, 0.8, 1.15), sph(0.155, YEL, 0, 0.4, 0.13),
    box(0.13, 0.045, 0.13, ORG, 0, 0.37, 0.28), cone(0.09, 0.16, YEL, 0, 0.3, -0.3, -1.1),
    sph(0.028, BLK, 0.075, 0.45, 0.25), sph(0.028, BLK, -0.075, 0.45, 0.25),
    sph(0.1, 0xf4c04d, -0.21, 0.2, -0.04, 0.4, 0.7, 1.3), sph(0.1, 0xf4c04d, 0.21, 0.2, -0.04, 0.4, 0.7, 1.3),
  ],
  ball,
  blockA: () => block(RED, CREAM, BLUE, 0.6),
  blockB: () => block(BLUE, CREAM, ORG, 0.6),
  blockC: () => block(YEL, WHT, GRN, 0.9),
  teddy: () => teddy(0xc68b59, 0xf2d0a4, RED),
  bigteddy: () => teddy(0xff9ecd, 0xffe5f1, 0x48cae4),
  robot: () => [
    box(0.13, 0.26, 0.16, DGREY, -0.11, 0.13, 0), box(0.13, 0.26, 0.16, DGREY, 0.11, 0.13, 0),
    box(0.17, 0.06, 0.24, RED, -0.11, 0.03, 0.03), box(0.17, 0.06, 0.24, RED, 0.11, 0.03, 0.03),
    box(0.44, 0.36, 0.3, 0x2ec4b6, 0, 0.45, 0), box(0.26, 0.16, 0.02, YEL, 0, 0.47, 0.16),
    sph(0.03, RED, -0.07, 0.5, 0.17), sph(0.03, GRN, 0, 0.5, 0.17), sph(0.03, BLUE, 0.07, 0.5, 0.17),
    box(0.09, 0.3, 0.12, GREY, -0.27, 0.46, 0), box(0.09, 0.3, 0.12, GREY, 0.27, 0.46, 0),
    sph(0.06, RED, -0.27, 0.28, 0), sph(0.06, RED, 0.27, 0.28, 0),
    box(0.1, 0.05, 0.1, DGREY, 0, 0.655, 0), box(0.34, 0.25, 0.28, WHT, 0, 0.8, 0),
    box(0.26, 0.1, 0.02, BLK, 0, 0.82, 0.145), sph(0.03, YEL, -0.07, 0.82, 0.15), sph(0.03, YEL, 0.07, 0.82, 0.15),
    cyl(0.012, 0.012, 0.1, DGREY, 0, 0.95, 0), sph(0.035, RED, 0, 1.0, 0),
  ],
  rocket: () => [
    cyl(0.2, 0.22, 0.9, WHT, 0, 0.75, 0), cone(0.2, 0.42, RED, 0, 1.41, 0),
    cyl(0.22, 0.16, 0.1, DGREY, 0, 0.25, 0), cyl(0.21, 0.21, 0.1, RED, 0, 0.95, 0), cyl(0.1, 0.1, 0.06, 0x48cae4, 0, 0.9, 0.18, H),
    tor(0.1, 0.02, YEL, 0, 0.9, 0.2, 0),
    box(0.05, 0.45, 0.3, RED, 0, 0.3, -0.27, 0.35), box(0.3, 0.45, 0.05, RED, 0.27, 0.3, 0, 0, 0, 0.35), box(0.3, 0.45, 0.05, RED, -0.27, 0.3, 0, 0, 0, -0.35),
    box(0.05, 0.45, 0.3, RED, 0, 0.3, 0.27, -0.35),
  ],
  car: () => [
    box(0.48, 0.17, 1.0, RED, 0, 0.2, 0), box(0.42, 0.17, 0.46, 0xbde0fe, 0, 0.36, -0.06), box(0.44, 0.03, 0.5, RED, 0, 0.45, -0.06),
    cyl(0.11, 0.11, 0.08, BLK, -0.25, 0.11, 0.3, 0, H), cyl(0.11, 0.11, 0.08, BLK, 0.25, 0.11, 0.3, 0, H),
    cyl(0.11, 0.11, 0.08, BLK, -0.25, 0.11, -0.3, 0, H), cyl(0.11, 0.11, 0.08, BLK, 0.25, 0.11, -0.3, 0, H),
    cyl(0.05, 0.05, 0.1, WHT, -0.25, 0.11, 0.3, 0, H), cyl(0.05, 0.05, 0.1, WHT, 0.25, 0.11, 0.3, 0, H),
    cyl(0.05, 0.05, 0.1, WHT, -0.25, 0.11, -0.3, 0, H), cyl(0.05, 0.05, 0.1, WHT, 0.25, 0.11, -0.3, 0, H),
    sph(0.045, YEL, -0.16, 0.22, 0.5), sph(0.045, YEL, 0.16, 0.22, 0.5), box(0.5, 0.05, 0.05, GREY, 0, 0.13, 0.5), box(0.5, 0.05, 0.05, GREY, 0, 0.13, -0.5),
    box(0.1, 0.02, 0.9, WHT, 0, 0.29, 0.02),
  ],
  drum: () => [
    cyl(0.28, 0.28, 0.4, RED, 0, 0.25, 0, 0, 0, 18), cyl(0.3, 0.3, 0.06, YEL, 0, 0.06, 0, 0, 0, 18), cyl(0.3, 0.3, 0.06, YEL, 0, 0.44, 0, 0, 0, 18),
    cyl(0.26, 0.26, 0.02, CREAM, 0, 0.475, 0, 0, 0, 18),
    cyl(0.012, 0.012, 0.36, BROWN, -0.06, 0.495, 0.02, H, 0.5), cyl(0.012, 0.012, 0.36, BROWN, 0.07, 0.495, -0.02, H, -0.4),
    ...[0, 1, 2, 3, 4, 5].map((i) => box(0.02, 0.36, 0.02, WHT, Math.cos(i * 1.047) * 0.285, 0.25, Math.sin(i * 1.047) * 0.285, 0, 0, i % 2 ? 0.3 : -0.3)),
  ],
  cone: () => [
    box(0.45, 0.05, 0.45, ORG, 0, 0.025, 0), cyl(0.04, 0.17, 0.6, ORG, 0, 0.35, 0),
    cyl(0.083, 0.118, 0.14, WHT, 0, 0.42, 0), cyl(0.127, 0.15, 0.09, WHT, 0, 0.2, 0),
  ],
  boxS: () => [
    box(0.6, 0.48, 0.6, TAN, 0, 0.24, 0), box(0.61, 0.02, 0.61, TAN2, 0, 0.49, 0), box(0.1, 0.03, 0.62, 0xe9d8a6, 0, 0.495, 0),
    box(0.1, 0.16, 0.62, 0xe9d8a6, 0, 0.41, 0), box(0.2, 0.14, 0.01, TAN2, 0.12, 0.2, 0.3), box(0.01, 0.14, 0.2, TAN2, 0.3, 0.2, -0.1),
  ],
  boxL: () => [
    box(1.0, 0.88, 1.0, TAN, 0, 0.44, 0), box(1.01, 0.02, 1.01, TAN2, 0, 0.89, 0), box(0.14, 0.03, 1.02, 0xe9d8a6, 0, 0.895, 0),
    box(0.14, 0.25, 1.02, 0xe9d8a6, 0, 0.77, 0), box(0.06, 0.3, 0.01, RED, -0.25, 0.4, 0.5), cone(0.09, 0.14, RED, -0.25, 0.6, 0.5, 0, 0, 4),
    box(0.3, 0.2, 0.01, TAN2, 0.2, 0.3, 0.5), box(0.01, 0.2, 0.3, TAN2, 0.5, 0.35, 0.1), box(0.01, 0.2, 0.3, TAN2, -0.5, 0.35, -0.15),
  ],
  crate: () => {
    const o: G[] = [box(0.82, 0.82, 0.82, 0xd4a373, 0, 0.45, 0)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) o.push(box(0.1, 0.9, 0.1, BROWN, sx * 0.4, 0.45, sz * 0.4));
    for (const y of [0.05, 0.85]) for (const s of [-1, 1]) { o.push(box(0.9, 0.1, 0.1, BROWN, 0, y, s * 0.4)); o.push(box(0.1, 0.1, 0.9, BROWN, s * 0.4, y, 0)); }
    o.push(box(0.06, 1.05, 0.03, BROWN, 0, 0.45, 0.42, 0, 0, 0.75), box(0.06, 1.05, 0.03, BROWN, 0, 0.45, -0.42, 0, 0, -0.75));
    return o;
  },
  gumball: () => [
    cyl(0.2, 0.24, 0.12, RED, 0, 0.06, 0), cyl(0.07, 0.09, 0.5, RED, 0, 0.37, 0), box(0.34, 0.24, 0.34, RED, 0, 0.72, 0),
    box(0.12, 0.1, 0.02, DGREY, 0, 0.7, 0.175), cyl(0.04, 0.04, 0.03, YEL, 0, 0.78, 0.18, H),
    sph(0.24, 0xcdeffd, 0, 1.03, 0), cyl(0.1, 0.14, 0.06, RED, 0, 1.27, 0),
    ...[RED, YEL, GRN, BLUE, PUR, ORG, RED, GRN, YEL, BLUE].map((c, i) => sph(0.05, c, Math.cos(i * 2.2) * 0.19, 0.93 + (i % 4) * 0.055, Math.sin(i * 2.2) * 0.19)),
  ],
  arcade: () => [
    box(0.8, 1.8, 0.6, PUR, 0, 0.9, -0.15), box(0.8, 0.9, 0.3, PUR, 0, 0.45, 0.3), box(0.76, 0.12, 0.34, DGREY, 0, 0.95, 0.3, 0.25),
    box(0.64, 0.5, 0.04, BLK, 0, 1.33, 0.16, -0.2), box(0.54, 0.4, 0.02, 0x3df2ff, 0, 1.33, 0.185, -0.2),
    box(0.3, 0.07, 0.01, 0xff5fa2, -0.06, 1.38, 0.2, -0.2), box(0.1, 0.1, 0.01, YEL, 0.12, 1.25, 0.215, -0.2),
    box(0.8, 0.24, 0.66, YEL, 0, 1.68, -0.12), box(0.6, 0.12, 0.02, RED, 0, 1.68, 0.215),
    cyl(0.018, 0.018, 0.12, DGREY, -0.2, 1.05, 0.3), sph(0.045, RED, -0.2, 1.12, 0.3),
    cyl(0.04, 0.04, 0.03, GRN, 0.08, 1.0, 0.33), cyl(0.04, 0.04, 0.03, YEL, 0.22, 1.0, 0.33),
    box(0.02, 1.5, 0.5, 0xff5fa2, 0.405, 0.9, -0.1), box(0.02, 1.5, 0.5, 0xff5fa2, -0.405, 0.9, -0.1), box(0.3, 0.2, 0.02, BLK, 0, 0.4, 0.455),
  ],
  beanbag: () => [sph(0.5, 0x2ec4b6, 0, 0.26, 0, 1, 0.52, 1), sph(0.36, 0x45d6c8, 0, 0.42, -0.06, 1, 0.45, 1), sph(0.05, WHT, 0, 0.59, -0.06, 1, 0.5, 1)],
  plant: () => [
    cyl(0.24, 0.17, 0.36, 0xd77a61, 0, 0.18, 0), cyl(0.26, 0.26, 0.05, 0xc1634c, 0, 0.36, 0), cyl(0.21, 0.21, 0.02, 0x5a3e2b, 0, 0.385, 0),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => sph(0.09, i % 2 ? 0x2a9d8f : 0x52b788, Math.cos(i * 0.9) * 0.14, 0.78 + (i % 3) * 0.08, Math.sin(i * 0.9) * 0.14, 1, 4.6 - (i % 3) * 0.5, 0.55, Math.sin(i * 0.9) * 0.42, -Math.cos(i * 0.9) * 0.42)),
    sph(0.08, 0x52b788, 0, 0.92, 0, 1, 4.6, 0.6),
  ],
  stool: () => [
    cyl(0.21, 0.21, 0.08, RED, 0, 0.56, 0), cyl(0.2, 0.2, 0.02, 0xff8fab, 0, 0.605, 0), tor(0.15, 0.012, GREY, 0, 0.2, 0),
    ...[0, 1, 2, 3].map((i) => cyl(0.02, 0.02, 0.56, GREY, Math.cos(i * H + 0.78) * 0.15, 0.27, Math.sin(i * H + 0.78) * 0.15, Math.sin(i * H + 0.78) * 0.14, -Math.cos(i * H + 0.78) * 0.14, 8)),
  ],
  basket: () => [
    box(0.5, 0.02, 0.35, RED, 0, 0.02, 0), box(0.55, 0.3, 0.02, RED, 0, 0.17, 0.19), box(0.55, 0.3, 0.02, RED, 0, 0.17, -0.19),
    box(0.02, 0.3, 0.38, RED, 0.265, 0.17, 0), box(0.02, 0.3, 0.38, RED, -0.265, 0.17, 0), box(0.57, 0.03, 0.42, 0xc9184a, 0, 0.32, 0),
    box(0.5, 0.025, 0.36, BLK, 0, 0.3, 0), box(0.36, 0.02, 0.03, DGREY, 0, 0.34, 0.08), box(0.36, 0.02, 0.03, DGREY, 0, 0.34, -0.08),
  ],
  register: () => [
    box(0.5, 0.16, 0.5, DGREY, 0, 0.08, 0), box(0.4, 0.03, 0.02, YEL, 0, 0.08, 0.255), box(0.46, 0.14, 0.4, GREY, 0, 0.23, -0.03, -0.3),
    box(0.3, 0.14, 0.03, BLK, 0, 0.38, -0.2, -0.2), box(0.25, 0.09, 0.02, 0x80ffdb, 0, 0.385, -0.18, -0.2),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => box(0.06, 0.03, 0.06, i === 8 ? RED : WHT, -0.1 + (i % 3) * 0.1, 0.3 - Math.floor(i / 3) * 0.028, 0.14 - Math.floor(i / 3) * 0.09)),
  ],
  rings: () => [
    cyl(0.23, 0.25, 0.06, WHT, 0, 0.03, 0), cyl(0.03, 0.03, 0.56, YEL, 0, 0.3, 0), sph(0.05, RED, 0, 0.58, 0),
    tor(0.17, 0.055, RED, 0, 0.11, 0), tor(0.145, 0.05, ORG, 0, 0.21, 0), tor(0.12, 0.045, YEL, 0, 0.3, 0), tor(0.095, 0.04, GRN, 0, 0.38, 0), tor(0.07, 0.035, BLUE, 0, 0.45, 0),
  ],
  train: () => [
    box(0.4, 0.1, 0.95, DGREY, 0, 0.15, 0), cyl(0.15, 0.15, 0.5, RED, 0, 0.33, 0.2, H), box(0.4, 0.34, 0.36, GRN, 0, 0.37, -0.28), box(0.46, 0.04, 0.42, YEL, 0, 0.55, -0.28),
    box(0.22, 0.12, 0.02, 0xbde0fe, 0, 0.42, -0.095), cyl(0.05, 0.035, 0.16, BLK, 0, 0.5, 0.3), cyl(0.07, 0.05, 0.04, BLK, 0, 0.59, 0.3),
    cyl(0.155, 0.155, 0.04, YEL, 0, 0.33, 0.46, H), sph(0.05, YEL, 0, 0.33, 0.48), box(0.44, 0.06, 0.06, RED, 0, 0.12, 0.5),
    ...[-0.3, 0, 0.3].flatMap((z) => [cyl(0.1, 0.1, 0.06, BLK, -0.22, 0.1, z, 0, H), cyl(0.1, 0.1, 0.06, BLK, 0.22, 0.1, z, 0, H), cyl(0.04, 0.04, 0.08, RED, -0.22, 0.1, z, 0, H), cyl(0.04, 0.04, 0.08, RED, 0.22, 0.1, z, 0, H)]),
  ],
  dino: () => [
    sph(0.22, GRN, 0, 0.42, -0.05, 0.95, 0.95, 1.5), cyl(0.07, 0.08, 0.3, GRN, -0.12, 0.15, 0), cyl(0.07, 0.08, 0.3, GRN, 0.12, 0.15, 0),
    box(0.14, 0.05, 0.2, 0x04a777, -0.12, 0.025, 0.04), box(0.14, 0.05, 0.2, 0x04a777, 0.12, 0.025, 0.04),
    cone(0.14, 0.5, GRN, 0, 0.36, -0.42, -1.75), cyl(0.1, 0.14, 0.3, GRN, 0, 0.62, 0.22, 0.5),
    sph(0.15, GRN, 0, 0.77, 0.34, 0.9, 0.85, 1.25), box(0.2, 0.05, 0.2, 0xb7efc5, 0, 0.7, 0.42),
    sph(0.03, BLK, -0.1, 0.82, 0.4), sph(0.03, BLK, 0.1, 0.82, 0.4), sph(0.045, WHT, -0.09, 0.82, 0.38), sph(0.045, WHT, 0.09, 0.82, 0.38),
    ...[0, 1, 2, 3].map((i) => cone(0.05, 0.13, ORG, 0, 0.67 - i * 0.03, 0.02 - i * 0.14, -0.3)),
    sph(0.05, GRN, -0.14, 0.5, 0.2, 0.7, 0.7, 1.6), sph(0.05, GRN, 0.14, 0.5, 0.2, 0.7, 0.7, 1.6),
  ],
  ufo: () => [
    sph(0.3, GREY, 0, 0.16, 0, 1, 0.3, 1), cyl(0.2, 0.26, 0.06, DGREY, 0, 0.07, 0), sph(0.16, 0x80ffdb, 0, 0.24, 0, 1, 0.95, 1),
    sph(0.04, GRN, 0, 0.3, 0.05), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => sph(0.035, i % 2 ? YEL : RED, Math.cos(i * 0.785) * 0.25, 0.17, Math.sin(i * 0.785) * 0.25)),
    cyl(0.015, 0.015, 0.08, DGREY, 0.12, 0.03, 0.1), cyl(0.015, 0.015, 0.08, DGREY, -0.12, 0.03, 0.1), cyl(0.015, 0.015, 0.08, DGREY, 0, 0.03, -0.15),
  ],
  bin: () => [
    cyl(0.24, 0.19, 0.66, 0x52796f, 0, 0.33, 0), cyl(0.26, 0.26, 0.05, 0x354f52, 0, 0.67, 0), cyl(0.2, 0.25, 0.07, 0x354f52, 0, 0.715, 0),
    cyl(0.13, 0.13, 0.01, BLK, 0, 0.752, 0), box(0.16, 0.16, 0.01, WHT, 0, 0.38, 0.215, -0.07),
  ],
  sign: () => [
    box(0.48, 0.8, 0.03, YEL, 0, 0.4, 0.11, -0.24), box(0.48, 0.8, 0.03, YEL, 0, 0.4, -0.11, 0.24), box(0.5, 0.04, 0.1, DGREY, 0, 0.79, 0),
    box(0.05, 0.26, 0.012, BLK, 0, 0.5, 0.105, -0.24), box(0.06, 0.06, 0.012, BLK, 0, 0.28, 0.157, -0.24),
    box(0.05, 0.26, 0.012, BLK, 0, 0.5, -0.105, 0.24), box(0.06, 0.06, 0.012, BLK, 0, 0.28, -0.157, 0.24),
    box(0.3, 0.03, 0.012, RED, 0, 0.14, 0.19, -0.24), box(0.3, 0.03, 0.012, RED, 0, 0.14, -0.19, 0.24),
  ],
  barrel: () => [
    cyl(0.3, 0.26, 0.28, BLUE, 0, 0.14, 0, 0, 0, 16), cyl(0.3, 0.3, 0.3, BLUE, 0, 0.43, 0, 0, 0, 16), cyl(0.26, 0.3, 0.27, BLUE, 0, 0.715, 0, 0, 0, 16),
    cyl(0.31, 0.31, 0.05, YEL, 0, 0.28, 0, 0, 0, 16), cyl(0.31, 0.31, 0.05, YEL, 0, 0.58, 0, 0, 0, 16), cyl(0.23, 0.23, 0.02, 0x0b6e8f, 0, 0.85, 0, 0, 0, 16),
    cyl(0.04, 0.04, 0.03, DGREY, 0.1, 0.86, 0.05),
  ],
  horse: () => [
    box(0.05, 0.06, 1.2, RED, -0.2, 0.03, 0), box(0.05, 0.06, 1.2, RED, 0.2, 0.03, 0), box(0.44, 0.04, 0.06, RED, 0, 0.06, 0.3), box(0.44, 0.04, 0.06, RED, 0, 0.06, -0.3),
    ...[[-0.15, 0.25, 0.2], [0.15, 0.25, 0.2], [-0.15, -0.28, -0.2], [0.15, -0.28, -0.2]].map(([x, z, r]) => cyl(0.045, 0.04, 0.42, WHT, x, 0.27, z, r, 0, 8)),
    sph(0.2, WHT, 0, 0.56, -0.02, 0.9, 0.9, 1.75), box(0.3, 0.05, 0.3, RED, 0, 0.74, -0.05), box(0.14, 0.4, 0.2, WHT, 0, 0.78, 0.33, 0.5),
    box(0.15, 0.17, 0.3, WHT, 0, 0.94, 0.47, 0.25), box(0.05, 0.36, 0.08, 0xffb703, 0, 0.84, 0.23, 0.5), sph(0.025, BLK, -0.08, 0.97, 0.5), sph(0.025, BLK, 0.08, 0.97, 0.5),
    cone(0.03, 0.08, WHT, -0.05, 1.04, 0.38), cone(0.03, 0.08, WHT, 0.05, 1.04, 0.38), cyl(0.03, 0.05, 0.3, 0xffb703, 0, 0.5, -0.42, -0.8),
    cyl(0.012, 0.012, 0.3, BROWN, 0, 0.92, 0.42, 0, H),
  ],
  lamp: () => [
    cyl(0.2, 0.22, 0.05, DGREY, 0, 0.025, 0), cyl(0.022, 0.022, 1.36, DGREY, 0, 0.72, 0, 0, 0, 8), cyl(0.12, 0.22, 0.32, 0xfff1b8, 0, 1.54, 0),
    cyl(0.125, 0.125, 0.02, YEL, 0, 1.7, 0), cyl(0.225, 0.225, 0.02, YEL, 0, 1.385, 0), sph(0.06, 0xfffbe0, 0, 1.45, 0),
  ],
  gift: () => [
    box(0.53, 0.45, 0.53, GRN, 0, 0.225, 0), box(0.55, 0.08, 0.55, 0x04a777, 0, 0.42, 0), box(0.1, 0.47, 0.56, RED, 0, 0.235, 0), box(0.56, 0.47, 0.1, RED, 0, 0.235, 0),
    sph(0.09, RED, -0.09, 0.5, 0, 1, 0.55, 0.7, 0, 0.5), sph(0.09, RED, 0.09, 0.5, 0, 1, 0.55, 0.7, 0, -0.5), sph(0.045, 0xc9184a, 0, 0.49, 0),
  ],
};

const cache = new Map<number, THREE.BufferGeometry>();

/** Merged, vertex-coloured geometry for a prop type, scaled to its exact catalog size, origin at base centre. */
export function propGeometry(type: number): THREE.BufferGeometry {
  let g = cache.get(type);
  if (g) return g;
  const def = PROPS[type];
  const parts = (BUILD[def.id] ?? (() => [box(def.w, def.h, def.d, 0xff00ff, 0, def.h / 2, 0)]))();
  g = mergeGeometries(parts, false)!;
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const sx = def.w / (bb.max.x - bb.min.x), sy = def.h / (bb.max.y - bb.min.y), sz = def.d / (bb.max.z - bb.min.z);
  g.translate(-(bb.max.x + bb.min.x) / 2, -bb.min.y, -(bb.max.z + bb.min.z) / 2);
  g.scale(sx, sy, sz);
  bakeAO(g, def.h);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  cache.set(type, g);
  return g;
}

export function mergeColored(parts: G[]): THREE.BufferGeometry {
  return mergeGeometries(parts, false)!;
}

export interface HunterParts { body: THREE.BufferGeometry; leg: THREE.BufferGeometry; arm: THREE.BufferGeometry; }
const hunterCache = new Map<number, HunterParts>();

/**
 * The hunters: chunky toy-store security guards. `look` picks a vest colour and a hat, so every
 * hunter is recognisable at a glance. Legs and the blaster arm are separate so they can animate.
 */
export function hunterGeometry(look = 0): HunterParts {
  const key = look & 63;
  const hit = hunterCache.get(key);
  if (hit) return hit;
  const NAVY = 0x264653, SKIN = 0xf2c9a1, VEST = HUNTER_COLORS[(key >> 3) % HUNTER_COLORS.length];
  const hat = (key & 7) % HATS.length;
  const top: G[] =
    hat === 0 ? [cyl(0.22, 0.22, 0.1, 0x1d3557, 0, 1.72, 0), box(0.3, 0.03, 0.2, 0x1d3557, 0, 1.68, 0.24), cyl(0.06, 0.06, 0.02, YEL, 0, 1.73, 0.21, H)]
    : hat === 1 ? [sph(0.235, YEL, 0, 1.66, 0, 1, 0.8, 1), box(0.52, 0.03, 0.56, YEL, 0, 1.66, 0.03), sph(0.05, WHT, 0, 1.74, 0.21), box(0.06, 0.2, 0.3, ORG, 0, 1.76, 0)]
    : hat === 2 ? [cone(0.16, 0.4, PUR, 0, 1.93, 0), sph(0.045, YEL, 0, 2.14, 0), tor(0.155, 0.02, YEL, 0, 1.74, 0), sph(0.03, RED, 0.08, 1.9, 0.1), sph(0.03, GRN, -0.07, 1.84, 0.12)]
    : hat === 3 ? [sph(0.215, RED, 0, 1.66, 0, 1, 0.7, 1), sph(0.215, BLUE, 0, 1.661, 0, 0.5, 0.71, 1.01), cyl(0.015, 0.015, 0.12, DGREY, 0, 1.86, 0), box(0.5, 0.02, 0.07, YEL, 0, 1.92, 0, 0, 0.5), sph(0.03, RED, 0, 1.93, 0)]
    : hat === 4 ? [cyl(0.17, 0.17, 0.3, BLK, 0, 1.9, 0), cyl(0.28, 0.28, 0.03, BLK, 0, 1.75, 0), cyl(0.175, 0.175, 0.06, RED, 0, 1.8, 0)]
    : [cyl(0.21, 0.19, 0.12, YEL, 0, 1.78, 0), ...[0, 1, 2, 3, 4, 5].map((i) => cone(0.05, 0.14, YEL, Math.cos(i * 1.047) * 0.17, 1.9, Math.sin(i * 1.047) * 0.17, 0, 0, 5)), sph(0.035, RED, 0, 1.79, 0.2), sph(0.03, BLUE, 0.17, 1.79, 0.1), sph(0.03, GRN, -0.17, 1.79, 0.1)];
  const body = mergeGeometries([
    box(0.56, 0.62, 0.32, VEST, 0, 1.06, 0), box(0.58, 0.07, 0.34, YEL, 0, 0.95, 0), box(0.58, 0.07, 0.34, YEL, 0, 1.2, 0),
    box(0.2, 0.12, 0.02, WHT, -0.13, 1.25, 0.165), box(0.5, 0.1, 0.3, NAVY, 0, 0.74, 0), box(0.14, 0.5, 0.2, VEST, -0.36, 1.1, 0),
    sph(0.09, SKIN, -0.36, 0.82, 0), sph(0.21, SKIN, 0, 1.56, 0), sph(0.05, WHT, -0.08, 1.6, 0.17), sph(0.05, WHT, 0.08, 1.6, 0.17),
    sph(0.026, BLK, -0.08, 1.6, 0.21), sph(0.026, BLK, 0.08, 1.6, 0.21), box(0.12, 0.03, 0.03, BLK, 0, 1.48, 0.2), ...top,
  ], false)!;
  // leg geometry hangs from its hip pivot at the origin
  const leg = mergeGeometries([box(0.2, 0.72, 0.24, NAVY, 0, -0.36, 0), box(0.24, 0.1, 0.34, BLK, 0, -0.7, 0.04)], false)!;
  const arm = mergeGeometries([
    box(0.14, 0.2, 0.46, VEST, 0, 0, 0.18), sph(0.09, SKIN, 0, 0, 0.43),
    box(0.1, 0.16, 0.5, ORG, 0, 0.07, 0.62), box(0.08, 0.16, 0.1, BLUE, 0, -0.05, 0.5), cyl(0.07, 0.07, 0.08, YEL, 0, 0.07, 0.9, H), cyl(0.04, 0.04, 0.1, GRN, 0, 0.17, 0.6, H),
  ], false)!;
  for (const g of [body, leg, arm]) bakeAO(g, 1.9);
  const parts = { body, leg, arm };
  hunterCache.set(key, parts);
  return parts;
}

/** A pair of googly eyes. They pop out of a prop whenever it gives itself away. */
let eyesGeo: THREE.BufferGeometry | null = null;
export function eyesGeometry(): THREE.BufferGeometry {
  return (eyesGeo ??= mergeGeometries([
    sph(0.1, WHT, -0.11, 0, 0, 1, 1, 0.6), sph(0.1, WHT, 0.11, 0, 0, 1, 1, 0.6),
    sph(0.045, BLK, -0.1, -0.02, 0.05, 1, 1, 0.5), sph(0.045, BLK, 0.12, 0.01, 0.05, 1, 1, 0.5),
  ], false)!);
}

/**
 * Bake a soft ambient-occlusion gradient into vertex colours: darker near the base and on
 * downward-facing surfaces. Free at runtime, and it grounds every object on the floor.
 */
export function bakeAO(g: THREE.BufferGeometry, height: number, strength = 0.34) {
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getY(i) / (height * 0.5)));
    let k = 1 - strength * (1 - t * t * (3 - 2 * t));
    if (nor.getY(i) < -0.5) k *= 0.8;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
}

/** First-person toy blaster. Barrel points towards -Z (into the screen). */
export function blasterGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.09, 0.13, 0.42, ORG, 0, 0, -0.1), box(0.1, 0.05, 0.3, 0xffb35c, 0, 0.08, -0.12), cyl(0.065, 0.065, 0.1, YEL, 0, 0, -0.35, H), cyl(0.04, 0.04, 0.11, BLK, 0, 0, -0.36, H),
    box(0.075, 0.18, 0.1, BLUE, 0, -0.14, 0.06, 0.25), box(0.03, 0.06, 0.1, DGREY, 0, -0.08, -0.04), cyl(0.045, 0.045, 0.12, GRN, 0, 0.1, 0.02, H),
    box(0.11, 0.03, 0.08, RED, 0, 0.06, 0.1), sph(0.03, 0x80ffdb, 0.05, 0.02, -0.2), sph(0.03, 0x80ffdb, -0.05, 0.02, -0.2),
    box(0.16, 0.4, 0.16, 0xff6b35, 0.02, -0.34, 0.2, 0.9), sph(0.075, 0xf2c9a1, 0, -0.17, 0.08),
  ], false)!;
}

export const DUCK_TYPE = PROP_INDEX['duck'];
