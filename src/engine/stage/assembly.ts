/**
 * Scene assembly. Parts hang off "rigs" (plain Object3D nodes that are never rendered). Each frame
 * the rig hierarchy is updated once and every visible mesh, its depth proxy and its hit target copy
 * their rig's world matrix — the manual-matrix approach of the CD Case stage, so the opaque, glass
 * and hit scenes always agree.
 */
import * as THREE from 'three';
import { CART_IDS, type CartId } from '../../device/machine';
import type { Action } from '../../runtime/input';
import { CART, CART_LABEL, CART_SHELL, CART_STRIP, cartParts } from '../geometry/cartridge';
import {
  ABSORB,
  BEZEL,
  HAZE,
  TINT,
  BODY,
  BTN_A,
  BTN_B,
  CAP_Z,
  DPAD,
  type Part,
  PILL,
  type RigName,
  SCREEN,
  SLOT,
  SWITCH,
  backGlass,
  frontGlass,
  handheldParts,
  pillX,
} from '../geometry/handheld';
import { type Materials, PRESET } from '../materials';
import { cartLabel, cartStrip } from '../textures/labels';
import { PCB_RECT, pcbCanvases } from '../textures/pcb';
import { type Fonts, backPrint, bezelPrint, facePrint, mmCanvas, switchPrint, toTexture } from '../textures/prints';
import type { GlassGroup } from './pipeline';

export type CartRig = `cart:${CartId}`;
export type AnyRig = RigName | CartRig | 'ghost';

interface Attached {
  mesh: THREE.Object3D;
  rig: THREE.Object3D;
  local: THREE.Matrix4;
}

export type HitKind =
  | { kind: 'button'; action: Action }
  | { kind: 'switch' }
  | { kind: 'slot' }
  | { kind: 'cart'; id: CartId }
  | { kind: 'body' };

export const cartRig = (id: CartId): CartRig => `cart:${id}`;

