/** VINE pixel art (160×144): a garden bed, a leafy vine with a bud head, dewdrops and blossoms. */
import { type Framebuffer, type Sprite, sprite } from '@/runtime/framebuffer';
import { text, textWidth } from '@/runtime/font';
import type { Theme } from '../common/menu';
import { BLOSSOM, type Cell, type Dir, GRID, type Run, VEC, newRun } from './logic';

export const C = {
  soil0: 0x5a3b2a,
  soil1: 0x4a3022,
  soil2: 0x3c271c,
  furrow: 0x6b4733,
  pebble: 0x8a6a52,
  tuft: 0x6f8f3e,
  frame: 0x2c1d14,
  frameHi: 0x7a5236,
  hud: 0x1f3320,
  hudEdge: 0x4f7a3a,
  ink: 0xf2f6e4,
  dim: 0xa9c08a,
  stem: 0x3f8a3a,
  stemHi: 0x7cc35a,
  stemLo: 0x2a5e2b,
  dew: 0x9fd6ff,
  pink: 0xf5a3c7,
  flash: 0xfff4d6,
} as const;

export const THEME: Theme = { panel: 0x26402a, edge: 0x7cc35a, ink: C.ink, dim: C.dim, accent: 0xf5a3c7, scrim: 0x120c08 };

const rotate = (rows: readonly string[]): string[] => rows[0].split('').map((_, i) => rows.map((r) => r[i]).reverse().join(''));
const turns = (rows: readonly string[]): string[][] => {
  const r1 = rotate(rows);
  const r2 = rotate(r1);
  return [[...rows], r1, r2, rotate(r2)];
};
const byDir = (rows: readonly string[], pal: Readonly<Record<string, number>>, order: readonly Dir[]): Record<Dir, Sprite> => {
  const sprites = turns(rows).map((r) => sprite(r, pal));
  return Object.fromEntries(order.map((d, i) => [d, sprites[i]])) as Record<Dir, Sprite>;
};

const BUD_PAL = { l: C.stemLo, L: C.stem, s: C.stem, b: 0xb6e07a, B: 0xe4f5b0, p: C.pink, P: 0xffd3e6, e: 0x1d2a14 };
/** Facing right; rotations give down, left, up. */
const BUD = byDir(
  ['...ll...', '..lLLbp.', '.lbbBBpP', 'ssbeBBBp', 'ssbBBBBp', '.lbeBBpP', '..lLLbp.', '...ll...'],
  BUD_PAL,
  ['right', 'down', 'left', 'up'],
);
/** Leaf sitting above a horizontal stem; rotations put it right, below, left. */
const LEAF = byDir(['...LLL', '.LLHHL', 'LHHLLl', '.ll...'], { L: C.stem, H: C.stemHi, l: C.stemLo }, ['up', 'right', 'down', 'left']);
const DEW = [
  sprite(['..d..', '.dbd.', 'dWbbd', 'dWbbd', 'dbbbd', '.ddd.'], { d: 0x5b8fd6, b: C.dew, W: 0xffffff }),
  sprite(['..d..', '.dbd.', 'dbWbd', 'dbbbd', 'dbbbd', '.ddd.'], { d: 0x5b8fd6, b: C.dew, W: 0xffffff }),
];
const FLOWER = sprite(['.pp.pp.', 'pPPpPPp', 'pPPyPPp', '.pyYyp.', 'pPPyPPp', 'pPPpPPp', '.pp.pp.'], {
  p: 0xe27fae,
  P: C.pink,
  y: 0xffd36e,
  Y: 0xfff1b0,
});
const ICON = sprite(['.LL', 'LHL', 'Ll.'], { L: C.stem, H: C.stemHi, l: C.stemLo });

