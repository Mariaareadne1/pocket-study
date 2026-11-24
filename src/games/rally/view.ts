/** RALLY pixel art (160×144): a lavender felt table seen from above. */
import { type Framebuffer, sprite } from '@/runtime/framebuffer';
import { text } from '@/runtime/font';
import type { Theme } from '../common/menu';
import { BALL, type Ball, type Difficulty, type Match, PADDLE, type Side, TABLE, WIN_SCORE } from './logic';

export const C = {
  room: 0x2b2742,
  roomEdge: 0x3a3458,
  felt0: 0xa496d8,
  felt1: 0x9285cb,
  felt2: 0x8577bf,
  fleck: 0xb3a7e2,
  line: 0xf1ecff,
  rim: 0x5d5191,
  net: 0xe6e0fb,
  netShadow: 0x7b6eb5,
  you: 0xf3a989,
  youHi: 0xffd9c4,
  youLo: 0xc97a62,
  cpu: 0x86cfc4,
  cpuHi: 0xc9f0ea,
  cpuLo: 0x55a196,
  ball: 0xfffdf6,
  ballEdge: 0xd9d1f2,
  shadow: 0x6d61a6,
  ink: 0xf6f3ff,
  dim: 0xa39cc9,
  gold: 0xffe08a,
  digitShadow: 0x17142a,
} as const;

export const THEME: Theme = { panel: 0x332d52, edge: 0x9c8fd0, ink: C.ink, dim: C.dim, accent: 0xc4b8f0, scrim: 0x15122a };

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'EASY', normal: 'NORMAL', hard: 'HARD' };

const BALL_SPRITE = sprite(['bwb', 'www', 'bwb'], { b: C.ballEdge, w: C.ball });
const BALL_CORE = sprite(['www', 'www', 'www'], { w: C.ball });

