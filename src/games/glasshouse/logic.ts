/**
 * GLASSHOUSE rules — a brick-breaker genre game as a pure, seeded simulation. `step(run, input, dt)`
 * returns a new run plus the events that happened; the RNG state (a tiny launch-angle jitter) lives
 * inside the run, so a game is exactly reproducible from its seed and input sequence.
 *
 * The pebble is a 4×4 box around its centre. Every frame is split into sub-steps of at most one
 * pixel of travel, and each sub-step moves along x then y, so the pebble can never skip over a
 * pane or the plank however large `dt` is.
 */
import { Rng } from '@/runtime/rng';
import { type Pane, GRID, breakableCount, buildPanes, layoutFor, loopOf } from './layouts';

export { GRID, LAYOUTS, type Pane, buildPanes, breakableCount, layoutFor } from './layouts';

export const FIELD = { w: 160, h: 144, top: 12 } as const;
/** Inner faces of the greenhouse frame the pebble bounces off. */
export const WALL = { l: 3, r: 157, top: 15 } as const;
export const PADDLE = { w: 24, h: 4, y: 128, speed: 110, accel: 900, brake: 1400 } as const;
export const BALL = { r: 2, base: 80, perPane: 1.6, cap: 130, jitter: 0.16 } as const;
export const MAX_ANGLE = Math.PI / 3;
export const LOOP_BOOST = 1.15;
export const MAX_LIVES = 3;
export const BANNER_TIME = 1.5;
export const POINTS = { glass: 10, frost: 25, clear: 100 } as const;
const MAX_SUBSTEP = 1;
const MAX_SUBSTEPS = 4000;

export interface Ball {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly stuck: boolean;
}

export interface Paddle {
  readonly x: number;
  readonly vx: number;
}

export interface Run {
  readonly over: boolean;
  readonly t: number;
  readonly score: number;
  readonly lives: number;
  readonly level: number;
  readonly panes: readonly Pane[];
  readonly paddle: Paddle;
  readonly ball: Ball;
  /** Panes broken since the last serve; drives the gentle speed-up. */
  readonly rally: number;
  /** Seconds left on the level banner; the pebble cannot be launched meanwhile. */
  readonly banner: number;
  readonly broken: number;
  readonly rng: number;
}

export interface StepInput {
  x: number;
  launch: boolean;
}

