/**
 * The main board, drawn procedurally: green solder mask, routed traces, exposed gold pads, button
 * contact combs and white silkscreen. Two canvases share one layout — `albedo` (colour) and `mask`
 * (white where copper is exposed, read as metalness). Front is the left half, back the right half.
 */
import { CART, DPAD, BTN_A, BTN_B, PILL, SCREEN, SCREWS, SLOT, SPEAKER, pillX } from '../geometry/handheld';
import type { Fonts } from './prints';

export const PCB_RECT = { x0: -40, y0: -68, w: 80, h: 136 } as const;
const PX = 9;

const MASK = '#1b4638';
const TRACE = '#2a634f';
const GOLD = '#d4ad5c';
const SILK = '#e9ebe3';

interface Pen {
  g: CanvasRenderingContext2D;
  m: CanvasRenderingContext2D;
}

/** Mulberry-style deterministic generator so the board is identical on every load. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pcbCanvases(fonts: Fonts): { albedo: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const W = PCB_RECT.w * PX;
  const H = PCB_RECT.h * PX;
  const albedo = document.createElement('canvas');
  const mask = document.createElement('canvas');
  for (const c of [albedo, mask]) {
    c.width = W * 2;
    c.height = H;
  }
  const g = albedo.getContext('2d');
  const m = mask.getContext('2d');
  if (!g || !m) throw new Error('2D canvas unavailable');
  g.fillStyle = MASK;
  g.fillRect(0, 0, W * 2, H);
  m.fillStyle = '#000';
  m.fillRect(0, 0, W * 2, H);
  for (const side of [0, 1] as const) {
    for (const ctx of [g, m]) {
      ctx.save();
      // Board millimetres → canvas: x from the left edge of this half, y flipped (top of board on top).
      ctx.translate(side * W, 0);
      ctx.scale(PX, -PX);
      ctx.translate(-PCB_RECT.x0, -(PCB_RECT.y0 + PCB_RECT.h));
    }
    const pen = { g, m };
    if (side === 0) drawFront(pen, fonts);
    else drawBack(pen, fonts);
    g.restore();
    m.restore();
  }
  return { albedo, mask };
}

// ───────────────────────── primitives ─────────────────────────

function traces(p: Pen, seed: number, from: [number, number][], to: [number, number][], width = 0.32): void {
  const r = rng(seed);
  p.g.strokeStyle = TRACE;
  p.g.lineWidth = width;
  p.g.lineCap = 'round';
  p.g.lineJoin = 'round';
  from.forEach((a, i) => {
    const b = to[i % to.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    // Manhattan route with a 45° chamfer at the bend.
    const bend = Math.min(Math.abs(dx), Math.abs(dy)) * (0.3 + r() * 0.5);
    p.g.beginPath();
    p.g.moveTo(a[0], a[1]);
    const midY = a[1] + dy * (0.25 + r() * 0.5);
    p.g.lineTo(a[0], midY - Math.sign(dy) * bend);
    p.g.lineTo(a[0] + Math.sign(dx) * bend, midY);
    p.g.lineTo(b[0] - Math.sign(dx) * bend, midY);
    p.g.lineTo(b[0], midY + Math.sign(dy) * bend);
    p.g.lineTo(b[0], b[1]);
    p.g.stroke();
  });
}

function gold(p: Pen, draw: (c: CanvasRenderingContext2D) => void): void {
  p.g.fillStyle = GOLD;
  p.g.strokeStyle = GOLD;
  p.m.fillStyle = '#fff';
  p.m.strokeStyle = '#fff';
  draw(p.g);
  draw(p.m);
}

function via(p: Pen, x: number, y: number): void {
  gold(p, (c) => {
    c.beginPath();
    c.arc(x, y, 0.42, 0, Math.PI * 2);
    c.fill();
  });
  p.g.fillStyle = '#0d221b';
  p.g.beginPath();
  p.g.arc(x, y, 0.17, 0, Math.PI * 2);
  p.g.fill();
}

function silk(p: Pen, fonts: Fonts, text: string, x: number, y: number, size = 1.5, align: CanvasTextAlign = 'center'): void {
  const c = p.g;
  c.save();
  c.translate(x, y);
  c.scale(1, -1);
  c.fillStyle = SILK;
  c.font = `600 ${size}px ${fonts.mono}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillText(text, 0, 0);
  c.restore();
}

function silkBox(p: Pen, x: number, y: number, w: number, h: number): void {
  p.g.strokeStyle = SILK;
  p.g.lineWidth = 0.22;
  p.g.strokeRect(x - w / 2, y - h / 2, w, h);
}

/** Interleaved comb contact under a rubber dome. */
function comb(p: Pen, x: number, y: number, r: number): void {
  gold(p, (c) => {
    c.lineWidth = 0.45;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.stroke();
    for (let i = -3; i <= 3; i++) {
      const yy = y + i * (r / 3.6);
      const half = Math.sqrt(Math.max(0, r * r - (yy - y) ** 2)) - 0.6;
      if (half <= 0.3) continue;
      c.beginPath();
      if (i % 2 === 0) {
        c.moveTo(x - half, yy);
        c.lineTo(x + half - 0.9, yy);
      } else {
        c.moveTo(x - half + 0.9, yy);
        c.lineTo(x + half, yy);
      }
      c.stroke();
    }
  });
}