export class Assembly {
  readonly rigRoot = new THREE.Object3D();
  readonly rigs = new Map<AnyRig, THREE.Object3D>();
  readonly hits = new THREE.Scene();
  readonly hitMeshes: THREE.Mesh[] = [];
  readonly groups: { front: GlassGroup; back: GlassGroup };
  readonly screenMaterial: THREE.ShaderMaterial;
  readonly screenTexture: THREE.DataTexture;
  readonly ledMaterial: THREE.ShaderMaterial;
  readonly ghostMaterial: THREE.ShaderMaterial;
  private readonly attached: Attached[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false });
  private readonly hitMaterial = new THREE.MeshBasicMaterial();

  constructor(
    private readonly opaque: THREE.Scene,
    private readonly glass: THREE.Scene,
    private readonly mats: Materials,
    fonts: Fonts,
    renderer: THREE.WebGLRenderer,
    screenPixels: Uint8Array,
    screenSize: [number, number],
  ) {
    this.hits.matrixWorldAutoUpdate = false;
    this.buildRigs();
    const tex = (c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture => this.keepTex(toTexture(c, renderer, srgb));

    // ── Device opaque parts.
    const board = pcbCanvases(fonts);
    const pcbMat = mats.surface({
      color: [0.1, 0.25, 0.2],
      metal: 0,
      rough: 0.42,
      coat: 0.35,
      map: tex(board.albedo),
      mask: tex(board.mask, false),
      mapMode: 3,
      mapRect: [PCB_RECT.x0, PCB_RECT.y0, 1 / PCB_RECT.w, 1 / PCB_RECT.h],
    });
    this.ledMaterial = mats.surface({ color: [0.16, 0.05, 0.08], metal: 0, rough: 0.2, coat: 0.6 });
    for (const p of handheldParts()) this.addPart(p, pcbMat);

    // ── The LCD panel.
    this.screenTexture = new THREE.DataTexture(screenPixels, screenSize[0], screenSize[1], THREE.RGBAFormat);
    this.screenTexture.magFilter = THREE.LinearFilter;
    this.screenTexture.minFilter = THREE.LinearFilter;
    this.screenTexture.generateMipmaps = false;
    this.screenTexture.needsUpdate = true;
    this.textures.push(this.screenTexture);
    this.screenMaterial = mats.screen(this.screenTexture, screenSize);
    this.addMesh(new THREE.Mesh(this.keepGeo(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h)), this.screenMaterial), 'device', [SCREEN.cx, SCREEN.cy, SCREEN.z]);

    // ── Printing.
    this.decal(tex(bezelPrint(fonts, BEZEL.hw * 2, BEZEL.hh * 2, SCREEN.cy - BEZEL.cy, SCREEN.h)), BEZEL.hw * 2, BEZEL.hh * 2, 'device', [BEZEL.cx, BEZEL.cy, BEZEL.z + 0.42], [0, 0, 0], 0.95);
    const face = facePrint(fonts, {
      a: [BTN_A.x, BTN_A.y],
      b: [BTN_B.x, BTN_B.y],
      start: [pillX('start'), PILL.y],
      select: [pillX('select'), PILL.y],
      dpad: [DPAD.x, DPAD.y],
    });
    this.decal(tex(face), BODY.hw * 2, BODY.hh * 2, 'device', [0, 0, BODY.hd - 1.7], [0, 0, 0], 0.9);
    this.decal(tex(backPrint(fonts)), 70, 46, 'device', [0, -40, -BODY.hd + 1.7], [0, Math.PI, 0], 0.88);
    this.decal(tex(switchPrint(fonts)), 18, 4, 'device', [(SWITCH.off + SWITCH.on) / 2, BODY.hh - 0.12, SWITCH.z], [-Math.PI / 2, 0, 0], 0.9);

    // ── Cartridges.
    for (const id of CART_IDS) {
      const rig = cartRig(id);
      for (const p of cartParts()) {
        this.keepGeo(p.geometry);
        const spec = p.spec === 'shell' ? CART_SHELL[id] : p.spec;
        this.addMesh(new THREE.Mesh(p.geometry, mats.surface(spec)), rig, p.at, p.rot, p.noProxy);
      }
      const label = mats.surface({ ...PRESET.paper, map: tex(cartLabel(id, fonts)), mapMode: 1, coat: 0.3, rough: 0.5 });
      this.addMesh(new THREE.Mesh(this.keepGeo(new THREE.PlaneGeometry(CART_LABEL.w, CART_LABEL.h)), label), rig, [0, CART_LABEL.y, -CART.hd - 0.04], [0, Math.PI, 0], true);
      const strip = mats.surface({ ...PRESET.paper, map: tex(cartStrip(id, fonts)), mapMode: 1, coat: 0.3, rough: 0.5 });
      this.addMesh(new THREE.Mesh(this.keepGeo(new THREE.PlaneGeometry(CART_STRIP.w, CART_STRIP.h)), strip), rig, [0, CART_STRIP.y, CART.hd + 0.04], [0, 0, 0], true);
    }

    // ── Alignment cue: a ghost outline of a cartridge at the slot's approach pose.
    const ghost = mmCanvas(CART.hw * 2 + 6, CART.hh * 2 + 6, 10);
    ghost.g.strokeStyle = 'rgba(150, 120, 230, 1)';
    ghost.g.lineWidth = 0.9;
    ghost.g.setLineDash([2.4, 1.6]);
    ghost.g.beginPath();
    ghost.g.roundRect(3, 3, CART.hw * 2, CART.hh * 2, CART.r);
    ghost.g.stroke();
    ghost.g.setLineDash([]);
    ghost.g.fillStyle = 'rgba(150, 120, 230, 0.12)';
    ghost.g.fill();
    ghost.g.fillStyle = 'rgba(150, 120, 230, 0.9)';
    ghost.g.beginPath();
    const ax = CART.hw + 3;
    const ay = CART.hh * 2 + 3 - 3;
    ghost.g.moveTo(ax - 4, ay - 5);
    ghost.g.lineTo(ax + 4, ay - 5);
    ghost.g.lineTo(ax, ay);
    ghost.g.fill();
    this.ghostMaterial = mats.decal(tex(ghost.c), 0, 0);
    const gm = new THREE.Mesh(this.keepGeo(new THREE.PlaneGeometry(CART.hw * 2 + 6, CART.hh * 2 + 6)), this.ghostMaterial);
    gm.renderOrder = 12;
    this.addMesh(gm, 'ghost', undefined, undefined, true, true);

    // ── Clear shell.
    const f = frontGlass();
    const b = backGlass();
    this.groups = {
      front: this.glassGroup(f.rods, f.sheets, ABSORB.front),
      back: this.glassGroup(b.rods, b.sheets, ABSORB.back),
    };

    // ── Hit targets (never drawn). Generous: at least ~11 mm, so fingertips land.
    const quad = 9.5;
    const dirs: [Action, number, number][] = [
      ['up', 0, quad],
      ['down', 0, -quad],
      ['left', -quad, 0],
      ['right', quad, 0],
    ];
    for (const [action, dx, dy] of dirs) this.hit(new THREE.BoxGeometry(11.5, 11.5, 8), 'device', [DPAD.x + dx, DPAD.y + dy, CAP_Z.dpad], { kind: 'button', action });
    this.hit(new THREE.CylinderGeometry(BTN_A.r + 2.4, BTN_A.r + 2.4, 8, 24).rotateX(Math.PI / 2), 'device', [BTN_A.x, BTN_A.y, CAP_Z.a], { kind: 'button', action: 'a' });
    this.hit(new THREE.CylinderGeometry(BTN_B.r + 2.4, BTN_B.r + 2.4, 8, 24).rotateX(Math.PI / 2), 'device', [BTN_B.x, BTN_B.y, CAP_Z.b], { kind: 'button', action: 'b' });
    for (const k of ['start', 'select'] as const) this.hit(new THREE.BoxGeometry(PILL.w + 4, PILL.h + 7, 8), 'device', [pillX(k), PILL.y, CAP_Z[k]], { kind: 'button', action: k });
    this.hit(new THREE.BoxGeometry(16, 12, 14), 'device', [(SWITCH.off + SWITCH.on) / 2, BODY.hh + 2, SWITCH.z - 2], { kind: 'switch' });
    this.hit(new THREE.BoxGeometry(CART.hw * 2 + 6, 22, 18), 'device', [0, BODY.hh + 8, SLOT.z], { kind: 'slot' });
    for (const id of CART_IDS) this.hit(new THREE.BoxGeometry(CART.hw * 2 + 4, CART.hh * 2 + 4, CART.hd * 2 + 6), cartRig(id), [0, 0, 0], { kind: 'cart', id });
    this.hit(new THREE.BoxGeometry(BODY.hw * 2, BODY.hh * 2, BODY.hd * 2), 'device', [0, 0, 0], { kind: 'body' });
  }

  private buildRigs(): void {
    const make = (name: AnyRig, parent: THREE.Object3D, at?: [number, number, number]): THREE.Object3D => {
      const o = new THREE.Object3D();
      o.name = name;
      if (at) o.position.set(...at);
      parent.add(o);
      this.rigs.set(name, o);
      return o;
    };
    const device = make('device', this.rigRoot);
    make('dpad', device, [DPAD.x, DPAD.y, CAP_Z.dpad]);
    make('a', device, [BTN_A.x, BTN_A.y, CAP_Z.a]);
    make('b', device, [BTN_B.x, BTN_B.y, CAP_Z.b]);
    make('start', device, [pillX('start'), PILL.y, CAP_Z.start]);
    make('select', device, [pillX('select'), PILL.y, CAP_Z.select]);
    make('switch', device, [SWITCH.off, SWITCH.y, SWITCH.z]);
    make('screen', device, [SCREEN.cx, SCREEN.cy, SCREEN.z]);
    make('ghost', this.rigRoot);
    for (const id of CART_IDS) make(cartRig(id), this.rigRoot);
  }

  rig(name: AnyRig): THREE.Object3D {
    const r = this.rigs.get(name);
    if (!r) throw new Error(`Unknown rig ${name}`);
    return r;
  }

  private keepGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private keepTex<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private localMatrix(at?: [number, number, number], rot?: [number, number, number]): THREE.Matrix4 {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0])));
    m.compose(new THREE.Vector3(...(at ?? [0, 0, 0])), q, new THREE.Vector3(1, 1, 1));
    return m;
  }

  private addMesh(mesh: THREE.Mesh, rig: AnyRig, at?: [number, number, number], rot?: [number, number, number], noProxy = false, overlay = false): void {
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    const local = this.localMatrix(at, rot);
    this.opaque.add(mesh);
    this.attached.push({ mesh, rig: this.rig(rig), local });
    if (!noProxy && !overlay) {
      const proxy = new THREE.Mesh(mesh.geometry, this.depthOnly);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      proxy.renderOrder = -5;
      this.glass.add(proxy);
      this.attached.push({ mesh: proxy, rig: this.rig(rig), local });
    }
  }

  private addPart(p: Part, pcb: THREE.ShaderMaterial): void {
    this.keepGeo(p.geometry);
    const mat = p.spec === 'pcb' ? pcb : p.spec === 'led' ? this.ledMaterial : this.mats.surface(p.spec);
    this.addMesh(new THREE.Mesh(p.geometry, mat), p.rig, p.at, p.rot, p.noProxy);
  }

  private decal(map: THREE.Texture, w: number, h: number, rig: AnyRig, at: [number, number, number], rot: [number, number, number], opacity: number): void {
    const mesh = new THREE.Mesh(this.keepGeo(new THREE.PlaneGeometry(w, h)), this.mats.decal(map, opacity));
    mesh.renderOrder = 10;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;
    this.opaque.add(mesh);
    this.attached.push({ mesh, rig: this.rig(rig), local: this.localMatrix(at, rot) });
  }

  private glassGroup(rods: THREE.BufferGeometry, sheets: THREE.BufferGeometry, absorb: [number, number, number]): GlassGroup {
    this.keepGeo(rods);
    this.keepGeo(sheets);
    const rodMat = this.mats.rod(absorb);
    const r = new THREE.Mesh(rods, rodMat);
    const s = new THREE.Mesh(sheets, this.mats.sheet(absorb, HAZE, TINT));
    s.renderOrder = 1;
    for (const m of [r, s]) {
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      this.glass.add(m);
      this.attached.push({ mesh: m, rig: this.rig('device'), local: new THREE.Matrix4() });
    }
    return { meshes: [r, s], rodMaterials: [rodMat], depth: 0 };
  }

  private hit(geometry: THREE.BufferGeometry, rig: AnyRig, at: [number, number, number], data: HitKind): void {
    const m = new THREE.Mesh(this.keepGeo(geometry), this.hitMaterial);
    m.matrixAutoUpdate = false;
    m.userData.hit = data;
    this.hits.add(m);
    this.hitMeshes.push(m);
    this.attached.push({ mesh: m, rig: this.rig(rig), local: this.localMatrix(at) });
  }

  /** Copy every rig's world matrix onto its meshes. Call after posing rigs. */
  sync(): void {
    this.rigRoot.updateMatrixWorld(true);
    for (const a of this.attached) a.mesh.matrixWorld.multiplyMatrices(a.rig.matrixWorld, a.local);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.depthOnly.dispose();
    this.hitMaterial.dispose();
  }
}