const hash = (i: number): number => {
  let x = Math.imul(i ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

const cellX = (c: Cell): number => GRID.x + c[0] * GRID.cell;
const cellY = (c: Cell): number => GRID.y + c[1] * GRID.cell;
const dirTo = (from: Cell, to: Cell): Dir => (to[0] > from[0] ? 'right' : to[0] < from[0] ? 'left' : to[1] > from[1] ? 'down' : 'up');

/** Garden bed: dithered soil, raked furrows, pebbles and grass tufts inside a wooden frame. */
export function drawBackdrop(fb: Framebuffer): void {
  const top = GRID.y;
  const h = GRID.rows * GRID.cell;
  fb.gradient(top, top + h, [C.soil0, C.soil1, C.soil2], 6);
  for (let r = 0; r < GRID.rows; r++) fb.shade(0, top + r * GRID.cell + 6, fb.width, 1, C.furrow, 0.45);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(hash(i) * fb.width);
    const y = top + Math.floor(hash(i + 300) * h);
    if (i % 5 === 0) {
      fb.px(x, y, C.tuft);
      fb.px(x + 1, y - 1, C.tuft);
      fb.px(x + 2, y, C.tuft);
    } else fb.px(x, y, i % 2 ? C.pebble : C.soil2);
  }
  fb.rect(0, top + h, fb.width, fb.height - top - h, C.frame);
  fb.rect(0, top + h, fb.width, 1, C.frameHi);
}

/** A 2-px stem from the cell centre towards one neighbour (one flat colour for the shadow pass). */
function stemTo(fb: Framebuffer, x: number, y: number, d: Dir, flat?: number): void {
  const [dx, dy] = VEC[d];
  const len = 5;
  const sx = dx < 0 ? x : x + 3;
  const sy = dy < 0 ? y : y + 3;
  if (dx !== 0) {
    fb.rect(sx, y + 3, len, 1, flat ?? C.stemHi);
    fb.rect(sx, y + 4, len, 1, flat ?? C.stem);
  } else {
    fb.rect(x + 3, sy, 1, len, flat ?? C.stemHi);
    fb.rect(x + 4, sy, 1, len, flat ?? C.stem);
  }
}

const LEAF_AT: Record<Dir, readonly [number, number]> = { up: [1, -1], down: [1, 5], left: [-1, 1], right: [5, 1] };

function drawSegment(fb: Framebuffer, body: readonly Cell[], i: number, ticks: number): void {
  const c = body[i];
  const x = cellX(c);
  const y = cellY(c);
  const toHead = dirTo(c, body[i - 1]);
  stemTo(fb, x, y, toHead);
  if (i < body.length - 1) stemTo(fb, x, y, dirTo(c, body[i + 1]));
  else fb.px(x + 3 - VEC[toHead][0] * 2, y + 3 - VEC[toHead][1] * 2, C.stemHi);
  // Leaves keep their cell as the vine grows: parity comes from the tick the cell was entered.
  const side = (ticks - i) % 2 === 0;
  const horizontal = VEC[toHead][1] === 0;
  const where: Dir = horizontal ? (side ? 'up' : 'down') : side ? 'left' : 'right';
  if ((ticks - i) % 3 !== 2) fb.sprite(LEAF[where], x + LEAF_AT[where][0], y + LEAF_AT[where][1]);
}

export function drawVine(fb: Framebuffer, run: Run): void {
  // Soft ground shadow, offset down-right.
  run.body.forEach((c, i) => {
    if (i > 0) stemTo(fb, cellX(c) + 1, cellY(c) + 1, dirTo(c, run.body[i - 1]), C.soil2);
  });
  for (let i = run.body.length - 1; i >= 1; i--) drawSegment(fb, run.body, i, run.ticks);
  fb.sprite(BUD[run.dir], cellX(run.body[0]), cellY(run.body[0]));
}

export function drawPickups(fb: Framebuffer, run: Run, t: number): void {
  if (run.food) {
    const bob = Math.floor(t * 3) % 2;
    fb.shade(cellX(run.food) + 2, cellY(run.food) + 6, 4, 1, 0x000000, 0.3);
    fb.sprite(DEW[Math.floor(t * 2) % 2], cellX(run.food) + 1, cellY(run.food) + bob);
  }
  const b = run.blossom;
  if (b && (b.ttl > 1.5 || Math.floor(t * 8) % 2 === 0)) fb.sprite(FLOWER, cellX(b.cell), cellY(b.cell));
}

export interface Spark {
  x: number;
  y: number;
  age: number;
  label: string;
}

export function drawSparks(fb: Framebuffer, sparks: readonly Spark[]): void {
  for (const s of sparks) {
    const cx = cellX([s.x, s.y]) + 4;
    const cy = cellY([s.x, s.y]) + 4;
    const r = 2 + s.age * 14;
    for (let k = 0; k < 6; k++) fb.px(cx + Math.cos(k + s.age) * r, cy + Math.sin(k + s.age) * r, C.dew);
    text(fb, s.label, cx, cy - 10 - s.age * 14, C.ink, { align: 'center', shadow: C.soil2 });
  }
}

const pad4 = (n: number): string => String(Math.min(9999, n)).padStart(4, '0');

export function drawHud(fb: Framebuffer, run: Run, best: number): void {
  fb.rect(0, 0, fb.width, GRID.y - 1, C.hud);
  fb.rect(0, GRID.y - 1, fb.width, 1, C.hudEdge);
  text(fb, pad4(run.score), 3, 3, C.ink);
  text(fb, `HI${pad4(Math.max(best, run.score))}`, 40, 3, C.dim);
  const len = String(run.body.length);
  fb.sprite(ICON, fb.width - 9 - textWidth(len), 5);
  text(fb, len, fb.width - 3, 3, C.ink, { align: 'right' });
  if (run.blossom) fb.rect(84, 5, Math.round(26 * (run.blossom.ttl / BLOSSOM.ttl)), 3, C.pink);
}

/** Crash point flash: the cell the vine bumped into blinks while the screen washes over. */
export function drawCrash(fb: Framebuffer, run: Run, since: number): void {
  if (!run.crash || since > 0.6) return;
  fb.shade(0, GRID.y, fb.width, GRID.rows * GRID.cell, C.flash, 0.5 * (1 - since / 0.6));
  if (Math.floor(since * 12) % 2 === 0) fb.rect(cellX(run.crash), cellY(run.crash), GRID.cell, GRID.cell, C.flash);
}

export function drawPlay(fb: Framebuffer, run: Run, best: number, t: number): void {
  drawBackdrop(fb);
  drawPickups(fb, run, t);
  drawVine(fb, run);
  drawHud(fb, run, best);
}

/** A fixed S-shaped vine for the title and the cartridge label. */
const SHOWCASE: readonly Cell[] = [
  [13, 5], [12, 5], [11, 5], [10, 5], [9, 5], [8, 5], [7, 5], [6, 5], [5, 5], [4, 5], [4, 6], [4, 7], [4, 8],
  [5, 8], [6, 8], [7, 8], [8, 8], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8], [14, 9], [14, 10],
  [13, 10], [12, 10], [11, 10],
];

