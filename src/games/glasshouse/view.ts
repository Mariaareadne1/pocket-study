/** GLASSHOUSE pixel art (160×144): pastel stained glass under a white-painted greenhouse frame. */
import { type Color, type Framebuffer, sprite } from '@/runtime/framebuffer';
import { text } from '@/runtime/font';
import type { Theme } from '../common/menu';
import { BALL, FIELD, GRID, MAX_LIVES, PADDLE, WALL, type Ball, type Pane, type Paddle, type Run, buildPanes, layoutFor, newRun } from './logic';
import { loopOf } from './layouts';

export const C = {
  sky0: 0x1f3c3a,
  sky1: 0x2f5a53,
  sky2: 0x4a7a66,
  beam: 0x18302c,
  frame: 0xd8e2d6,
  frameLo: 0x8ea596,
  hud: 0x142a27,
  hudEdge: 0x4d7a6c,
  ink: 0xf2f7ee,
  dim: 0x9dbdb0,
  gold: 0xffe3a0,
  leaf: 0x2c6146,
  leafHi: 0x3f7f59,
  pot: 0x7a4c3a,
  potHi: 0x9c6550,
} as const;

export const THEME: Theme = { panel: 0x1f3d38, edge: 0x8fc4ad, ink: C.ink, dim: C.dim, accent: 0xf4c0cc, scrim: 0x0b1715 };

/** [base, top highlight, lower shade] per pastel tint: rose, peach, butter, mint, sky. */
export const TINTS: readonly (readonly [Color, Color, Color])[] = [
  [0xf4a9bd, 0xffdde6, 0xc77d93],
  [0xf7c59f, 0xffe8d2, 0xcc9672],
  [0xf2e39b, 0xfff7cf, 0xc4b56c],
  [0xa8e0c0, 0xdaf7e7, 0x76b293],
  [0xa9c8f0, 0xdbe9ff, 0x7896c4],
];
const FROST = { base: 0xdbe6ec, hi: 0xffffff, lo: 0xa6bac5, dot: 0xc3d3dc, crack: 0x5f7887 } as const;
const IRON = { base: 0x3b484c, hi: 0x6a7b7f, rivet: 0x9aa8aa } as const;

const PEBBLE = sprite(['.gg.', 'gHgg', 'gggd', '.dd.'], { g: 0xc9c2b4, H: 0xffffff, d: 0x8a8273 });
const PEBBLE_OFF = sprite(['.gg.', 'gggg', 'gggg', '.gg.'], { g: 0x33504a });

export const paneColor = (p: Pick<Pane, 'kind' | 'tint'>): Color => (p.kind === 'frost' ? FROST.base : p.kind === 'iron' ? IRON.base : TINTS[p.tint][0]);

function drawFrame(fb: Framebuffer): void {
  // Gable beams, mullions and a transom, seen through the glass as dark silhouettes.
  for (let x = 0; x <= 80; x++) {
    const y = Math.round(58 - (x / 80) * 42);
    fb.rect(x, y, 1, 2, C.beam);
    fb.rect(FIELD.w - 1 - x, y, 1, 2, C.beam);
  }
  for (const x of [32, 64, 95, 127]) fb.rect(x, FIELD.top, 2, FIELD.h - FIELD.top, C.beam);
  fb.rect(0, 96, FIELD.w, 2, C.beam);
  // Soft reflections on the far glass.
  for (let k = 0; k < 4; k++) for (let i = 0; i < 26; i++) fb.shade(10 + k * 38 + i, 100 + i, 1, 1, 0xffffff, 0.06);
  // Painted posts and the top beam the pebble bounces off.
  fb.rect(0, FIELD.top, WALL.l, FIELD.h - FIELD.top, C.frame);
  fb.rect(WALL.l - 1, FIELD.top, 1, FIELD.h - FIELD.top, C.frameLo);
  fb.rect(WALL.r, FIELD.top, FIELD.w - WALL.r, FIELD.h - FIELD.top, C.frame);
  fb.rect(WALL.r, FIELD.top, 1, FIELD.h - FIELD.top, C.frameLo);
  fb.rect(0, FIELD.top, FIELD.w, WALL.top - FIELD.top, C.frame);
  fb.rect(WALL.l, WALL.top - 1, WALL.r - WALL.l, 1, C.frameLo);
}

function drawPlants(fb: Framebuffer): void {
  for (let i = 0; i < 6; i++) {
    const x = 8 + i * 26;
    const h = 5 + ((i * 7) % 4);
    for (let k = -2; k <= 2; k++) fb.rect(x + 4 + k * 2, 138 - h + Math.abs(k) * 2, 2, h - Math.abs(k), k % 2 ? C.leaf : C.leafHi);
    fb.rect(x, 138, 12, 6, C.pot);
    fb.rect(x, 138, 12, 1, C.potHi);
  }
}

