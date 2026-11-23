/**
 * The handheld, PS-002. Millimetres; X right, Y up, Z toward the viewer (screen side).
 *
 * Clear faintly-lavender polycarbonate in two halves (front z 0…13, back −13…0) built from swept rods
 * and sheets, so the CD Case ray-tracer renders every wall, lip, boss and button well. Inside: the
 * PCB, LCD module, speaker, flat battery and cartridge connector are opaque parts.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PRESET, type SurfaceSpec } from '../materials';
import { cylinderZ, plate, roundedBox, screwCross, screwHead } from './parts';
import { type P2, RodBuilder, arc, circle, fillet, mergeSheets, roundedRect, sheet } from './rods';

const PI = Math.PI;

export const BODY = { hw: 44, hh: 72, hd: 13, rTop: 7, rBot: 20 } as const;
/** LCD active area: 160×144 pixels at 0.3125 mm. */
export const SCREEN = { cx: 0, cy: 32, w: 50, h: 45, z: 10.4 } as const;
export const BEZEL = { cx: 0, cy: 30, hw: 34, hh: 31, r: 6, z: 10.9 } as const;
export const PCB = { z: 4, t: 1.2, inset: 4.2 } as const;
export const DPAD = { x: -22, y: -27, arm: 8.6, len: 25.5, h: 3.6, travel: 1.1, tilt: 0.07 } as const;
export const BTN_A = { x: 24, y: -21, r: 5.3 } as const;
export const BTN_B = { x: 10.5, y: -31, r: 5.3 } as const;
export const PILL = { w: 10, h: 3.6, gap: 8.5, y: -54 } as const;
export const BTN_TRAVEL = 1.25;
export const SPEAKER = { x: 25, y: -55, r: 8.5 } as const;
export const SWITCH = { off: -35.5, on: -29.5, y: BODY.hh + 0.6, z: 6.4 } as const;
/** Cartridge size (shared with cartridge.ts). */
export const CART = { hw: 25, hh: 28, hd: 3.2, r: 2.6 } as const;
/** Seated cartridge centre in device space: in the back half, 16 mm proud of the top edge. */
export const SLOT = new THREE.Vector3(0, BODY.hh + 16 - CART.hh, -6.6);
/** Slot opening half-width in the back wall. */
export const SLOT_HW = CART.hw + 1.4;
export const LED = { x: -30, y: 47, z: BODY.hd - 0.2 } as const;

/** Faint lavender: absorbs green a little more than red and blue (per mm, Beer–Lambert). */
export const ABSORB = {
  front: [0.011, 0.026, 0.0075] as [number, number, number],
  back: [0.012, 0.028, 0.008] as [number, number, number],
};
/** Body tint of the clear panels (linear RGB) and how strongly a millimetre of it colours the view. */
export const TINT: [number, number, number] = [0.8, 0.72, 0.96];
export const HAZE = 0.07;

export const DPAD_DIRS = ['up', 'down', 'left', 'right'] as const;
export type DpadDir = (typeof DPAD_DIRS)[number];
export const FACE_BUTTONS = ['a', 'b', 'start', 'select'] as const;
export type FaceButton = (typeof FACE_BUTTONS)[number];

export type RigName = 'device' | 'dpad' | 'a' | 'b' | 'start' | 'select' | 'switch' | 'screen';

export interface Part {
  geometry: THREE.BufferGeometry;
  spec: SurfaceSpec | 'pcb' | 'led';
  rig: RigName;
  at?: [number, number, number];
  rot?: [number, number, number];
  noProxy?: boolean;
}

export interface Glass {
  rods: THREE.BufferGeometry;
  sheets: THREE.BufferGeometry;
}

/** Body outline (counter-clockwise from the bottom-right corner), inset by `d`. */
export function bodyOutline(d = 0): P2[] {
  const hw = BODY.hw - d;
  const hh = BODY.hh - d;
  const rt = Math.max(0.4, BODY.rTop - d);
  const rb = Math.max(0.4, BODY.rBot - d);
  return [
    ...arc([hw - rb, -hh + rb], rb, -PI / 2, 0),
    ...arc([hw - rt, hh - rt], rt, 0, PI / 2),
    ...arc([-hw + rt, hh - rt], rt, PI / 2, PI),
    ...arc([-hw + rb, -hh + rb], rb, PI, (3 * PI) / 2),
  ];
}