function padRow(p: Pen, x: number, y: number, n: number, pitch: number, w: number, h: number, vertical = false): [number, number][] {
  const out: [number, number][] = [];
  gold(p, (c) => {
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * pitch;
      const px = vertical ? x : x + o;
      const py = vertical ? y + o : y;
      c.fillRect(px - w / 2, py - h / 2, w, h);
    }
  });
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * pitch;
    out.push(vertical ? [x, y + o] : [x + o, y]);
  }
  return out;
}

function chipFootprint(p: Pen, x: number, y: number, w: number, h: number, perSide: number): [number, number][] {
  const pins: [number, number][] = [];
  const pitch = Math.min(w, h) / (perSide + 1);
  pins.push(...padRow(p, x, y + h / 2 + 0.9, perSide, pitch, 0.35, 1.2));
  pins.push(...padRow(p, x, y - h / 2 - 0.9, perSide, pitch, 0.35, 1.2));
  pins.push(...padRow(p, x - w / 2 - 0.9, y, perSide, pitch, 1.2, 0.35, true));
  pins.push(...padRow(p, x + w / 2 + 0.9, y, perSide, pitch, 1.2, 0.35, true));
  return pins;
}

function screwPads(p: Pen): void {
  for (const [x, y] of SCREWS) {
    gold(p, (c) => {
      c.beginPath();
      c.arc(x, y, 3.0, 0, Math.PI * 2);
      c.fill();
    });
  }
}

// ───────────────────────── sides ─────────────────────────