export function drawBackdrop(fb: Framebuffer): void {
  fb.gradient(FIELD.top, fb.height, [C.sky0, C.sky1, C.sky2], 6);
  drawFrame(fb);
  drawPlants(fb);
}

function drawCrack(fb: Framebuffer, p: Pane): void {
  const o = p.id % 5;
  const path: readonly [number, number][] = [[3, 0], [4, 1], [5, 2], [6, 2], [7, 3], [8, 4], [9, 5], [6, 3], [5, 4], [8, 1], [9, 1]];
  for (const [dx, dy] of path) fb.px(p.x + dx + o, p.y + dy, FROST.crack);
}

export function drawPane(fb: Framebuffer, p: Pane): void {
  const { x, y } = p;
  if (p.kind === 'iron') {
    fb.rect(x, y, GRID.w, GRID.h, IRON.base);
    fb.rect(x, y, GRID.w, 1, IRON.hi);
    for (const rx of [2, GRID.w - 3]) fb.px(x + rx, y + 3, IRON.rivet);
    return;
  }
  const [base, hi, lo] = p.kind === 'frost' ? [FROST.base, FROST.hi, FROST.lo] : TINTS[p.tint];
  fb.rect(x, y, GRID.w, GRID.h, base);
  if (p.kind === 'frost') for (let j = 1; j < GRID.h - 1; j++) for (let i = (j & 1) + 1; i < GRID.w - 1; i += 3) fb.px(x + i, y + j, FROST.dot);
  fb.rect(x + 1, y, GRID.w - 2, 1, hi);
  fb.rect(x, y + GRID.h - 1, GRID.w, 1, lo);
  fb.px(x + 2, y + 2, hi);
  fb.px(x + 3, y + 1, hi);
  if (p.cracked) drawCrack(fb, p);
}

export function drawPaddle(fb: Framebuffer, p: Paddle): void {
  const x = Math.round(p.x);
  const y = PADDLE.y;
  fb.rect(x + 1, y, PADDLE.w - 2, 1, 0xe8c48e);
  fb.rect(x, y + 1, PADDLE.w, 2, 0xc8975e);
  fb.rect(x + 1, y + 3, PADDLE.w - 2, 1, 0x7d5734);
  fb.rect(x + 5, y + 2, 4, 1, 0xa87a48);
  fb.rect(x + 13, y + 1, 5, 1, 0xa87a48);
  fb.px(x + 2, y + 1, 0x4f4038);
  fb.px(x + PADDLE.w - 3, y + 1, 0x4f4038);
}

export function drawBall(fb: Framebuffer, b: Ball): void {
  if (!b.stuck) {
    const s = Math.hypot(b.vx, b.vy) || 1;
    for (let k = 1; k <= 2; k++) fb.shade(b.x - (b.vx / s) * k * 3 - 1, b.y - (b.vy / s) * k * 3 - 1, 2, 2, 0xeae4d8, 0.35 / k);
  }
  fb.sprite(PEBBLE, b.x - BALL.r, b.y - BALL.r);
}

export function drawScene(fb: Framebuffer, run: Run): void {
  drawBackdrop(fb);
  for (const p of run.panes) drawPane(fb, p);
  drawPaddle(fb, run.paddle);
  if (run.ball.y - BALL.r <= FIELD.h) drawBall(fb, run.ball);
}

export interface Shard {
  x: number;
  y: number;
  age: number;
  color: Color;
  label: string;
}

export function drawShards(fb: Framebuffer, shards: readonly Shard[]): void {
  for (const s of shards) {
    for (let k = 0; k < 6; k++) {
      const fx = s.x + 2 + k * 2 + (k - 2.5) * s.age * 22;
      const fy = s.y + 2 + (k % 3) + s.age * s.age * 140;
      fb.rect(fx, fy, k % 2 ? 2 : 1, 1, s.age < 0.12 ? 0xffffff : s.color);
    }
    if (s.label) text(fb, s.label, s.x + GRID.w / 2, s.y - 6 - s.age * 14, C.gold, { align: 'center' });
  }
}

const pad5 = (n: number): string => String(Math.min(99999, n)).padStart(5, '0');