/** The same outline as an open path that skips the slot opening on the top edge. */
function outlineWithGap(d: number, gap: number): P2[] {
  const hw = BODY.hw - d;
  const hh = BODY.hh - d;
  const rt = BODY.rTop - d;
  const rb = BODY.rBot - d;
  return [
    [gap, hh],
    ...arc([hw - rt, hh - rt], rt, PI / 2, 0),
    ...arc([hw - rb, -hh + rb], rb, 0, -PI / 2),
    ...arc([-hw + rb, -hh + rb], rb, -PI / 2, -PI),
    ...arc([-hw + rt, hh - rt], rt, PI, PI / 2),
    [-gap, hh],
  ];
}

export function dpadOutline(grow = 0): P2[] {
  const a = DPAD.arm / 2 + grow;
  const l = DPAD.len / 2 + grow;
  const { x, y } = DPAD;
  return fillet(
    [
      [x + a, y - l],
      [x + a, y - a],
      [x + l, y - a],
      [x + l, y + a],
      [x + a, y + a],
      [x + a, y + l],
      [x - a, y + l],
      [x - a, y + a],
      [x - l, y + a],
      [x - l, y - a],
      [x - a, y - a],
      [x - a, y - l],
    ],
    1.1 + grow * 0.5,
    true,
  );
}

export const pillX = (b: 'start' | 'select'): number => (b === 'start' ? PILL.gap : -PILL.gap);
const pill = (cx: number, cy: number, grow = 0): P2[] => roundedRect(cx, cy, PILL.w / 2 + grow, PILL.h / 2 + grow, PILL.h / 2 + grow - 0.01);

export const SCREWS: P2[] = [
  [-35, 62],
  [35, 62],
  [-37, 0],
  [37, 0],
  [-27, -60],
  [27, -60],
];

const speakerHoles = (): P2[][] => {
  const out: P2[][] = [];
  for (let i = -2; i <= 2; i++) {
    const len = 14 - Math.abs(i) * 3.4;
    const cx = SPEAKER.x + i * 3.1;
    const cy = SPEAKER.y;
    out.push(roundedRect(cx, cy, 0.7, len / 2, 0.69).reverse());
  }
  return out;
};

export function frontGlass(): Glass {
  const rods = new RodBuilder();
  const { hd } = BODY;
  // Wall band (front half) and the rounded front lip.
  rods.add(bodyOutline(1.6), { hw: 1.6, hh: 6.1, rc: 1.5, zc: 6.5, seg: 6 }, true);
  rods.add(bodyOutline(2.5), { hw: 2.5, hh: 0.8, rc: 0.78, zc: hd - 0.8, seg: 5 }, true);
  // Seam lip: the halves meet at a slightly thicker step.
  rods.add(bodyOutline(2.2), { hw: 0.7, hh: 0.45, rc: 0.4, zc: 0.9, seg: 3 }, true);
  // Screw bosses.
  for (const [x, y] of SCREWS) rods.add(circle(x, y, 2.4, 0.5), { hw: 0.8, hh: 5.6, rc: 0.75, zc: 6.2, seg: 4 }, true);
  // Raised wells round the controls.
  rods.add(dpadOutline(1.5), { hw: 0.6, hh: 0.45, rc: 0.42, zc: hd + 0.05, seg: 3 }, true);
  for (const b of [BTN_A, BTN_B]) rods.add(circle(b.x, b.y, b.r + 1.5, 0.5), { hw: 0.6, hh: 0.45, rc: 0.42, zc: hd + 0.05, seg: 3 }, true);
  for (const b of ['start', 'select'] as const) rods.add(pill(pillX(b), PILL.y, 1.2), { hw: 0.45, hh: 0.35, rc: 0.33, zc: hd, seg: 3 }, true);
  // Lens rim round the screen window.
  rods.add(roundedRect(BEZEL.cx, BEZEL.cy, BEZEL.hw + 0.4, BEZEL.hh + 0.4, BEZEL.r + 0.4), { hw: 0.55, hh: 0.35, rc: 0.33, zc: hd + 0.1, seg: 3 }, true);
  // Inner stiffening ribs either side of the screen (visible through the face).
  for (const s of [-1, 1]) {
    rods.add(
      [
        [s * 39.5, 8],
        [s * 39.5, 56],
      ],
      { hw: 0.7, hh: 3.2, rc: 0.65, zc: 8.9, seg: 3, ends: 'dome' },
    );
  }
  // Speaker baffle ring under the grille.
  rods.add(circle(SPEAKER.x, SPEAKER.y, SPEAKER.r + 1.2, 0.5), { hw: 0.6, hh: 2.2, rc: 0.55, zc: 10.2, seg: 3 }, true);

  const holes = [
    dpadOutline(0.45).reverse(),
    circle(BTN_A.x, BTN_A.y, BTN_A.r + 0.45, 0.5).reverse(),
    circle(BTN_B.x, BTN_B.y, BTN_B.r + 0.45, 0.5).reverse(),
    pill(pillX('start'), PILL.y, 0.4).reverse(),
    pill(pillX('select'), PILL.y, 0.4).reverse(),
    ...speakerHoles(),
  ];
  const sheets = mergeSheets([sheet(bodyOutline(0.9), hd - 1.6, hd - 0.1, holes)]);
  return { rods: rods.build(), sheets };
}

