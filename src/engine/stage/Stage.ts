/**
 * The 3D stage: renderer lifecycle, camera composition, device rotation with inertia, picking and
 * pointer gestures (press buttons, flick the switch, drag cartridges into the slot). It knows nothing
 * about games or audio; the controller feeds it a frame each tick and receives intent callbacks.
 */
import * as THREE from 'three';
import { CART_IDS, type CartId, type DeviceState } from '../../device/machine';
import type { Action } from '../../runtime/input';
import { CART } from '../geometry/cartridge';
import { BODY, SCREEN, SWITCH } from '../geometry/handheld';
import { Materials } from '../materials';
import { BACKDROP_FRAG, BACKDROP_VERT, SHADOW_BOXES } from '../shaders/surfaces';
import type { Fonts } from '../textures/prints';
import { Assembly, type HitKind, cartRig } from './assembly';
import { type Pose, pose, spring } from './motion';
import { type GlassGroup, Pipeline, ROOM_SIZE, type Rect } from './pipeline';
import { Poser } from './poser';

const FOV = 26;
const LIGHT = new THREE.Vector3(-0.34, 0.52, 1).normalize();
const BACKDROP_Z = -95;
const TAP_SLOP = 6;
const ROT_RATE = 0.0085;
const PITCH_LIMIT: [number, number] = [-0.75, 0.9];
const YAW_LIMIT = 2.9;
const SNAP_DISTANCE = 40;
const DRAG_DEPTH = 30;
export const HERO = { yaw: -0.34, pitch: 0.14 } as const;
const PLAY = { yaw: -0.12, pitch: 0.05 } as const;

export interface StageFrame {
  device: DeviceState;
  held: ReadonlySet<Action>;
  backlight: number;
  screenVersion: number;
}

export interface StageHandlers {
  frame: () => StageFrame;
  tick?: (dt: number) => void;
  onButton: (action: Action, down: boolean) => void;
  onSwitch: () => void;
  onSlotTap: () => void;
  onCartTap: (id: CartId) => void;
  onCartGrab: (id: CartId) => boolean;
  onCartMove: (near: boolean) => void;
  onCartDrop: (near: boolean) => void;
  onCartCancel: () => void;
  onInteract?: () => void;
  onReady?: () => void;
}

export interface StageOptions {
  fonts: Fonts;
  screen: { pixels: Uint8Array; width: number; height: number };
  manual?: boolean;
  preserveBuffer?: boolean;
  reducedMotion?: boolean;
  maxDpr?: number;
}

export type StageTarget = 'slot' | 'switch' | 'body' | 'screen' | 'approach' | Action | `cart:${CartId}`;

type Gesture =
  | { kind: 'none' }
  | { kind: 'rotate'; id: number; x: number; y: number; sx: number; sy: number; moved: number; t: number; hit: HitKind | null }
  | { kind: 'button'; id: number; action: Action }
  | { kind: 'tap'; id: number; sx: number; sy: number; hit: HitKind }
  | { kind: 'cart'; id: number; cart: CartId; sx: number; sy: number; dragging: boolean; offset: THREE.Vector3; near: boolean };