export function drawHud(fb: Framebuffer, run: Run, best: number): void {
  fb.rect(0, 0, fb.width, FIELD.top - 1, C.hud);
  fb.rect(0, FIELD.top - 1, fb.width, 1, C.hudEdge);
  text(fb, pad5(run.score), 3, 2, C.ink);
  text(fb, `HI${pad5(Math.max(best, run.score))}`, 38, 2, C.dim);
  text(fb, `L${String(run.level).padStart(2, '0')}`, 90, 2, TINTS[(run.level - 1) % TINTS.length][0]);
  for (let i = 0; i < MAX_LIVES; i++) fb.sprite(i < run.lives ? PEBBLE : PEBBLE_OFF, fb.width - 22 + i * 7, 4);
}

/** Level banner while the next roof is shown, then a blinking launch hint. */
export function drawPrompt(fb: Framebuffer, run: Run, t: number): void {
  if (run.banner > 0) {
    const w = 100;
    const x = (fb.width - w) / 2;
    fb.panel(x, 82, w, loopOf(run.level) > 0 ? 34 : 26, THEME.panel, THEME.edge);
    text(fb, `LEVEL ${run.level}`, fb.width / 2, 86, C.gold, { align: 'center' });
    text(fb, layoutFor(run.level).name, fb.width / 2, 97, C.dim, { align: 'center' });
    if (loopOf(run.level) > 0) text(fb, 'FASTER!', fb.width / 2, 106, THEME.accent, { align: 'center' });
  } else if (run.ball.stuck && Math.floor(t * 1.6) % 2 === 0) {
    text(fb, 'A: LAUNCH', fb.width / 2, 110, C.ink, { align: 'center', shadow: C.beam });
  }
}

export function drawTitle(fb: Framebuffer, t: number, best: number): void {
  drawBackdrop(fb);
  fb.rect(0, 0, fb.width, FIELD.top, C.hud);
  const roof = buildPanes(layoutFor(1));
  for (const p of roof) drawPane(fb, { ...p, y: p.y + 40 });
  text(fb, 'GLASSHOUSE', fb.width / 2, 24, C.ink, { align: 'center', scale: 2, shadow: C.beam });
  text(fb, 'BREAK EVERY PANE', fb.width / 2, 44, C.dim, { align: 'center' });
  const bx = 80 + Math.sin(t * 1.7) * 30;
  drawPaddle(fb, { x: bx - PADDLE.w / 2, vx: 0 });
  fb.sprite(PEBBLE, bx - 2 + Math.cos(t * 3) * 4, 124 - Math.abs(Math.sin(t * 3)) * 20);
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: PLAY', fb.width / 2, 102, C.ink, { align: 'center', shadow: C.beam });
  text(fb, `BEST ${pad5(best)}`, fb.width / 2, 2, C.dim, { align: 'center' });
}

export function drawOver(fb: Framebuffer, run: Run, best: number, isNew: boolean, t: number): void {
  fb.shade(0, 0, fb.width, fb.height, THEME.scrim, 0.55);
  const w = 120;
  const x = (fb.width - w) / 2;
  fb.panel(x, 40, w, 62, THEME.panel, THEME.edge);
  text(fb, 'GAME OVER', fb.width / 2, 47, C.ink, { align: 'center' });
  text(fb, `SCORE ${pad5(run.score)}`, fb.width / 2, 61, C.gold, { align: 'center' });
  text(fb, isNew ? 'NEW BEST!' : `BEST  ${pad5(best)}`, fb.width / 2, 72, isNew ? THEME.accent : C.dim, { align: 'center' });
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: AGAIN', fb.width / 2, 88, C.ink, { align: 'center' });
}

/** A fixed mid-game moment for the printed cartridge label. */
export function drawLabelArt(fb: Framebuffer): void {
  const gone = new Set([53, 54, 55, 56, 47, 33, 22]);
  const panes = buildPanes(layoutFor(2))
    .filter((p) => !gone.has(p.id))
    .map((p) => (p.id === 45 ? { ...p, cracked: true } : p));
  const base = newRun(5);
  const run: Run = { ...base, level: 2, score: 1240, lives: 2, panes, paddle: { x: 58, vx: 0 }, ball: { x: 97, y: 86, vx: 42, vy: -76, stuck: false }, banner: 0 };
  drawScene(fb, run);
  drawShards(fb, [{ x: GRID.x + 4 * (GRID.w + GRID.gapX), y: GRID.y + 5 * (GRID.h + GRID.gapY), age: 0.2, color: TINTS[4][0], label: '' }]);
  drawHud(fb, run, 2860);
}

export const HELP_LINES = [
  'D-PAD  MOVE PLANK',
  'A      LAUNCH PEBBLE',
  'START  PAUSE',
  '',
  'BREAK EVERY PANE.',
  'FROSTED PANES TAKE 2.',
  'IRON NEVER BREAKS.',
  'PLANK ENDS ANGLE IT.',
];