export function backGlass(): Glass {
  const rods = new RodBuilder();
  const { hd, hh } = BODY;
  // Wall band (back half), open at the cartridge slot.
  rods.add(outlineWithGap(1.6, SLOT_HW), { hw: 1.6, hh: 6.1, rc: 1.5, zc: -6.5, seg: 6, ends: 'flat' }, false);
  // Slot jaws: thick rounded posts that frame the opening.
  for (const s of [-1, 1]) {
    rods.add(
      [
        [s * (SLOT_HW + 0.2), hh - 1.6],
        [s * (SLOT_HW + 0.2), hh - 7],
      ],
      { hw: 1.4, hh: 6.1, rc: 1.3, zc: -6.5, seg: 5, ends: 'dome' },
    );
  }
  rods.add(bodyOutline(2.5), { hw: 2.5, hh: 0.8, rc: 0.78, zc: -hd + 0.8, seg: 5 }, true);
  rods.add(bodyOutline(2.2), { hw: 0.7, hh: 0.45, rc: 0.4, zc: -0.9, seg: 3 }, true);
  for (const [x, y] of SCREWS) {
    rods.add(circle(x, y, 2.4, 0.5), { hw: 0.8, hh: 5.6, rc: 0.75, zc: -6.2, seg: 4 }, true);
    // Counterbore ring on the back face.
    rods.add(circle(x, y, 3.1, 0.5), { hw: 0.5, hh: 0.4, rc: 0.38, zc: -hd - 0.05, seg: 3 }, true);
  }
  // Cartridge guide rails.
  for (const s of [-1, 1]) {
    rods.add(
      [
        [s * (CART.hw + 1.0), SLOT.y - CART.hh + 4],
        [s * (CART.hw + 1.0), hh - 3],
      ],
      { hw: 0.75, hh: 3.6, rc: 0.7, zc: SLOT.z, seg: 4, ends: 'dome' },
    );
  }
  // Battery cover seam and grip ribs on the back.
  rods.add(roundedRect(0, -40, 29, 25, 5), { hw: 0.45, hh: 0.4, rc: 0.38, zc: -hd - 0.05, seg: 3 }, true);
  for (let i = 0; i < 6; i++) {
    const y = -66 + i * 2.6;
    const half = 14 - Math.abs(i - 2.5) * 1.6;
    rods.add(
      [
        [-half, y],
        [half, y],
      ],
      { hw: 0.5, hh: 0.4, rc: 0.38, zc: -hd - 0.1, seg: 3, ends: 'dome' },
    );
  }
  const screwHoles = SCREWS.map(([x, y]) => circle(x, y, 2.5, 0.5).reverse());
  const sheets = mergeSheets([sheet(bodyOutline(0.9), -hd + 0.1, -hd + 1.6, screwHoles)]);
  return { rods: rods.build(), sheets };
}