function drawFront(p: Pen, fonts: Fonts): void {
  const r = rng(11);
  // Ground pour hatching near the edges.
  p.g.strokeStyle = '#21523f';
  p.g.lineWidth = 0.18;
  for (let y = -66; y < 66; y += 1.6) {
    p.g.beginPath();
    p.g.moveTo(-39, y);
    p.g.lineTo(-35, y + 4);
    p.g.stroke();
  }
  // Big buses first so pads sit on top.
  const cpu = chipFootprint(p, 2, -4, 12, 12, 9);
  const ram = chipFootprint(p, -26, -6, 9, 6, 6);
  const contacts: [number, number][] = [
    [DPAD.x, DPAD.y + 8],
    [DPAD.x, DPAD.y - 8],
    [DPAD.x - 8, DPAD.y],
    [DPAD.x + 8, DPAD.y],
    [BTN_A.x, BTN_A.y],
    [BTN_B.x, BTN_B.y],
    [pillX('start'), PILL.y],
    [pillX('select'), PILL.y],
  ];
  const lcd = padRow(p, SCREEN.cx + 12, SCREEN.cy - SCREEN.h / 2 - 7.4, 14, 0.9, 0.45, 2.2);
  traces(p, 3, cpu.slice(0, 9), lcd);
  traces(p, 5, cpu.slice(9, 18), contacts.slice(0, 6));
  traces(p, 7, cpu.slice(18, 27), ram);
  traces(p, 9, cpu.slice(27, 36), [
    [SPEAKER.x - 6, SPEAKER.y + 6],
    [pillX('start'), PILL.y + 3],
    [pillX('select'), PILL.y + 3],
    [30, 40],
    [-34, 50],
  ]);
  traces(p, 13, ram, [
    [-34, -30],
    [-34, 20],
    [-20, 62],
  ]);
  for (let i = 0; i < 70; i++) via(p, -36 + r() * 72, -64 + r() * 128);
  for (const [x, y] of contacts.slice(0, 6)) comb(p, x, y, 3.4);
  for (const b of ['start', 'select'] as const) {
    gold(p, (c) => {
      c.fillRect(pillX(b) - 4.2, PILL.y - 1.4, 3.6, 2.8);
      c.fillRect(pillX(b) + 0.6, PILL.y - 1.4, 3.6, 2.8);
    });
  }
  screwPads(p);
  // Speaker pads and the LCD standoff rings.
  padRow(p, SPEAKER.x - 10.5, SPEAKER.y, 2, 3, 1.4, 1.8, true);
  // Silkscreen.
  silkBox(p, 2, -4, 15, 15);
  silk(p, fonts, 'U1', 2, -13.4);
  silkBox(p, -26, -6, 11.6, 8.6);
  silk(p, fonts, 'U2', -26, -12);
  silk(p, fonts, 'Y1', 18, -10.6);
  silk(p, fonts, 'LCD1', -22, SCREEN.cy + SCREEN.h / 2 + 4.6, 1.6, 'left');
  silkBox(p, SCREEN.cx, SCREEN.cy, SCREEN.w + 8, SCREEN.h + 9);
  silk(p, fonts, 'SPK1', SPEAKER.x, SPEAKER.y - 11.2);
  silk(p, fonts, 'SW1', -33, 64.5, 1.3);
  const labels: [string, number, number][] = [
    ['UP', DPAD.x, DPAD.y + 13.2],
    ['DN', DPAD.x, DPAD.y - 13.2],
    ['LT', DPAD.x - 13.4, DPAD.y],
    ['RT', DPAD.x + 13.4, DPAD.y],
    ['A', BTN_A.x + 6.2, BTN_A.y + 5.2],
    ['B', BTN_B.x - 6.2, BTN_B.y - 5.2],
  ];
  for (const [t, x, y] of labels) silk(p, fonts, t, x, y, 1.4);
  silk(p, fonts, 'PS-002 MAIN', -30, -64, 1.7, 'left');
  silk(p, fonts, 'REV B  2026', 10, -64, 1.4, 'left');
  for (let i = 0; i < 12; i++) silk(p, fonts, `C${10 + i}`, -34 + (i % 6) * 13.5, i < 6 ? 6.4 : -17.6, 1.05);
}

function drawBack(p: Pen, fonts: Fonts): void {
  // The back half is mirrored relative to the front: draw in back-view coordinates.
  p.g.save();
  p.m.save();
  p.g.scale(-1, 1);
  p.m.scale(-1, 1);
  const r = rng(29);
  const conn = padRow(p, 0, SLOT.y - CART.hh + 1.5, 16, (CART.hw * 2 - 12) / 15, 1.5, 4.2);
  const amp = chipFootprint(p, -16, 12, 8, 8, 6);
  traces(p, 17, conn, amp);
  traces(p, 19, amp, [
    [10, -10],
    [-6, -14],
    [-3.6, -14],
    [24, -60],
  ]);
  for (let i = 0; i < 50; i++) via(p, -36 + r() * 72, -64 + r() * 128);
  screwPads(p);
  // Battery outline and polarity.
  p.g.strokeStyle = SILK;
  p.g.lineWidth = 0.24;
  p.g.strokeRect(-28, -60, 56, 44);
  silk(p, fonts, 'BT1  3.7V LI-PO', 0, -63, 1.6);
  silk(p, fonts, '+', 9, -12.4, 2);
  silk(p, fonts, 'J1  CART', -24, SLOT.y - CART.hh + 7, 1.5, 'left');
  silk(p, fonts, 'U3', -16, 3.4);
  silk(p, fonts, 'OBJECT STUDY / 002', 0, 64, 1.7);
  silk(p, fonts, 'THIS SIDE TOWARD BACK', 0, 61.6, 1.1);
  p.g.restore();
  p.m.restore();
}
