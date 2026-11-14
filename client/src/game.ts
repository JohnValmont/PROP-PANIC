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
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { CFG, F, QUICK_CHAT, ROUNDS_DEFAULT, TAUNTS, type Phase, type Team } from '../../shared/constants';
import { GUNS, KIT, bankRound, kitToWire, utcDay, xpLevel, type Profile, type Report, type WireKit } from '../../shared/progress';
import { loadProfile, saveProfile } from './profile';
import { buildMap, BOUNDS, MAP_NAMES, type GameMap } from '../../shared/map';
import { World, aimDir, newBody, type Body, type Cmd } from '../../shared/physics';
import { PROPS, PROP_INDEX, propBody } from '../../shared/props';
import type { Results, RosterEntry } from '../../shared/protocol';
import { Sfx } from './audio';
import { Fx, makeBeacon, textSprite } from './fx';
import { Hud, esc, type AbilityView } from './hud';
import { Net, type Mode } from './net';
import { assets } from './assets';
import { HunterRig, buildEyes, buildViewmodel } from './hunter';
import { WorldView } from './world';
import { ACTIONS, B, isBound, keyLabel } from './keys';

const STEP = 1 / 60;
const DUCK_TYPE = PROP_INDEX['duck'];
const PROP_INDEX_BOX = PROP_INDEX['box'];
export type Quality = 'ultra' | 'high' | 'low';
const INTERP_MS = 110;
const CONFETTI = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0x9b5de5, 0xf78c2b, 0xffffff];
const lerpAngle = (a: number, b: number, k: number) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };

