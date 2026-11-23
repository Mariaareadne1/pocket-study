/**
 * Poses every rig from the device state: control travel, the power slider, the LED, and the three
 * cartridges as they rest in the tray, lift when selected, follow a drag, turn and slide into the
 * slot, and ride back out on eject. Purely kinematic — the state machine decides, this only shows.
 */
import * as THREE from 'three';
import { CART_IDS, type CartId, type CartPlace, type DeviceState, TIMING } from '../../device/machine';
import type { Action } from '../../runtime/input';
import { CART } from '../geometry/cartridge';
import { BODY, BTN_TRAVEL, CAP_Z, DPAD, SLOT, SWITCH } from '../geometry/handheld';
import { type Assembly, cartRig } from './assembly';
import { type Pose, clamp01, curve, ease, easeOut, mixPose, pose, span, spring } from './motion';

/** Where the cartridge waits just above the slot, aligned with it, before sliding in. */
export const APPROACH_LOCAL = new THREE.Vector3(SLOT.x, BODY.hh + CART.hh + 7, SLOT.z);
const SLOT_LOCAL = SLOT.clone();

export interface PoseInput {
  device: DeviceState;
  held: ReadonlySet<Action>;
  /** Device pose in world space. */
  deviceQ: THREE.Quaternion;
  devicePos: THREE.Vector3;
  tray: Record<CartId, Pose>;
  /** World point the dragged cartridge follows. */
  drag: THREE.Vector3 | null;
  backlight: number;
  reduced: boolean;
  time: number;
}

interface CartMotion {
  place: CartPlace;
  current: Pose;
  from: Pose;
  vel: number;
}

/** Slide in: a quick start, slowing as the contacts meet, a tiny seat at the end. */
const SLIDE_IN = curve([
  [0, 0],
  [0.55, 0.82],
  [0.86, 1.012],
  [1, 1],
]);

const placeOf = (s: DeviceState, id: CartId): CartPlace => {
  if (s.cart === id) {
    if (s.slot === 'inserting') return 'inserting';
    if (s.slot === 'inserted') return 'inserted';
    if (s.slot === 'ejecting') return 'ejecting';
  }
  if (s.dragging === id) return 'dragging';
  if (s.selected === id) return 'selected';
  return 'tray';
};

export class Poser {
  private readonly carts = new Map<CartId, CartMotion>();
  private readonly travel = new Map<string, [number, number]>();
  private sw: [number, number] = [0, 0];
  private tilt: [number, number, number, number] = [0, 0, 0, 0];
  private readonly tmp = pose();
  private readonly tmp2 = pose();
  private readonly deviceM = new THREE.Matrix4();
  approach = pose();
  slot = pose();

  constructor(private readonly asm: Assembly) {
    for (const id of CART_IDS) this.carts.set(id, { place: 'tray', current: pose(), from: pose(), vel: 0 });
  }

  /** World pose of a cartridge right now (for picking and the demo script). */
  cartPose(id: CartId): Pose {
    return this.carts.get(id)!.current;
  }

  update(dt: number, f: PoseInput): void {
    const device = this.asm.rig('device');
    device.position.copy(f.devicePos);
    device.quaternion.copy(f.deviceQ);
    device.updateMatrix();
    this.deviceM.compose(f.devicePos, f.deviceQ, new THREE.Vector3(1, 1, 1));
    this.slot.p.copy(SLOT_LOCAL).applyMatrix4(this.deviceM);
    this.slot.q.copy(f.deviceQ);
    this.approach.p.copy(APPROACH_LOCAL).applyMatrix4(this.deviceM);
    this.approach.q.copy(f.deviceQ);

    this.poseControls(dt, f);
    this.poseSwitch(dt, f);
    for (const id of CART_IDS) this.poseCart(id, dt, f);
    this.poseGhost(f);
    const led = this.asm.ledMaterial.uniforms.uColor.value as THREE.Vector3;
    const on = f.device.power !== 'off';
    const pulse = f.device.power === 'paused' ? 0.6 + 0.4 * Math.sin(f.time * 4) : 1;
    if (on) led.set(3.6 * pulse, 0.55 * pulse, 1.9 * pulse);
    else led.set(0.16, 0.05, 0.08);
    this.asm.screenMaterial.uniforms.uBacklight.value = f.backlight;
  }

  private spring1(key: string, target: number, omega: number, dt: number): number {
    const s = this.travel.get(key) ?? [target, 0];
    const n = spring(s[0], s[1], target, omega, dt);
    this.travel.set(key, n);
    return n[0];
  }

