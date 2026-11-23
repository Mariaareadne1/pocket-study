/**
 * Game cartridge, 50 × 56 × 6.4 mm. Local frame: X across, Y up (the grip end is +Y, the contact
 * edge −Y), +Z faces the device's PCB when seated. The main label is on −Z (it faces out of the
 * back of the console) and a title strip near the grip on +Z shows above the shell from the front.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CartId } from '../../device/machine';
import type { SurfaceSpec } from '../materials';
import { roundedBox } from './parts';
import { CART } from './handheld';

export { CART };

export const CART_LABEL = { w: 42, h: 34, y: -5 } as const;
export const CART_STRIP = { w: 40, h: 8.5, y: 19 } as const;

export const CART_SHELL: Record<CartId, SurfaceSpec> = {
  bloom: { color: [0.86, 0.865, 0.875], metal: 0, rough: 0.42, coat: 0.3, grain: 0.05 },
  starfall: { color: [0.05, 0.052, 0.062], metal: 0, rough: 0.4, coat: 0.35, grain: 0.05 },
  littlesky: { color: [0.62, 0.66, 0.73], metal: 0, rough: 0.42, coat: 0.3, grain: 0.05 },
};

export interface CartPart {
  geometry: THREE.BufferGeometry;
  spec: SurfaceSpec | 'shell';
  at?: [number, number, number];
  rot?: [number, number, number];
  noProxy?: boolean;
}

const bx = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
};

export function cartParts(): CartPart[] {
  const { hw, hh, hd, r } = CART;
  const parts: CartPart[] = [];
  // Shell: main body plus a slightly thicker grip at the top.
  parts.push({ geometry: roundedBox(hw * 2, hh * 2, hd * 2, r, 0.7), spec: 'shell' });
  // Grip ridges across the top of the −Z (label) face, above the label.
  const ridges: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) ridges.push(bx(hw * 2 - 10, 0.7, 0.5, 0, hh - 2.6 - i * 1.6, -hd - 0.2));
  parts.push({ geometry: mergeGeometries(ridges, false), spec: 'shell', noProxy: true });
  // Gold edge contacts at the bottom on +Z.
  const pins: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) pins.push(bx(1.5, 5.4, 0.12, -hw + 6 + i * ((hw * 2 - 12) / 15), -hh + 3.4, hd + 0.03));
  parts.push({ geometry: mergeGeometries(pins, false), spec: { color: [0.95, 0.74, 0.38], metal: 1, rough: 0.2, spark: 0.4 }, noProxy: true });
  // Key notch at the bottom-left corner (a dark recess block reads as a notch).
  parts.push({ geometry: roundedBox(4.5, 3.5, hd * 2 + 0.1, 0.6, 0.2), spec: { color: [0.03, 0.03, 0.035], metal: 0, rough: 0.7 }, at: [-hw + 2.6, -hh + 2.2, 0], noProxy: true });
  return parts;
}