// ─────────────────────────── opaque parts ───────────────────────────

const box = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};

const merge = (list: THREE.BufferGeometry[]): THREE.BufferGeometry =>
  mergeGeometries(
    list.map((g) => {
      const n = g.index ? g.toNonIndexed() : g;
      if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
      return n;
    }),
    false,
  );

/** Tiny surface-mount parts scattered in a few clusters (deterministic). */
function smdField(side: 1 | -1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let s = side > 0 ? 7 : 19;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const z = PCB.z + side * (PCB.t / 2 + 0.25);
  const clusters: [number, number, number, number][] =
    side > 0
      ? [
          [-10, -5, 14, 5],
          [18, 4, 10, 4],
          [-32, -46, 6, 8],
          [4, -44, 8, 6],
          [-36, 30, 3, 14],
          [36, 30, 3, 14],
        ]
      : [
          [16, 12, 12, 6],
          [-18, 14, 10, 5],
          [30, -14, 6, 6],
          [-30, -14, 6, 6],
        ];
  for (const [cx, cy, rx, ry] of clusters) {
    for (let i = 0; i < 10; i++) {
      const w = rnd() > 0.5 ? 1.6 : 1.0;
      const h = w > 1.2 ? 0.8 : 0.5;
      const g = box(w, h, 0.5, cx + (rnd() * 2 - 1) * rx, cy + (rnd() * 2 - 1) * ry, z);
      if (rnd() > 0.5) g.rotateZ(0);
      parts.push(g);
    }
  }
  return merge(parts);
}