  private poseControls(dt: number, f: PoseInput): void {
    const w = f.reduced ? 60 : 38;
    for (const k of ['a', 'b', 'start', 'select'] as const) {
      const t = this.spring1(k, f.held.has(k) ? 1 : 0, w, dt);
      const rig = this.asm.rig(k);
      rig.position.z = CAP_Z[k] - BTN_TRAVEL * t;
    }
    const want = [f.held.has('up') ? 1 : 0, f.held.has('down') ? 1 : 0, f.held.has('left') ? 1 : 0, f.held.has('right') ? 1 : 0];
    for (let i = 0; i < 4; i++) this.tilt[i] = this.spring1(`d${i}`, want[i], w, dt);
    const [u, d, l, r] = this.tilt;
    const dpad = this.asm.rig('dpad');
    dpad.rotation.set(DPAD.tilt * (d - u), DPAD.tilt * (r - l), 0);
    dpad.position.z = CAP_Z.dpad - DPAD.travel * 0.35 * Math.min(1, u + d + l + r);
  }

  private poseSwitch(dt: number, f: PoseInput): void {
    const on = f.device.power !== 'off' && f.device.power !== 'shutting_down' ? 1 : 0;
    this.sw = spring(this.sw[0], this.sw[1], on, f.reduced ? 40 : 26, dt);
    this.asm.rig('switch').position.x = THREE.MathUtils.lerp(SWITCH.off, SWITCH.on, clamp01(this.sw[0]));
  }

  private poseCart(id: CartId, dt: number, f: PoseInput): void {
    const m = this.carts.get(id)!;
    const place = placeOf(f.device, id);
    if (place !== m.place) {
      m.from.p.copy(m.current.p);
      m.from.q.copy(m.current.q);
      m.place = place;
    }
    const out = m.current;
    const tray = f.tray[id];
    const settle = (target: Pose, rate: number): void => {
      const k = 1 - Math.exp(-dt * (f.reduced ? rate * 2 : rate));
      mixPose(out, target, k, out);
    };
    switch (place) {
      case 'tray':
        // First frame: start in place rather than flying in from the origin.
        if (out.p.lengthSq() === 0) mixPose(tray, tray, 0, out);
        settle(tray, 9);
        break;
      case 'selected': {
        const lift = this.tmp;
        lift.p.copy(tray.p).add(new THREE.Vector3(0, 4, 16));
        const wob = f.reduced ? 0 : 0.03 * Math.sin(f.time * 2.2);
        lift.q.copy(tray.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, wob, 0)));
        settle(lift, 10);
        break;
      }
      case 'dragging': {
        if (!f.drag) {
          settle(tray, 9);
          break;
        }
        const target = this.tmp;
        target.p.copy(f.drag);
        // Turn label-in as it nears the slot, so the alignment is visible before release.
        const near = f.device.nearSlot ? 1 : 0;
        const held = new THREE.Quaternion().copy(tray.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.18, 0, 0)));
        target.q.copy(held).slerp(this.approach.q, near * 0.85);
        if (near) target.p.lerp(this.approach.p, 0.35);
        settle(target, 16);
        break;
      }
      case 'inserting': {
        const t = clamp01(f.device.slotT / TIMING.insert);
        // 0–0.42: turn and travel to the approach pose. 0.42–1: slide straight down into the slot.
        if (t < 0.42) {
          const k = f.reduced ? ease(t / 0.42) : easeOut(t / 0.42);
          mixPose(m.from, this.approach, k, out);
          // A small arc toward the viewer so the turn clears the shell.
          out.p.z += Math.sin(Math.PI * k) * 14;
        } else {
          const k = f.reduced ? ease(span(t, 0.42, 1)) : SLIDE_IN(span(t, 0.42, 1));
          mixPose(this.approach, this.slot, k, out);
        }
        break;
      }
      case 'inserted':
        mixPose(this.slot, this.slot, 0, out);
        break;
      case 'ejecting': {
        const t = clamp01(f.device.slotT / TIMING.eject);
        if (t < 0.4) {
          // Spring kick out of the connector.
          const k = easeOut(span(t, 0, 0.4));
          mixPose(this.slot, this.approach, k, out);
        } else {
          const k = ease(span(t, 0.4, 1));
          mixPose(this.approach, tray, k, out);
          out.p.z += Math.sin(Math.PI * k) * 18;
        }
        break;
      }
    }
    const rig = this.asm.rig(cartRig(id));
    rig.position.copy(out.p);
    rig.quaternion.copy(out.q);
    rig.updateMatrix();
  }

  private poseGhost(f: PoseInput): void {
    const ghost = this.asm.rig('ghost');
    ghost.position.copy(this.approach.p);
    ghost.quaternion.copy(this.approach.q);
    // Sit just in front of the cartridge's +Z face so it reads as a target outline.
    ghost.position.add(new THREE.Vector3(0, 0, CART.hd + 0.3).applyQuaternion(this.approach.q));
    const want = f.device.dragging ? (f.device.nearSlot ? 0.95 : 0.45) : f.device.selected && f.device.slot === 'empty' ? 0.3 : 0;
    const u = this.asm.ghostMaterial.uniforms.uOpacity;
    u.value += (want - u.value) * 0.2;
    void this.tmp2;
  }
}