const DPAD_ACTIONS: readonly Action[] = ['up', 'down', 'left', 'right'];

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private readonly pipe: Pipeline;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);
  private readonly mats: Materials;
  readonly asm: Assembly;
  private readonly poser: Poser;
  private readonly backdrop: THREE.Mesh;
  private readonly shadow;
  private readonly ro: ResizeObserver;
  private readonly raycaster = new THREE.Raycaster();
  private readonly reduced: boolean;
  private raf = 0;
  private last = 0;
  private time = 0;
  private disposed = false;
  private manual: boolean;
  private gesture: Gesture = { kind: 'none' };
  private yaw: number = HERO.yaw;
  private pitch: number = HERO.pitch;
  private vyaw = 0;
  private vpitch = 0;
  private homing = false;
  private idle = 0;
  private focus: [number, number] = [0, 0];
  private portrait = false;
  private size = { w: 1, h: 1 };
  private readonly handlers: StageHandlers;
  private readonly frameStats = { frames: 0, gaps: [] as number[] };
  private dprProbe = true;
  private readonly maxDpr: number;
  private readonly glassList: GlassGroup[] = [];
  private readonly tray: Record<CartId, Pose> = { bloom: pose(), starfall: pose(), littlesky: pose() };
  private readonly drag = new THREE.Vector3();
  private hasDrag = false;
  private screenVersion = -1;
  private wasOn = false;

  constructor(container: HTMLElement, handlers: StageHandlers, opts: StageOptions) {
    this.handlers = handlers;
    this.manual = opts.manual ?? false;
    this.reduced = opts.reducedMotion ?? false;
    this.maxDpr = opts.maxDpr ?? 2;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute(
      'aria-label',
      'A clear lavender handheld console and three cartridges. Drag to turn the console, press its buttons, flick the power switch on the top edge, and drag a cartridge into the slot.',
    );
    container.appendChild(this.canvas);
    this.pipe = new Pipeline(this.canvas, opts.preserveBuffer);
    this.pipe.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    this.mats = new Materials(this.pipe.roomRT.texture, ROOM_SIZE, this.camera, coarse ? 1 : 2);
    this.asm = new Assembly(this.pipe.opaque, this.pipe.glass, this.mats, opts.fonts, this.pipe.renderer, opts.screen.pixels, [opts.screen.width, opts.screen.height]);
    this.poser = new Poser(this.asm);
    this.pipe.registerGlass([...this.asm.groups.front.meshes, ...this.asm.groups.back.meshes]);

    const n = SHADOW_BOXES;
    this.shadow = {
      uLight: { value: LIGHT.clone() },
      uInv: { value: Array.from({ length: n }, () => new THREE.Matrix4()) },
      uBox: { value: Array.from({ length: n }, () => new THREE.Vector4()) },
      uZ: { value: Array.from({ length: n }, () => new THREE.Vector2()) },
      uCentre: { value: new THREE.Vector3() },
      uScale: { value: 1 },
    };
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(12000, 12000),
      new THREE.ShaderMaterial({ uniforms: this.shadow, vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG, depthWrite: false }),
    );
    this.backdrop.position.z = BACKDROP_Z;
    this.backdrop.renderOrder = -20;
    this.backdrop.updateMatrixWorld();
    this.pipe.opaque.add(this.backdrop);

    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(container);
    this.canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onCancel);
    this.canvas.addEventListener('lostpointercapture', this.onLost);
    this.layout();
    this.renderFrame(0);
    handlers.onReady?.();
    if (!this.manual) this.raf = requestAnimationFrame(this.loop);
  }

  // ───────────────────────── public API ─────────────────────────

  resetView(): void {
    this.homing = true;
  }

  /** Deterministic stepping for capture and tests. */
  setManual(on: boolean): void {
    if (on === this.manual) return;
    this.manual = on;
    if (on) cancelAnimationFrame(this.raf);
    else {
      this.last = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  get isManual(): boolean {
    return this.manual;
  }

  advance(dt: number): void {
    this.handlers.tick?.(dt);
    this.renderFrame(dt);
  }

  setOrbit(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
    this.vyaw = 0;
    this.vpitch = 0;
    this.homing = false;
  }

  get orbit(): { yaw: number; pitch: number } {
    return { yaw: this.yaw, pitch: this.pitch };
  }

  /** Screen position (CSS px) of a named feature, for tests and the demo script. */
  screenOf(target: StageTarget): { x: number; y: number } {
    const v = new THREE.Vector3();
    const dev = this.asm.rig('device').matrixWorld;
    if (target.startsWith('cart:')) v.copy(this.poser.cartPose(target.slice(5) as CartId).p);
    else if (target === 'approach') v.copy(this.poser.approach.p);
    else if (target === 'slot') v.set(0, BODY.hh + 6, 0).applyMatrix4(dev);
    else if (target === 'switch') v.set((SWITCH.off + SWITCH.on) / 2, BODY.hh + 2, SWITCH.z).applyMatrix4(dev);
    else if (target === 'body') v.set(-30, -64, BODY.hd).applyMatrix4(dev);
    else if (target === 'screen') v.set(SCREEN.cx, SCREEN.cy, SCREEN.z).applyMatrix4(dev);
    else {
      const hit = this.asm.hitMeshes.find((m) => {
        const h = m.userData.hit as HitKind;
        return h.kind === 'button' && h.action === target;
      });
      if (hit) v.setFromMatrixPosition(hit.matrixWorld);
    }
    v.project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.w, y: ((1 - v.y) / 2) * this.size.h };
  }

  /** Rendered pixels as a data URL. */
  snapshot(type = 'image/png'): string {
    this.renderFrame(0);
    return this.canvas.toDataURL(type);
  }

  debug(): Record<string, unknown> {
    const carts: Record<string, number[]> = {};
    for (const id of CART_IDS) carts[id] = this.poser.cartPose(id).p.toArray().map((x) => Math.round(x * 10) / 10);
    return {
      yaw: this.yaw,
      pitch: this.pitch,
      focus: this.focus[0],
      portrait: this.portrait,
      carts,
      switchX: this.asm.rig('switch').position.x,
      buttonA: this.asm.rig('a').position.z,
      dpad: this.asm.rig('dpad').rotation.toArray().slice(0, 2),
      ghost: this.asm.ghostMaterial.uniforms.uOpacity.value,
      backlight: this.asm.screenMaterial.uniforms.uBacklight.value,
      dpr: this.pipe.renderer.getPixelRatio(),
      frames: this.frameStats.frames,
      gesture: this.gesture.kind,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('pointercancel', this.onCancel);
    this.canvas.removeEventListener('lostpointercapture', this.onLost);
    this.asm.dispose();
    this.mats.dispose();
    this.backdrop.geometry.dispose();
    (this.backdrop.material as THREE.Material).dispose();
    this.pipe.dispose();
    this.canvas.remove();
  }

  // ───────────────────────── frame ─────────────────────────

  private readonly loop = (now: number): void => {
    if (this.disposed || this.manual) return;
    this.raf = requestAnimationFrame(this.loop);
    const gap = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    const dt = Math.min(gap, 1 / 20);
    this.handlers.tick?.(dt);
    this.renderFrame(dt);
    this.probe(gap);
  };

  private renderFrame(dt: number): void {
    this.time += dt;
    this.frameStats.frames++;
    const f = this.handlers.frame();
    const on = f.device.power !== 'off';
    if (on && !this.wasOn && this.gesture.kind === 'none') this.homing = true;
    this.wasOn = on;
    this.updateOrbit(dt, on);
    this.placeTray();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'XYZ'));
    if (!this.reduced && this.gesture.kind === 'none' && this.idle > 3 && !on) {
      const s = Math.min(1, (this.idle - 3) / 2);
      const sway = new THREE.Euler(0.025 * Math.sin(this.time * 0.6) * s, 0.07 * Math.sin(this.time * 0.37) * s, 0.012 * Math.sin(this.time * 0.5) * s);
      q.multiply(new THREE.Quaternion().setFromEuler(sway));
    }
    if (f.screenVersion !== this.screenVersion) {
      this.asm.screenTexture.needsUpdate = true;
      this.screenVersion = f.screenVersion;
    }
    this.poser.update(dt, {
      device: f.device,
      held: f.held,
      deviceQ: q,
      devicePos: new THREE.Vector3(0, 0, 0),
      tray: this.tray,
      drag: this.hasDrag ? this.drag : null,
      backlight: f.backlight,
      reduced: this.reduced,
      time: this.time,
    });
    this.asm.sync();
    this.updateCamera(dt, f.device);
    this.updateShadows(f.device);
    this.pipe.draw(this.camera, this.orderGroups(), this.scissor());
  }

  private updateOrbit(dt: number, on: boolean): void {
    this.idle += dt;
    const home = on ? PLAY : HERO;
    if (this.homing) {
      [this.yaw, this.vyaw] = spring(this.yaw, this.vyaw, home.yaw, this.reduced ? 12 : 5, dt);
      [this.pitch, this.vpitch] = spring(this.pitch, this.vpitch, home.pitch, this.reduced ? 12 : 5, dt);
      if (Math.abs(this.yaw - home.yaw) < 1e-3 && Math.abs(this.pitch - home.pitch) < 1e-3) this.homing = false;
      return;
    }
    if (this.gesture.kind === 'rotate') return;
    const damp = Math.exp(-dt * (this.reduced ? 12 : 4.2));
    this.vyaw *= damp;
    this.vpitch *= damp;
    this.yaw = THREE.MathUtils.clamp(this.yaw + this.vyaw * dt, -YAW_LIMIT, YAW_LIMIT);
    this.pitch = THREE.MathUtils.clamp(this.pitch + this.vpitch * dt, PITCH_LIMIT[0], PITCH_LIMIT[1]);
  }

  /** Tray poses: the label (−Z) faces the viewer, each cartridge a little askew. */
  private placeTray(): void {
    const spots: Record<CartId, [number, number, number, number]> = this.portrait
      ? { bloom: [-58, -112, 4, 0.05], starfall: [0, -116, 6, -0.03], littlesky: [58, -112, 4, 0.04] }
      : { bloom: [98, 36, 4, 0.05], starfall: [158, 28, 2, -0.04], littlesky: [128, -38, 6, 0.035] };
    for (const id of CART_IDS) {
      const [x, y, z, roll] = spots[id];
      const t = this.tray[id];
      t.p.set(x, y, z);
      t.q.setFromEuler(new THREE.Euler(-0.16, Math.PI - 0.12, roll, 'XYZ'));
    }
  }

  private updateCamera(dt: number, device: DeviceState): void {
    const on = device.power !== 'off' && !device.dragging ? 1 : 0;
    [this.focus[0], this.focus[1]] = spring(this.focus[0], this.focus[1], on, this.reduced ? 8 : 2.2, dt);
    const k = this.focus[0];
    const aspect = this.size.w / this.size.h;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fit = (w: number, h: number): number => Math.max(h / 0.8 / 2 / tanHalf, w / 0.88 / 2 / (tanHalf * aspect));
    const wide = this.portrait ? { x: 0, y: -34, w: 186, h: 246 } : { x: 50, y: -6, w: 318, h: 204 };
    const close = this.portrait ? { x: 0, y: 6, w: 112, h: 172 } : { x: 0, y: 6, w: 120, h: 176 };
    const dist = THREE.MathUtils.lerp(fit(wide.w, wide.h), fit(close.w, close.h), k);
    const tx = THREE.MathUtils.lerp(wide.x, close.x, k);
    const ty = THREE.MathUtils.lerp(wide.y, close.y, k);
    this.camera.aspect = aspect;
    this.camera.position.set(tx, ty, dist);
    this.camera.lookAt(tx, ty, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.shadow.uCentre.value.set(tx, ty, 0);
    this.shadow.uScale.value = dist / 900;
  }

  private updateShadows(device: DeviceState): void {
    const inv = this.shadow.uInv.value;
    const box = this.shadow.uBox.value;
    const z = this.shadow.uZ.value;
    inv[0].copy(this.asm.rig('device').matrixWorld).invert();
    box[0].set(BODY.hw - 1.5, BODY.hh - 1.5, 12, 0.13);
    z[0].set(0, 1.5);
    CART_IDS.forEach((id, i) => {
      inv[i + 1].copy(this.asm.rig(cartRig(id)).matrixWorld).invert();
      const seated = device.cart === id && device.slot === 'inserted';
      box[i + 1].set(CART.hw, CART.hh, CART.r + 1, seated ? 0.04 : 0.12);
      z[i + 1].set(0, 0.5);
    });
  }

  private orderGroups(): GlassGroup[] {
    const { front, back } = this.asm.groups;
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.asm.rig('device').quaternion).z > 0;
    this.glassList.length = 0;
    this.glassList.push(...(facing ? [back, front] : [front, back]));
    return this.glassList;
  }

  private scissor(): Rect | null {
    const { w, h } = this.pipe.drawSize;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const c = new THREE.Vector3();
    const m = this.asm.rig('device').matrixWorld;
    const [bx, by, bz] = [BODY.hw + 4, BODY.hh + 4, BODY.hd + 4];
    for (let i = 0; i < 8; i++) {
      c.set(i & 1 ? bx : -bx, i & 2 ? by : -by, i & 4 ? bz : -bz).applyMatrix4(m).project(this.camera);
      if (c.z > 1) continue;
      x0 = Math.min(x0, c.x);
      x1 = Math.max(x1, c.x);
      y0 = Math.min(y0, c.y);
      y1 = Math.max(y1, c.y);
    }
    const pad = 0.03;
    const px = (v: number): number => Math.round(((v + 1) / 2) * w);
    const py = (v: number): number => Math.round(((v + 1) / 2) * h);
    const r = {
      x: THREE.MathUtils.clamp(px(x0 - pad), 0, w),
      y: THREE.MathUtils.clamp(py(y0 - pad), 0, h),
      x1: THREE.MathUtils.clamp(px(x1 + pad), 0, w),
      y1: THREE.MathUtils.clamp(py(y1 + pad), 0, h),
    };
    return r.x1 > r.x && r.y1 > r.y ? r : null;
  }

  private layout(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth || 1;
    const h = parent?.clientHeight || 1;
    this.size = { w, h };
    this.portrait = h > w * 1.08;
    this.pipe.setSize(w, h);
    if (this.manual) this.renderFrame(0);
  }

  private probe(gap: number): void {
    if (!this.dprProbe || document.hidden || gap > 0.1) return;
    this.frameStats.gaps.push(gap);
    if (this.frameStats.gaps.length < 120) return;
    const gaps = this.frameStats.gaps.sort((a, b) => a - b);
    const typical = gaps[gaps.length >> 1];
    gaps.length = 0;
    const ratio = this.pipe.renderer.getPixelRatio();
    if (typical < 1 / 40 || ratio <= 1) {
      this.dprProbe = false;
      return;
    }
    this.pipe.renderer.setPixelRatio(Math.max(1, Math.min(ratio - 0.25, Math.round(ratio * Math.sqrt(1 / 45 / typical) * 4) / 4)));
    this.layout();
  }

  private readonly onRestored = (): void => this.pipe.bakeRoom();

  // ───────────────────────── input ─────────────────────────

  private ndc(e: PointerEvent): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  }

  private pick(e: PointerEvent): HitKind | null {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const hits = this.raycaster.intersectObjects(this.asm.hitMeshes, false);
    if (!hits.length) return null;
    const order = (h: HitKind): number => (h.kind === 'button' ? 0 : h.kind === 'switch' ? 1 : h.kind === 'cart' ? 2 : h.kind === 'slot' ? 3 : 4);
    const near = hits[0].distance;
    const candidates = hits.filter((h) => h.distance < near + 40).map((h) => h.object.userData.hit as HitKind);
    candidates.sort((a, b) => order(a) - order(b));
    return candidates[0];
  }

  private worldOnPlane(e: PointerEvent, depth: number): THREE.Vector3 {
    this.raycaster.setFromCamera(this.ndc(e), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -depth);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, out) ?? out;
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.gesture.kind !== 'none') return;
    this.idle = 0;
    this.homing = false;
    this.handlers.onInteract?.();
    const hit = this.pick(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (hit?.kind === 'button') {
      this.gesture = { kind: 'button', id: e.pointerId, action: hit.action };
      this.handlers.onButton(hit.action, true);
      return;
    }
    if (hit?.kind === 'cart') {
      const p = this.poser.cartPose(hit.id).p;
      const at = this.worldOnPlane(e, DRAG_DEPTH);
      this.gesture = { kind: 'cart', id: e.pointerId, cart: hit.id, sx: e.clientX, sy: e.clientY, dragging: false, offset: new THREE.Vector3(p.x - at.x, p.y - at.y, 0), near: false };
      return;
    }
    if (hit?.kind === 'switch' || hit?.kind === 'slot') {
      this.gesture = { kind: 'tap', id: e.pointerId, sx: e.clientX, sy: e.clientY, hit };
      return;
    }
    this.gesture = { kind: 'rotate', id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0, t: performance.now(), hit };
    this.vyaw = 0;
    this.vpitch = 0;
    this.canvas.style.cursor = 'grabbing';
  };

  private readonly onMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (g.kind === 'none') {
      const hover = this.pick(e);
      this.canvas.style.cursor = hover && hover.kind !== 'body' ? 'pointer' : 'grab';
      return;
    }
    if (g.id !== e.pointerId) return;
    this.idle = 0;
    if (g.kind === 'rotate') {
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      const now = performance.now();
      const dts = Math.max((now - g.t) / 1000, 1 / 240);
      g.x = e.clientX;
      g.y = e.clientY;
      g.t = now;
      g.moved = Math.max(g.moved, Math.hypot(e.clientX - g.sx, e.clientY - g.sy));
      this.yaw = THREE.MathUtils.clamp(this.yaw + dx * ROT_RATE, -YAW_LIMIT, YAW_LIMIT);
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * ROT_RATE, PITCH_LIMIT[0], PITCH_LIMIT[1]);
      this.vyaw = THREE.MathUtils.lerp(this.vyaw, (dx * ROT_RATE) / dts, 0.5);
      this.vpitch = THREE.MathUtils.lerp(this.vpitch, (dy * ROT_RATE) / dts, 0.5);
    } else if (g.kind === 'button') {
      // Thumb rolls across the pad: slide from one direction to the next without lifting.
      if (!DPAD_ACTIONS.includes(g.action)) return;
      const hit = this.pick(e);
      if (hit?.kind === 'button' && DPAD_ACTIONS.includes(hit.action) && hit.action !== g.action) {
        this.handlers.onButton(g.action, false);
        g.action = hit.action;
        this.handlers.onButton(g.action, true);
      }
    } else if (g.kind === 'cart') {
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < TAP_SLOP) return;
        if (!this.handlers.onCartGrab(g.cart)) {
          this.gesture = { kind: 'none' };
          return;
        }
        g.dragging = true;
        this.canvas.style.cursor = 'grabbing';
      }
      const at = this.worldOnPlane(e, DRAG_DEPTH).add(g.offset);
      this.drag.copy(at);
      this.hasDrag = true;
      const ap = this.poser.approach.p;
      const near = Math.hypot(at.x - ap.x, at.y - ap.y) < SNAP_DISTANCE;
      if (near !== g.near) {
        g.near = near;
        this.handlers.onCartMove(near);
      }
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (g.kind === 'none' || g.id !== e.pointerId) return;
    this.gesture = { kind: 'none' };
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = '';
    if (g.kind === 'button') this.handlers.onButton(g.action, false);
    else if (g.kind === 'cart') {
      this.hasDrag = false;
      if (g.dragging) this.handlers.onCartDrop(g.near);
      else this.handlers.onCartTap(g.cart);
    } else if (g.kind === 'tap') {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < TAP_SLOP * 2) {
        if (g.hit.kind === 'switch') this.handlers.onSwitch();
        else if (g.hit.kind === 'slot') this.handlers.onSlotTap();
      }
    } else if (g.kind === 'rotate') {
      if (performance.now() - g.t > 90) {
        this.vyaw = 0;
        this.vpitch = 0;
      }
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    const g = this.gesture;
    if (g.kind === 'none' || g.id !== e.pointerId) return;
    this.cancelGestures();
  };

  private readonly onLost = (e: PointerEvent): void => {
    // Capture lost without pointerup (window blur, element removed): never leave a stuck gesture.
    if (this.gesture.kind !== 'none') this.onCancel(e);
  };

  /** Releases any held button or dragged cartridge (e.g. on window blur). */
  cancelGestures(): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    this.hasDrag = false;
    this.canvas.style.cursor = '';
    if (g.kind === 'button') this.handlers.onButton(g.action, false);
    if (g.kind === 'cart' && g.dragging) this.handlers.onCartCancel();
  }

  get gestureKind(): string {
    return this.gesture.kind;
  }
}
