/** STARFALL pixel art (160×144). */
import { type Framebuffer, type Sprite, sprite } from '@/runtime/framebuffer';
import { text, textWidth } from '@/runtime/font';
import type { Theme } from '../common/menu';
import { DASH, FIELD, MAX_LIVES, PULSE, type Obj, type Player, type Run, multiplier } from './logic';

export const C = {
  sky0: 0x111a38,
  sky1: 0x262c5c,
  sky2: 0x3a3570,
  far: 0x56609a,
  near: 0xc9d2ff,
  hud: 0x0b1130,
  hudEdge: 0x2a3168,
  ink: 0xeef0ff,
  dim: 0x8790c6,
  gold: 0xffe08a,
  heart: 0xf29bb0,
  heartOff: 0x3b4277,
  pulse: 0x9fd8f2,
} as const;

export const THEME: Theme = { panel: 0x1a2350, edge: 0x5a64a8, ink: C.ink, dim: C.dim, accent: 0xb9a6ec, scrim: 0x070a1c };

const SHIP = [
  sprite(
    ['.....ww.....', '....wccw....', '...wwccww...', '..wwwwwwww..', '.lwwwwwwwwl.', 'llwwllllwwll', 'l..ll..ll..l', '...o....o...'],
    { w: 0xf3f1ff, c: 0x7fd0e8, l: 0xb9a6ec, o: 0xffb070 },
  ),
  sprite(
    ['.....ww.....', '....wccw....', '...wwccww...', '..wwwwwwww..', '.lwwwwwwwwl.', 'llwwllllwwll', 'l..ll..ll..l', '...O....O...'],
    { w: 0xf3f1ff, c: 0x7fd0e8, l: 0xb9a6ec, O: 0xffe08a },
  ),
];

const STAR = [
  sprite(['...y...', '...y...', '..yYy..', 'yyYWYyy', '..yYy..', '...y...', '...y...'], { y: 0xffd36e, Y: 0xffeaa6, W: 0xffffff }),
  sprite(['.y...y.', '..y.y..', '..yYy..', '.yYWYy.', '..yYy..', '..y.y..', '.y...y.'], { y: 0xffd36e, Y: 0xffeaa6, W: 0xffffff }),
];
const BIG = sprite(
  ['....Y....', '....Y....', '...YWY...', 'YYYYWYYYY', '.YYWWWYY.', '..YYWYY..', '..YY.YY..', '.YY...YY.', 'Y.......Y'],
  { Y: 0xffe39a, W: 0xffffff },
);
const ROCK_ROWS = ['..rrrr..', '.rRRrrr.', 'rRRrrrrd', 'rRrrrrdd', 'rrrrrddd', 'rrrrdddd', '.rrdddd.', '..dddd..'];
const rotate = (rows: readonly string[]): string[] => rows[0].split('').map((_, i) => rows.map((r) => r[i]).reverse().join(''));
const ROCK_PAL = { r: 0x8b7f9a, R: 0xb9afc6, d: 0x544c66 };
const ROCKS: Sprite[] = [ROCK_ROWS, rotate(ROCK_ROWS), rotate(rotate(ROCK_ROWS)), rotate(rotate(rotate(ROCK_ROWS)))].map((r) => sprite(r, ROCK_PAL));
const HEART = sprite(['.h.h.', 'hhhhh', 'hhhhh', '.hhh.', '..h..'], { h: C.heart });
const HEART_OFF = sprite(['.h.h.', 'hhhhh', 'hhhhh', '.hhh.', '..h..'], { h: C.heartOff });