export type RunEvent =
  | { type: 'launch' }
  | { type: 'bounce' }
  | { type: 'paddle'; x: number }
  | { type: 'pane'; x: number; y: number; points: number; kind: Pane['kind']; tint: number }
  | { type: 'crack'; x: number; y: number }
  | { type: 'miss' }
  | { type: 'clear'; level: number; bonus: number }
  | { type: 'over'; score: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const ballBox = (b: { x: number; y: number }): Box => ({ x: b.x - BALL.r, y: b.y - BALL.r, w: BALL.r * 2, h: BALL.r * 2 });
export const paneBox = (p: Pane): Box => ({ x: p.x, y: p.y, w: GRID.w, h: GRID.h });
export const paddleBox = (p: Paddle): Box => ({ x: p.x, y: PADDLE.y, w: PADDLE.w, h: PADDLE.h });

export const speedBoost = (level: number): number => LOOP_BOOST ** loopOf(level);
export const maxSpeed = (level: number): number => BALL.cap * speedBoost(level);
export const ballSpeed = (level: number, rally: number): number => Math.min(BALL.cap, BALL.base + rally * BALL.perPane) * speedBoost(level);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const restingBall = (p: Paddle): Ball => ({ x: p.x + PADDLE.w / 2, y: PADDLE.y - BALL.r, vx: 0, vy: 0, stuck: true });

export function newRun(seed: number): Run {
  const paddle: Paddle = { x: (FIELD.w - PADDLE.w) / 2, vx: 0 };
  return {
    over: false,
    t: 0,
    score: 0,
    lives: MAX_LIVES,
    level: 1,
    panes: buildPanes(layoutFor(1)),
    paddle,
    ball: restingBall(paddle),
    rally: 0,
    banner: BANNER_TIME,
    broken: 0,
    rng: new Rng(seed).snapshot,
  };
}

/** D-pad steering with a short ramp up and a quicker stop. */
export function movePaddle(p: Paddle, ix: number, dt: number): Paddle {
  const target = Math.sign(ix) * PADDLE.speed;
  const rate = target === 0 ? PADDLE.brake : PADDLE.accel;
  const dv = clamp(target - p.vx, -rate * dt, rate * dt);
  const vx = p.vx + dv;
  const x = clamp(p.x + vx * dt, WALL.l, WALL.r - PADDLE.w);
  const pinned = x === WALL.l || x === WALL.r - PADDLE.w;
  return { x, vx: pinned && Math.sign(vx) === Math.sign(x - FIELD.w / 2) ? 0 : vx };
}

/** Where on the plank the pebble lands sets its new heading: centre = straight up, ends = 60°. */
export function paddleBounce(ball: Ball, paddle: Paddle, speed: number): Ball {
  const rel = clamp((ball.x - (paddle.x + PADDLE.w / 2)) / (PADDLE.w / 2), -1, 1);
  const a = rel * MAX_ANGLE;
  return { ...ball, y: PADDLE.y - BALL.r, vx: speed * Math.sin(a), vy: -speed * Math.cos(a) };
}

interface Sim {
  readonly ball: Ball;
  readonly panes: readonly Pane[];
  readonly score: number;
  readonly rally: number;
  readonly broken: number;
}

function rescale(ball: Ball, speed: number): Ball {
  const s = Math.hypot(ball.vx, ball.vy) || 1;
  return { ...ball, vx: (ball.vx / s) * speed, vy: (ball.vy / s) * speed };
}

function hitPane(sim: Sim, pane: Pane, level: number, events: RunEvent[]): Sim {
  if (pane.kind === 'iron') {
    events.push({ type: 'bounce' });
    return sim;
  }
  if (pane.kind === 'frost' && !pane.cracked) {
    events.push({ type: 'crack', x: pane.x, y: pane.y });
    return { ...sim, panes: sim.panes.map((p) => (p.id === pane.id ? { ...p, cracked: true } : p)) };
  }
  const points = pane.kind === 'frost' ? POINTS.frost : POINTS.glass;
  const rally = sim.rally + 1;
  events.push({ type: 'pane', x: pane.x, y: pane.y, points, kind: pane.kind, tint: pane.tint });
  return {
    ball: rescale(sim.ball, ballSpeed(level, rally)),
    panes: sim.panes.filter((p) => p.id !== pane.id),
    score: sim.score + points,
    rally,
    broken: sim.broken + 1,
  };
}

const firstPane = (panes: readonly Pane[], ball: Ball): Pane | undefined => {
  const b = ballBox(ball);
  return panes.find((p) => overlaps(b, paneBox(p)));
};

function moveX(sim: Sim, h: number, level: number, events: RunEvent[]): Sim {
  const from = sim.ball;
  let ball: Ball = { ...from, x: from.x + from.vx * h };
  if (ball.x - BALL.r < WALL.l) ball = { ...ball, x: WALL.l + BALL.r, vx: Math.abs(ball.vx) };
  else if (ball.x + BALL.r > WALL.r) ball = { ...ball, x: WALL.r - BALL.r, vx: -Math.abs(ball.vx) };
  if (ball.vx !== from.vx) events.push({ type: 'bounce' });
  const pane = firstPane(sim.panes, ball);
  if (!pane) return { ...sim, ball };
  const away = from.x < pane.x + GRID.w / 2 ? -1 : 1;
  return hitPane({ ...sim, ball: { ...ball, x: from.x, vx: away * Math.abs(ball.vx) } }, pane, level, events);
}

function moveY(sim: Sim, h: number, level: number, paddle: Paddle, events: RunEvent[]): Sim {
  const from = sim.ball;
  let ball: Ball = { ...from, y: from.y + from.vy * h };
  if (ball.y - BALL.r < WALL.top) {
    ball = { ...ball, y: WALL.top + BALL.r, vy: Math.abs(ball.vy) };
    events.push({ type: 'bounce' });
  }
  const pane = firstPane(sim.panes, ball);
  if (pane) {
    const away = from.y < pane.y + GRID.h / 2 ? -1 : 1;
    return hitPane({ ...sim, ball: { ...ball, y: from.y, vy: away * Math.abs(ball.vy) } }, pane, level, events);
  }
  const onTop = from.y + BALL.r <= PADDLE.y + 1;
  if (ball.vy > 0 && onTop && overlaps(ballBox(ball), paddleBox(paddle))) {
    events.push({ type: 'paddle', x: ball.x - paddle.x });
    return { ...sim, ball: paddleBounce(ball, paddle, ballSpeed(level, sim.rally)) };
  }
  return { ...sim, ball };
}

function fly(sim: Sim, dt: number, level: number, paddle: Paddle, events: RunEvent[]): Sim {
  const fastest = Math.max(maxSpeed(level), Math.hypot(sim.ball.vx, sim.ball.vy));
  const n = clamp(Math.ceil((fastest * dt) / MAX_SUBSTEP), 1, MAX_SUBSTEPS);
  let s = sim;
  for (let i = 0; i < n && s.ball.y - BALL.r <= FIELD.h; i++) {
    s = moveY(moveX(s, dt / n, level, events), dt / n, level, paddle, events);
    if (breakableCount(s.panes) === 0) break;
  }
  return s;
}

/** A launches the resting pebble (not while the level banner is up), with a little seeded jitter. */
function serve(run: Run, rng: Rng, events: RunEvent[]): Ball {
  if (!run.ball.stuck || run.banner > 0) return run.ball;
  const a = rng.range(-BALL.jitter, BALL.jitter);
  const s = ballSpeed(run.level, 0);
  events.push({ type: 'launch' });
  return { ...restingBall(run.paddle), vx: s * Math.sin(a), vy: -s * Math.cos(a), stuck: false };
}

function nextLevel(run: Run, events: RunEvent[]): Run {
  const level = run.level + 1;
  events.push({ type: 'clear', level, bonus: POINTS.clear });
  return { ...run, level, score: run.score + POINTS.clear, panes: buildPanes(layoutFor(level)), ball: restingBall(run.paddle), rally: 0, banner: BANNER_TIME };
}

function loseLife(run: Run, events: RunEvent[]): Run {
  const lives = run.lives - 1;
  events.push({ type: 'miss' });
  if (lives > 0) return { ...run, lives, ball: restingBall(run.paddle), rally: 0 };
  events.push({ type: 'over', score: run.score });
  return { ...run, lives: 0, over: true };
}

export function step(run: Run, input: StepInput, dt: number): { run: Run; events: RunEvent[] } {
  if (run.over) return { run, events: [] };
  const events: RunEvent[] = [];
  const rng = new Rng(0);
  rng.restore(run.rng);
  const paddle = movePaddle(run.paddle, input.x, dt);
  const moved: Run = { ...run, t: run.t + dt, banner: Math.max(0, run.banner - dt), paddle };
  const launched = input.launch ? serve(moved, rng, events) : moved.ball;
  const base: Run = { ...moved, ball: launched.stuck ? restingBall(paddle) : launched, rng: rng.snapshot };
  if (base.ball.stuck) return { run: base, events };
  const sim = fly(base, dt, base.level, paddle, events);
  const after: Run = { ...base, ball: sim.ball, panes: sim.panes, score: sim.score, rally: sim.rally, broken: sim.broken };
  if (breakableCount(after.panes) === 0) return { run: nextLevel(after, events), events };
  if (after.ball.y - BALL.r > FIELD.h) return { run: loseLife(after, events), events };
  return { run: after, events };
}

// ── high score persistence ──

export const SAVE_KEY = 'glasshouse';
export const SAVE_VERSION = 1;

export interface Record_ {
  best: number;
  runs: number;
}

export const validateRecord = (d: unknown): Record_ | null => {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  const r = d as Record<string, unknown>;
  if (typeof r.best !== 'number' || !Number.isFinite(r.best) || r.best < 0) return null;
  const runs = typeof r.runs === 'number' && Number.isFinite(r.runs) && r.runs >= 0 ? Math.floor(r.runs) : 0;
  return { best: Math.floor(r.best), runs };
};