const hash = (i: number): number => {
  let x = Math.imul(i ^ 0x2c1b3c6d, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

/** Felt, a fine painted border, the dashed net and the score band. */
export function drawTable(fb: Framebuffer): void {
  fb.clear(C.room);
  fb.rect(0, 15, fb.width, 1, C.roomEdge);
  const { left, right, top, bottom } = TABLE;
  fb.gradient(top, bottom + 1, [C.felt0, C.felt1, C.felt2], 5);
  fb.rect(0, top, left, bottom - top + 1, C.room);
  fb.rect(right + 1, top, fb.width - right - 1, bottom - top + 1, C.room);
  fb.frame(left - 1, top - 1, right - left + 3, bottom - top + 3, C.rim);
  fb.rect(left, bottom + 2, right - left + 2, 1, C.roomEdge);
  for (let i = 0; i < 70; i++) fb.px(left + 2 + hash(i) * (right - left - 4), top + 2 + hash(i + 300) * (bottom - top - 4), C.fleck);
  fb.frame(left + 1, top + 1, right - left - 1, bottom - top - 1, C.line);
  fb.rect(left + 2, (top + bottom) / 2, right - left - 3, 1, C.felt0);
  const mid = (left + right) / 2;
  for (let y = top + 2; y < bottom - 1; y += 6) {
    fb.rect(mid + 1, y + 1, 1, 3, C.netShadow);
    fb.rect(mid, y, 1, 3, C.net);
  }
}

export function drawPaddle(fb: Framebuffer, side: Side, y: number): void {
  const x = side === 'you' ? PADDLE.youX : PADDLE.cpuX;
  const [body, hi, lo] = side === 'you' ? [C.you, C.youHi, C.youLo] : [C.cpu, C.cpuHi, C.cpuLo];
  const { w, h } = PADDLE;
  fb.shade(x + 1, y + 2, w, h, C.shadow, 0.45);
  fb.panel(x, y, w, h, body);
  fb.rect(x + 1, y + 2, 1, h - 5, hi);
  fb.px(x + 1, y + 1, hi);
  fb.rect(x + w - 1, y + 3, 1, h - 5, lo);
  fb.rect(x + 1, y + h - 1, w - 2, 1, lo);
}

/** Ball with a soft shadow and a short fading motion trail. */
export function drawBall(fb: Framebuffer, ball: Ball, trail: readonly (readonly [number, number])[]): void {
  trail.forEach(([tx, ty], i) => {
    const a = 0.5 - i * 0.14;
    fb.shade(Math.round(tx - BALL.r), Math.round(ty - BALL.r), 3, 3, C.ball, a);
  });
  const x = Math.round(ball.x - BALL.r);
  const y = Math.round(ball.y - BALL.r);
  fb.shade(x + 1, y + 2, 3, 2, C.shadow, 0.5);
  fb.sprite(Math.hypot(ball.vx, ball.vy) > 120 ? BALL_CORE : BALL_SPRITE, x, y);
}

/** Big blocky digits on the score band; the latest scorer's digit glows briefly. */
export function drawScore(fb: Framebuffer, score: readonly [number, number], glow: Side | null): void {
  text(fb, String(score[0]), 52, 1, glow === 'you' ? C.gold : C.youHi, { align: 'center', scale: 2, shadow: C.digitShadow });
  text(fb, String(score[1]), 108, 1, glow === 'cpu' ? C.gold : C.cpuHi, { align: 'center', scale: 2, shadow: C.digitShadow });
  for (let i = 0; i < WIN_SCORE; i++) fb.px(62 + i * 6, 7, C.dim);
  text(fb, 'YOU', 6, 4, C.dim);
  text(fb, 'CPU', fb.width - 6, 4, C.dim, { align: 'right' });
}

export function drawMatch(fb: Framebuffer, m: Match, t: number, glow: Side | null): void {
  drawTable(fb);
  drawScore(fb, m.score, glow);
  drawPaddle(fb, 'you', m.you.y);
  drawPaddle(fb, 'cpu', m.cpu.y);
  drawBall(fb, m.ball, m.trail);
  if (m.held && m.serving === 'you' && !m.over && Math.floor(t * 1.6) % 2 === 0) {
    text(fb, 'A: SERVE', 42, TABLE.bottom - 10, C.ink, { align: 'center', shadow: C.rim });
  }
}

export function drawTitle(fb: Framebuffer, t: number, difficulty: Difficulty, wins: number, losses: number): void {
  drawTable(fb);
  const bob = Math.round(Math.sin(t * 2) * 3);
  drawPaddle(fb, 'you', 64 + bob);
  drawPaddle(fb, 'cpu', 70 - bob);
  const bx = 80 + Math.sin(t * 1.3) * 52;
  drawBall(fb, { x: bx, y: 58 + Math.abs(Math.sin(t * 2.6)) * 60, vx: 0, vy: 0 }, []);
  fb.panel(30, 26, 100, 30, THEME.panel, THEME.edge);
  text(fb, 'RALLY', fb.width / 2, 31, C.gold, { align: 'center', scale: 2, shadow: 0x4a3f7a });
  text(fb, 'A TABLE DUEL', fb.width / 2, 47, C.dim, { align: 'center' });
  fb.panel(34, 92, 92, 16, THEME.panel, THEME.edge);
  const pulse = Math.floor(t * 3) % 2;
  text(fb, '<', 40 - pulse, 97, C.dim);
  text(fb, DIFFICULTY_LABEL[difficulty], fb.width / 2, 97, C.ink, { align: 'center' });
  text(fb, '>', 115 + pulse, 97, C.dim);
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: PLAY', fb.width / 2, 114, C.ink, { align: 'center', shadow: C.rim });
  text(fb, `WINS ${wins}  LOSSES ${losses}`, fb.width / 2, 2, C.dim, { align: 'center' });
}

export function drawOver(fb: Framebuffer, m: Match, wins: number, losses: number, t: number): void {
  fb.shade(0, 0, fb.width, fb.height, THEME.scrim, 0.5);
  const w = 124;
  const x = (fb.width - w) / 2;
  const won = m.winner === 'you';
  fb.panel(x, 38, w, 66, THEME.panel, THEME.edge);
  text(fb, won ? 'YOU WIN' : 'CONSOLE WINS', fb.width / 2, 45, won ? C.gold : C.cpuHi, { align: 'center' });
  text(fb, `${m.score[0]} - ${m.score[1]}`, fb.width / 2, 57, C.ink, { align: 'center', scale: 2 });
  text(fb, `W ${wins}  L ${losses}  ${DIFFICULTY_LABEL[m.difficulty]}`, fb.width / 2, 76, C.dim, { align: 'center' });
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, 'START: PLAY AGAIN', fb.width / 2, 90, C.ink, { align: 'center' });
}

/** Fixed mid-rally scene for the printed cartridge label. */
export function drawLabelArt(fb: Framebuffer): void {
  drawTable(fb);
  drawScore(fb, [5, 4], null);
  drawPaddle(fb, 'you', 74);
  drawPaddle(fb, 'cpu', 40);
  const trail: [number, number][] = [
    [96, 66],
    [91, 70],
    [86, 74],
  ];
  drawBall(fb, { x: 101, y: 62, vx: 90, vy: -70 }, trail);
}

export const HELP_LINES = [
  'D-PAD  MOVE PADDLE',
  'A      SERVE',
  'START  PAUSE',
  '',
  'HIT WITH THE EDGE',
  'FOR A STEEP ANGLE.',
  'MOVE AS YOU HIT TO',
  'ADD SPIN. FIRST TO 7.',
];
