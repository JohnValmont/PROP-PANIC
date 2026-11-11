/**
 * The client game: renders the world, predicts the local player with the shared physics,
 * interpolates everyone else, and turns server events into sound, particles and HUD feedback.
 * The server stays the authority on everything that matters.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CFG, F, QUICK_CHAT, TAUNTS, xpLevel, type Phase, type Team } from '../../shared/constants';
import { buildMap, BOUNDS, type GameMap } from '../../shared/map';
import { World, aimDir, newBody, type Body, type Cmd } from '../../shared/physics';
import { PROPS, propBody } from '../../shared/props';
import type { Results, RosterEntry } from '../../shared/protocol';
import { Sfx } from './audio';
import { Fx, textSprite } from './fx';
import { Hud, type AbilityView } from './hud';
import { Net } from './net';
import { DUCK_TYPE, blasterGeometry, eyesGeometry, hunterGeometry, propGeometry } from './propgeo';
import { WorldView } from './world';
import { ACTIONS, B, keyLabel } from './keys';

const STEP = 1 / 60;
const INTERP_MS = 110;
const CONFETTI = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf78c2b, 0xffffff];
const lerpAngle = (a: number, b: number, k: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

interface Sample { t: number; x: number; y: number; z: number; f: number; p: number; }
interface Ent {
  id: number; group: THREE.Group; model: THREE.Object3D | null; arm: THREE.Object3D | null; kind: string;
  legL: THREE.Object3D | null; legR: THREE.Object3D | null; eyes: THREE.Mesh | null; stars: THREE.Sprite | null; eyeK: number;
  buf: Sample[]; flags: number; lastSeen: number; label: THREE.Sprite | null; labelKey: string; marker: THREE.Sprite | null;
  hitT: number; hopT: number; x: number; y: number; z: number; f: number; speed: number; stepT: number; h: number;
}
interface DecoyView { mesh: THREE.Mesh; type: number; x: number; y: number; z: number; yaw: number; hopT: number; owner: number; }
interface Pending { seq: number; cmd: Cmd; }

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(78, 1, 0.08, 120);
  world: WorldView;
  fx: Fx;
  sfx = new Sfx();
  hud = new Hud();
  net = new Net();

  // session
  inGame = false;
  myId = 0; code = ''; pub = false;
  phase: Phase = 'lobby'; phaseEnds = 0; round = 0; seed = -1; panic = false;
  results: Results | undefined;
  roster = new Map<number, RosterEntry>();
  lobbyInfo = { bots: 0, countdown: 0, canStart: false, at: 0 };
  chaos = 0;
  onLeave: (reason?: string) => void = () => {};

  // world state
  private map!: GameMap;
  private phys!: World;
  private ents = new Map<number, Ent>();
  private decoys = new Map<number, DecoyView>();
  private offset = 0; private haveOffset = false;
  private ghostMat: THREE.MeshLambertMaterial;

  // local player
  team: Team = 'prop'; alive = false; disguise = 0;
  private body: Body = newBody(0.3, 0.5);
  private hasMe = false;
  private prev = new THREE.Vector3(); private smooth = new THREE.Vector3(); private rpos = new THREE.Vector3();
  private pending: Pending[] = []; private outbox: number[][] = []; private seq = 0; private acc = 0;
  private speed = CFG.PROP_SPEED; private jumpV = CFG.PROP_JUMP; private canMove = true;
  hp = 100; focus = 100;
  yaw = 0; pitch = -0.22; private facing = 0; private camDist = 3.4; private camY = 0;
  private cd = { decoy: 0, ghost: 0, taunt: 0, pulse: 0, shock: 0 };
  private nextFire = 0; private recoil = 0; private shake = 0; private bob = 0;
  private dashQueued = false; private wasMoving = false;
  private specPos = new THREE.Vector3(0, 3, 10);
  private target = -1;
  private freezeUntil = 0; private revealedUntil = 0; private quackedMe = false;
  private nextBeep = 0; private nextHeart = 0; private lastTickSec = -1;

  // input
  private keys = new Set<string>();
  locked = false;
  private mouseL = false; private mouseR = false;
  private chatOpen = false; private showScores = false;
  sens = 0.0022;

  // misc
  private viewmodel: THREE.Mesh; private flashlight: THREE.SpotLight; private highlight: THREE.LineSegments;
  private last = performance.now(); private time = 0; private menuAngle = 0;
  private fpsAcc = 0; private fpsN = 0; private fpsChecked = false;
  quality: 'high' | 'low' = 'high';
  fps = 60;
  renderEvery = 1;
  helpOn = true;
  private slowSecs = 0;
  look = 0; baseFov = 78; xp = 0;
  private composer!: EffectComposer; private bloom!: UnrealBloomPass;
  private eyeMat!: THREE.MeshBasicMaterial; private muzzle!: THREE.Mesh;
  private fovNow = 78; private fovPunch = 0; private zoomK = 1; private muzzleT = 0; private xpRound = -1;
  private hitch = 0;
  private frameN = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.world = new WorldView(this.scene);
    this.fx = new Fx(this.scene);
    this.world.initEnv(this.renderer);
    // post-processing (high quality only): HDR render -> bloom -> filmic tone mapping
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.5, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.eyeMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.2), transparent: true, opacity: 0.9 }));
    this.muzzle.position.set(0, 0, -0.46); this.muzzle.visible = false;
    this.ghostMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false });
    this.scene.add(this.camera);
    this.camera.rotation.order = 'YXZ';

    this.viewmodel = new THREE.Mesh(blasterGeometry(), this.world.material);
    this.viewmodel.position.set(0.27, -0.25, -0.5);
    this.viewmodel.visible = false;
    this.camera.add(this.viewmodel);
    this.viewmodel.add(this.muzzle);
    this.flashlight = new THREE.SpotLight(0xfff2cc, 0, 32, 0.52, 0.5, 1.2);
    this.flashlight.position.set(0.1, -0.05, -1); // just past the blaster so it doesn't blow out the viewmodel
    this.flashlight.target.position.set(0.1, -0.05, -2);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true }));
    this.highlight.visible = false; this.highlight.renderOrder = 5;
    this.scene.add(this.highlight);

    const q = localStorage.getItem('pp_quality');
    this.setQuality(q === 'low' ? 'low' : 'high');
    const s = Number(localStorage.getItem('pp_sens'));
    if (s > 0.0004 && s < 0.01) this.sens = s;
    if (localStorage.getItem('pp_mute') === '1') this.sfx.muted = true;
    this.xp = Math.max(0, Number(localStorage.getItem('pp_xp')) || 0);
    const hp = localStorage.getItem('pp_help');
    this.helpOn = hp === null ? true : hp === '1';
    this.look = Math.max(0, Math.min(63, Number(localStorage.getItem('pp_look')) || Math.floor(Math.random() * 8) * 8));
    const f = Number(localStorage.getItem('pp_fov')); if (f >= 60 && f <= 100) this.baseFov = f;
    const v = Number(localStorage.getItem('pp_vol')); if (localStorage.getItem('pp_vol') !== null && v >= 0 && v <= 1) this.sfx.volume = v;

    this.loadMap(1);
    this.preview.position.set(0.95, 0, 13.2);
    this.scene.add(this.preview);
    this.setLook(this.look);
    this.bindInput();
    this.net.onMsg = (m) => this.onMsg(m);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  // ================================================================ setup helpers
  setQuality(q: 'high' | 'low') {
    this.quality = q;
    localStorage.setItem('pp_quality', q);
    this.world.setQuality(q === 'high');
    this.resize();
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // keep the HUD readable (and non-overlapping) from small windows up to 4K
    const scale = Math.max(0.5, Math.min(1.5, Math.min(w / 1280, h / 720)));
    (this.hud.root.style as any).zoom = String(scale);
  }

  private loadMap(seed: number) {
    if (seed === this.seed) return;
    this.seed = seed;
    this.map = buildMap(seed);
    this.phys = new World(this.map);
    this.world.load(this.map);
    this.pending.length = 0;
    this.target = -1;
  }

  serverNow(): number { return performance.now() + this.offset; }
  private nameOf(id: number): string { return this.roster.get(id)?.name ?? 'Someone'; }

  join(name: string, mode: 'quick' | 'create' | 'join', code?: string) {
    this.sfx.unlock();
    this.net.connect(name, mode, code, this.look);
  }

  leave() {
    this.net.close();
    this.inGame = false; this.hasMe = false; this.alive = false;
    for (const e of this.ents.values()) this.scene.remove(e.group);
    this.ents.clear();
    for (const d of this.decoys.values()) this.scene.remove(d.mesh);
    this.decoys.clear();
    this.roster.clear();
    this.world.darkTarget = 0; this.world.stopPoltergeist();
    this.hud.show(false);
    this.sfx.music('none');
    this.viewmodel.visible = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.loadMap(1);
  }

  onMenu: () => void = () => {};
  private preview = new THREE.Group();

  /** Change hunter colour/hat; updates the menu preview and is sent with the next join. */
  setLook(look: number) {
    this.look = look & 63;
    try { localStorage.setItem('pp_look', String(this.look)); } catch { /* ignore */ }
    this.preview.clear();
    const geo = hunterGeometry(this.look), mat = this.world.material, g = new THREE.Group();
    const body = new THREE.Mesh(geo.body, mat), arm = new THREE.Mesh(geo.arm, mat), l1 = new THREE.Mesh(geo.leg, mat), l2 = new THREE.Mesh(geo.leg, mat);
    arm.position.set(0.36, 1.28, 0); l1.position.set(-0.13, 0.74, 0); l2.position.set(0.13, 0.74, 0);
    for (const m of [body, arm, l1, l2]) m.castShadow = true;
    g.add(body, arm, l1, l2);
    this.preview.add(g);
  }

  requestLock() { if (!this.locked && this.inGame) { try { const p: any = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } } }

  // ================================================================ input
  private bindInput() {
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.canvas; this.skipMouse = 2;
      if (this.locked && document.activeElement instanceof HTMLElement) document.activeElement.blur(); if (!this.locked) { this.keys.clear(); this.mouseL = this.mouseR = false; } });
    this.canvas.addEventListener('click', () => { this.sfx.unlock(); this.requestLock(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // browsers sometimes report one huge bogus delta right after the pointer locks: drop it
      if (this.skipMouse > 0) { this.skipMouse--; return; }
      const mx = Math.max(-300, Math.min(300, e.movementX)), my = Math.max(-300, Math.min(300, e.movementY));
      this.yaw -= mx * this.sens * this.zoomK;
      this.pitch -= my * this.sens * this.zoomK;
      const fp = this.team === 'hunter' && !this.quackedMe && this.alive;
      this.pitch = Math.max(fp ? -1.5 : -1.35, Math.min(fp ? 1.5 : 0.3, this.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouseL = true; if (this.team === 'prop') this.tryTransform(); }
      if (e.button === 2) this.mouseR = true;
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseL = false; if (e.button === 2) this.mouseR = false; });
    document.addEventListener('contextmenu', (e) => { if (this.inGame) e.preventDefault(); });
    document.addEventListener('wheel', (e) => { if (this.locked) this.camDist = Math.max(1.6, Math.min(6.5, this.camDist + Math.sign(e.deltaY) * 0.4)); }, { passive: true });
    document.addEventListener('keyup', (e) => { this.keys.delete(e.code); if (e.code === 'Tab') this.showScores = false; });
    document.addEventListener('keydown', (e) => {
      if (!this.inGame || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      // game keys must never activate a focused HUD button (Space would re-click "Start" or "+ bot")
      if (e.code === 'Space' || e.code === 'Enter' || e.code.startsWith('Arrow') || e.code === B.jump) e.preventDefault();
      if (e.code === 'Tab') { e.preventDefault(); this.showScores = true; return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      const digit = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
      if (this.chatOpen) {
        if (digit >= 1 && digit <= QUICK_CHAT.length) this.net.send({ t: 'chat', i: digit - 1 });
        this.chatOpen = false; this.hud.chatMenu(false);
        return;
      }
      switch (e.code) {
        case 'Enter': this.chatOpen = true; this.hud.chatMenu(true); break;
        case B.act: this.tryTransform(); break;
        case B.help: this.helpOn = !this.helpOn; try { localStorage.setItem('pp_help', this.helpOn ? '1' : '0'); } catch { /* ignore */ } break;
        case B.ab1: this.useAbility(this.team === 'hunter' ? 'pulse' : 'decoy'); break;
        case B.ab2: this.useAbility(this.team === 'hunter' ? 'shock' : 'ghost'); break;
        case B.dash: if (this.team === 'prop' && this.alive) { if (this.body.dashCd <= 0) { this.dashQueued = true; this.sfx.play('dash'); } else this.sfx.play('deny'); } break;
        case B.taunt: this.taunt(Math.floor(Math.random() * TAUNTS.length)); break;
        case 'KeyM': { const m = this.sfx.toggleMute(); localStorage.setItem('pp_mute', m ? '1' : '0'); this.hud.popup(m ? 'Sound off' : 'Sound on'); break; }
        case 'Minus': case 'Equal': this.sens = Math.max(0.0006, Math.min(0.006, this.sens * (e.code === 'Minus' ? 0.88 : 1.14))); localStorage.setItem('pp_sens', String(this.sens)); this.hud.popup(`Mouse sensitivity ${(this.sens / 0.0022).toFixed(2)}x`); break;
        default: if (digit >= 1 && digit <= 5) this.taunt(digit - 1);
      }
    });
  }

  private useAbility(k: 'decoy' | 'ghost' | 'pulse' | 'shock') {
    if (!this.alive) return;
    if (this.serverNow() < this.cd[k] - 60 || (k === 'ghost' && this.phase === 'lobby') || ((k === 'pulse' || k === 'shock') && (this.phase !== 'hunt' || this.quackedMe))) { this.sfx.play('deny'); return; }
    this.net.send({ t: 'ab', k });
  }

  private taunt(i: number) {
    if (this.team !== 'prop' || !this.alive) return;
    if (this.serverNow() < this.cd.taunt - 60) return;
    this.net.send({ t: 'taunt', i });
  }

  private tryTransform() {
    if (this.team !== 'prop' || !this.alive) return;
    if (this.target >= 0) this.net.send({ t: 'tf', d: this.target });
  }

  // ================================================================ network
  private onMsg(m: any) {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id; this.code = m.code; this.pub = m.pub; this.inGame = true;
        this.haveOffset = false; this.seq = 0; this.pending.length = 0; this.outbox.length = 0;
        this.hud.show(true);
        // private lobbies need the mouse for Start / bots / invite, so only public games grab it straight away
        if (m.pub) this.requestLock();
        break;
      case 'phase': this.onPhase(m); break;
      case 'roster': this.onRoster(m.p); break;
      case 's': this.onSnap(m); break;
      case 'ev': this.onEvent(m); break;
      case 'cd': this.cd = { decoy: m.decoy, ghost: m.ghost, taunt: m.taunt, pulse: m.pulse, shock: m.shock }; break;
      case 'lobby': this.lobbyInfo = { bots: m.bots, countdown: m.countdown, canStart: m.canStart, at: performance.now() }; break;
      case 'decoys': {
        for (const d of this.decoys.values()) this.scene.remove(d.mesh);
        this.decoys.clear();
        for (const d of m.d) this.addDecoy(d);
        break;
      }
    }
  }

  private onPhase(m: any) {
    const prevPhase = this.phase;
    this.phase = m.phase; this.phaseEnds = m.ends; this.round = m.round; this.results = m.results;
    this.loadMap(m.seed);
    this.lastTickSec = -1;
    if (m.phase !== 'hunt') { this.panic = false; }
    if (m.phase === 'hiding' || m.phase === 'lobby') { this.world.darkTarget = 0; this.world.stopPoltergeist(); this.freezeUntil = 0; this.revealedUntil = 0; }
    if (m.phase === 'hiding') {
      // new round: forget where everyone was, so nobody is drawn at a stale lobby position
      for (const e of this.ents.values()) { e.buf.length = 0; e.lastSeen = -1e9; }
      this.sfx.play('hide'); this.sfx.music('sneak');
      // team is confirmed by the roster that follows; banner is shown from there
      this.bannerPending = 'hiding';
    } else if (m.phase === 'hunt') {
      this.sfx.music('none'); this.sfx.play('go');
      if (prevPhase === 'hiding') {
        if (this.team === 'hunter') this.hud.banner('GO HUNT!', 'Zap the fakes. Innocent toys cost you FOCUS.', 'pink');
        else if (this.alive) this.hud.banner('HUNTERS RELEASED!', 'Hold your nerve. Taunt (T) near them for big points.', '');
      }
    } else if (m.phase === 'end') {
      this.sfx.music('none');
      this.world.darkTarget = 0; this.world.stopPoltergeist();
      const res: Results = m.results;
      const won = (res.winner === 'props' && this.team === 'prop') || (res.winner === 'hunters' && this.team === 'hunter');
      this.sfx.play(won || this.team === 'spec' ? 'win' : 'lose');
      const mine = res.board.find((r) => r.id === this.myId);
      if (mine && this.xpRound !== m.round) {
        this.xpRound = m.round;
        const gain = Math.max(10, mine.round), before = xpLevel(this.xp);
        this.xp += gain;
        try { localStorage.setItem('pp_xp', String(this.xp)); } catch { /* ignore */ }
        this.hud.popup(`+${gain} XP`);
        if (xpLevel(this.xp) > before) { this.sfx.play('levelup'); this.hud.banner(`LEVEL ${xpLevel(this.xp)}!`, 'Check the menu for newly unlocked hats.', 'teal', 3200); }
      }
      // celebratory confetti a few steps ahead, so it never fills a first-person view
      if (this.hasMe) { const [fx, , fz] = aimDir(this.yaw, 0); this.fx.burst(this.body.x + fx * 3, this.body.y + 1.2, this.body.z + fz * 3, 70, CONFETTI, 4, 6, 1.1, 1.8); }
    } else {
      this.sfx.music('lobby');
    }
  }
  private bannerPending = '';

  private onRoster(list: RosterEntry[]) {
    const seen = new Set<number>();
    for (const r of list) {
      seen.add(r.id);
      const old = this.roster.get(r.id);
      if (!old && this.roster.size && this.phase === 'lobby' && r.id !== this.myId) this.hud.feed([{ b: r.name }, r.bot ? ' (bot) joined' : ' joined'], 'good');
      this.roster.set(r.id, r);
      if (r.id === this.myId) {
        const teamChanged = this.team !== r.team || this.alive !== r.alive;
        this.team = r.team; this.alive = r.alive; this.disguise = r.disguise;
        this.quackedMe = r.team === 'hunter' && r.quack;
        if (teamChanged) { this.pitch = r.team === 'hunter' ? 0 : -0.22; this.mouseL = false; }
      }
      const wantKind = !r.alive || r.team === 'spec' ? '' : r.team === 'hunter' ? (r.quack ? 'duck' : 'hunter:' + (r.look | 0)) : 'prop:' + r.disguise;
      let e = this.ents.get(r.id);
      if (!wantKind) { if (e) { this.scene.remove(e.group); this.ents.delete(r.id); } continue; }
      if (!e) {
        e = { id: r.id, group: new THREE.Group(), model: null, arm: null, legL: null, legR: null, eyes: null, stars: null, eyeK: 0, kind: '', buf: [], flags: 0, lastSeen: -1e9, label: null, labelKey: '', marker: null, hitT: 0, hopT: 0, x: 0, y: -50, z: 0, f: 0, speed: 0, stepT: 0, h: 1 };
        e.group.visible = false;
        this.scene.add(e.group);
        this.ents.set(r.id, e);
      }
      if (e.kind !== wantKind) this.buildModel(e, wantKind);
    }
    for (const [id, r] of this.roster) if (!seen.has(id)) {
      if (this.phase === 'lobby') this.hud.feed([{ b: r.name }, ' left']);
      this.roster.delete(id);
      const e = this.ents.get(id);
      if (e) { this.scene.remove(e.group); this.ents.delete(id); }
    }
    if (this.bannerPending === 'hiding') {
      this.bannerPending = '';
      if (this.team === 'prop' && this.alive) this.hud.banner('HIDE!', 'Aim at a toy and press E to become it. Hunters are coming!', 'teal', 3200);
    }
  }

  private buildModel(e: Ent, kind: string) {
    if (e.model) e.group.remove(e.model);
    if (e.eyes) { e.group.remove(e.eyes); e.eyes = null; }
    e.kind = kind; e.arm = e.legL = e.legR = null;
    const mat = this.world.material;
    if (kind.startsWith('hunter')) {
      const geo = hunterGeometry(Number(kind.slice(7)) || 0);
      const g = new THREE.Group();
      const body = new THREE.Mesh(geo.body, mat), arm = new THREE.Mesh(geo.arm, mat);
      const legL = new THREE.Mesh(geo.leg, mat), legR = new THREE.Mesh(geo.leg, mat);
      arm.position.set(0.36, 1.28, 0); legL.position.set(-0.13, 0.74, 0); legR.position.set(0.13, 0.74, 0);
      for (const m of [body, arm, legL, legR]) m.castShadow = true;
      g.add(body, arm, legL, legR);
      e.model = g; e.arm = arm; e.legL = legL; e.legR = legR; e.h = CFG.HUNTER_H;
    } else {
      const type = kind === 'duck' ? DUCK_TYPE : Number(kind.slice(5));
      const def = PROPS[type];
      const m = new THREE.Mesh(propGeometry(type), mat);
      m.castShadow = true;
      if (kind === 'duck') m.scale.setScalar(1.5);
      e.model = m; e.h = def.h * (kind === 'duck' ? 1.5 : 1);
      if (kind !== 'duck') {
        // googly eyes: hidden until this prop gives itself away (taunt, panic, sneeze, scanner)
        const k = Math.max(0.55, Math.min(1.6, Math.min(def.w, def.h) / 0.6));
        e.eyes = new THREE.Mesh(eyesGeometry(), this.eyeMat);
        e.eyes.position.set(0, def.h + 0.07 * k, def.d * 0.22); // perched on top so they read from any angle
        e.eyes.userData.k = k; e.eyes.scale.setScalar(0.001); e.eyes.visible = false;
        e.group.add(e.eyes);
      }
    }
    e.group.add(e.model);
    e.labelKey = '';
  }

  private onSnap(m: any) {
    const sample = m.st - performance.now();
    if (!this.haveOffset || Math.abs(sample - this.offset) > 400) { this.offset = sample; this.haveOffset = true; }
    else this.offset += (sample - this.offset) * 0.05;
    this.chaos = m.ch;
    for (const row of m.p as number[][]) {
      const e = this.ents.get(row[0]);
      if (!e) continue;
      if (m.st - e.lastSeen > 500) e.buf.length = 0; // re-appeared (ghost ended, round start): don't lerp from stale data
      e.buf.push({ t: m.st, x: row[1], y: row[2], z: row[3], f: row[4], p: row[5] });
      if (e.buf.length > 14) e.buf.shift();
      e.flags = row[6]; e.lastSeen = m.st;
    }
    const a: number[] | null = m.me;
    if (!a) { this.hasMe = false; return; }
    const b = this.body;
    const alpha = this.acc / STEP;
    const bx = this.prev.x + (b.x - this.prev.x) * alpha + this.smooth.x, by = this.prev.y + (b.y - this.prev.y) * alpha + this.smooth.y, bz = this.prev.z + (b.z - this.prev.z) * alpha + this.smooth.z;
    const first = !this.hasMe;
    this.hasMe = true;
    b.x = a[0]; b.y = a[1]; b.z = a[2]; b.vx = a[3]; b.vy = a[4]; b.vz = a[5]; b.ground = a[6] === 1; b.dashLeft = a[7]; b.dashCd = a[8];
    this.speed = a[9]; this.jumpV = a[10]; this.hp = a[11]; this.focus = a[12]; b.hw = a[13]; b.h = a[14];
    this.phys.gravScale = a[15]; this.canMove = a[16] === 1; this.myFlags = a[17] | 0; b.air = a[18] ?? 0;
    while (this.pending.length && this.pending[0].seq <= m.ack) this.pending.shift();
    this.prev.set(b.x, b.y, b.z);
    const canDash = this.team === 'prop';
    for (const p of this.pending) { this.prev.set(b.x, b.y, b.z); this.phys.step(b, p.cmd, this.speed, this.jumpV, canDash); }
    const ax = this.prev.x + (b.x - this.prev.x) * alpha, ay = this.prev.y + (b.y - this.prev.y) * alpha, az = this.prev.z + (b.z - this.prev.z) * alpha;
    this.smooth.set(bx - ax, by - ay, bz - az);
    if (first || this.smooth.lengthSq() > 9) { this.smooth.set(0, 0, 0); this.camY = b.y; }
  }

  private addDecoy(d: { id: number; type: number; x: number; y: number; z: number; yaw: number; owner: number }) {
    const mesh = new THREE.Mesh(propGeometry(d.type), this.world.material);
    mesh.castShadow = true;
    mesh.position.set(d.x, d.y, d.z);
    mesh.rotation.y = d.yaw + Math.PI;
    this.scene.add(mesh);
    this.decoys.set(d.id, { mesh, type: d.type, x: d.x, y: d.y, z: d.z, yaw: d.yaw, hopT: 0, owner: d.owner });
  }

  private entPos(id: number): [number, number, number] | null {
    if (id === this.myId && this.hasMe) return [this.rpos.x, this.rpos.y, this.rpos.z];
    const e = this.ents.get(id);
    return e && e.y > -40 ? [e.x, e.y, e.z] : null;
  }

  private onEvent(m: any) {
    const me = this.myId;
    switch (m.k) {
      case 'shot': {
        const mine = m.by === me;
        const src = this.entPos(m.by);
        const to = new THREE.Vector3(m.x, m.y, m.z);
        if (src) {
          const from = mine && !this.quackedMe
            ? this.camera.localToWorld(new THREE.Vector3(0.27, -0.2, -0.9))
            : new THREE.Vector3(src[0], src[1] + 1.3, src[2]);
          this.fx.tracer(from, to, 0xfff27a);
          if (!mine) this.sfx.play('shoot', [src[0], src[1] + 1.4, src[2]]);
          this.fx.flash(from.x, from.y, from.z, 0xffe08a, mine ? 14 : 22);
        }
        if (m.hit === 1) { this.fx.burst(m.x, m.y, m.z, 5, [0xdddddd, 0xfff27a], 1.5, 1.5, 0.6, 0.4); this.sfx.play('thud', [m.x, m.y, m.z], 0.6); }
        else if (m.hit === 2) {
          this.world.wobble(m.tg);
          this.fx.burst(m.x, m.y, m.z, 9, [0xffffff, 0xffd166, 0xbbbbbb], 2.2, 2.4, 0.7, 0.6);
          this.sfx.play('bonk', [m.x, m.y, m.z]);
          if (mine) { this.hud.hitmark('#b8c0cc'); this.hud.popup(`Innocent toy!  −${CFG.FOCUS_MISS} focus`, true); }
        } else if (m.hit === 3) {
          this.fx.burst(m.x, m.y, m.z, 16, CONFETTI, 3.5, 3.5, 0.9, 0.8);
          this.sfx.play('hit', mine ? undefined : [m.x, m.y, m.z]);
          const e = this.ents.get(m.tg);
          if (e) e.hitT = 0.3;
          if (mine) this.hud.hitmark('#ffd166');
        }
        break;
      }
      case 'kill': {
        this.fx.burst(m.x, m.y + 0.4, m.z, 70, CONFETTI, 6, 7, 1.3, 1.7);
        this.fx.floater(m.x, m.y + 1.2, m.z, 'CAUGHT!', '#ff8fa3', 0.6, false, 1.6);
        this.sfx.play('kill', m.who === me || m.by === me ? undefined : [m.x, m.y, m.z]);
        const r = this.roster.get(m.who);
        this.hud.feed([{ b: this.nameOf(m.by) }, ' caught ', { b: this.nameOf(m.who) }, r ? ` (the ${PROPS[r.disguise].name})` : ''], 'kill');
        this.fx.flash(m.x, m.y + 0.6, m.z, 0xff8fa3, 40);
        if (m.by === me) this.fovPunch = 9;
        if (m.who === me) { this.hud.banner('CAUGHT!', 'You are a ghost now. Fly around and watch the chaos.', 'pink', 3200); this.specPos.set(m.x, m.y + 2.5, m.z); this.shake = 0.5; }
        else if (m.by === me) this.hud.banner('GOT ONE!', `${this.nameOf(m.who)} was the ${r ? PROPS[r.disguise].name : 'prop'}`, '', 1800);
        break;
      }
      case 'taunt': {
        const mine = m.who === me;
        this.sfx.play('taunt' + m.i, mine ? undefined : [m.x, m.y + 0.3, m.z], mine ? 0.6 : 1.3);
        this.fx.floater(m.x, m.y + 0.9, m.z, '♪', '#ffd166', 0.5);
        const e = this.ents.get(m.who);
        if (e) e.hopT = 0.45;
        break;
      }
      case 'roll': {
        for (const p of m.pts as number[][]) { this.sfx.play('squeak', [p[0], p[1] + 0.3, p[2]], 1.4); this.fx.floater(p[0], p[1] + 0.8, p[2], '♪', '#ffffff', 0.4); }
        if (this.team === 'hunter') this.hud.popup('Roll call — listen for the squeaks!');
        else if (this.alive) this.hud.popup('Roll call! You squeaked.', true);
        break;
      }
      case 'poof': this.fx.burst(m.x, m.y + 0.4, m.z, 22, [0xffffff, 0xffe5ec, 0xcdeffd], 2.6, 2.4, 1.3, 0.6, 3); this.sfx.play('poof', [m.x, m.y, m.z]); break;
      case 'pulse': {
        this.fx.ring(m.x, 0, m.z, CFG.PULSE_RADIUS, CFG.PULSE_SPEED, 0x33e1ff, 'pulse');
        this.sfx.play('pulse', m.by === me ? undefined : [m.x, 1.2, m.z], 1.2);
        if (this.team === 'prop' && this.alive && this.hasMe && Math.hypot(m.x - this.body.x, m.z - this.body.z) < CFG.PULSE_RADIUS + 1.5) { this.freezeUntil = performance.now() + 1750; this.sfx.play('freeze'); }
        break;
      }
      case 'shock': {
        this.fx.ring(m.x, m.y, m.z, CFG.SHOCK_RADIUS, 16, 0xff9f1c, 'shock');
        this.fx.burst(m.x, m.y + 0.2, m.z, 26, [0xff9f1c, 0xffd166], 7, 1.5, 0.9, 0.5);
        this.sfx.play('shock', m.by === me ? undefined : [m.x, m.y + 1, m.z], 1.2);
        if (this.hasMe && Math.hypot(m.x - this.body.x, m.z - this.body.z) < 9) this.shake = Math.max(this.shake, 0.35);
        break;
      }
      case 'decoy': this.addDecoy(m); if (m.owner === me) this.hud.popup('Decoy placed. Now walk away casually.'); this.sfx.play('poof', [m.x, m.y, m.z], 0.4); break;
      case 'decoyHop': { const d = this.decoys.get(m.id); if (d) d.hopT = 0.6; break; }
      case 'decoyPop': {
        const d = this.decoys.get(m.id);
        if (!d) break;
        this.scene.remove(d.mesh); this.decoys.delete(m.id);
        this.fx.burst(d.x, d.y + 0.4, d.z, 45, CONFETTI, 5, 5, 1.1, 1.2);
        this.sfx.play('pop', [d.x, d.y + 0.4, d.z], 1.4);
        if (m.by) {
          this.fx.floater(d.x, d.y + 1.1, d.z, 'DECOY!', '#c8a8ff', 0.6, false, 1.5);
          this.hud.feed([{ b: this.nameOf(m.by) }, ' shot a decoy planted by ', { b: this.nameOf(d.owner) }], 'chaos');
        }
        break;
      }
      case 'quack': {
        const pos = this.entPos(m.who);
        if (pos) { this.fx.burst(pos[0], pos[1] + 0.6, pos[2], 30, [0xffd166, 0xffffff, 0xf78c2b], 3.5, 3.5, 1.1, 0.9); this.sfx.play(m.on ? 'quacked' : 'poof', m.who === me ? undefined : [pos[0], pos[1], pos[2]], 1.3); }
        if (m.on) {
          this.hud.feed([{ b: this.nameOf(m.who) }, ' ran out of focus and turned into a duck'], 'chaos');
          if (m.who === me) { this.hud.banner('QUACK!', 'Too many innocent toys. Enjoy 6 seconds as a duck.', 'purple', 2600); this.pitch = Math.min(this.pitch, 0.3); }
        }
        break;
      }
      case 'blind': this.hud.blind(m.ms); this.shake = 0.4; break;
      case 'bonk': {
        this.fx.burst(m.x, m.y, m.z, 18, [0xffe14d, 0xffffff], 3, 3, 0.9, 0.7);
        this.fx.floater(m.x, m.y + 0.5, m.z, 'BONK!', '#ffe14d', 0.7, false, 1.4);
        this.sfx.play('bonkHead', m.on === me || m.who === me ? undefined : [m.x, m.y, m.z], 1.3);
        this.hud.feed([{ b: this.nameOf(m.who) }, ' bonked ', { b: this.nameOf(m.on) }, ' on the head'], 'good');
        if (m.on === me) { this.hud.banner('BONKED!', 'Seeing stars. Your blaster is jammed for a moment.', 'purple', 1700); this.shake = 0.7; }
        break;
      }
      case 'last': {
        this.sfx.play('alarm');
        if (m.who === me) this.hud.banner('LAST PROP STANDING', 'Ghost and Decoy recharged. Make it count!', 'teal', 3000);
        else this.hud.banner('ONE LEFT!', `${this.nameOf(m.who)} is the last prop. Roll calls come faster now.`, 'pink', 2600);
        break;
      }
      case 'sneeze': {
        for (const p of m.pts as number[][]) { this.sfx.play('sneeze', p[0] === me ? undefined : [p[1], p[2] + 0.3, p[3]], 1.4); this.fx.burst(p[1], p[2] + 0.5, p[3], 10, [0xffffff, 0xcdeffd], 2.5, 2, 0.7, 0.5, 4); const e = this.ents.get(p[0]); if (e) e.hopT = 0.9; }
        break;
      }
      case 'chaos': {
        this.sfx.play('chaos');
        if (m.kind === 'blackout') { this.world.darkTarget = 1; this.sfx.play('blackout'); this.hud.banner('BLACKOUT!', this.team === 'hunter' ? 'Flashlights only. They can see you coming.' : 'Lights out. Move while they are blind!', 'purple'); }
        else if (m.kind === 'poltergeist') { this.world.poltergeist(m.seed, m.ms); this.hud.banner('POLTERGEIST!', 'The toys are alive. Good luck telling who is who.', 'purple'); }
        else if (m.kind === 'shuffle') this.hud.banner('PROP SHUFFLE!', 'Every prop just became a different toy.', 'purple');
        else if (m.kind === 'moon') this.hud.banner('MOON BOUNCE!', 'Low gravity. Jump onto anything.', 'purple');
        else if (m.kind === 'sneeze') this.hud.banner('ACHOO!', this.team === 'hunter' ? 'Every real prop just sneezed. Did you see it?' : 'Dust everywhere. You sneezed!', 'purple', 2200);
        this.hud.feed(['CHAOS EVENT: ', { b: String(m.kind).toUpperCase() }], 'chaos');
        break;
      }
      case 'chaosEnd':
        if (m.kind === 'blackout') { this.world.darkTarget = 0; this.sfx.play('lightsOn'); }
        if (m.kind === 'poltergeist') this.world.stopPoltergeist();
        break;
      case 'panic':
        this.panic = true;
        this.sfx.play('alarm'); this.sfx.music('panic');
        this.hud.banner('PANIC TIME!', this.team === 'hunter' ? 'Props squeak every few seconds now. Finish it!' : 'You squeak every few seconds. Keep moving!', 'pink', 3000);
        break;
      case 'reveal':
        if (m.who === me) { this.revealedUntil = performance.now() + m.ms; this.sfx.play('freeze'); }
        else if (this.team !== 'prop' || !this.alive) { this.fx.floater(m.x, m.y + 1.2, m.z, 'MOVED!', '#33e1ff', 0.55, false, 1.6); this.sfx.play('beep'); }
        break;
      case 'hurt': this.hud.hurt(); this.sfx.play('hurt'); this.shake = 0.3; if (m.hp > 0) this.hud.popup('HIT! Panic speed boost — RUN!', true); break;
      case 'chat': this.hud.feed([{ b: this.nameOf(m.who) }, ': ' + (QUICK_CHAT[m.i] ?? '')], 'chat'); break;
      case 'pts': if (m.why) { this.hud.popup(`${m.n > 0 ? '+' : ''}${m.n}  ${m.why}`, m.n < 0); if (m.n > 0) this.sfx.play('points'); } break;
      case 'toast': this.hud.popup(m.msg, true); this.sfx.play('deny'); break;
    }
  }

  // ================================================================ simulation
  private stepLocal() {
    const k = this.keys;
    let mx = (k.has(B.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(B.left) || k.has('ArrowLeft') ? 1 : 0);
    let mz = (k.has(B.fwd) || k.has('ArrowUp') ? 1 : 0) - (k.has(B.back) || k.has('ArrowDown') ? 1 : 0);
    let jump = k.has(B.jump), dash = this.dashQueued;
    this.dashQueued = false;
    if (!this.canMove || !this.locked) { mx = 0; mz = 0; jump = false; dash = false; }
    const moving = mx !== 0 || mz !== 0;
    if (this.team === 'prop') {
      if (moving && !this.mouseR) {
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        const wx = cos * mx - sin * mz, wz = -sin * mx - cos * mz;
        this.facing = lerpAngle(this.facing, Math.atan2(-wx, -wz), 0.25);
      } else if (!moving && this.wasMoving && !this.mouseR) {
        // tidy props blend in better: settle onto the nearest right angle if we're close to one
        const q = Math.round(this.facing / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(this.facing - q) < 0.3) this.facing = q;
      }
    } else this.facing = this.yaw;
    this.wasMoving = moving;
    const cmd: Cmd = { dt: STEP, mx, mz, yaw: this.yaw, jump, dash };
    const b = this.body;
    this.prev.set(b.x, b.y, b.z);
    this.phys.step(b, cmd, this.speed, this.jumpV, this.team === 'prop');
    this.pending.push({ seq: ++this.seq, cmd });
    if (this.pending.length > 180) this.pending.shift();
    this.outbox.push([this.seq, STEP, mx, mz, this.yaw, this.pitch, (jump ? 1 : 0) | (dash ? 2 : 0), this.facing]);
  }

  private fire() {
    const now = this.serverNow();
    if (now < this.nextFire) return;
    this.nextFire = now + CFG.FIRE_MS;
    this.net.send({ t: 'fire', yaw: this.yaw, pitch: this.pitch, rt: now - INTERP_MS });
    this.recoil = 1; this.muzzleT = 0.05; this.fovPunch = Math.max(this.fovPunch, 1.6);
    this.sfx.play('shoot');
  }

  private sampleEnt(e: Ent, rt: number, dt: number) {
    const buf = e.buf;
    if (!buf.length) return;
    let a = buf[0], b = buf[0];
    if (rt >= buf[buf.length - 1].t) a = b = buf[buf.length - 1];
    else for (let i = buf.length - 2; i >= 0; i--) if (buf[i].t <= rt) { a = buf[i]; b = buf[i + 1]; break; }
    const k = a === b ? 0 : (rt - a.t) / (b.t - a.t);
    const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
    if (e.y > -40 && dt > 0) e.speed += (Math.hypot(x - e.x, z - e.z) / dt - e.speed) * 0.3; else e.speed = 0;
    e.x = x; e.y = y; e.z = z;
    e.f = lerpAngle(a.f, b.f, k);
    if (e.arm) e.arm.rotation.x = -(a.p + (b.p - a.p) * k);
  }

  private updateEnts(dt: number) {
    const now = this.serverNow(), rt = now - INTERP_MS;
    const viewerHunter = this.team === 'hunter' && this.alive;
    const viewerSpec = !this.alive || this.team === 'spec';
    const firstPerson = viewerHunter && !this.quackedMe;
    for (const e of this.ents.values()) {
      const mine = e.id === this.myId;
      if (mine) {
        if (!this.hasMe) { e.group.visible = false; continue; }
        const sp = Math.hypot(this.body.vx, this.body.vz);
        e.x = this.rpos.x; e.y = this.rpos.y; e.z = this.rpos.z; e.f = this.facing; e.speed = sp;
        e.flags = F.ALIVE | (this.body.dashLeft > 0 ? F.DASH : 0) | (this.revealedUntil > performance.now() ? F.REVEAL : 0) | (this.myFlags & (F.PANIC | F.GHOST));
        e.group.visible = !firstPerson;
        if (e.arm) e.arm.rotation.x = -this.pitch;
      } else {
        this.sampleEnt(e, rt, dt);
        // "not heard about recently" hides a player (ghosted, blindfold) — but never on the frame right after
        // a hitch, when the network messages that would refresh them are still waiting to be processed
        e.group.visible = (now - e.lastSeen < 450 || (this.hitch > 0 && e.group.visible)) && e.buf.length > 0;
        if (!e.group.visible) continue;
      }
      const r = this.roster.get(e.id);
      const isProp = e.kind.startsWith('prop');
      e.group.position.set(e.x, e.y, e.z);
      e.group.rotation.y = e.f + Math.PI;
      // little bits of life: waddles, hops, panic jitters, hit squash
      const m = e.model!;
      const move = Math.min(1, e.speed / 4);
      e.stepT += dt * (6 + e.speed * 1.6);
      let hop = 0, tilt = 0, sq = 0;
      if (isProp || e.kind === 'duck') { hop = Math.abs(Math.sin(e.stepT)) * 0.07 * move; tilt = Math.sin(e.stepT) * 0.09 * move; }
      else hop = Math.abs(Math.sin(e.stepT * 1.6)) * 0.05 * move;
      if (e.flags & F.PANIC) { tilt += Math.sin(this.time * 46) * 0.1; sq += Math.sin(this.time * 31) * 0.06; if (Math.random() < dt * 14) this.fx.burst(e.x, e.y + e.h, e.z, 1, [0x9bdcff, 0xffffff], 1.4, 2, 0.6, 0.5); }
      if (e.flags & F.DASH && Math.random() < dt * 30) this.fx.burst(e.x, e.y + 0.1, e.z, 1, [0xffffff, 0xffe5ec], 0.8, 0.8, 0.9, 0.35, 2);
      if (e.hopT > 0) { e.hopT -= dt; hop += Math.sin((1 - e.hopT / 0.45) * Math.PI) * 0.3; sq += Math.sin(e.hopT * 30) * 0.1; }
      if (e.hitT > 0) { e.hitT -= dt; sq += Math.sin(e.hitT * 40) * 0.22 * (e.hitT / 0.3); }
      if (e.kind === 'duck') tilt += Math.sin(this.time * 9) * 0.15;
      const dizzy = (e.flags & F.DIZZY) !== 0;
      if (e.legL && e.legR) {
        const sw = Math.sin(e.stepT * 0.8) * 0.75 * move;
        e.legL.rotation.x = sw; e.legR.rotation.x = -sw;
        if (dizzy) tilt += Math.sin(this.time * 7) * 0.22;
      }
      if (dizzy && !e.stars) { e.stars = textSprite('✦ ✦ ✦', '#ffe14d', 0.3, false); e.group.add(e.stars); }
      if (e.stars) { e.stars.visible = dizzy; e.stars.position.set(Math.sin(this.time * 6) * 0.25, e.h + 0.35, Math.cos(this.time * 6) * 0.25); }
      if (e.eyes) {
        const want = (e.flags & (F.PANIC | F.REVEAL)) !== 0 || e.hopT > 0 ? 1 : 0;
        e.eyeK += (want - e.eyeK) * Math.min(1, dt * (want ? 22 : 7));
        e.eyes.visible = e.eyeK > 0.03;
        if (e.eyes.visible) { const k = e.eyes.userData.k * e.eyeK * (1 + Math.sin(this.time * 30) * 0.06 * want); e.eyes.scale.set(k, k, k); e.eyes.position.y = e.h + 0.07 * e.eyes.userData.k + hop; }
      }
      m.position.y = hop; m.rotation.z = tilt;
      const base = e.kind === 'duck' ? 1.5 : 1;
      m.scale.set(base * (1 + sq), base * (1 - sq), base * (1 + sq));
      // ghosted props are see-through for friends, absent for hunters
      const ghost = (e.flags & F.GHOST) !== 0;
      if (isProp) (m as THREE.Mesh).material = ghost ? this.ghostMat : this.world.material;
      // hunter footsteps carry through the store
      if (e.legL && e.speed > 2.5 && !mine) { if (e.stepT > Math.PI) { e.stepT -= Math.PI; this.sfx.play('step', [e.x, e.y, e.z], 0.9); } }
      // name labels: you can always recognise your own side
      let label = '';
      if (r && !mine) {
        if (viewerSpec) label = r.name;
        else if (viewerHunter) label = r.team === 'hunter' ? r.name : '';
        else label = r.name;
      }
      const key = label + '|' + (r?.team ?? '');
      if (key !== e.labelKey) {
        e.labelKey = key;
        if (e.label) { e.group.remove(e.label); e.label.material.dispose(); e.label = null; }
        if (label) { e.label = textSprite(label, r!.team === 'hunter' ? '#ff8fa3' : '#ffe9a8', 0.26); e.group.add(e.label); }
      }
      if (e.label) e.label.position.y = e.h + 0.32;
      // scanner pings show through walls for hunters
      const showMark = (e.flags & F.REVEAL) !== 0 && isProp && (viewerHunter || viewerSpec);
      if (showMark && !e.marker) { e.marker = textSprite('!', '#33e1ff', 0.7, false); e.group.add(e.marker); }
      if (e.marker) { e.marker.visible = showMark; e.marker.position.y = e.h + 0.7 + Math.sin(this.time * 10) * 0.08; }
    }
    for (const d of this.decoys.values()) {
      if (d.hopT > 0) {
        d.hopT -= dt;
        const k = 1 - d.hopT / 0.6;
        d.mesh.position.y = d.y + Math.sin(k * Math.PI) * 0.32;
        d.mesh.rotation.z = Math.sin(k * 14) * 0.12;
      } else { d.mesh.position.y = d.y; d.mesh.rotation.z = 0; }
    }
  }

  private pickTarget(): number {
    if (this.team !== 'prop' || !this.alive || !this.hasMe || this.phase === 'end') return -1;
    const o = this.camera.position;
    const [dx, dy, dz] = aimDir(this.yaw, this.pitch);
    // start the ray at the player's depth so toys between the camera and the player are ignored
    const back = this.camDistNow;
    const hit = this.phys.raycast(o.x + dx * back * 0.6, o.y + dy * back * 0.6, o.z + dz * back * 0.6, dx, dy, dz, 14);
    const aimed = hit.decor >= 0 ? this.map.decor[hit.decor] : null;
    if (aimed && Math.hypot(aimed.x - this.body.x, aimed.y - this.body.y, aimed.z - this.body.z) <= CFG.TRANSFORM_RANGE) return aimed.id;
    // nothing under the crosshair: offer the closest toy roughly in front, so transforming never needs pixel aim
    let best = -1, bs = 0.72;
    for (const d of this.map.decor) {
      const ox = d.x - this.body.x, oz = d.z - this.body.z, dist = Math.hypot(ox, oz);
      if (dist > 3.2 || dist < 0.05 || Math.abs(d.y - this.body.y) > 1.6) continue;
      const score = (ox * dx + oz * dz) / (dist * Math.max(0.2, Math.hypot(dx, dz))) - dist * 0.05;
      if (score > bs) { bs = score; best = d.id; }
    }
    return best;
  }
  private camDistNow = 3.4;
  private myFlags = 0;
  private skipMouse = 0;

  private updateCamera(dt: number) {
    const cam = this.camera;
    if (!this.inGame) {
      // menu: a gently swaying hero shot from the entrance, with your own hunter showing off their look
      this.menuAngle += dt;
      const sway = Math.sin(this.menuAngle * 0.23);
      cam.position.set(1.4 + sway * 0.5, 1.5 + Math.sin(this.menuAngle * 0.31) * 0.05, 16.4);
      cam.lookAt(-0.4 + sway * 0.25, 1.22, 8);
      if (cam.fov !== 62) { cam.fov = 62; cam.updateProjectionMatrix(); }
      this.preview.visible = true;
      this.preview.rotation.y = 0.35 + Math.sin(this.menuAngle * 0.9) * 0.3;
      this.preview.position.y = Math.abs(Math.sin(this.menuAngle * 2.2)) * 0.04;
      const pm = this.preview.children[0] as THREE.Group | undefined;
      if (pm && pm.children[1]) pm.children[1].rotation.x = -0.5 + Math.sin(this.menuAngle * 2.2) * 0.25;
      this.viewmodel.visible = false;
      return;
    }
    this.preview.visible = false;
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    const spectating = !this.alive || this.team === 'spec' || !this.hasMe;
    if (spectating) {
      const k = this.keys;
      const f = (k.has(B.fwd) ? 1 : 0) - (k.has(B.back) ? 1 : 0), s = (k.has(B.right) ? 1 : 0) - (k.has(B.left) ? 1 : 0), u = (k.has(B.jump) ? 1 : 0) - (k.has(B.dash) ? 1 : 0);
      const [dx, dy, dz] = aimDir(this.yaw, this.pitch);
      const sp = 9 * dt;
      this.specPos.x += (dx * f + Math.cos(this.yaw) * s) * sp;
      this.specPos.y += (dy * f + u) * sp;
      this.specPos.z += (dz * f - Math.sin(this.yaw) * s) * sp;
      this.specPos.x = Math.max(BOUNDS.x0 + 0.5, Math.min(BOUNDS.x1 - 0.5, this.specPos.x));
      this.specPos.z = Math.max(BOUNDS.z0 + 0.5, Math.min(BOUNDS.z1 - 0.5, this.specPos.z));
      this.specPos.y = Math.max(0.5, Math.min(4.2, this.specPos.y));
      cam.position.copy(this.specPos);
      this.viewmodel.visible = false;
      return;
    }
    // smooth the vertical pops from stepping up ledges
    const ty = this.rpos.y;
    if (Math.abs(ty - this.camY) > 0.6 || !this.body.ground) this.camY = ty; else this.camY += (ty - this.camY) * Math.min(1, dt * 16);
    const firstPerson = this.team === 'hunter' && !this.quackedMe;
    const sp = Math.hypot(this.body.vx, this.body.vz);
    if (firstPerson) {
      this.bob += dt * sp * 1.9;
      const bobY = this.body.ground ? Math.sin(this.bob) * 0.035 * Math.min(1, sp / 5) : 0;
      cam.position.set(this.rpos.x, this.camY + CFG.HUNTER_EYE + bobY, this.rpos.z);
      this.viewmodel.visible = true;
      this.recoil = Math.max(0, this.recoil - dt * 7);
      const r = this.recoil * this.recoil;
      this.viewmodel.position.set(0.27 + Math.cos(this.bob * 0.5) * 0.008 * Math.min(1, sp / 5), -0.25 + Math.abs(Math.sin(this.bob * 0.5)) * 0.012 * Math.min(1, sp / 5) + r * 0.02, -0.5 + r * 0.12);
      this.viewmodel.rotation.set(r * 0.35, 0, 0);
      this.muzzleT -= dt; this.muzzle.visible = this.muzzleT > 0;
      if (this.muzzle.visible) this.muzzle.scale.setScalar(0.8 + Math.random() * 0.9);
      if (this.myFlags & F.DIZZY) { cam.rotation.z = Math.sin(this.time * 9) * 0.07; cam.rotation.x += Math.sin(this.time * 6) * 0.03; }
    } else {
      this.viewmodel.visible = false;
      const h = this.body.h;
      const tx = this.rpos.x, tyy = this.camY + Math.min(1.7, Math.max(0.95, h * 0.75 + 0.35)), tz = this.rpos.z;
      const [dx, dy, dz] = aimDir(this.yaw, this.pitch);
      let dist = this.camDist + h * 0.5;
      const hit = this.phys.raycast(tx, tyy, tz, -dx, -dy, -dz, dist + 0.3);
      if (hit.t < dist + 0.3) dist = Math.max(0.35, hit.t - 0.3);
      this.camDistNow += (dist - this.camDistNow) * Math.min(1, dt * (dist < this.camDistNow ? 30 : 8));
      cam.position.set(tx - dx * this.camDistNow, Math.max(0.25, tyy - dy * this.camDistNow), tz - dz * this.camDistNow);
    }
    // field of view: right mouse zooms the hunter's aim; shots and catches give a small punch
    const ads = firstPerson && this.mouseR && this.locked;
    this.zoomK = ads ? 0.55 : 1;
    this.fovPunch *= Math.exp(-dt * 9);
    const fovT = (ads ? this.baseFov * 0.6 : this.baseFov) + this.fovPunch + (this.body.dashLeft > 0 && !firstPerson ? 7 : 0);
    this.fovNow += (fovT - this.fovNow) * Math.min(1, dt * 14);
    if (Math.abs(cam.fov - this.fovNow) > 0.05) { cam.fov = this.fovNow; cam.updateProjectionMatrix(); }
    if (this.shake > 0.001) {
      cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.12;
      cam.rotation.y += (Math.random() - 0.5) * this.shake * 0.12;
      this.shake *= Math.exp(-dt * 7);
    }
  }

  private updateHud(dt: number) {
    const h = this.hud, now = this.serverNow(), pnow = performance.now();
    const left = this.phaseEnds - now;
    h.setPhase(this.phase, this.round, this.panic);
    h.setTimer(left, this.phase !== 'lobby');
    h.setChaos(this.chaos);
    let props = 0;
    for (const r of this.roster.values()) if (r.team === 'prop' && r.alive) props++;
    h.setCounts(props);
    const lobby = this.phase === 'lobby';
    const playing = this.alive && this.team !== 'spec' && this.hasMe;
    const hunter = this.team === 'hunter';
    if (playing) h.setRole(this.team, true, hunter ? (this.quackedMe ? 'Rubber Duck?!' : 'Zap the fakes') : PROPS[this.disguise].name, hunter ? this.focus : this.hp, lobby);
    else h.setRole('prop', false, '', 0, false);

    const ab: AbilityView[] = [];
    if (playing && hunter) {
      ab.push({ key: 'Click', name: 'ZAP', icon: '✦', left: 0, total: 1 });
      ab.push({ key: keyLabel(B.ab1), name: 'SCANNER', icon: '◎', left: this.cd.pulse - now, total: CFG.CD_PULSE });
      ab.push({ key: keyLabel(B.ab2), name: 'SHOCKWAVE', icon: '✺', left: this.cd.shock - now, total: CFG.CD_SHOCK });
    } else if (playing) {
      ab.push({ key: keyLabel(B.act), name: 'BECOME', icon: '⇄', left: 0, total: 1 });
      ab.push({ key: keyLabel(B.ab1), name: 'DECOY', icon: '❖', left: this.cd.decoy - now, total: CFG.CD_DECOY });
      if (!lobby) ab.push({ key: keyLabel(B.ab2), name: 'GHOST', icon: '☁', left: this.cd.ghost - now, total: CFG.CD_GHOST, active: (this.myFlags & F.GHOST) !== 0 });
      ab.push({ key: keyLabel(B.dash), name: 'DASH', icon: '»', left: this.body.dashCd * 1000, total: CFG.DASH_CD * 1000, active: this.body.dashLeft > 0 });
      ab.push({ key: keyLabel(B.taunt), name: 'TAUNT', icon: '♪', left: this.cd.taunt - now, total: CFG.CD_TAUNT });
    }
    h.setAbilities(ab);

    const blindfolded = this.phase === 'hiding' && hunter && this.alive;
    h.blindfold(blindfolded, left);
    h.crosshair(!playing || blindfolded ? 'none' : hunter && !this.quackedMe ? 'hunter' : 'prop');

    // transform prompt
    if (this.target >= 0 && playing && !hunter) {
      const info = this.world.decorDef(this.target);
      if (info) h.prompt(info.d.type === this.disguise ? `You are already a <b>${info.def.name}</b>` : `<b>[${keyLabel(B.act)}]</b> Become <b>${info.def.name}</b>`);
    } else h.prompt(null);

    h.freeze(pnow < this.freezeUntil && playing);
    h.revealed(pnow < this.revealedUntil && playing);

    // tension audio: hunters get a warmer/colder meter, props hear their own heartbeat
    if (playing && this.phase === 'hunt') {
      let near = 1e9;
      for (const e of this.ents.values()) {
        if (e.id === this.myId || !e.group.visible) continue;
        const r = this.roster.get(e.id);
        if (!r || (hunter ? r.team !== 'prop' : r.team !== 'hunter')) continue;
        near = Math.min(near, Math.hypot(e.x - this.body.x, e.y - this.body.y, e.z - this.body.z));
      }
      if (hunter) {
        const v = this.quackedMe ? 0 : Math.max(0, Math.min(1, 1 - (near - 2) / 8));
        h.meter(v);
        if (v > 0.04 && pnow > this.nextBeep) { this.nextBeep = pnow + 1100 - v * 950; this.sfx.play('beep', undefined, 0.5 + v * 0.6); }
      } else {
        h.meter(null);
        const v = Math.max(0, Math.min(1, 1 - (near - 2) / 8));
        if (v > 0.04 && pnow > this.nextHeart) { this.nextHeart = pnow + 1050 - v * 650; this.sfx.play('heart', undefined, 0.5 + v * 0.7); }
        document.getElementById('vignette')!.classList.toggle('heart', v > 0.5);
      }
    } else h.meter(null);

    // countdown ticks
    const sec = Math.ceil(left / 1000);
    if (sec !== this.lastTickSec && left > 0) {
      this.lastTickSec = sec;
      if (this.phase === 'hunt' && sec <= 10) this.sfx.play(sec <= 5 ? 'tock' : 'tick');
      if (this.phase === 'hiding' && sec <= 5) this.sfx.play('tick');
    }

    // contextual hint / spectate strip
    let hint: string | null = null, spec: string | null = null;
    if (!playing && this.phase !== 'end') {
      spec = this.team === 'spec' ? 'Round in progress — you join the next one. WASD + mouse to fly around.' : 'You were caught! Fly around with WASD (Space / Shift = up / down).';
    } else if (!this.locked && this.phase !== 'end') hint = 'Click the game to run around  ·  Esc frees the mouse again';
    else if (lobby) hint = 'Lobby warm-up: transform (E), taunt (T), drop a decoy (Q), dash (Shift)';
    else if (playing && !hunter && this.phase === 'hiding' && left < CFG.HIDE_MS - 3500) hint = 'Right-click holds your rotation · scroll zooms · small toys fit on shelves';
    h.hint(hint); h.spectate(spec);

    // always-on objective line and a controls card, so a first-time player is never left guessing
    let obj = '';
    if (lobby) obj = 'Warm-up. The round starts soon — try becoming a toy.';
    else if (playing && hunter && this.phase === 'hunt') obj = this.quackedMe ? 'You are a duck! Too many innocent toys. Wait it out.' : (this.myFlags & F.DIZZY) ? 'Bonked! Your blaster is jammed for a moment.' : `Find the fake toys and zap them. Fakes squeak on roll calls, move when unwatched, and fly up when you Shockwave [${keyLabel(B.ab2)}].`;
    else if (playing && !hunter && this.phase === 'hiding') obj = `Aim at a toy and press [${keyLabel(B.act)}] to become it, then stand among similar toys.`;
    else if (playing && !hunter && this.phase === 'hunt') obj = 'Survive until the timer runs out. Freeze when a hunter or the blue scanner ring is near.';
    h.objective(obj);
    const K = (id: string) => `<kbd>${keyLabel(B[id])}</kbd>`;
    const rows = !playing ? null : hunter
      ? [['Move', `${K('fwd')}${K('left')}${K('back')}${K('right')}`], ['Jump', K('jump')], ['Zap', '<kbd>Left click</kbd>'], ['Zoom aim', '<kbd>Right click</kbd>'], ['Scanner', K('ab1')], ['Shockwave', K('ab2')]]
      : [['Move', `${K('fwd')}${K('left')}${K('back')}${K('right')}`], ['Jump', K('jump')], ['Become toy', `${K('act')} <kbd>Click</kbd>`], ['Decoy', K('ab1')], ['Ghost', K('ab2')], ['Dash', K('dash')], ['Taunt', K('taunt')], ['Hold rotation', '<kbd>Right click</kbd>']];
    h.help(this.helpOn && rows && this.phase !== 'end' ? `<div class="helpT">${hunter ? 'HUNTER' : 'PROP'} CONTROLS</div>${rows.map((r) => `<div><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}<div class="helpF">${K('help')} hides this · <kbd>Esc</kbd> settings &amp; key bindings</div>` : null);
    void ACTIONS;

    h.lobby(lobby, { code: this.code, pub: this.pub, roster: [...this.roster.values()], me: this.myId, host: !!this.roster.get(this.myId)?.host, bots: this.lobbyInfo.bots, countdown: Math.max(0, this.lobbyInfo.countdown - (pnow - this.lobbyInfo.at)), canStart: this.lobbyInfo.canStart });
    h.results(this.phase === 'end', this.results, this.myId, this.team, left);
    h.scoreboard(this.showScores && this.phase !== 'end', [...this.roster.values()], this.myId);
    void dt;
  }

  // ================================================================ main loop
  private frame() {
    requestAnimationFrame(() => this.frame());
    const t = performance.now();
    const raw = (t - this.last) / 1000;
    const dt = Math.min(0.1, raw);
    this.last = t;
    this.time += dt;
    this.hitch = raw > 0.2 ? 2 : Math.max(0, this.hitch - 1);

    // adaptive quality: if a machine can't hold a playable frame rate, drop shadows once
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 1) {
      this.fps = this.fpsN / this.fpsAcc;
      if (!this.fpsChecked && this.inGame && this.time > 8 && !document.hidden) this.slowSecs = this.fps < 28 ? this.slowSecs + 1 : 0;
      if (!this.fpsChecked && this.slowSecs >= 4) {
        this.fpsChecked = true;
        if (this.quality === 'high') { this.setQuality('low'); this.hud.popup('Low frame rate: switched to fast graphics'); document.getElementById('gfxBtn')!.textContent = 'Graphics: Fast'; }
      }
      this.fpsAcc = 0; this.fpsN = 0;
    }

    if (this.inGame && this.hasMe && this.alive && this.team !== 'spec') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6) { this.stepLocal(); this.acc -= STEP; n++; }
      if (this.acc > STEP) this.acc = 0;
      if (this.outbox.length) { this.net.send({ t: 'in', c: this.outbox }); this.outbox = []; }
      const a = this.acc / STEP, b = this.body;
      this.smooth.multiplyScalar(Math.exp(-dt * 14));
      this.rpos.set(this.prev.x + (b.x - this.prev.x) * a + this.smooth.x, this.prev.y + (b.y - this.prev.y) * a + this.smooth.y, this.prev.z + (b.z - this.prev.z) * a + this.smooth.z);
      if (this.mouseL && this.locked && this.team === 'hunter' && this.phase === 'hunt' && !this.quackedMe && !(this.myFlags & F.DIZZY)) this.fire();
    }

    this.updateCamera(dt);
    if (this.inGame) {
      this.updateEnts(dt);
      this.target = this.pickTarget();
      const info = this.target >= 0 ? this.world.decorDef(this.target) : null;
      this.highlight.visible = !!info;
      if (info) {
        this.highlight.position.set(info.d.x, info.d.y + info.def.h / 2, info.d.z);
        this.highlight.rotation.y = info.def.round ? 0 : info.d.yaw;
        this.highlight.scale.set(info.def.w + 0.06, info.def.h + 0.06, info.def.d + 0.06);
      }
      this.updateHud(dt);
      // in a blackout hunters only get a flashlight; props keep a little night vision
      const hunterView = this.team === 'hunter' && this.alive;
      // (values are linear light: 0.012 reads as near-black on screen, 0.12 as moonlit)
      this.world.darkFloor = hunterView ? 0.02 : 0.12;
      this.flashlight.intensity = hunterView && !this.quackedMe ? this.world.dark * 7 : 0;
    } else { this.highlight.visible = false; this.flashlight.intensity = 0; }

    this.world.update(dt);
    this.fx.update(dt);
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.sfx.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, d.x, d.y, d.z);
    // renderEvery > 1 draws only every Nth frame (simulation and input still run every frame);
    // used by the automated browser test on machines without a GPU
    if (++this.frameN % this.renderEvery === 0) {
      if (this.quality === 'high') this.composer.render(); else this.renderer.render(this.scene, this.camera);
    }
  }
}