interface Sample { t: number; x: number; y: number; z: number; f: number; p: number; }
interface Ent {
  id: number; group: THREE.Group; model: THREE.Object3D | null; rig: HunterRig | null; kind: string;
  pitch: number; kick: number; vy: number;
  /** Disguise last reported alongside this player's position (-1 = never seen). */
  netType: number;
  eyes: THREE.Object3D | null; stars: THREE.Sprite | null; eyeK: number;
  buf: Sample[]; flags: number; lastSeen: number; label: THREE.Sprite | null; labelKey: string; marker: THREE.Sprite | null;
  hitT: number; hopT: number; x: number; y: number; z: number; f: number; speed: number; stepT: number; h: number;
  /** Counts down after a change of disguise: the new shape pops into place. */
  popT: number;
  /** Pillar of light over a survivor once the round is over. */
  beam: THREE.Mesh | null;
}
interface DecoyView { mesh: THREE.Object3D; type: number; x: number; y: number; z: number; yaw: number; hopT: number; owner: number; }
interface Pending { seq: number; cmd: Cmd; }

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(78, 1, 0.1, 700);
  world: WorldView;
  fx: Fx;
  sfx = new Sfx();
  hud = new Hud();
  net = new Net();

  // session
  inGame = false;
  myId = 0; code = ''; pub = false;
  phase: Phase = 'lobby'; phaseEnds = 0; round = 0; rounds = ROUNDS_DEFAULT; seed = -1; panic = false;
  results: Results | undefined;
  roster = new Map<number, RosterEntry>();
  lobbyInfo = { bots: 0, countdown: 0, canStart: false, at: 0, map: 0, rounds: ROUNDS_DEFAULT };
  chaos = 0;
  onLeave: (reason?: string) => void = () => {};
  /** A game has finished and everyone is back in the lobby. */
  onLobby: () => void = () => {};

  // world state
  private map!: GameMap;
  private phys!: World;
  private ents = new Map<number, Ent>();
  private decoys = new Map<number, DecoyView>();
  private offset = 0; private haveOffset = false;
  private ghostMat: THREE.MeshStandardMaterial;

  // local player
  team: Team = 'prop'; alive = false; disguise = 0;
  private body: Body = newBody(0.3, 0.5);
  private hasMe = false;
  private prev = new THREE.Vector3(); private smooth = new THREE.Vector3(); private rpos = new THREE.Vector3();
  private pending: Pending[] = []; private outbox: number[][] = []; private seq = 0; private acc = 0;
  private speed = CFG.PROP_SPEED; private jumpV = CFG.PROP_JUMP; private canMove = true;
  hp = 100; focus = 100;
  yaw = 0; pitch = -0.22; private facing = 0; private camDist = 3.4; private camY = 0;
  private cd = { decoy: 0, ghost: 0, taunt: 0, pulse: 0, shock: 0, haunt: 0 };
  // a hunter looks round the room (with no props in it) while the props hide: see CFG.PREVIEW_ON
  previewOn = false;
  private glideFrom = new THREE.Vector3(); private glide = 1;
  /** When the results panel may come up: the survivors are shown off first. */
  private resultsAt = 0;
  /** Set by the welcome: the first roster after it decides whether a mid-round joiner needs telling what they are. */
  private joinCard = false;
  private nextFire = 0; private recoil = 0; private shake = 0; private bob = 0;
  private dashQueued = false; private wasMoving = false;
  // ghost (caught props and late joiners): attached to a player, looking through a hunter's eyes, or flying free
  private specPos = new THREE.Vector3(0, 3, 10); private specVel = new THREE.Vector3();
  specOn = false; specMode: 'follow' | 'free' = 'follow'; specTarget = 0; specPov = false;
  private specFrom = new THREE.Vector3(); private specWant = new THREE.Vector3(); private specBlend = 1; private specSeek = 0;
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
  /** Holds the first-person arms and blaster (rebuilt when the kit, or the hunter being watched, changes). */
  private viewmodel = new THREE.Group(); private vmKey = ''; private flashlight: THREE.SpotLight; private highlight: THREE.LineSegments;
  private last = performance.now(); private time = 0; private menuAngle = 0;
  private fpsAcc = 0; private fpsN = 0; private fpsChecked = false;
  quality: Quality = 'high';
  fps = 60;
  renderEvery = 1;
  mapId = -1; nextMap = 0; invertY = false;
  private stepCount = 0;
  helpOn = true;
  private slowSecs = 0;
  baseFov = 78;
  /** Level, coins, wardrobe, catalogue, feats and jobs. Kept in the browser: there are no accounts to keep it against. */
  profile: Profile = loadProfile();
  /** What the last round banked, for the results panel. */
  report: Report | null = null;
  /** Called after a round is banked (the menu redraws the profile from it). */
  onBanked: (r: Report) => void = () => {};
  private composer!: EffectComposer; private bloom!: UnrealBloomPass; private gtao!: GTAOPass;
  private muzzle!: THREE.Mesh; private previewRig: HunterRig | null = null;
  private fovNow = 78; private fovPunch = 0; private zoomK = 1; private muzzleT = 0;
  private hitch = 0;
  private frameN = 0;
  // connection quality: app-level ping every second, so the HUD can tell network lag apart from a slow device
  private pingOut = new Map<number, number>(); private pingNextAt = 0; private pingSent = 0;
  private rtt = -1; private jitter = 0; private pingLog: boolean[] = []; private netHudAt = 0; private badNetSince = 0; private badNetWarnAt = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !assets.lite, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // refreshed by hand in frame()
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.world = new WorldView(this.scene);
    this.fx = new Fx(this.scene);
    this.world.initEnv(this.renderer);
    // post-processing: HDR render -> ambient occlusion (ultra) -> bloom -> filmic tone mapping
    const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = new GTAOPass(this.scene, this.camera, 4, 4);
    this.gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 0.9;
    // cut-out foliage and see-through effects would smear the occlusion buffer: leave them out of it
    const gt = this.gtao as any, hideForAO = gt.overrideVisibility.bind(gt);
    gt.overrideVisibility = () => { hideForAO(); this.scene.traverse((o: any) => { if ((o.isMesh || o.isSprite) && o.visible && (o.material?.alphaTest > 0 || o.material?.transparent)) { gt._visibilityCache.set(o, o.visible); o.visible = false; } }); };
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 1.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.2), transparent: true, opacity: 0.9 }));
    this.muzzle.visible = false;
    this.ghostMat = new THREE.MeshStandardMaterial({ color: 0xa8dcff, roughness: 0.35, transparent: true, opacity: 0.36, depthWrite: false });
    this.scene.add(this.camera);
    this.camera.rotation.order = 'YXZ';

    this.viewmodel.position.set(0.25, -0.2, -0.5);
    this.viewmodel.visible = false;
    this.camera.add(this.viewmodel);
    this.flashlight = new THREE.SpotLight(0xfff2cc, 0, 32, 0.52, 0.5, 1.2);
    this.flashlight.position.set(0.1, -0.05, -1); // just past the blaster so it doesn't blow out the viewmodel
    this.flashlight.target.position.set(0.1, -0.05, -2);
    this.camera.add(this.flashlight, this.flashlight.target);
    this.highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true }));
    this.highlight.visible = false; this.highlight.renderOrder = 5;
    this.scene.add(this.highlight);

    const q = localStorage.getItem('pp_quality');
    this.setQuality(q === 'low' || q === 'high' || q === 'ultra' ? q : this.guessQuality());
    const s = Number(localStorage.getItem('pp_sens'));
    if (s > 0.0004 && s < 0.01) this.sens = s;
    if (localStorage.getItem('pp_mute') === '1') this.sfx.muted = true;
    this.invertY = localStorage.getItem('pp_invy') === '1';
    const mv = localStorage.getItem('pp_mus'); if (mv !== null && Number(mv) >= 0 && Number(mv) <= 1) this.sfx.musicVol = Number(mv);
    const hp = localStorage.getItem('pp_help');
    this.helpOn = hp === null ? true : hp === '1';
    const f = Number(localStorage.getItem('pp_fov')); if (f >= 60 && f <= 100) this.baseFov = f;
    const v = Number(localStorage.getItem('pp_vol')); if (localStorage.getItem('pp_vol') !== null && v >= 0 && v <= 1) this.sfx.volume = v;

    this.loadMap(1);
    this.preview.position.set(0.25, 0, 13.0);
    this.scene.add(this.preview);
    this.showcase.position.set(-0.75, 0, 13.6); this.showcase.rotation.y = 0.5; this.showcase.visible = false;
    this.scene.add(this.showcase);
    this.applyKit();
    this.bindInput();
    this.net.onMsg = (m) => this.onMsg(m);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  // ================================================================ setup helpers
  /** Integrated and mobile GPUs start one notch down; everything else gets the full pipeline. */
  private guessQuality(): Quality {
    try {
      const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '').toLowerCase();
      if (/swiftshader|llvmpipe|software/.test(name)) return 'low';
      // older integrated chips cannot afford the full pipeline: start them on fast, they can always turn it up
      if (/iris\(r\) xe|iris xe|apple|radeon|geforce|nvidia|arc\(/.test(name)) return /radeon\(tm\) graphics|vega|iris/.test(name) ? 'high' : 'ultra';
      if (/intel|hd graphics|uhd|mali|adreno|powervr/.test(name) || /Mobi|Android/i.test(navigator.userAgent)) return 'low';
    } catch { /* ignore */ }
    return 'ultra';
  }

  setQuality(q: Quality) {
    try { localStorage.setItem('pp_quality', q); } catch { /* ignore */ }
    this.quality = q;
    this.world.setQuality(q === 'ultra' ? 2 : q === 'high' ? 1 : 0);
    // fast graphics uses different models and materials: swap them in place and rebuild what is on screen
    if ((q === 'low') !== assets.lite) {
      assets.setLite(q === 'low');
      if (this.map) {
        this.world.rebuild(this.map);
        for (const e of this.ents.values()) if (e.kind) this.buildModel(e, e.kind);
        for (const d of this.decoys.values()) { this.scene.remove(d.mesh); d.mesh = assets.propObject(d.type); d.mesh.position.set(d.x, d.y, d.z); d.mesh.rotation.y = d.yaw + Math.PI; this.scene.add(d.mesh); }
      }
      if (this.previewRig) this.applyKit(); // the wardrobe's box was built from the other model set
    }
    this.gtao.enabled = q === 'ultra';
    this.resize();
  }

  /** Re-fit the renderer and the HUD to the window (also after the HUD size setting changes). */
  relayout() { this.resize(); }
  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.quality === 'ultra' ? Math.min(window.devicePixelRatio, 2) : this.quality === 'high' ? Math.min(window.devicePixelRatio, 1.5) : 0.85);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // keep the HUD readable (and non-overlapping) from small windows up to 4K
    const scale = Math.max(0.5, Math.min(1.5, Math.min(w / 1280, h / 720))) * this.hudScale;
    (this.hud.root.style as any).zoom = String(scale);
  }

  private loadMap(seed: number, id = 0) {
    if (seed === this.seed && id === this.mapId) return;
    this.seed = seed; this.mapId = id;
    this.map = buildMap(seed, id);
    this.sfx.ambience(id === 1 ? 'meadow' : 'store');
    const tag = document.getElementById('mapName');
    if (tag) tag.textContent = MAP_NAMES[id] ?? '';
    this.phys = new World(this.map);
    this.world.load(this.map);
    this.pending.length = 0;
    this.target = -1;
  }

  serverNow(): number { return performance.now() + this.offset; }
  private nameOf(id: number): string { return this.roster.get(id)?.name ?? 'Someone'; }

  join(name: string, mode: Mode, code?: string, pass?: string) {
    this.sfx.unlock();
    this.net.connect(name, mode, code, kitToWire(this.profile), xpLevel(this.profile.xp), pass);
  }

  leave() {
    this.net.close();
    this.inGame = false; this.hasMe = false; this.alive = false;
    this.specOn = false; this.specTarget = 0; this.specPov = false; this.specMode = 'follow';
    this.previewOn = false; this.glide = 1; this.resultsAt = 0; this.hud.count(null); this.hud.ghostTint(false);
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
  /** Called when the game changes the graphics setting by itself (the low frame rate fallback). */
  onQuality: () => void = () => {};
  /** The player's HUD size setting, on top of the automatic fit to the window. */
  hudScale = Math.max(0.7, Math.min(1.4, Number(localStorage.getItem('pp_hud')) || 1));
  /** Menu camera: 1 slides the scene left so the robot stands beside the profile panel (the fitting room). */
  menuShift = 0;
  private menuShiftNow = 0;
  /** Put back the music that belongs to where the player is (after the sound test played something else). */
  syncMusic() {
    this.sfx.music('none');
    this.sfx.music(!this.inGame || this.phase === 'lobby' || this.phase === 'end' ? 'lobby' : this.phase === 'hiding' ? 'sneak' : this.panic ? 'panic' : 'hunt');
  }
  private preview = new THREE.Group();

  /** Save the profile and redraw the menu's hunter (and the googly-eyed box beside it) in what the player now wears. */
  applyKit() {
    saveProfile(this.profile);
    const w = kitToWire(this.profile);
    this.preview.clear();
    this.previewRig = new HunterRig(w[KIT.paint], w[KIT.hat], w[KIT.char], w[KIT.gun]);
    this.preview.add(this.previewRig.root);
    this.setViewmodel(w);
    // the wardrobe shows eyes and pops on a cardboard box next to the hunter
    this.showcase.clear();
    const box = assets.propObject(PROP_INDEX_BOX);
    const eyes = buildEyes(w[2]);
    eyes.position.set(0, PROPS[PROP_INDEX_BOX].h + 0.07, PROPS[PROP_INDEX_BOX].d * 0.22);
    eyes.name = 'eyes';
    this.showcase.add(box, eyes);
  }
  /** First-person arms and blaster for a kit: yours, or the hunter a ghost is watching through. */
  private setViewmodel(w: WireKit | undefined) {
    const p = (w?.[KIT.paint] ?? 0), c = (w?.[KIT.char] ?? 0), g = (w?.[KIT.gun] ?? 0), key = `${p}.${c}.${g}`;
    if (key === this.vmKey) return;
    this.vmKey = key;
    this.viewmodel.clear();
    const vm = buildViewmodel(p, c, g);
    this.viewmodel.add(vm);
    (vm.getObjectByName('muzzle') ?? vm).add(this.muzzle);
    (this.muzzle.material as THREE.MeshBasicMaterial).color.set(GUNS[g]?.flash ?? 0xffe08a).multiplyScalar(3.5);
  }
  private previewKick = 0;
  /** The menu hunter fires a test shot with the blaster and trail just put on. */
  previewShot() {
    const rig = this.previewRig;
    if (!rig) return;
    this.previewKick = 1;
    this.preview.updateMatrixWorld(true);
    const from = rig.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.preview.getWorldQuaternion(new THREE.Quaternion()));
    const w = kitToWire(this.profile);
    this.fx.zap(from, from.clone().addScaledVector(dir, 9), w[KIT.trail]);
    this.fx.flash(from.x, from.y, from.z, GUNS[w[KIT.gun]]?.flash ?? 0xffe08a, 6);
    this.sfx.play('shoot', undefined, 0.6);
    const extra = GUNS[w[KIT.gun]]?.sfx; if (extra) this.sfx.play(extra, undefined, 0.5);
  }
  /** The googly-eyed box beside the menu hunter: shown while the wardrobe is open. */
  showcase = new THREE.Group();
  showcaseOn = false;
  /** Preview a catch pop over the showcase box. */
  previewPop(style: number) {
    const p = this.showcase.position;
    this.fx.pop(p.x, p.y + 0.5, p.z, style);
    this.sfx.play('kill');
  }

  // touch devices have no pointer to lock: the game counts as "locked" whenever it is not paused
  touch = false; touchPaused = false; stick = { x: 0, y: 0 };
  /** Look around by a pointer delta in pixels (shared by touch drag). */
  turn(mx: number, my: number) {
    if (!this.locked || (this.specOn && this.specPov)) return; // a borrowed view is steered by its owner
    this.yaw -= mx * this.sens * this.zoomK;
    this.pitch -= my * this.sens * this.zoomK * (this.invertY ? -1 : 1);
    this.clampPitch();
  }
  /** First-person views and free flight look all the way up and down; a camera orbiting a body does not. */
  private clampPitch() {
    const free = this.specOn ? this.specMode === 'free' || this.specPov : this.team === 'hunter' && !this.quackedMe && this.alive;
    this.pitch = Math.max(free ? -1.5 : -1.35, Math.min(free ? 1.5 : this.specOn ? 0.5 : 0.3, this.pitch));
  }
  touchAlt(on: boolean) { this.mouseR = on; }
  touchFire(down: boolean) {
    if (!this.locked) return;
    if (this.specOn) { if (down) { if (this.canHaunt()) this.ghostAct(); else this.specSwitch(); } return; }
    this.mouseL = down; if (down && this.team === 'prop') this.tryTransform();
  }
  /** Touch: swap a ghost between flying free and watching a player. */
  ghostSwitch() { if (this.specOn && this.locked) this.specSwitch(); }
  requestLock() { if (this.touch) return; if (!this.locked && this.inGame) { try { const p: any = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } } }

  // ================================================================ input
  private bindInput() {
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === this.canvas; this.skipMouse = 2;
      if (this.locked && document.activeElement instanceof HTMLElement) document.activeElement.blur(); if (!this.locked) { this.keys.clear(); this.mouseL = this.mouseR = false; } });
    this.canvas.addEventListener('click', () => { this.sfx.unlock(); this.requestLock(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // browsers sometimes report one huge bogus delta right after the pointer locks: drop it
      if (this.skipMouse > 0) { this.skipMouse--; return; }
      if (this.specOn && this.specPov) return;
      const mx = Math.max(-300, Math.min(300, e.movementX)), my = Math.max(-300, Math.min(300, e.movementY));
      this.yaw -= mx * this.sens * this.zoomK;
      this.pitch -= my * this.sens * this.zoomK * (this.invertY ? -1 : 1);
      this.clampPitch();
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      // a mouse button bound to an action in the key bindings does that action instead of its usual job
      const code = `Mouse${e.button}`;
      if (isBound(code)) { e.preventDefault(); this.keys.add(code); this.pressKey(code); return; }
      // a ghost's mouse buttons pick who to watch
      // (while haunting is possible, left click haunts and right click takes over choosing who to watch)
      if (this.specOn) { if (e.button === 0) this.ghostAct(); else if (e.button === 2) { if (!this.canHaunt()) this.specCycle(-1); else if (this.specMode === 'free') this.specClick(); else this.specCycle(1); } return; }
      if (e.button === 0) { this.mouseL = true; if (this.team === 'prop') this.tryTransform(); }
      if (e.button === 2) this.mouseR = true;
    });
    // side buttons would otherwise make the browser go back / forward a page
    document.addEventListener('auxclick', (e) => { if (this.inGame && e.button >= 3) e.preventDefault(); });
    document.addEventListener('mouseup', (e) => { this.keys.delete(`Mouse${e.button}`); if (this.inGame && e.button >= 3) e.preventDefault(); if (e.button === 0) this.mouseL = false; if (e.button === 2) this.mouseR = false; });
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
      this.pressKey(e.code);
    });
  }

  /** One press of a bound key or mouse button (code is a KeyboardEvent.code, or 'Mouse<button>'). */
  private pressKey(code: string) {
    const digit = code.startsWith('Digit') ? Number(code.slice(5)) : 0;
    if (this.chatOpen) {
      if (digit >= 1 && digit <= QUICK_CHAT.length) this.net.send({ t: 'chat', i: digit - 1 });
      this.chatOpen = false; this.hud.chatMenu(false);
      return;
    }
    if (this.specOn && this.specKey(code)) return;
    switch (code) {
      case 'Enter': this.chatOpen = true; this.hud.chatMenu(true); break;
      case B.act: this.tryTransform(); break;
      case B.help: this.helpOn = !this.helpOn; try { localStorage.setItem('pp_help', this.helpOn ? '1' : '0'); } catch { /* ignore */ } break;
      case B.ab1: this.useAbility(this.team === 'hunter' ? 'pulse' : 'decoy'); break;
      case B.ab2: this.useAbility(this.team === 'hunter' ? 'shock' : 'ghost'); break;
      case B.dash: if (this.team === 'prop' && this.alive) { if (this.body.dashCd <= 0) { this.dashQueued = true; this.sfx.play('dash'); } else this.sfx.play('deny'); } break;
      case B.taunt: this.taunt(Math.floor(Math.random() * TAUNTS.length)); break;
      case 'KeyM': { const m = this.sfx.toggleMute(); localStorage.setItem('pp_mute', m ? '1' : '0'); this.hud.popup(m ? 'Sound off' : 'Sound on'); break; }
      case 'Minus': case 'Equal': this.sens = Math.max(0.0006, Math.min(0.006, this.sens * (code === 'Minus' ? 0.88 : 1.14))); localStorage.setItem('pp_sens', String(this.sens)); this.hud.popup(`Mouse sensitivity ${(this.sens / 0.0022).toFixed(2)}x`); break;
      default: if (digit >= 1 && digit <= 5) this.taunt(digit - 1);
    }
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
        this.pingOut.clear(); this.pingLog.length = 0; this.rtt = -1; this.jitter = 0; this.pingNextAt = 0;
        this.joinCard = true;
        this.hud.show(true);
        // private lobbies need the mouse for Start / bots / invite, so only public games grab it straight away
        if (m.pub) this.requestLock();
        break;
      case 'phase': this.onPhase(m); break;
      case 'roster': this.onRoster(m.p); break;
      case 's': this.onSnap(m); break;
      case 'pong': this.onPong(m.c); break;
      case 'ev': this.onEvent(m); break;
      case 'cd': this.cd = { decoy: m.decoy, ghost: m.ghost, taunt: m.taunt, pulse: m.pulse, shock: m.shock, haunt: m.haunt ?? 0 }; break;
      case 'lobby': this.lobbyInfo = { bots: m.bots, countdown: m.countdown, canStart: m.canStart, at: performance.now(), map: m.map | 0, rounds: m.rounds | 0 || ROUNDS_DEFAULT }; break;
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
    this.phase = m.phase; this.phaseEnds = m.ends; this.round = m.round; this.rounds = m.rounds | 0 || ROUNDS_DEFAULT; this.results = m.results;
    this.loadMap(m.seed, m.map | 0);
    this.nextMap = m.next | 0;
    this.lastTickSec = -1;
    if (m.phase !== 'hunt') { this.panic = false; }
    if (m.phase === 'hiding' || m.phase === 'lobby') { this.world.darkTarget = 0; this.world.stopPoltergeist(); this.freezeUntil = 0; this.revealedUntil = 0; }
    if (m.phase === 'hiding') {
      // new round: forget where everyone was, so nobody is drawn at a stale lobby position
      for (const e of this.ents.values()) { e.buf.length = 0; e.lastSeen = -1e9; }
      this.sfx.music('sneak');
      // which side we are on is confirmed by the roster that follows: the role card is shown from there
      this.bannerPending = 'hiding';
    } else if (m.phase === 'hunt') {
      this.sfx.music('hunt'); this.sfx.play('go');
      this.hud.count(null);
      if (prevPhase === 'hiding') {
        if (this.team === 'hunter') this.hud.banner('GO HUNT!', 'Zap the fakes. Innocent objects cost you FOCUS.', 'pink');
        else if (this.alive) this.hud.banner('HUNTERS RELEASED!', `Hold your nerve. Taunt [${keyLabel(B.taunt)}] near them for big points.`, '');
      }
    } else if (m.phase === 'end' && m.results) {
      // the win or lose jingle first, then the theme comes back in under the results
      this.sfx.music('lobby', prevPhase === 'hunt' ? 3.4 : 0);
      this.world.darkTarget = 0; this.world.stopPoltergeist();
      const res: Results = m.results;
      // straight from a hunt: first a beat in which everyone sees who survived and as what, then the board
      const beat = prevPhase === 'hunt' && CFG.REVEAL_BEAT_MS > 0;
      this.resultsAt = beat ? performance.now() + CFG.REVEAL_BEAT_MS : 0;
      if (beat) {
        const left = res.board.filter((r) => r.survived).length;
        this.hud.banner(res.winner === 'props' ? 'PROPS WIN!' : 'HUNTERS WIN!', res.winner === 'hunters' ? 'Every last prop was found.' : left === 1 ? 'One prop made it. There it is!' : `${left} props made it. There they are!`, res.winner === 'props' ? '' : 'pink', CFG.REVEAL_BEAT_MS);
        if (left) this.sfx.play('reveal');
      }
      const won = (res.winner === 'props' && this.team === 'prop') || (res.winner === 'hunters' && this.team === 'hunter');
      this.sfx.play(won || this.team === 'spec' ? 'win' : 'lose');
      const mine = res.board.find((r) => r.id === this.myId);
      // bank this round's rewards once: results are sent again to a client that reconnects or reloads during them
      const key = `${this.code}:${res.n}:${m.seed}`;
      if (mine && mine.st && this.profile.paid !== key) {
        const fin = res.final?.find((r) => r.id === this.myId);
        const rep = bankRound(this.profile, {
          key, day: utcDay(), team: mine.team, won: mine.team !== 'spec' && (mine.team === 'prop') === (res.winner === 'props'),
          survived: mine.survived, pts: mine.round, coins: (mine.coins | 0) + ((fin?.coins ?? 0) | 0), st: mine.st,
          gameOver: !!res.final, place: fin && res.final ? res.final.indexOf(fin) + 1 : 0, players: res.final?.length ?? 0,
        });
        saveProfile(this.profile);
        this.report = rep;
        this.onBanked(rep);
        this.hud.popup(`+${rep.xp} XP`);
        if (rep.coins) this.hud.popup(`+${rep.coins} coins`);
        // a jingle as the board comes up if the round brought anything new; the panel itself lists what (see Hud.progress)
        if (rep.levelTo > rep.levelFrom || rep.feats.length || rep.unlocked.length || rep.shift) window.setTimeout(() => this.sfx.play('levelup'), Math.max(0, this.resultsAt - performance.now()) + 300);
      } else if (!mine) this.report = null;
      // celebratory confetti a few steps ahead, so it never fills a first-person view
      if (this.hasMe) { const [fx, , fz] = aimDir(this.yaw, 0); this.fx.burst(this.body.x + fx * 3, this.body.y + 1.2, this.body.z + fz * 3, 70, CONFETTI, 4, 6, 1.1, 1.8); }
    } else {
      this.sfx.music('lobby');
      if (prevPhase !== 'lobby' && this.inGame) {
        // back from a game: the host of a private room needs the mouse for Start, bots and the game length
        if (!this.pub && this.roster.get(this.myId)?.host && document.pointerLockElement) document.exitPointerLock();
        this.onLobby();
      }
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
      let e = this.ents.get(r.id);
      // hunters are not told a prop's disguise up front (-1): it arrives with the prop's position once it is in view
      let wantKind = !r.alive || r.team === 'spec' ? '' : r.team === 'hunter' ? (r.quack ? 'duck' : `hunter:${r.kit?.[KIT.paint] | 0}.${r.kit?.[KIT.hat] | 0}.${r.kit?.[KIT.char] | 0}.${r.kit?.[KIT.gun] ?? 0}`) : r.disguise >= 0 ? 'prop:' + r.disguise : '?';
      if (wantKind === '?') wantKind = e && e.kind.startsWith('prop:') ? e.kind : 'prop:' + (PROPS[e?.netType ?? -1] ? e!.netType : -1);
      if (!wantKind) { if (e) { this.scene.remove(e.group); this.ents.delete(r.id); } continue; }
      if (!e) {
        e = { id: r.id, group: new THREE.Group(), model: null, rig: null, pitch: 0, kick: 0, vy: 0, netType: -1, eyes: null, stars: null, eyeK: 0, kind: '', buf: [], flags: 0, lastSeen: -1e9, label: null, labelKey: '', marker: null, hitT: 0, hopT: 0, x: 0, y: -50, z: 0, f: 0, speed: 0, stepT: 0, h: 1, popT: 0, beam: null };
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
      this.bannerPending = ''; this.joinCard = false;
      this.showRole(false);
    } else if (this.joinCard && this.roster.has(this.myId)) {
      // dropped into a hunt that is already running: say what we are, there was no round start to say it
      this.joinCard = false;
      if (this.phase === 'hunt') this.showRole(true);
    }
  }

  /** The role card: which side you are on this round, who is on the other one, and the one thing to do next. */
  private showRole(late: boolean) {
    const all = [...this.roster.values()];
    const hunters = all.filter((r) => r.team === 'hunter').map((r) => r.name);
    const props = all.filter((r) => r.team === 'prop' && r.alive).length;
    const where = `${this.rounds > 1 ? `ROUND ${this.round} OF ${this.rounds} · ` : ''}${(MAP_NAMES[this.mapId] ?? '').toUpperCase()}`;
    const who = hunters.length > 2 ? `${hunters.slice(0, -1).join(', ')} and ${hunters[hunters.length - 1]}` : hunters.join(' and ');
    const act = this.touch ? 'BECOME' : keyLabel(B.act);
    if (this.team === 'hunter') {
      this.hud.roleCard('hunter', where, hunters.length > 1 ? 'YOU ARE A HUNTER' : 'YOU ARE THE HUNTER', `${props} ${props === 1 ? 'prop is' : 'props are'} hiding among the objects. Find the fakes and zap them.`, CFG.ROLE_CARD_MS);
      this.sfx.play('roleHunter');
    } else if (this.team === 'prop' && this.alive) {
      this.hud.roleCard('prop', where, 'YOU ARE A PROP', late ? `The hunt is already on! Become an object [${act}] and blend in, quick.` : `${who || 'A hunter'} ${hunters.length > 1 ? 'are' : 'is'} coming. Become an object [${act}] and blend in.`, CFG.ROLE_CARD_MS);
      this.sfx.play('roleProp');
    } else if (late) {
      this.hud.roleCard('ghost', where, 'ROUND IN PROGRESS', CFG.HAUNT_ON ? 'You play in the next one. Until then you are a ghost: aim at an object and haunt it.' : 'You play in the next one. Until then, have a look around.', CFG.ROLE_CARD_MS + 800);
    }
  }

  private buildModel(e: Ent, kind: string) {
    if (e.model) e.group.remove(e.model);
    if (e.eyes) { e.group.remove(e.eyes); e.eyes = null; }
    const real = (k: string) => k.startsWith('prop:') && k !== 'prop:-1';
    if (real(e.kind) && real(kind) && e.kind !== kind) e.popT = 0.4; // a new disguise pops into shape
    e.kind = kind; e.rig = null; e.model = null;
    if (kind === 'prop:-1') { e.labelKey = ''; return; } // an unseen prop: nothing to draw yet
    if (kind.startsWith('hunter')) {
      const [pi, hi, ci, gi] = kind.slice(7).split('.').map(Number);
      e.rig = new HunterRig(pi || 0, hi || 0, ci || 0, gi || 0);
      e.model = e.rig.root; e.h = CFG.HUNTER_H;
    } else {
      const type = kind === 'duck' ? DUCK_TYPE : Number(kind.slice(5));
      const def = PROPS[type];
      const m = assets.propObject(type);
      if (kind === 'duck') m.scale.setScalar(1.5);
      e.model = m; e.h = def.h * (kind === 'duck' ? 1.5 : 1);
      if (kind !== 'duck') {
        // googly eyes: hidden until this prop gives itself away (taunt, panic, sneeze, scanner)
        const k = Math.max(0.55, Math.min(1.6, Math.min(def.w, def.h) / 0.6));
        e.eyes = buildEyes(this.roster.get(e.id)?.kit?.[2] ?? 0);
        e.eyes.position.set(0, def.h + 0.07 * k, def.d * 0.22); // perched on top so they read from any angle
        e.eyes.userData.k = k; e.eyes.scale.setScalar(0.001); e.eyes.visible = false;
        e.group.add(e.eyes);
      }
    }
    e.group.add(e.model);
    e.labelKey = '';
  }

  private onPong(c: number) {
    const sentAt = this.pingOut.get(c);
    if (sentAt === undefined) return; // already written off as lost, or from a previous connection
    this.pingOut.delete(c);
    const ms = Math.min(999, performance.now() - sentAt);
    if (this.rtt < 0) this.rtt = ms;
    else { this.jitter += (Math.abs(ms - this.rtt) - this.jitter) * 0.25; this.rtt += (ms - this.rtt) * 0.35; }
    this.logPing(true);
  }

  private logPing(ok: boolean) { this.pingLog.push(ok); if (this.pingLog.length > 20) this.pingLog.shift(); }

  /** Sends a ping each second, writes off unanswered ones and refreshes the HUD's connection badge. */
  private updateNet(t: number) {
    if (!this.inGame) return;
    for (const [c, at] of this.pingOut) if (t - at > 2500) { this.pingOut.delete(c); this.logPing(false); }
    if (t >= this.pingNextAt) {
      this.pingNextAt = t + 1000;
      const c = ++this.pingSent;
      this.pingOut.set(c, performance.now());
      this.net.send({ t: 'ping', c });
    }
    if (t - this.netHudAt < 250) return;
    this.netHudAt = t;
    const lost = this.pingLog.filter((ok) => !ok).length;
    const loss = this.pingLog.length ? Math.round((lost / this.pingLog.length) * 100) : 0;
    // nothing back for a while: the connection is stalled, whatever the last good reading was
    let oldest = Infinity; for (const at of this.pingOut.values()) oldest = Math.min(oldest, at);
    const stalled = t - oldest > 2000;
    this.hud.setNet(stalled ? -1 : Math.round(this.rtt), loss, Math.round(this.fps));
    const slowDevice = this.fps < 30 && !document.hidden; // a starved main thread reads replies late and inflates ping
    const bad = stalled || this.rtt >= 200 || loss >= 10 || this.jitter >= 60 || slowDevice;
    if (!bad) { this.badNetSince = 0; return; }
    if (!this.badNetSince) this.badNetSince = t;
    if (t - this.badNetSince > 4000 && t - this.badNetWarnAt > 45000) {
      this.badNetWarnAt = t;
      const why = stalled ? 'Connection stalled: the server is not answering' : slowDevice ? `Low frame rate (${Math.round(this.fps)} FPS): your device is causing the lag, not the network` : loss >= 10 ? `Unstable connection: ${loss}% packet loss` : this.jitter >= 60 ? 'Unstable connection: ping is jumping around' : `High ping (${Math.round(this.rtt)} ms): expect lag`;
      this.hud.popup(why, true);
    }
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
      const type = row[7] ?? -1;
      if (type >= 0 && PROPS[type]) { e.netType = type; if (e.kind.startsWith('prop:') && e.kind !== 'prop:' + type) this.buildModel(e, 'prop:' + type); }
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
    if (this.decoys.has(d.id)) return;
    const mesh = assets.propObject(d.type);
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
        const eyes = this.specOn && this.specPov && this.specMode === 'follow' && m.by === this.specTarget; // watching through this hunter's eyes
        if (eyes) { this.recoil = 1; this.muzzleT = 0.05; }
        const src = this.entPos(m.by);
        const shooter = this.ents.get(m.by); if (shooter) shooter.kick = 1;
        const to = new THREE.Vector3(m.x, m.y, m.z);
        const kit = this.roster.get(m.by)?.kit;
        if (src) {
          // from the muzzle you can see: your own blaster on screen, or the one in the shooter's hand
          let from: THREE.Vector3;
          if ((mine && !this.quackedMe) || eyes) { this.muzzle.updateWorldMatrix(true, false); from = this.muzzle.getWorldPosition(new THREE.Vector3()); }
          else if (shooter?.rig && shooter.group.visible) { shooter.group.updateMatrixWorld(true); from = shooter.rig.muzzle.getWorldPosition(new THREE.Vector3()); }
          else from = new THREE.Vector3(src[0], src[1] + 1.3, src[2]);
          this.fx.zap(from, to, kit?.[KIT.trail] ?? 0);
          if (!mine) this.sfx.play('shoot', [src[0], src[1] + 1.4, src[2]]);
          this.fx.flash(from.x, from.y, from.z, GUNS[kit?.[KIT.gun] ?? 0]?.flash ?? 0xffe08a, mine ? 14 : 22);
        }
        if (m.hit === 1) { this.fx.burst(m.x, m.y, m.z, 5, [0xdddddd, 0xfff27a], 1.5, 1.5, 0.6, 0.4); this.sfx.play('thud', [m.x, m.y, m.z], 0.6); }
        else if (m.hit === 2) {
          this.world.wobble(m.tg);
          this.fx.burst(m.x, m.y, m.z, 9, [0xffffff, 0xffd166, 0xbbbbbb], 2.2, 2.4, 0.7, 0.6);
          this.sfx.play('bonk', [m.x, m.y, m.z]);
          if (mine) { this.hud.hitmark('#b8c0cc'); if (!m.sp) this.hud.popup(`Innocent object!  −${CFG.FOCUS_MISS} focus`, true); }
        } else if (m.hit === 3) {
          // a hit reads at a glance: confetti, a squash, and how many hits the prop has left
          this.fx.burst(m.x, m.y, m.z, 16, CONFETTI, 3.5, 3.5, 0.9, 0.8);
          this.sfx.play('hit', mine ? undefined : [m.x, m.y, m.z]);
          const e = this.ents.get(m.tg);
          if (e) e.hitT = 0.3;
          const left = typeof m.hp === 'number' ? Math.ceil(m.hp / CFG.DMG) : -1;
          if (left > 0) this.fx.floater(m.x, m.y + 0.5, m.z, left === 1 ? 'ONE MORE!' : `${left} MORE`, '#ffd166', 0.42, false, 0.9);
          if (mine) this.hud.hitmark('#ffd166');
        }
        break;
      }
      case 'kill': {
        this.fx.pop(m.x, m.y + 0.4, m.z, this.roster.get(m.who)?.kit?.[3] ?? 0); // in the caught player's chosen style
        this.fx.floater(m.x, m.y + 1.2, m.z, 'CAUGHT!', '#ff8fa3', 0.6, false, 1.6);
        if (CFG.HAUNT_ON) this.fx.ghost(m.x, m.y + 0.6, m.z, 0.8);
        this.sfx.play('kill', m.who === me || m.by === me ? undefined : [m.x, m.y, m.z]);
        const r = this.roster.get(m.who);
        this.hud.feed([{ b: this.nameOf(m.by) }, ' caught ', { b: this.nameOf(m.who) }, PROPS[m.ty ?? r?.disguise ?? -1] ? ` (the ${PROPS[m.ty ?? r!.disguise].name})` : ''], 'kill');
        this.fx.flash(m.x, m.y + 0.6, m.z, 0xff8fa3, 40);
        if (m.by === me) this.fovPunch = 9;
        if (m.who === me) {
          // the ghost starts out attached to whoever caught it (see enterSpectator)
          this.hud.banner('CAUGHT!', !CFG.HAUNT_ON ? (this.touch ? 'You are a ghost now. Watch anyone, or push the stick to fly.' : 'You are a ghost now. Click to watch other players, or move to fly free.')
            : this.touch ? 'You are a ghost! Aim at an object and tap HAUNT to bait the hunters.' : 'You are a ghost! Aim at an object and click to haunt it. If a hunter shoots it, you score.', 'pink', 3800);
          this.specPos.set(m.x, m.y + 2.5, m.z); this.specTarget = m.by; this.shake = 0.5;
        }
        else if (m.by === me) this.hud.banner('GOT ONE!', `${this.nameOf(m.who)} was the ${PROPS[m.ty ?? r?.disguise ?? -1]?.name ?? 'prop'}`, '', 1800);
        break;
      }
      case 'taunt': {
        const mine = m.who === me;
        this.sfx.play('taunt' + m.i, mine ? undefined : [m.x, m.y + 0.3, m.z], mine ? 0.6 : 1.3);
        this.fx.floater(m.x, m.y + 0.9, m.z, '♪', '#ffd166', 0.5);
        const e = this.ents.get(m.who);
        if (e) e.hopT = 0.45;
        // hunters get an arrow towards the sound: stereo alone cannot tell front from behind
        if (!mine && this.team === 'hunter' && this.alive) {
          const el = document.createElement('div'); el.className = 'dir';
          el.append(document.createElement('i'), Object.assign(document.createElement('b'), { textContent: 'TAUNT' }));
          document.getElementById('dirs')!.append(el);
          this.pings.push({ x: m.x, z: m.z, until: this.time + 2.6, el });
        }
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
      case 'decoy': {
        // hunters hear of a decoy only when it comes into view: no sound for that, it just sits there like an object
        const fresh = !this.decoys.has(m.id);
        this.addDecoy(m);
        if (m.owner === me) this.hud.popup('Decoy placed. Now walk away casually.');
        if (fresh && m.owner) this.sfx.play('poof', [m.x, m.y, m.z], 0.4);
        break;
      }
      case 'decoyHop': { const d = this.decoys.get(m.id); if (d) d.hopT = 0.6; break; }
      case 'decoyPop': {
        const d = this.decoys.get(m.id);
        if (!d) break;
        this.scene.remove(d.mesh); this.decoys.delete(m.id);
        this.fx.burst(d.x, d.y + 0.4, d.z, 45, CONFETTI, 5, 5, 1.1, 1.2);
        this.sfx.play('pop', [d.x, d.y + 0.4, d.z], 1.4);
        if (m.by) {
          this.fx.floater(d.x, d.y + 1.1, d.z, 'DECOY!', '#c8a8ff', 0.6, false, 1.5);
          this.hud.feed(d.owner ? [{ b: this.nameOf(m.by) }, ' shot a decoy planted by ', { b: this.nameOf(d.owner) }] : [{ b: this.nameOf(m.by) }, ' shot a decoy'], 'chaos');
        }
        break;
      }
      case 'quack': {
        const pos = this.entPos(m.who);
        if (pos) { this.fx.burst(pos[0], pos[1] + 0.6, pos[2], 30, [0xffd166, 0xffffff, 0xf78c2b], 3.5, 3.5, 1.1, 0.9); this.sfx.play(m.on ? 'quacked' : 'poof', m.who === me ? undefined : [pos[0], pos[1], pos[2]], 1.3); }
        if (m.on) {
          this.hud.feed([{ b: this.nameOf(m.who) }, ' ran out of focus and turned into a duck'], 'chaos');
          if (m.who === me) { this.hud.banner('QUACK!', 'Too many innocent objects. Enjoy 6 seconds as a duck.', 'purple', 2600); this.pitch = Math.min(this.pitch, 0.3); }
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
        if (m.who === me) this.hud.banner('LAST PROP STANDING', 'Vanish and Decoy recharged. Make it count!', 'teal', 3000);
        else this.hud.banner('ONE LEFT!', `${this.nameOf(m.who)} is the last prop. Roll calls come faster now.`, 'pink', 2600);
        break;
      }
      case 'sneeze': {
        for (const p of m.pts as number[][]) { this.sfx.play('sneeze', p[0] === me ? undefined : [p[1], p[2] + 0.3, p[3]], 1.4); this.fx.burst(p[1], p[2] + 0.5, p[3], 10, [0xffffff, 0xcdeffd], 2.5, 2, 0.7, 0.5, 4); const e = this.ents.get(p[0]); if (e) e.hopT = 0.9; }
        break;
      }
      case 'chaos': {
        this.sfx.play('chaos');
        if (m.kind === 'blackout') { this.world.darkTarget = 1; this.sfx.play('blackout'); this.hud.banner(this.mapId === 1 ? 'ECLIPSE!' : 'BLACKOUT!', this.team === 'hunter' ? 'Flashlights only. They can see you coming.' : 'Darkness falls. Move while they are blind!', 'purple'); }
        else if (m.kind === 'poltergeist') { this.world.poltergeist(m.seed, m.ms); this.hud.banner('POLTERGEIST!', 'The furniture is alive. Good luck telling who is who.', 'purple'); }
        else if (m.kind === 'shuffle') this.hud.banner('PROP SHUFFLE!', 'Every prop just became something else.', 'purple');
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
      case 'haunt': {
        this.world.haunt(m.d);
        const info = this.world.decorDef(m.d);
        if (!info) break;
        const { d, def } = info;
        this.sfx.play('haunt', [d.x, d.y + def.h / 2, d.z], 1.2);
        // the props' side sees who did it; to a hunter it is just an object that moved
        if (this.team !== 'hunter' || !this.alive) { this.fx.ghost(d.x, d.y + def.h + 0.2, d.z, 0.45); if (m.by === me) this.hud.popup('Haunted! Now wait for a hunter to take the bait.'); }
        break;
      }
      case 'spook': {
        this.sfx.play('spook', m.by === me ? undefined : [m.x, m.y, m.z], 1.3);
        this.fx.ghost(m.x, m.y + 0.3, m.z, 1.1);
        this.fx.floater(m.x, m.y + 1.0, m.z, 'BOO!', '#a8dcff', 0.7, false, 1.5);
        this.hud.feed([{ b: this.nameOf(m.ghost) }, '\'s ghost spooked ', { b: this.nameOf(m.by) }], 'chaos');
        if (m.by === me) { this.hud.banner('SPOOKED!', `A ghost rattled that one. Real objects that move are bait.  −${CFG.FOCUS_SPOOK} focus`, 'purple', 2400); this.shake = 0.45; }
        else if (m.ghost === me) this.hud.banner('BOO!', `${this.nameOf(m.by)} fell for it.`, 'teal', 1800);
        break;
      }
      case 'sub': {
        const to = m.to ? this.nameOf(m.to) : '';
        this.hud.feed(to ? [{ b: this.nameOf(m.from) }, ' left the hunt. ', { b: to }, ' (bot) takes over'] : [{ b: this.nameOf(m.from) }, ' left the hunt'], 'chaos');
        if (m.to === me) this.hud.banner('YOU ARE THE HUNTER NOW', 'A hunter left, so you take over. Zap the fakes!', 'pink', 2600);
        break;
      }
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
    if (this.touch) { mx = this.stick.x; mz = -this.stick.y; }
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
    const wasGround = b.ground, vy0 = b.vy;
    this.phys.step(b, cmd, this.speed, this.jumpV, this.team === 'prop');
    // small movement sounds make the character feel connected to the floor
    if (!wasGround && b.ground && vy0 < -6) this.sfx.play('land', undefined, Math.min(1, -vy0 / 12));
    else if (wasGround && !b.ground && b.vy > 3) this.sfx.play('jump', undefined, 0.45);
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
    const extra = GUNS[kitToWire(this.profile)[KIT.gun]]?.sfx; // a little extra on your own shot only: everyone else hears the same zap
    if (extra) this.sfx.play(extra, undefined, 0.35);
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
    e.vy = dt > 0 && e.y > -40 ? (y - e.y) / dt : 0;
    e.x = x; e.y = y; e.z = z;
    e.f = lerpAngle(a.f, b.f, k);
    e.pitch = a.p + (b.p - a.p) * k;
  }

  private updateEnts(dt: number) {
    const now = this.serverNow(), rt = now - INTERP_MS;
    const viewerHunter = this.team === 'hunter' && this.alive;
    const viewerSpec = !this.alive || this.team === 'spec';
    const firstPerson = viewerHunter && !this.quackedMe;
    const eyesOf = this.specOn && this.specPov && this.specMode === 'follow' ? this.specTarget : 0;
    const cam = this.camera.position;
    for (const e of this.ents.values()) {
      const mine = e.id === this.myId;
      if (mine) {
        if (!this.hasMe) { e.group.visible = false; continue; }
        const sp = Math.hypot(this.body.vx, this.body.vz);
        e.x = this.rpos.x; e.y = this.rpos.y; e.z = this.rpos.z; e.f = this.facing; e.speed = sp;
        e.flags = F.ALIVE | (this.body.dashLeft > 0 ? F.DASH : 0) | (this.revealedUntil > performance.now() ? F.REVEAL : 0) | (this.myFlags & (F.PANIC | F.GHOST));
        e.group.visible = !firstPerson;
        e.pitch = this.pitch; e.vy = this.body.ground ? 0 : 5;
      } else {
        if (!e.model) { e.group.visible = false; continue; }
        this.sampleEnt(e, rt, dt);
        // "not heard about recently" hides a player (ghosted, blindfold) — but never on the frame right after
        // a hitch, when the network messages that would refresh them are still waiting to be processed
        e.group.visible = (now - e.lastSeen < 450 || (this.hitch > 0 && e.group.visible)) && e.buf.length > 0;
        if (e.id === eyesOf) e.group.visible = false; // a ghost looking through this hunter's eyes
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
      if (e.flags & F.PANIC) { tilt += Math.sin(this.time * 46) * 0.1; sq += Math.sin(this.time * 31) * 0.06; if (Math.random() < dt * 14) this.fx.burst(e.x, e.y + e.h, e.z, 1, [0x9bdcff, 0xffffff], 1.4, 2, 0.6, 0.5); }
      if (e.flags & F.DASH && Math.random() < dt * 30) this.fx.burst(e.x, e.y + 0.1, e.z, 1, [0xffffff, 0xffe5ec], 0.8, 0.8, 0.9, 0.35, 2);
      if (e.hopT > 0) { e.hopT -= dt; hop += Math.sin((1 - e.hopT / 0.45) * Math.PI) * 0.3; sq += Math.sin(e.hopT * 30) * 0.1; }
      if (e.hitT > 0) { e.hitT -= dt; sq += Math.sin(e.hitT * 40) * 0.22 * (e.hitT / 0.3); }
      if (e.kind === 'duck') tilt += Math.sin(this.time * 9) * 0.15;
      let pop = 1;
      if (e.popT > 0) { e.popT = Math.max(0, e.popT - dt); const k = 1 - e.popT / 0.4; pop = 0.55 + 0.45 * k + Math.sin(k * Math.PI) * 0.22; }
      const dizzy = (e.flags & F.DIZZY) !== 0;
      if (e.rig) {
        e.kick = Math.max(0, e.kick - dt * 6);
        e.rig.pose({ time: this.time, stepT: e.stepT, move, pitch: e.pitch, air: Math.abs(e.vy) > 1.2, dizzy, kick: e.kick });
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
      m.scale.set(base * pop * (1 + sq), base * pop * (1 - sq), base * pop * (1 + sq));
      // once the round is over, a pillar of light over every prop that made it, so everyone sees where they were
      const survivor = this.phase === 'end' && isProp && !!r?.alive && r.team === 'prop';
      if (survivor && !e.beam) { e.beam = makeBeacon(); e.group.add(e.beam); }
      if (e.beam) e.beam.visible = survivor;
      // ghosted props are see-through for friends, absent for hunters
      const ghost = (e.flags & F.GHOST) !== 0;
      if (isProp) for (const c of m.children) { const want = ghost ? this.ghostMat : c.userData.mat; if ((c as THREE.Mesh).material !== want) (c as THREE.Mesh).material = want; }
      // hunter footsteps carry through the store
      if (e.rig && e.speed > 2.5 && !mine) { if (e.stepT > Math.PI) { e.stepT -= Math.PI; this.sfx.play('step', [e.x, e.y, e.z], 0.9); } }
      // name labels: you can always recognise your own side
      let label = '';
      if (r && !mine) {
        if (viewerSpec) label = r.name;
        else if (viewerHunter) label = r.team === 'hunter' ? r.name : '';
        else label = r.name;
      }
      // ghosts read every name through walls, and at a size that stays legible across the map
      const key = label + '|' + (r?.team ?? '') + (viewerSpec ? '|g' : '');
      if (key !== e.labelKey) {
        e.labelKey = key;
        if (e.label) { e.group.remove(e.label); e.label.material.dispose(); e.label = null; }
        if (label) {
          e.label = textSprite(label, r!.team === 'hunter' ? '#ff8fa3' : '#ffe9a8', 0.26, !viewerSpec);
          e.label.userData.w = e.label.scale.x; e.label.renderOrder = viewerSpec ? 6 : 0;
          e.group.add(e.label);
        }
      }
      if (e.label) {
        const k = viewerSpec ? Math.max(1, Math.min(7, Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z) / 8)) : 1;
        e.label.scale.set(e.label.userData.w * k, 0.26 * k, 1);
        e.label.position.y = e.h + 0.19 + 0.13 * k;
      }
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
  private pings: { x: number; z: number; until: number; el: HTMLElement }[] = [];
  private updatePings() {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i], left = p.until - this.time;
      if (left <= 0 || this.team !== 'hunter') { p.el.remove(); this.pings.splice(i, 1); continue; }
      const dx = p.x - this.camera.position.x, dz = p.z - this.camera.position.z;
      const ang = Math.atan2(dx * Math.cos(this.yaw) - dz * Math.sin(this.yaw), -dx * Math.sin(this.yaw) - dz * Math.cos(this.yaw));
      p.el.style.transform = `rotate(${ang.toFixed(3)}rad)`;
      p.el.style.opacity = String(Math.min(1, left / 0.6));
      (p.el.lastChild as HTMLElement).textContent = `${Math.round(Math.hypot(dx, dz))} m`;
    }
  }
  private lastSend = 0;
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
      // the fitting room: only on screens wide enough to show the robot and the profile panel side by side
      // (upright phones: nudge the scene right instead, so the robot is not cut off at the left edge)
      const w = window.innerWidth, h = window.innerHeight, goal = h > w ? -0.36 : this.menuShift && w >= 1000 ? 0.16 : 0;
      this.menuShiftNow += (goal - this.menuShiftNow) * Math.min(1, dt * 6);
      if (Math.abs(this.menuShiftNow) > 0.001) { cam.setViewOffset(w, h, this.menuShiftNow * w, 0, w, h); }
      else if (cam.view?.enabled) { this.menuShiftNow = 0; cam.clearViewOffset(); }
      this.preview.visible = true;
      this.preview.rotation.y = 0.35 + Math.sin(this.menuAngle * 0.9) * 0.3;
      this.preview.position.y = Math.abs(Math.sin(this.menuAngle * 2.2)) * 0.04;
      this.previewKick = Math.max(0, this.previewKick - dt * 5);
      this.previewRig?.pose({ time: this.menuAngle, stepT: 0, move: 0, pitch: 0.25 + Math.sin(this.menuAngle * 1.1) * 0.2, air: false, dizzy: false, kick: this.previewKick });
      this.showcase.visible = this.showcaseOn;
      if (this.showcaseOn) {
        // the box twitches now and then, eyes out, like a prop that cannot keep still
        const t = this.menuAngle % 3.2, hop = t < 0.35 ? Math.sin((t / 0.35) * Math.PI) : 0;
        this.showcase.position.y = hop * 0.08; this.showcase.rotation.z = hop * 0.12;
        const eyes = this.showcase.getObjectByName('eyes');
        if (eyes) eyes.scale.setScalar(1 + Math.sin(this.menuAngle * 30) * 0.04 * hop);
      }
      this.viewmodel.visible = false;
      return;
    }
    this.preview.visible = false; this.showcase.visible = false;
    if (cam.view?.enabled) { this.menuShiftNow = 0; cam.clearViewOffset(); }
    const ghost = !this.alive || this.team === 'spec';
    if (ghost !== this.specOn) { if (ghost) this.enterSpectator(); else { this.specOn = false; this.specTarget = 0; this.specPov = false; this.specMode = 'follow'; } }
    // hunters: while the props hide, a free look round the room as it was stocked (it holds no props: the server sends none)
    const preview = CFG.PREVIEW_ON && !ghost && this.hasMe && this.team === 'hunter' && this.phase === 'hiding';
    if (preview !== this.previewOn) {
      this.previewOn = preview;
      if (preview) { this.specPos.set(this.rpos.x, this.rpos.y + CFG.HUNTER_EYE, this.rpos.z); this.specVel.set(0, 0, 0); }
      else { this.glideFrom.copy(cam.position); this.glide = 0; } // and back into the hunter's own head, smoothly
    }
    let firstPerson = false, dashing = false;
    if (preview) {
      this.viewmodel.visible = false;
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.fly(dt);
    } else if (ghost || !this.hasMe) {
      this.updateSpectator(dt); // may steer yaw and pitch (through a hunter's eyes), so the rotation is applied after
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else {
      cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      // smooth the vertical pops from stepping up ledges
      const ty = this.rpos.y;
      if (Math.abs(ty - this.camY) > 0.6 || !this.body.ground) this.camY = ty; else this.camY += (ty - this.camY) * Math.min(1, dt * 16);
      firstPerson = this.team === 'hunter' && !this.quackedMe;
      dashing = this.body.dashLeft > 0 && !firstPerson;
      if (firstPerson) {
        this.setViewmodel(kitToWire(this.profile));
        const bobY = this.poseViewmodel(dt, Math.hypot(this.body.vx, this.body.vz), this.body.ground);
        cam.position.set(this.rpos.x, this.camY + CFG.HUNTER_EYE + bobY, this.rpos.z);
        if (this.glide < 1) { this.glide = Math.min(1, this.glide + dt * 2.2); const k = this.glide * this.glide * (3 - 2 * this.glide); cam.position.lerpVectors(this.glideFrom, cam.position.clone(), k); }
        if (this.myFlags & F.DIZZY) { cam.rotation.z = Math.sin(this.time * 9) * 0.07; cam.rotation.x += Math.sin(this.time * 6) * 0.03; }
      } else {
        this.viewmodel.visible = false;
        this.orbit(cam.position, this.rpos.x, this.camY, this.rpos.z, this.body.h, dt);
      }
    }
    // field of view: right mouse zooms the hunter's aim; shots and catches give a small punch
    const ads = firstPerson && this.mouseR && this.locked;
    this.zoomK = ads ? 0.55 : 1;
    this.fovPunch *= Math.exp(-dt * 9);
    const fovT = (ads ? this.baseFov * 0.6 : this.baseFov) + this.fovPunch + (dashing ? 7 : 0);
    this.fovNow += (fovT - this.fovNow) * Math.min(1, dt * 14);
    if (Math.abs(cam.fov - this.fovNow) > 0.05) { cam.fov = this.fovNow; cam.updateProjectionMatrix(); }
    if (this.shake > 0.001) {
      cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.12;
      cam.rotation.y += (Math.random() - 0.5) * this.shake * 0.12;
      this.shake *= Math.exp(-dt * 7);
    }
  }

  /** Third-person camera: sits behind (x, y, z) along the aim, pulled in when a wall is in the way. */
  private orbit(out: THREE.Vector3, x: number, y: number, z: number, h: number, dt: number) {
    const ty = y + Math.min(1.7, Math.max(0.95, h * 0.75 + 0.35));
    const [dx, dy, dz] = aimDir(this.yaw, this.pitch);
    let dist = this.camDist + h * 0.5;
    const hit = this.phys.raycast(x, ty, z, -dx, -dy, -dz, dist + 0.3);
    if (hit.t < dist + 0.3) dist = Math.max(0.35, hit.t - 0.3);
    this.camDistNow += (dist - this.camDistNow) * Math.min(1, dt * (dist < this.camDistNow ? 30 : 8));
    out.set(x - dx * this.camDistNow, Math.max(0.25, ty - dy * this.camDistNow), z - dz * this.camDistNow);
  }

  /** First-person blaster: sway with the stride, kick back on a shot. Returns this frame's head bob. */
  private poseViewmodel(dt: number, sp: number, ground: boolean): number {
    this.bob += dt * sp * 1.9;
    const steps = Math.floor(this.bob / Math.PI);
    if (steps !== this.stepCount) { this.stepCount = steps; if (ground && sp > 2) this.sfx.play('stepSoft', undefined, 0.5); }
    const k = Math.min(1, sp / 5);
    this.viewmodel.visible = true;
    this.recoil = Math.max(0, this.recoil - dt * 7);
    const r = this.recoil * this.recoil;
    this.viewmodel.position.set(0.25 + Math.cos(this.bob * 0.5) * 0.008 * k, -0.2 + Math.abs(Math.sin(this.bob * 0.5)) * 0.012 * k + r * 0.02, -0.5 + r * 0.12);
    this.viewmodel.rotation.set(r * 0.35, 0, 0);
    this.muzzleT -= dt; this.muzzle.visible = this.muzzleT > 0;
    if (this.muzzle.visible) this.muzzle.scale.setScalar(0.8 + Math.random() * 0.9);
    return ground ? Math.sin(this.bob) * 0.035 * k : 0;
  }

  // ================================================================ ghost mode
  // Caught props and late joiners become ghosts. A ghost is either attached to a living player (orbiting
  // them, or looking through a hunter's eyes) or flying free through the map. All of it is local: the
  // server already sends spectators everybody's position.

  /** Players a ghost can attach to, hunters first, in a stable order for cycling. */
  private specList(): number[] {
    const now = this.serverNow(), out: RosterEntry[] = [];
    for (const r of this.roster.values()) {
      if (r.id === this.myId || !r.alive || r.team === 'spec') continue;
      const e = this.ents.get(r.id);
      if (e && e.model && e.buf.length && now - e.lastSeen < 1500) out.push(r);
    }
    out.sort((a, b) => (a.team === b.team ? a.id - b.id : a.team === 'hunter' ? -1 : 1));
    return out.map((r) => r.id);
  }

  /** The player under the crosshair (within about 17 degrees); with `orNearest`, otherwise the closest one. */
  private specAim(orNearest: boolean): number {
    const c = this.camera.position, [dx, dy, dz] = aimDir(this.yaw, this.pitch);
    let best = 0, bs = 0.956, near = 0, nd = 1e9;
    for (const id of this.specList()) {
      const e = this.ents.get(id)!;
      const ox = e.x - c.x, oy = e.y + e.h / 2 - c.y, oz = e.z - c.z, d = Math.hypot(ox, oy, oz) || 1;
      const dot = (ox * dx + oy * dy + oz * dz) / d;
      if (dot > bs) { bs = dot; best = id; }
      if (d < nd) { nd = d; near = id; }
    }
    return best || (orNearest ? near : 0);
  }

  /** True while the watched player is a hunter whose eyes a ghost can borrow. */
  get specEyes(): boolean { return this.specOn && this.specMode === 'follow' && this.canPov(this.specTarget); }
  private canPov(id: number): boolean { const r = this.roster.get(id); return !!r && r.team === 'hunter' && !r.quack; }

  private enterSpectator() {
    this.specOn = true; this.specPov = false; this.specVel.set(0, 0, 0);
    const list = this.specList();
    if (!list.includes(this.specTarget)) this.specTarget = list[0] ?? 0;
    if (this.specTarget) this.specAttach(this.specTarget, true);
    else {
      // nobody to watch yet (a late joiner's first positions are still on their way): hover, and attach when they arrive
      this.specMode = 'free'; this.specSeek = this.time + 3;
      if (this.hasMe) this.specPos.copy(this.camera.position);
    }
  }

  private specAttach(id: number, quiet = false) {
    this.specMode = 'follow'; this.specTarget = id; this.specPov = false; this.specSeek = 0;
    this.specFrom.copy(this.camera.position); this.specBlend = 0; // glide over rather than cut
    const e = this.ents.get(id);
    if (e) this.camY = e.y;
    this.pitch = Math.max(-1.2, Math.min(0.2, this.pitch));
    if (!quiet) this.sfx.play('click', undefined, 0.6);
  }

  private specFree() {
    this.specMode = 'free'; this.specPov = false; this.specSeek = 0; this.specBlend = 1;
    this.specPos.copy(this.camera.position); this.specVel.set(0, 0, 0);
    this.viewmodel.visible = false;
  }

  /** Step to the next (dir 1) or previous (dir -1) player. */
  private specCycle(dir: number) {
    const list = this.specList();
    if (!list.length) { this.sfx.play('deny'); return; }
    const i = list.indexOf(this.specTarget);
    this.specAttach(list[i < 0 ? 0 : (i + dir + list.length) % list.length]);
  }

  /** Left click: while flying, attach to whoever you are looking at; while attached, move on to the next player. */
  private specClick() {
    if (this.specMode === 'follow') { this.specCycle(1); return; }
    const id = this.specAim(true);
    if (id) this.specAttach(id); else this.sfx.play('deny');
  }

  /** Swap between flying free and watching a player. */
  private specSwitch() { if (this.specMode === 'follow') { this.specFree(); this.sfx.play('click', undefined, 0.6); } else this.specClick(); }

  /** Ghost key presses. Returns false for keys a ghost has no use for, so chat, mute and the rest still work. */
  private specKey(code: string): boolean {
    if (code === B.ab2) this.specCycle(1);
    else if (code === B.ab1) this.specCycle(-1);
    else if (code === B.act) this.specSwitch();
    else if (code === B.jump && this.specMode === 'follow') {
      // through a hunter's eyes and back out again
      if (!this.canPov(this.specTarget)) return true;
      this.specPov = !this.specPov; this.specFrom.copy(this.camera.position); this.specBlend = 0;
      if (!this.specPov) { this.pitch = Math.max(-1.2, Math.min(0.2, this.pitch)); this.viewmodel.visible = false; }
      this.sfx.play('click', undefined, 0.6);
    } else return false;
    return true;
  }

  private updateSpectator(dt: number) {
    const cam = this.camera, k = this.keys;
    let f = (k.has(B.fwd) || k.has('ArrowUp') ? 1 : 0) - (k.has(B.back) || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has(B.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(B.left) || k.has('ArrowLeft') ? 1 : 0);
    let u = (k.has(B.jump) ? 1 : 0) - (k.has(B.dash) ? 1 : 0);
    if (this.touch) { s = this.stick.x; f = -this.stick.y; if (!this.locked) f = s = u = 0; }
    const moving = f !== 0 || s !== 0;

    if (this.specOn && this.specMode === 'follow') {
      let e = this.ents.get(this.specTarget);
      if (moving) { this.specFree(); e = undefined; } // pushing a direction lets go and flies off from right here
      else if (!e || !this.specList().includes(this.specTarget)) {
        // the player we were watching was caught or left: move on to the next one
        const list = this.specList();
        if (list.length) { const was = this.specPov; this.specAttach(list[0], true); this.specPov = was && this.canPov(list[0]); e = this.ents.get(list[0]); }
        else { this.specFree(); e = undefined; }
      }
      if (e) {
        if (this.specPov && !this.canPov(e.id)) { this.specPov = false; this.specFrom.copy(cam.position); this.specBlend = 0; }
        const want = this.specWant;
        if (this.specPov) {
          const a = Math.min(1, dt * 18);
          this.yaw = lerpAngle(this.yaw, e.f, a); this.pitch += (e.pitch - this.pitch) * a;
          this.setViewmodel(this.roster.get(e.id)?.kit); // their arms and blaster, not yours
          const bobY = this.poseViewmodel(dt, e.speed, Math.abs(e.vy) < 1.2);
          want.set(e.x, e.y + CFG.HUNTER_EYE + bobY, e.z);
        } else {
          this.viewmodel.visible = false;
          if (Math.abs(e.y - this.camY) > 0.6 || Math.abs(e.vy) > 1.2) this.camY = e.y; else this.camY += (e.y - this.camY) * Math.min(1, dt * 16);
          this.orbit(want, e.x, this.camY, e.z, e.h, dt);
        }
        if (this.specBlend < 1) {
          this.specBlend = Math.min(1, this.specBlend + dt * 3.2);
          const t = this.specBlend * this.specBlend * (3 - 2 * this.specBlend);
          cam.position.lerpVectors(this.specFrom, want, t);
        } else cam.position.copy(want);
        this.specPos.copy(cam.position);
        return;
      }
    }

    // free flight
    this.viewmodel.visible = false;
    if (this.specOn && this.specSeek) {
      if (moving || this.time > this.specSeek) this.specSeek = 0;
      else { const list = this.specList(); if (list.length) { this.specAttach(list[0], true); this.updateSpectator(dt); return; } }
    }
    void u;
    this.fly(dt);
  }

  /** Free flight through walls (ghosts, and hunters looking round during the hiding phase). Forward follows the look, so looking up climbs. */
  private fly(dt: number) {
    const k = this.keys;
    let f = (k.has(B.fwd) || k.has('ArrowUp') ? 1 : 0) - (k.has(B.back) || k.has('ArrowDown') ? 1 : 0);
    let s = (k.has(B.right) || k.has('ArrowRight') ? 1 : 0) - (k.has(B.left) || k.has('ArrowLeft') ? 1 : 0);
    let u = (k.has(B.jump) ? 1 : 0) - (k.has(B.dash) ? 1 : 0);
    if (this.touch) { s = this.stick.x; f = -this.stick.y; } // UP / DOWN replay the jump and dash keys
    if (!this.locked) f = s = u = 0;
    const [dx, dy, dz] = aimDir(this.yaw, this.pitch);
    const len = Math.max(1, Math.hypot(f, s)), sp = CFG.FLY_SPEED;
    const v = this.specVel, ease = 1 - Math.exp(-dt * 12);
    v.x += ((dx * f + Math.cos(this.yaw) * s) / len * sp - v.x) * ease;
    v.y += ((dy * f / len + u) * sp - v.y) * ease;
    v.z += ((dz * f - Math.sin(this.yaw) * s) / len * sp - v.z) * ease;
    const p = this.specPos;
    p.x = Math.max(BOUNDS.x0 + 0.5, Math.min(BOUNDS.x1 - 0.5, p.x + v.x * dt));
    p.z = Math.max(BOUNDS.z0 + 0.5, Math.min(BOUNDS.z1 - 0.5, p.z + v.z * dt));
    p.y = Math.max(0.4, Math.min(this.mapId === 1 ? 10 : 4.2, p.y + v.y * dt));
    this.camera.position.copy(p);
  }

  // ================================================================ haunting (ghosts)
  /** Innocent object under a ghost's crosshair, or -1. */
  private hauntTarget = -1;
  /** A ghost may haunt right now (the cooldown aside). */
  canHaunt(): boolean { return CFG.HAUNT_ON && this.specOn && this.phase === 'hunt' && this.team !== 'hunter'; }
  private pickHaunt(): number {
    if (!this.canHaunt()) return -1;
    const o = this.camera.position, [dx, dy, dz] = aimDir(this.yaw, this.pitch);
    const hit = this.phys.raycast(o.x, o.y, o.z, dx, dy, dz, 30);
    return hit.decor;
  }
  /** A ghost's main button: haunt what is under the crosshair; without haunting, the 2.4 behaviour (watch / next player). */
  ghostAct() {
    if (!this.canHaunt()) { this.specClick(); return; }
    const left = this.cd.haunt - this.serverNow();
    if (this.hauntTarget < 0) { this.sfx.play('deny'); this.hud.popup('Aim at an object to haunt it', true); return; }
    if (left > 60) { this.sfx.play('deny'); this.hud.popup(`Haunt ready in ${Math.ceil(left / 1000)}s`, true); return; }
    this.net.send({ t: 'haunt', d: this.hauntTarget });
  }

  private updateHud(dt: number) {
    const h = this.hud, now = this.serverNow(), pnow = performance.now();
    const left = this.phaseEnds - now;
    h.setPhase(this.phase, this.round, this.panic, this.rounds);
    h.setTimer(left, this.phase !== 'lobby');
    h.setChaos(this.chaos);
    let props = 0;
    for (const r of this.roster.values()) if (r.team === 'prop' && r.alive) props++;
    h.setCounts(props);
    const lobby = this.phase === 'lobby';
    const playing = this.alive && this.team !== 'spec' && this.hasMe;
    const hunter = this.team === 'hunter';
    if (playing) h.setRole(this.team, true, hunter ? (this.quackedMe ? 'Rubber Duck?!' : 'Zap the fakes') : PROPS[this.disguise]?.name ?? 'Prop', hunter ? this.focus : this.hp, lobby);
    else h.setRole('prop', false, '', 0, false);

    const ab: AbilityView[] = [];
    const haunting = this.canHaunt() && this.roster.has(this.myId);
    if (haunting) {
      ab.push({ key: this.touch ? 'TAP' : 'Click', name: 'HAUNT', icon: '✧', left: this.cd.haunt - now, total: CFG.CD_HAUNT });
    } else if (playing && hunter) {
      ab.push({ key: 'Click', name: 'ZAP', icon: '✦', left: 0, total: 1 });
      ab.push({ key: keyLabel(B.ab1), name: 'SCANNER', icon: '◎', left: this.cd.pulse - now, total: CFG.CD_PULSE });
      ab.push({ key: keyLabel(B.ab2), name: 'SHOCKWAVE', icon: '✺', left: this.cd.shock - now, total: CFG.CD_SHOCK });
    } else if (playing) {
      ab.push({ key: keyLabel(B.act), name: 'BECOME', icon: '⇄', left: 0, total: 1 });
      ab.push({ key: keyLabel(B.ab1), name: 'DECOY', icon: '❖', left: this.cd.decoy - now, total: CFG.CD_DECOY });
      if (!lobby) ab.push({ key: keyLabel(B.ab2), name: 'VANISH', icon: '☁', left: this.cd.ghost - now, total: CFG.CD_GHOST, active: (this.myFlags & F.GHOST) !== 0 });
      ab.push({ key: keyLabel(B.dash), name: 'DASH', icon: '»', left: this.body.dashCd * 1000, total: CFG.DASH_CD * 1000, active: this.body.dashLeft > 0 });
      ab.push({ key: keyLabel(B.taunt), name: 'TAUNT', icon: '♪', left: this.cd.taunt - now, total: CFG.CD_TAUNT });
    }
    h.setAbilities(ab, haunting);

    const blindfolded = this.phase === 'hiding' && hunter && this.alive;
    const flyHint = this.touch ? 'Use the stick to fly around, UP and DOWN to climb.' : `<kbd>Mouse</kbd> look · ${['fwd', 'left', 'back', 'right'].map((id) => `<kbd>${keyLabel(B[id])}</kbd>`).join('')} fly · <kbd>${keyLabel(B.jump)}</kbd> <kbd>${keyLabel(B.dash)}</kbd> up / down`;
    h.blindfold(blindfolded, left, this.previewOn, flyHint);
    // 3 · 2 · 1 before the hunters are let loose, for everyone in the round
    const cnt = this.phase === 'hiding' && left > 0 && left <= 3000 && this.roster.has(this.myId) ? Math.ceil(left / 1000) : null;
    h.count(cnt);
    // ghost: who (if anyone) the camera is attached to
    const ghost = this.specOn && this.roster.has(this.myId) && this.phase !== 'end';
    const watching = ghost && this.specMode === 'follow' ? this.roster.get(this.specTarget) : undefined;
    const eyes = !!watching && this.specPov;
    h.crosshair(ghost ? (eyes ? 'hunter' : watching && !haunting ? 'none' : 'prop') : !playing || (blindfolded && !this.previewOn) ? 'none' : blindfolded ? 'prop' : hunter && !this.quackedMe ? 'hunter' : 'prop');
    h.ghostTint(ghost && this.phase === 'hunt');

    // transform prompt (a flying ghost gets "watch this player" instead)
    if (this.target >= 0 && playing && !hunter) {
      const info = this.world.decorDef(this.target);
      if (info) h.prompt(info.d.type === this.disguise ? `You are already a <b>${info.def.name}</b>` : `<b>[${keyLabel(B.act)}]</b> Become <b>${info.def.name}</b>`);
    } else {
      // a flying ghost looking at a player is offered to watch them; otherwise, while haunting, the object under the crosshair
      const r = ghost && !watching ? this.roster.get(this.specAim(false)) : undefined;
      const info = haunting && this.hauntTarget >= 0 ? this.world.decorDef(this.hauntTarget) : null, wait = this.cd.haunt - now;
      if (r) h.prompt(`<b>[${this.touch ? 'WATCH' : haunting ? 'Right click' : 'Click'}]</b> Watch <b>${esc(r.name)}</b>`);
      else if (info) h.prompt(wait > 60 ? `Haunt the <b>${info.def.name}</b> in ${Math.ceil(wait / 1000)}s` : `<b>[${this.touch ? 'HAUNT' : 'Click'}]</b> Haunt the <b>${info.def.name}</b>`, true);
      else h.prompt(null);
    }

    h.freeze(pnow < this.freezeUntil && playing);
    h.revealed(pnow < this.revealedUntil && playing);

    // the hunt music builds as the last minute nears (and, below, as hunter and prop close in on each other)
    const late = this.phase === 'hunt' ? Math.max(0, Math.min(1, (75_000 - left) / 45_000)) * 0.75 : 0;
    let tension = late;
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
        tension = Math.max(tension, v);
        if (v > 0.04 && pnow > this.nextBeep) { this.nextBeep = pnow + 1100 - v * 950; this.sfx.play('beep', undefined, 0.5 + v * 0.6); }
      } else {
        h.meter(null);
        const v = Math.max(0, Math.min(1, 1 - (near - 2) / 8));
        tension = Math.max(tension, v);
        if (v > 0.04 && pnow > this.nextHeart) { this.nextHeart = pnow + 1050 - v * 650; this.sfx.play('heart', undefined, 0.5 + v * 0.7); }
        document.getElementById('vignette')!.classList.toggle('heart', v > 0.5);
      }
    } else h.meter(null);
    this.sfx.setIntensity(tension);

    // countdown ticks
    const sec = Math.ceil(left / 1000);
    if (sec !== this.lastTickSec && left > 0) {
      this.lastTickSec = sec;
      if (this.phase === 'hunt' && sec <= 10) this.sfx.play(sec <= 5 ? 'tock' : 'tick');
      if (this.phase === 'hiding' && sec <= 5) this.sfx.play(sec <= 3 ? 'count' : 'tick');
    }

    // contextual hint / spectate strip
    const K = (id: string) => `<kbd>${keyLabel(B[id])}</kbd>`;
    const move = `${K('fwd')}${K('left')}${K('back')}${K('right')}`;
    let hint: string | null = null;
    if (ghost) {
      const pov = !!watching && this.canPov(watching.id);
      h.spectate({
        head: this.team === 'spec' ? 'ROUND IN PROGRESS · YOU JOIN THE NEXT ONE' : haunting ? 'CAUGHT · HAUNT OBJECTS TO BAIT THE HUNTERS' : 'YOU WERE CAUGHT · GHOST MODE',
        label: eyes ? 'THROUGH THE EYES OF' : watching ? 'WATCHING' : 'FLYING FREE',
        name: watching?.name ?? '', team: watching?.team ?? null,
        note: watching && watching.team === 'prop' && PROPS[watching.disguise] ? `the ${PROPS[watching.disguise].name}` : '',
        hint: !this.locked ? 'Click the game to look around' : haunting
          ? (watching ? `<kbd>Click</kbd> haunt · <kbd>Right click</kbd> next player · ${move} fly free${pov ? ` · ${K('jump')} ${eyes ? 'step back out' : 'their eyes'}` : ''}`
            : `<kbd>Click</kbd> haunt · <kbd>Right click</kbd> watch a player · ${move} fly · ${K('jump')} ${K('dash')} up / down`)
          : watching
          ? `<kbd>Click</kbd> next player · ${move} fly free${pov ? ` · ${K('jump')} ${eyes ? 'step back out' : 'their eyes'}` : ''}`
          : `<kbd>Click</kbd> watch a player · ${move} fly · ${K('jump')} ${K('dash')} up / down`,
      });
    } else {
      h.spectate(null);
      if (!playing) hint = null;
      else if (!this.locked && this.phase !== 'end') hint = 'Click the game to run around  ·  Esc frees the mouse again';
      else if (lobby) hint = 'Lobby warm-up: transform (E), taunt (T), drop a decoy (Q), dash (Shift)';
      else if (!hunter && this.phase === 'hiding' && left < CFG.HIDE_MS - 3500) hint = 'Right-click holds your rotation · scroll zooms · small objects fit on shelves';
    }
    h.hint(hint);

    // always-on objective line and a controls card, so a first-time player is never left guessing
    let obj = '';
    if (lobby) obj = 'Warm-up. The game starts soon — try becoming an object.';
    else if (playing && hunter && this.phase === 'hunt') obj = this.quackedMe ? 'You are a duck! Too many innocent objects. Wait it out.' : (this.myFlags & F.DIZZY) ? 'Bonked! Your blaster is jammed for a moment.' : `Find the fake objects and zap them. Fakes squeak on roll calls, move when unwatched, and fly up when you Shockwave [${keyLabel(B.ab2)}].`;
    else if (playing && !hunter && this.phase === 'hiding') obj = `Aim at an object and press [${keyLabel(B.act)}] to become it, then stand among similar ones.`;
    else if (playing && !hunter && this.phase === 'hunt') obj = 'Survive until the timer runs out. Freeze when a hunter or the blue scanner ring is near.';
    else if (haunting) obj = 'Rattle real objects near the hunters. If one shoots what you haunted, you score and they lose Focus.';
    h.objective(obj);
    const rows = ghost && haunting
      ? [['Haunt object', '<kbd>Left click</kbd>'], ['Next / aimed player', `<kbd>Right click</kbd> ${K('ab2')}`], ['Previous player', K('ab1')], ['Fly free', move], ['Fly up / down', `${K('jump')} ${K('dash')}`], ["Hunter's eyes", `${K('jump')} while watching`], ['Watch / fly', K('act')]]
      : ghost
      ? [['Next player', `<kbd>Click</kbd> ${K('ab2')}`], ['Previous player', `<kbd>Right click</kbd> ${K('ab1')}`], ['Fly free', move], ['Fly up / down', `${K('jump')} ${K('dash')}`], ["Hunter's eyes", `${K('jump')} while watching`], ['Watch / fly', K('act')], ['Zoom', '<kbd>Scroll</kbd>']]
      : !playing ? null : hunter
      ? [['Move', move], ['Jump', K('jump')], ['Zap', '<kbd>Left click</kbd>'], ['Zoom aim', '<kbd>Right click</kbd>'], ['Scanner', K('ab1')], ['Shockwave', K('ab2')]]
      : [['Move', move], ['Jump', K('jump')], ['Become object', `${K('act')} <kbd>Click</kbd>`], ['Decoy', K('ab1')], ['Vanish', K('ab2')], ['Dash', K('dash')], ['Taunt', K('taunt')], ['Hold rotation', '<kbd>Right click</kbd>']];
    h.help(this.helpOn && rows && this.phase !== 'end' ? `<div class="helpT">${ghost ? 'GHOST' : hunter ? 'HUNTER' : 'PROP'} CONTROLS</div>${rows.map((r) => `<div><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}<div class="helpF">${K('help')} hides this · <kbd>Esc</kbd> settings &amp; key bindings</div>` : null);
    void ACTIONS;

    h.lobby(lobby, { code: this.code, pub: this.pub, roster: [...this.roster.values()], me: this.myId, host: !!this.roster.get(this.myId)?.host, bots: this.lobbyInfo.bots, countdown: Math.max(0, this.lobbyInfo.countdown - (pnow - this.lobbyInfo.at)), canStart: this.lobbyInfo.canStart, map: this.lobbyInfo.map, rounds: this.lobbyInfo.rounds });
    h.xpNow = this.profile.xp;
    h.results(this.phase === 'end' && pnow >= this.resultsAt, this.results, this.myId, this.team, left, MAP_NAMES[this.nextMap] ?? '', this.report, this.profile.coins, this.roster);
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
    if (this.touch) this.locked = this.inGame && !this.touchPaused;
    this.hitch = raw > 0.2 ? 2 : Math.max(0, this.hitch - 1);

    // adaptive quality: if a machine can't hold a playable frame rate, drop shadows once
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc >= 1) {
      this.fps = this.fpsN / this.fpsAcc;
      if (!this.fpsChecked && this.inGame && this.time > 8 && !document.hidden) this.slowSecs = this.fps < 34 ? this.slowSecs + 1 : 0;
      if (!this.fpsChecked && this.slowSecs >= 4) {
        // step down one notch at a time; from ultra there is still somewhere left to go
        this.slowSecs = 0;
        if (this.quality === 'ultra') { this.setQuality('high'); this.hud.popup('Low frame rate: graphics set to High'); this.onQuality(); }
        else { this.fpsChecked = true; if (this.quality === 'high') { this.setQuality('low'); this.hud.popup('Low frame rate: switched to fast graphics'); this.onQuality(); } }
      }
      this.fpsAcc = 0; this.fpsN = 0;
    }
    this.updateNet(t);

    if (this.inGame && this.hasMe && this.alive && this.team !== 'spec') {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6) { this.stepLocal(); this.acc -= STEP; n++; }
      if (this.acc > STEP) this.acc = 0;
      // batch inputs to about 60 messages a second: a 240 Hz display must not trip the server's flood guard
      if (this.outbox.length && (t - this.lastSend >= 15 || this.outbox.length >= 8)) { this.net.send({ t: 'in', c: this.outbox }); this.outbox = []; this.lastSend = t; }
      const a = this.acc / STEP, b = this.body;
      this.smooth.multiplyScalar(Math.exp(-dt * 14));
      this.rpos.set(this.prev.x + (b.x - this.prev.x) * a + this.smooth.x, this.prev.y + (b.y - this.prev.y) * a + this.smooth.y, this.prev.z + (b.z - this.prev.z) * a + this.smooth.z);
      if (this.mouseL && this.locked && this.team === 'hunter' && this.phase === 'hunt' && !this.quackedMe && !(this.myFlags & F.DIZZY)) this.fire();
    }

    this.updateCamera(dt);
    if (this.inGame) {
      this.updateEnts(dt);
      this.target = this.pickTarget();
      this.hauntTarget = this.pickHaunt();
      const pick = this.target >= 0 ? this.target : this.hauntTarget;
      const info = pick >= 0 ? this.world.decorDef(pick) : null;
      (this.highlight.material as THREE.LineBasicMaterial).color.set(this.target >= 0 ? 0xffe14d : this.cd.haunt - this.serverNow() > 60 ? 0x6f6a8a : 0xc8a8ff);
      this.highlight.visible = !!info;
      if (info) {
        this.highlight.position.set(info.d.x, info.d.y + info.def.h / 2, info.d.z);
        this.highlight.rotation.y = info.def.round ? 0 : info.d.yaw;
        this.highlight.scale.set(info.def.w + 0.06, info.def.h + 0.06, info.def.d + 0.06);
      }
      this.updateHud(dt);
      this.updatePings();
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
      this.renderer.toneMappingExposure = this.world.exposure;
      // shadows are the most expensive pass: every frame on ultra, every other frame otherwise
      this.renderer.shadowMap.needsUpdate = this.quality === 'ultra' || (this.frameN / this.renderEvery) % 2 === 0;
      if (this.quality !== 'low') this.composer.render(); else this.renderer.render(this.scene, this.camera);
    }
  }
}