const showcase = (): Run => ({ ...newRun(1), body: SHOWCASE, dir: 'right', ticks: 40, food: [16, 5], blossom: { cell: [9, 11], ttl: 5 } });

export function drawTitle(fb: Framebuffer, t: number, best: number): void {
  drawBackdrop(fb);
  fb.rect(0, 0, fb.width, GRID.y, C.hud);
  drawPickups(fb, showcase(), t);
  drawVine(fb, showcase());
  fb.shade(16, 2, 128, 36, C.hud, 0.85);
  text(fb, 'VINE', fb.width / 2, 7, C.ink, { align: 'center', scale: 2, shadow: C.stemLo });
  text(fb, 'GROW TOWARD THE DEW', fb.width / 2, 26, C.dim, { align: 'center' });
  fb.shade(24, 110, 112, 28, C.hud, 0.85);
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: PLANT', fb.width / 2, 114, C.ink, { align: 'center' });
  text(fb, `BEST ${pad4(best)}`, fb.width / 2, 126, C.dim, { align: 'center' });
}

/** Representative in-game scene for the printed cartridge label (fixed time, no randomness). */
export function drawLabelArt(fb: Framebuffer): void {
  drawPlay(fb, { ...showcase(), score: 270 }, 480, 0);
}

export function drawOver(fb: Framebuffer, run: Run, best: number, isNew: boolean, since: number, t: number): void {
  if (since < 0.6) {
    drawCrash(fb, run, since);
    return;
  }
  fb.shade(0, 0, fb.width, fb.height, THEME.scrim, 0.55);
  const w = 120;
  const x = (fb.width - w) / 2;
  fb.panel(x, 38, w, 68, THEME.panel, THEME.edge);
  text(fb, 'THE VINE WILTED', fb.width / 2, 45, C.ink, { align: 'center' });
  text(fb, `SCORE ${pad4(run.score)}`, fb.width / 2, 58, C.ink, { align: 'center' });
  text(fb, `LENGTH ${run.body.length}`, fb.width / 2, 68, C.dim, { align: 'center' });
  text(fb, isNew ? 'NEW BEST!' : `BEST  ${pad4(best)}`, fb.width / 2, 78, isNew ? C.pink : C.dim, { align: 'center' });
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: AGAIN', fb.width / 2, 92, C.ink, { align: 'center' });
}

export const HELP_LINES = [
  'D-PAD  STEER',
  'A      HURRY (HOLD)',
  'START  PAUSE',
  '',
  'DEWDROP +10, GROW 1',
  'EVERY 5TH: BLOSSOM',
  'BLOSSOM +50, GROW 2',
  "DON'T HIT WALLS/VINE",
];