export function handheldParts(): Part[] {
  const parts: Part[] = [];
  const add = (geometry: THREE.BufferGeometry, spec: Part['spec'], rig: RigName = 'device', at?: [number, number, number], rot?: [number, number, number], noProxy = false): void => {
    parts.push({ geometry, spec, rig, at, rot, noProxy });
  };
  const front = PCB.z + PCB.t / 2;
  const back = PCB.z - PCB.t / 2;

  // PCB (textured both sides, see textures/pcb.ts).
  add(plate(bodyOutline(PCB.inset), SCREWS.map(([x, y]) => circle(x, y, 1.7, 0.5).reverse()), PCB.t, 0.15), 'pcb', 'device', [0, 0, PCB.z]);

  // LCD module: metal frame on standoffs, a dark glass panel behind the active area.
  const lcdZ = SCREEN.z - 1.6;
  add(roundedBox(SCREEN.w + 7, SCREEN.h + 8, 2.4, 1.2, 0.3), PRESET.satin, 'device', [SCREEN.cx, SCREEN.cy - 1, lcdZ]);
  add(roundedBox(SCREEN.w + 3, SCREEN.h + 3, 0.6, 0.6, 0.15), { color: [0.02, 0.022, 0.026], metal: 0, rough: 0.12, coat: 0.6 }, 'device', [SCREEN.cx, SCREEN.cy, SCREEN.z - 0.35]);
  for (const [x, y] of [
    [-27, 6],
    [27, 6],
    [-27, 56],
    [27, 56],
  ] as P2[]) {
    add(cylinderZ(1.3, lcdZ - 1.2 - front, 16), PRESET.brushed, 'device', [x, y, (front + lcdZ - 1.2) / 2], undefined, true);
  }
  // Flex cable from the LCD down to the board.
  add(box(16, 0.25, 4.8, 0, 0, 0), { color: [0.78, 0.46, 0.14], metal: 0, rough: 0.35, coat: 0.5 }, 'device', [SCREEN.cx + 12, SCREEN.cy - SCREEN.h / 2 - 5.2, front + 2.2], undefined, true);
  // Bezel: graphite plate with the screen window cut out.
  add(
    plate(roundedRect(BEZEL.cx, BEZEL.cy, BEZEL.hw, BEZEL.hh, BEZEL.r), [roundedRect(SCREEN.cx, SCREEN.cy, SCREEN.w / 2 + 0.6, SCREEN.h / 2 + 0.6, 1).reverse()], 0.8, 0.2),
    { color: [0.018, 0.018, 0.024], metal: 0, rough: 0.62, coat: 0.12, grain: 0.03 },
    'device',
    [0, 0, BEZEL.z],
  );

  // Chips on the front of the board.
  add(roundedBox(12, 12, 1.4, 0.4, 0.15), { color: [0.035, 0.035, 0.04], metal: 0, rough: 0.5, coat: 0.15 }, 'device', [2, -4, front + 0.7]);
  add(roundedBox(9, 6, 1.1, 0.3, 0.12), { color: [0.04, 0.04, 0.045], metal: 0, rough: 0.5 }, 'device', [-26, -6, front + 0.55]);
  add(roundedBox(5.4, 2.6, 1.3, 1.2, 0.3), PRESET.chrome, 'device', [18, -7, front + 0.65]);
  for (const [x, y] of [
    [-10, 4],
    [12, 3],
  ] as P2[]) {
    add(cylinderZ(1.6, 3.2, 20), PRESET.satin, 'device', [x, y, front + 1.6], undefined, true);
  }
  add(smdField(1), { color: [0.46, 0.4, 0.32], metal: 0.3, rough: 0.4 }, 'device', undefined, undefined, true);
  // Button contact domes (conductive rubber).
  const dome = { color: [0.11, 0.11, 0.12] as [number, number, number], metal: 0, rough: 0.55, coat: 0.15 };
  for (const [x, y] of [
    [DPAD.x, DPAD.y + 8],
    [DPAD.x, DPAD.y - 8],
    [DPAD.x - 8, DPAD.y],
    [DPAD.x + 8, DPAD.y],
    [BTN_A.x, BTN_A.y],
    [BTN_B.x, BTN_B.y],
  ] as P2[]) {
    add(cylinderZ(3.2, 1.2, 24, 2.2), dome, 'device', [x, y, front + 0.6], undefined, true);
  }
  for (const b of ['start', 'select'] as const) add(roundedBox(9, 3.4, 1.0, 1.6, 0.3), dome, 'device', [pillX(b), PILL.y, front + 0.5], undefined, true);

  // Speaker.
  add(cylinderZ(SPEAKER.r, 2.6, 40), PRESET.satin, 'device', [SPEAKER.x, SPEAKER.y, front + 1.3]);
  add(cylinderZ(SPEAKER.r - 1.4, 0.6, 40, SPEAKER.r - 3), { color: [0.06, 0.06, 0.065], metal: 0, rough: 0.8 }, 'device', [SPEAKER.x, SPEAKER.y, front + 2.8], undefined, true);
  add(cylinderZ(2.2, 0.8, 24), PRESET.chrome, 'device', [SPEAKER.x, SPEAKER.y, front + 3.2], undefined, true);

  // Back of the board: cartridge connector, battery, a few parts.
  add(roundedBox(CART.hw * 2 + 6, 7, 8.6, 0.8, 0.3), { color: [0.03, 0.03, 0.034], metal: 0, rough: 0.45, coat: 0.2 }, 'device', [0, SLOT.y - CART.hh + 1.5, SLOT.z + 0.2]);
  add(box(CART.hw * 2 - 2, 1.0, 0.4, 0, 0, 0), PRESET.platinum, 'device', [0, SLOT.y - CART.hh + 5.1, SLOT.z + 0.2], undefined, true);
  add(roundedBox(54, 42, 4.6, 3, 1.2), { color: [0.78, 0.79, 0.81], metal: 1, rough: 0.34, brush: 0.08, spark: 0.3 }, 'device', [0, -38, back - 2.5]);
  add(box(10, 6, 0.3, 0, 0, 0), { color: [0.9, 0.9, 0.9], metal: 0, rough: 0.6 }, 'device', [12, -36, back - 4.95], undefined, true);
  add(roundedBox(8, 8, 1.1, 0.3, 0.12), { color: [0.035, 0.035, 0.04], metal: 0, rough: 0.5 }, 'device', [16, 12, back - 0.55]);
  add(smdField(-1), { color: [0.46, 0.4, 0.32], metal: 0.3, rough: 0.4 }, 'device', undefined, undefined, true);
  // Battery leads.
  add(box(1.2, 10, 0.8, 0, 0, 0), { color: [0.6, 0.06, 0.08], metal: 0, rough: 0.4 }, 'device', [-6, -12, back - 0.8], undefined, true);
  add(box(1.2, 10, 0.8, 0, 0, 0), { color: [0.05, 0.05, 0.05], metal: 0, rough: 0.4 }, 'device', [-3.6, -12, back - 0.8], undefined, true);

  // Screws through the back into the bosses.
  for (const [x, y] of SCREWS) {
    add(screwHead(2.2), PRESET.chrome, 'device', [x, y, -BODY.hd + 0.95], [PI, 0, 0], true);
    add(screwCross(2.2), { color: [0.2, 0.2, 0.22], metal: 1, rough: 0.4 }, 'device', [x, y, -BODY.hd - 0.02], [PI, 0, 0], true);
    add(cylinderZ(0.9, 11, 12), PRESET.satin, 'device', [x, y, -6.5], undefined, true);
  }

  // Power switch: a track on the top edge and the knob (its own rig).
  add(roundedBox(14, 1.6, 4.8, 0.7, 0.3), { color: [0.05, 0.05, 0.058], metal: 0, rough: 0.5 }, 'device', [(SWITCH.off + SWITCH.on) / 2, BODY.hh - 1.0, SWITCH.z]);
  add(roundedBox(4.6, 3.4, 4.2, 1.0, 0.45), { color: [0.86, 0.85, 0.88], metal: 0, rough: 0.32, coat: 0.4 }, 'switch', [0, 1.1, 0]);
  for (let i = -1; i <= 1; i++) add(box(0.5, 0.4, 3.6, 0, 0, 0), { color: [0.6, 0.6, 0.63], metal: 0, rough: 0.4 }, 'switch', [i * 1.2, 2.85, 0], undefined, true);
  // Power LED.
  add(cylinderZ(1.15, 0.8, 20), 'led', 'device', [LED.x, LED.y, LED.z - 1.8], undefined, true);

  // ── Controls (each on its own rig so it can travel). Caps are opaque moulded plastic.
  const dpadCap = { color: [0.06, 0.06, 0.07] as [number, number, number], metal: 0, rough: 0.36, coat: 0.4, grain: 0.03 };
  const cross = plate(dpadOutline(0).map(([x, y]) => [x - DPAD.x, y - DPAD.y] as P2), [], DPAD.h, 0.5);
  const flange = plate(dpadOutline(1.6).map(([x, y]) => [x - DPAD.x, y - DPAD.y] as P2), [], 0.8, 0.2);
  flange.translate(0, 0, -DPAD.h / 2 - 0.2);
  add(merge([cross, flange]), dpadCap, 'dpad');
  // Pivot nub and the direction dimples on the cross.
  add(cylinderZ(1.6, 0.5, 20), { color: [0.035, 0.035, 0.04], metal: 0, rough: 0.6 }, 'dpad', [0, 0, DPAD.h / 2 + 0.05], undefined, true);

  const faceCap = { color: [0.5, 0.4, 0.78] as [number, number, number], metal: 0, rough: 0.3, coat: 0.5, grain: 0.02 };
  for (const [rig, b] of [
    ['a', BTN_A],
    ['b', BTN_B],
  ] as const) {
    const cap = cylinderZ(b.r, 3.4, 48, b.r - 0.25);
    const fl = cylinderZ(b.r + 1.5, 0.8, 48);
    fl.translate(0, 0, -1.9);
    add(merge([cap, fl]), faceCap, rig);
  }
  const pillCap = { color: [0.32, 0.31, 0.35] as [number, number, number], metal: 0, rough: 0.62, coat: 0.08 };
  for (const b of ['start', 'select'] as const) add(roundedBox(PILL.w, PILL.h, 2.6, PILL.h / 2 - 0.01, 0.6), pillCap, b);

  return parts;
}

/** Rest z of the control caps' centres (top surfaces sit ~1.4 mm proud of the face). */
export const CAP_Z = { dpad: BODY.hd - 0.25, a: BODY.hd - 0.3, b: BODY.hd - 0.3, start: BODY.hd - 0.1, select: BODY.hd - 0.1 } as const;