const hash = (i: number): number => {
  let x = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

export function drawBackdrop(fb: Framebuffer, t: number): void {
  fb.gradient(0, fb.height, [C.sky0, C.sky1, C.sky2], 6);
  for (let i = 0; i < 46; i++) {
    const near = i % 3 === 0;
    const speed = near ? 14 : 5;
    const x = Math.floor(hash(i) * fb.width);
    const y = Math.floor((hash(i + 99) * fb.height + t * speed) % fb.height);
    const tw = Math.sin(t * (2 + hash(i + 7) * 3) + i) > 0.3;
    fb.px(x, y, near ? (tw ? C.near : C.far) : C.far);
  }
}

export function drawObj(fb: Framebuffer, o: Obj, t: number): void {
  if (o.kind === 'rock') fb.sprite(ROCKS[Math.floor(o.spin) % 4], o.x, o.y);
  else if (o.kind === 'big') fb.sprite(BIG, o.x, o.y);
  else fb.sprite(STAR[Math.floor(t * 5 + o.id) % 2], o.x, o.y);
}

export function drawPlayer(fb: Framebuffer, p: Player, t: number): void {
  if (p.inv > 0 && Math.floor(t * 14) % 2 === 0) return;
  if (p.dash > 0) {
    // Short afterimage trail.
    for (let k = 1; k <= 3; k++) fb.shade(p.x - p.dashDir[0] * k * 5 + 2, p.y + 2, 8, 5, 0xb9a6ec, 0.35 / k);
  }
  if (p.pulse > 0) {
    const r = PULSE.radius * (0.6 + 0.4 * Math.sin(t * 9));
    const cx = p.x + 6;
    const cy = p.y + 4;
    for (let a = 0; a < 48; a++) {
      const ang = (a / 48) * Math.PI * 2 + t;
      if (a % 2 === 0) fb.px(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.8, C.pulse);
    }
  }
  fb.sprite(SHIP[Math.floor(t * 12) % 2], p.x, p.y);
}

export interface Spark {
  x: number;
  y: number;
  age: number;
  label: string;
}

export function drawSparks(fb: Framebuffer, sparks: readonly Spark[]): void {
  for (const s of sparks) {
    const r = 2 + s.age * 18;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      fb.px(s.x + 3 + Math.cos(a) * r, s.y + 3 + Math.sin(a) * r, s.age < 0.2 ? 0xffffff : C.gold);
    }
    // Keep the score pop-up on screen when a star is caught at the edge.
    const half = textWidth(s.label) / 2;
    const cx = Math.min(Math.max(s.x + 3, half + 1), fb.width - half - 1);
    text(fb, s.label, cx, s.y - 6 - s.age * 16, C.gold, { align: 'center' });
  }
}

const pad5 = (n: number): string => String(Math.min(99999, n)).padStart(5, '0');

export function drawHud(fb: Framebuffer, run: Run, best: number): void {
  fb.rect(0, 0, fb.width, FIELD.top - 1, C.hud);
  fb.rect(0, FIELD.top - 1, fb.width, 1, C.hudEdge);
  text(fb, pad5(run.score), 3, 2, C.ink);
  const m = multiplier(run.streak);
  if (m > 1) text(fb, `X${m}`, 36, 2, C.gold);
  text(fb, `HI${pad5(Math.max(best, run.score))}`, 54, 2, C.dim);
  for (let i = 0; i < MAX_LIVES; i++) fb.sprite(i < run.lives ? HEART : HEART_OFF, fb.width - 21 + i * 7, 3);
  // Pulse charge meter along the bottom edge.
  const charge = 1 - run.player.pulseCd / PULSE.cooldown;
  fb.rect(2, fb.height - 3, 40, 2, 0x2a3168);
  fb.rect(2, fb.height - 3, Math.round(40 * charge), 2, charge >= 1 ? C.pulse : 0x5a7fb8);
  const dash = 1 - run.player.dashCd / DASH.cooldown;
  fb.rect(fb.width - 22, fb.height - 3, 20, 2, 0x2a3168);
  fb.rect(fb.width - 22, fb.height - 3, Math.round(20 * dash), 2, 0xb9a6ec);
}

export function drawTitle(fb: Framebuffer, t: number, best: number): void {
  drawBackdrop(fb, t);
  text(fb, 'STARFALL', fb.width / 2, 30, C.gold, { align: 'center', scale: 2, shadow: 0x3a2d6a });
  text(fb, 'CATCH STARS, MISS ROCKS', fb.width / 2, 54, C.dim, { align: 'center' });
  fb.sprite(SHIP[Math.floor(t * 12) % 2], 74, 82 + Math.round(Math.sin(t * 2) * 2));
  fb.sprite(STAR[Math.floor(t * 4) % 2], 46, 70 + ((t * 20) % 30));
  fb.sprite(BIG, 108, 62 + ((t * 14) % 30));
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: LAUNCH', fb.width / 2, 106, C.ink, { align: 'center' });
  text(fb, `BEST ${pad5(best)}`, fb.width / 2, 122, C.dim, { align: 'center' });
}

export function drawOver(fb: Framebuffer, run: Run, best: number, isNew: boolean, t: number): void {
  fb.shade(0, 0, fb.width, fb.height, 0x070a1c, 0.55);
  const w = 120;
  const x = (fb.width - w) / 2;
  fb.panel(x, 40, w, 62, THEME.panel, THEME.edge);
  text(fb, 'GAME OVER', fb.width / 2, 47, C.ink, { align: 'center' });
  text(fb, `SCORE ${pad5(run.score)}`, fb.width / 2, 61, C.gold, { align: 'center' });
  text(fb, isNew ? 'NEW BEST!' : `BEST  ${pad5(best)}`, fb.width / 2, 72, isNew ? C.heart : C.dim, { align: 'center' });
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: AGAIN', fb.width / 2, 88, C.ink, { align: 'center' });
}

export const HELP_LINES = ['D-PAD  FLY', 'A      DASH (SAFE)', 'B      STAR PULSE', 'START  PAUSE', '', 'CATCH 5 IN A ROW', 'FOR X2, X3, X4.', 'ROCKS COST A HEART.'];
