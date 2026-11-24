/**
 * Cartridge labels. The artwork in each label window is rendered by the game's own pixel
 * renderer (the same code that draws the screen), then enlarged with nearest-neighbour scaling —
 * so the label always matches what the cartridge actually plays.
 */
import type { CartId } from '../../device/machine';
import { demoGarden } from '../../games/bloom/logic';
import { drawGarden, drawSky } from '../../games/bloom/view';
import { demoSky } from '../../games/littlesky/logic';
import { renderSky } from '../../games/littlesky/view';
import { newRun } from '../../games/starfall/logic';
import { drawLabelArt as glasshouseArt } from '../../games/glasshouse/view';
import { drawLabelArt as rallyArt } from '../../games/rally/view';
import { drawLabelArt as vineArt } from '../../games/vine/view';
import { drawBackdrop, drawObj, drawPlayer } from '../../games/starfall/view';
import { Framebuffer } from '../../runtime/framebuffer';
import { CARTS } from '../../runtime/types';
import { CART_LABEL, CART_STRIP } from '../geometry/cartridge';
import { type Fonts, mmCanvas, tracked } from './prints';

interface LabelStyle {
  paper: string;
  ink: string;
  dim: string;
  accent: string;
  crop: [number, number, number, number];
}

const STYLE: Record<CartId, LabelStyle> = {
  bloom: { paper: '#f3efe6', ink: '#2c3a2e', dim: '#7b8a74', accent: '#e58fa6', crop: [8, 6, 144, 117] },
  starfall: { paper: '#141a36', ink: '#ece8ff', dim: '#8f8fc4', accent: '#f4cf6b', crop: [0, 12, 160, 132] },
  littlesky: { paper: '#e9edf5', ink: '#2e3452', dim: '#7c84a8', accent: '#b39ae6', crop: [0, 0, 160, 128] },
  vine: { paper: '#eef1e4', ink: '#24361f', dim: '#71836a', accent: '#7fb86a', crop: [0, 14, 160, 128] },
  glasshouse: { paper: '#f6f0e2', ink: '#3b3226', dim: '#8d8170', accent: '#8cc7c1', crop: [0, 12, 160, 132] },
  rally: { paper: '#f4ece9', ink: '#3a2324', dim: '#8f7470', accent: '#d9786f', crop: [0, 0, 160, 144] },
};

const LABEL_ART: Partial<Record<CartId, (fb: Framebuffer) => void>> = { vine: vineArt, glasshouse: glasshouseArt, rally: rallyArt };

/** Renders the game's pixel art for a cartridge into a small canvas (1 px per screen pixel). */
export function cartArt(id: CartId): HTMLCanvasElement {
  let fb: Framebuffer;
  if (id === 'bloom') {
    fb = new Framebuffer();
    drawSky(fb, 2.4);
    drawGarden(fb, demoGarden(), 2.4);
  } else if (id === 'starfall') {
    fb = new Framebuffer();
    drawBackdrop(fb, 3.1);
    const objs = [
      { kind: 'star', x: 34, y: 30 },
      { kind: 'big', x: 92, y: 46 },
      { kind: 'star', x: 128, y: 22 },
      { kind: 'rock', x: 58, y: 70 },
      { kind: 'star', x: 112, y: 84 },
      { kind: 'rock', x: 20, y: 96 },
    ] as const;
    objs.forEach((o, i) => drawObj(fb, { id: i + 1, vx: 0, vy: 0, spin: i, ...o }, 3.1));
    drawPlayer(fb, { ...newRun(1).player, x: 74, y: 110 }, 3.1);
  } else if (id === 'littlesky') {
    fb = new Framebuffer(160, 128);
    renderSky(fb, demoSky(), 4.2);
  } else {
    fb = new Framebuffer();
    LABEL_ART[id]?.(fb);
  }
  const [x, y, w, h] = STYLE[id].crop;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  const img = g.createImageData(w, h);
  for (let row = 0; row < h; row++) {
    const src = ((y + row) * fb.width + x) * 4;
    img.data.set(fb.data.subarray(src, src + w * 4), row * w * 4);
  }
  g.putImageData(img, 0, 0);
  return c;
}

function frame(g: CanvasRenderingContext2D, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(0, 0, w, h, r);
  g.closePath();
}

/** Main label (42 × 34 mm) for the −Z face. */
export function cartLabel(id: CartId, fonts: Fonts): HTMLCanvasElement {
  const s = STYLE[id];
  const info = CARTS[id];
  const { w, h } = CART_LABEL;
  const { c, g } = mmCanvas(w, h, 18);
  frame(g, w, h, 1.6);
  g.fillStyle = s.paper;
  g.fill();
  g.textBaseline = 'middle';
  // Header.
  g.fillStyle = s.dim;
  g.font = `600 1.45px ${fonts.mono}`;
  tracked(g, `CARTRIDGE ${info.number}`, 2.4, 2.9, 0.34, 'left');
  tracked(g, 'OS-002', w - 2.4, 2.9, 0.34, 'right');
  // Art window.
  const art = cartArt(id);
  const ax = 2.4;
  const ay = 4.8;
  const aw = w - 4.8;
  const ah = 19.4;
  g.save();
  g.beginPath();
  g.roundRect(ax, ay, aw, ah, 0.8);
  g.clip();
  g.imageSmoothingEnabled = false;
  const scale = Math.max(aw / art.width, ah / art.height);
  const dw = art.width * scale;
  const dh = art.height * scale;
  g.drawImage(art, ax + (aw - dw) / 2, ay + (ah - dh) / 2, dw, dh);
  g.restore();
  g.strokeStyle = s.ink;
  g.globalAlpha = 0.18;
  g.lineWidth = 0.18;
  g.beginPath();
  g.roundRect(ax, ay, aw, ah, 0.8);
  g.stroke();
  g.globalAlpha = 1;
  // Title.
  g.fillStyle = s.ink;
  g.font = `italic 800 4.2px ${fonts.sans}`;
  tracked(g, info.title.toUpperCase(), 2.4, 28.0, 0.02, 'left');
  g.fillStyle = s.accent;
  g.fillRect(2.4, 30.9, 6, 0.4);
  g.fillStyle = s.dim;
  g.font = `600 1.3px ${fonts.mono}`;
  tracked(g, info.genre.toUpperCase(), w - 2.4, 28.4, 0.3, 'right');
  tracked(g, 'OS-002 · 160 × 144', w - 2.4, 31.0, 0.3, 'right');
  return c;
}

/** Title strip (40 × 8.5 mm) on the +Z face near the grip: visible above the shell when seated. */
export function cartStrip(id: CartId, fonts: Fonts): HTMLCanvasElement {
  const s = STYLE[id];
  const info = CARTS[id];
  const { w, h } = CART_STRIP;
  const { c, g } = mmCanvas(w, h, 18);
  frame(g, w, h, 1);
  g.fillStyle = s.paper;
  g.fill();
  g.textBaseline = 'middle';
  g.fillStyle = s.accent;
  g.font = `700 2.2px ${fonts.mono}`;
  tracked(g, info.number, 2.2, h / 2, 0.1, 'left');
  g.fillStyle = s.ink;
  g.font = `italic 800 3.2px ${fonts.sans}`;
  tracked(g, info.title.toUpperCase(), 7.6, h / 2 + 0.2, 0.02, 'left');
  g.fillStyle = s.dim;
  g.font = `600 1.2px ${fonts.mono}`;
  tracked(g, info.genre.toUpperCase(), w - 2.2, h / 2, 0.3, 'right');
  return c;
}
