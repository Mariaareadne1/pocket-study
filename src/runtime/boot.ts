/** Console firmware screens: the original boot sequence and the empty-slot screen. */
import type { CartId } from '@/device/machine';
import { type Framebuffer, mix } from './framebuffer';
import { text, textWidth } from './font';
import { CARTS } from './types';

const PAPER = 0xf4f1ea;
const INK = 0x3a3d48;
const LILAC = 0x9d8bd8;
const DIM = 0x9a968c;

/** Seconds into the boot at which the chime plays. */
export const CHIME_AT = 0.62;

/** The mark: four rounded tiles that land one after another, like cells lighting on a grid. */
function mark(fb: Framebuffer, cx: number, cy: number, t: number): void {
  const tiles: [number, number, number][] = [
    [-7, -7, 0.18],
    [1, -7, 0.27],
    [-7, 1, 0.36],
    [1, 1, 0.45],
  ];
  tiles.forEach(([dx, dy, at], i) => {
    const k = Math.min(1, Math.max(0, (t - at) / 0.12));
    if (k <= 0) return;
    const drop = Math.round((1 - k) * -6);
    const c = i === 3 ? LILAC : mix(PAPER, INK, k);
    fb.panel(cx + dx, cy + dy + drop, 6, 6, c);
  });
}

export function drawBoot(fb: Framebuffer, t: number, cart: CartId | null): void {
  fb.clear(PAPER);
  const cy = 52;
  mark(fb, fb.width / 2, cy, t);
  // The mark alone, then a quiet model line: no product name.
  if (t > 0.9) {
    const k = Math.min(1, (t - 0.9) / 0.3);
    const word = 'OS-002';
    text(fb, word, (fb.width - textWidth(word)) / 2, cy + 18, mix(PAPER, DIM, k));
  }
  if (t > 1.55) {
    const k = Math.min(1, (t - 1.55) / 0.25);
    const label = cart ? `${CARTS[cart].number}  ${CARTS[cart].title.toUpperCase()}` : 'NO CARTRIDGE';
    fb.rect(20, 118, fb.width - 40, 1, mix(PAPER, 0xd8d2c4, k));
    text(fb, label, fb.width / 2, 124, mix(PAPER, cart ? INK : 0xb0574e, k), { align: 'center' });
  }
  // Hand-off: a short white-out before the cartridge's own title screen.
  if (t > 2.35) fb.fadeTo(0xffffff, Math.min(1, (t - 2.35) / 0.3));
}

export function drawNoCart(fb: Framebuffer, t: number): void {
  fb.clear(PAPER);
  text(fb, 'NO CARTRIDGE', fb.width / 2, 28, INK, { align: 'center' });
  // A little slot with a cartridge easing in and out of it.
  const sx = 62;
  const sy = 74;
  fb.rect(sx - 4, sy, 44, 3, INK);
  const k = (Math.sin(t * 2.2) + 1) / 2;
  const cy = Math.round(sy - 34 + k * 14);
  fb.panel(sx + 4, cy, 28, 30, 0xffffff, INK);
  fb.rect(sx + 8, cy + 6, 20, 12, LILAC);
  for (let i = 0; i < 6; i++) fb.rect(sx + 7 + i * 4, cy + 26, 2, 3, 0xc9c2b2);
  fb.rect(sx - 4, sy + 3, 44, 8, PAPER);
  text(fb, 'SWITCH OFF, THEN', fb.width / 2, 100, DIM, { align: 'center' });
  text(fb, 'INSERT A CARTRIDGE', fb.width / 2, 110, DIM, { align: 'center' });
}
