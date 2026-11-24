/**
 * RALLY rules — a calm table duel in the paddle-duel genre, played against the console.
 *
 * `step(match, input, dt)` is pure: it returns a new match plus the events that happened. The RNG
 * state lives inside the match, so a whole match is reproducible from its seed and inputs. The
 * ball moves in sub-steps of at most one pixel, so it can never tunnel through a paddle.
 */
import { Rng } from '@/runtime/rng';

export const TABLE = { left: 4, right: 156, top: 18, bottom: 140 } as const;
export const PADDLE = { w: 4, h: 20, speed: 95, youX: 10, cpuX: 146 } as const;
export const BALL = { r: 1.5, serve: 70, speedUp: 7, max: 150 } as const;
/** Return angle at the very edge of a paddle (radians, ≈ 55°). */
export const EDGE_ANGLE = (55 * Math.PI) / 180;
/** Extra angle from the paddle's own motion at full speed. */
export const SPIN = 0.14;
export const MAX_ANGLE = EDGE_ANGLE + SPIN;
export const SERVE_SPREAD = 0.35;
export const CPU_SERVE_DELAY = 0.8;
export const WIN_SCORE = 7;
const SUBSTEP = 1;
const MAX_SUBSTEPS = 4000;
const DEAD_ZONE = 0.75;
const IDLE_PACE = 0.45;

export type Side = 'you' | 'cpu';
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export interface CpuLevel {
  /** Max paddle speed, px/s. */
  readonly speed: number;
  /** Seconds before the CPU starts tracking a ball coming its way. */
  readonly reaction: number;
  /** Max aim error at the contact point, px (± uniformly). */
  readonly error: number;
}

export const CPU_LEVELS: Record<Difficulty, CpuLevel> = {
  easy: { speed: 52, reaction: 0.32, error: 13 },
  normal: { speed: 60, reaction: 0.25, error: 11 },
  hard: { speed: 74, reaction: 0.17, error: 9 },
};

export interface Paddle {
  readonly y: number;
  readonly vy: number;
}

export interface Ball {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export interface Ai {
  readonly react: number;
  readonly offset: number;
}

export interface Match {
  readonly over: boolean;
  readonly winner: Side | null;
  readonly t: number;
  readonly difficulty: Difficulty;
  readonly score: readonly [number, number];
  readonly serving: Side;
  readonly held: boolean;
  readonly serveTimer: number;
  readonly hits: number;
  readonly you: Paddle;
  readonly cpu: Paddle;
  readonly ai: Ai;
  readonly ball: Ball;
  /** Recent ball centres, newest first (motion trail). */
  readonly trail: readonly (readonly [number, number])[];
  readonly rng: number;
}

export interface StepInput {
  y: number;
  serve: boolean;
}

export type RallyEvent =
  | { type: 'serve'; side: Side }
  | { type: 'bounce' }
  | { type: 'paddle'; side: Side; hits: number }
  | { type: 'point'; side: Side; score: readonly [number, number] }
  | { type: 'over'; winner: Side };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const PADDLE_MIN = TABLE.top;
export const PADDLE_MAX = TABLE.bottom - PADDLE.h;
const CENTER = (TABLE.top + TABLE.bottom - PADDLE.h) / 2;
const BALL_LO = TABLE.top + BALL.r;
const BALL_HI = TABLE.bottom - BALL.r;
const TRAIL = 3;

/** Where a held ball sits: just in front of the serving paddle, level with its centre. */
export function heldBall(side: Side, paddleY: number): Ball {
  const y = paddleY + PADDLE.h / 2;
  return side === 'you' ? { x: PADDLE.youX + PADDLE.w + BALL.r + 1, y, vx: 0, vy: 0 } : { x: PADDLE.cpuX - BALL.r - 1, y, vx: 0, vy: 0 };
}

export function newMatch(seed: number, difficulty: Difficulty): Match {
  const paddle: Paddle = { y: CENTER, vy: 0 };
  return {
    over: false,
    winner: null,
    t: 0,
    difficulty,
    score: [0, 0],
    serving: 'you',
    held: true,
    serveTimer: 0,
    hits: 0,
    you: paddle,
    cpu: paddle,
    ai: { react: 0, offset: 0 },
    ball: heldBall('you', CENTER),
    trail: [],
    rng: new Rng(seed).snapshot,
  };
}

export const ballSpeed = (hits: number): number => Math.min(BALL.max, BALL.serve + hits * BALL.speedUp);

/** Return angle off a paddle: edge ≈ 55°, plus spin from the paddle's motion. */
export function returnAngle(ballY: number, paddleY: number, paddleVy: number): number {
  const rel = clamp((ballY - (paddleY + PADDLE.h / 2)) / (PADDLE.h / 2 + BALL.r), -1, 1);
  const spin = clamp(paddleVy / PADDLE.speed, -1, 1) * SPIN;
  return clamp(rel * EDGE_ANGLE + spin, -MAX_ANGLE, MAX_ANGLE);
}

/** Ball centre y when it reaches `atX`, folding top/bottom bounces. */
export function predictY(ball: Ball, atX: number): number {
  if (ball.vx === 0) return ball.y;
  const t = (atX - ball.x) / ball.vx;
  if (t <= 0) return ball.y;
  const span = BALL_HI - BALL_LO;
  const raw = (((ball.y + ball.vy * t - BALL_LO) % (2 * span)) + 2 * span) % (2 * span);
  return BALL_LO + (raw > span ? 2 * span - raw : raw);
}

function movePlayer(p: Paddle, input: StepInput, dt: number): Paddle {
  const y = clamp(p.y + Math.sign(input.y) * PADDLE.speed * dt, PADDLE_MIN, PADDLE_MAX);
  return { y, vy: dt > 0 ? (y - p.y) / dt : 0 };
}

function cpuTarget(m: Match): { target: number; pace: number } | null {
  const incoming = !m.held && m.ball.vx > 0;
  if (!incoming) return { target: CENTER, pace: IDLE_PACE };
  if (m.ai.react > 0) return null;
  return { target: predictY(m.ball, PADDLE.cpuX - BALL.r) + m.ai.offset - PADDLE.h / 2, pace: 1 };
}

function moveCpu(m: Match, dt: number): { cpu: Paddle; ai: Ai } {
  const incoming = !m.held && m.ball.vx > 0;
  const ai = incoming ? { ...m.ai, react: Math.max(0, m.ai.react - dt) } : m.ai;
  const goal = cpuTarget(m);
  if (!goal) return { cpu: { y: m.cpu.y, vy: 0 }, ai };
  const target = clamp(goal.target, PADDLE_MIN, PADDLE_MAX);
  const d = target - m.cpu.y;
  const maxMove = CPU_LEVELS[m.difficulty].speed * goal.pace * dt;
  const move = Math.abs(d) <= DEAD_ZONE ? 0 : clamp(d, -maxMove, maxMove);
  const y = clamp(m.cpu.y + move, PADDLE_MIN, PADDLE_MAX);
  return { cpu: { y, vy: dt > 0 ? (y - m.cpu.y) / dt : 0 }, ai };
}

const touches = (x: number, y: number, px: number, py: number): boolean =>
  x + BALL.r > px && x - BALL.r < px + PADDLE.w && y + BALL.r > py && y - BALL.r < py + PADDLE.h;

function launch(dir: 1 | -1, angle: number, hits: number, x: number, y: number): Ball {
  const s = ballSpeed(hits);
  return { x, y, vx: dir * s * Math.cos(angle), vy: s * Math.sin(angle) };
}

interface Flight {
  ball: Ball;
  hits: number;
  scored: Side | null;
}

/** Sub-stepped flight: wall bounces, paddle returns and misses, in time order. */
function fly(m: Match, you: Paddle, cpu: Paddle, dt: number, events: RallyEvent[]): Flight {
  let { x, y, vx, vy } = m.ball;
  let hits = m.hits;
  const n = clamp(Math.ceil((Math.hypot(vx, vy) * dt) / SUBSTEP), 1, MAX_SUBSTEPS);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    x += vx * h;
    y += vy * h;
    if (y < BALL_LO || y > BALL_HI) {
      y = y < BALL_LO ? 2 * BALL_LO - y : 2 * BALL_HI - y;
      vy = -vy;
      events.push({ type: 'bounce' });
    }
    const side: Side | null =
      vx < 0 && x >= PADDLE.youX + PADDLE.w / 2 && touches(x, y, PADDLE.youX, you.y)
        ? 'you'
        : vx > 0 && x <= PADDLE.cpuX + PADDLE.w / 2 && touches(x, y, PADDLE.cpuX, cpu.y)
          ? 'cpu'
          : null;
    if (side) {
      const p = side === 'you' ? you : cpu;
      hits += 1;
      const fx = side === 'you' ? PADDLE.youX + PADDLE.w + BALL.r : PADDLE.cpuX - BALL.r;
      ({ x, y, vx, vy } = launch(side === 'you' ? 1 : -1, returnAngle(y, p.y, p.vy), hits, fx, y));
      events.push({ type: 'paddle', side, hits });
    }
    if (x < TABLE.left - BALL.r) return { ball: { x, y, vx, vy }, hits, scored: 'cpu' };
    if (x > TABLE.right + BALL.r) return { ball: { x, y, vx, vy }, hits, scored: 'you' };
  }
  return { ball: { x, y, vx, vy }, hits, scored: null };
}

function serveBall(m: Match, you: Paddle, cpu: Paddle, rng: Rng): Ball {
  const p = m.serving === 'you' ? you : cpu;
  const spin = clamp(p.vy / PADDLE.speed, -1, 1) * SPIN;
  const angle = rng.range(-SERVE_SPREAD, SERVE_SPREAD) + spin;
  const b = heldBall(m.serving, p.y);
  return launch(m.serving === 'you' ? 1 : -1, angle, 0, b.x, b.y);
}

function scorePoint(m: Match, scorer: Side, you: Paddle, cpu: Paddle, events: RallyEvent[]): Match {
  const score: readonly [number, number] = scorer === 'you' ? [m.score[0] + 1, m.score[1]] : [m.score[0], m.score[1] + 1];
  events.push({ type: 'point', side: scorer, score });
  const over = Math.max(score[0], score[1]) >= WIN_SCORE;
  if (over) events.push({ type: 'over', winner: scorer });
  const serving: Side = scorer === 'you' ? 'cpu' : 'you';
  return {
    ...m,
    over,
    winner: over ? scorer : null,
    score,
    serving,
    held: true,
    serveTimer: 0,
    hits: 0,
    you,
    cpu,
    ai: { react: 0, offset: 0 },
    ball: heldBall(serving, serving === 'you' ? you.y : cpu.y),
    trail: [],
  };
}

export function step(match: Match, input: StepInput, dt: number): { match: Match; events: RallyEvent[] } {
  if (match.over) return { match, events: [] };
  const events: RallyEvent[] = [];
  const rng = new Rng(0);
  rng.restore(match.rng);
  const you = movePlayer(match.you, input, dt);
  const { cpu, ai } = moveCpu(match, dt);
  const t = match.t + dt;
  const base: Match = { ...match, t, you, cpu, ai };

  if (match.held) {
    const serveTimer = match.serveTimer + dt;
    const serves = match.serving === 'you' ? input.serve : serveTimer >= CPU_SERVE_DELAY;
    if (!serves) {
      const ball = heldBall(match.serving, match.serving === 'you' ? you.y : cpu.y);
      return { match: { ...base, serveTimer, ball, rng: rng.snapshot }, events };
    }
    events.push({ type: 'serve', side: match.serving });
    const ball = serveBall(match, you, cpu, rng);
    return { match: withIncoming({ ...base, held: false, serveTimer: 0, ball, trail: [] }, match, rng), events };
  }

  const flight = fly(match, you, cpu, dt, events);
  if (flight.scored) return { match: { ...scorePoint(base, flight.scored, you, cpu, events), rng: rng.snapshot }, events };
  const trail = [[match.ball.x, match.ball.y] as const, ...match.trail].slice(0, TRAIL);
  return { match: withIncoming({ ...base, ball: flight.ball, hits: flight.hits, trail }, match, rng), events };
}

/** When the ball turns towards the console, it starts its reaction delay and picks an aim error. */
function withIncoming(next: Match, prev: Match, rng: Rng): Match {
  const wasIncoming = !prev.held && prev.ball.vx > 0;
  const isIncoming = !next.held && next.ball.vx > 0;
  if (!isIncoming || wasIncoming) return { ...next, rng: rng.snapshot };
  const lv = CPU_LEVELS[next.difficulty];
  const ai: Ai = { react: lv.reaction, offset: rng.range(-lv.error, lv.error) };
  return { ...next, ai, rng: rng.snapshot };
}

// ── record persistence ──

export const SAVE_KEY = 'rally';
export const SAVE_VERSION = 1;

export interface Record_ {
  wins: number;
  losses: number;
  difficulty: Difficulty;
}

export const DEFAULT_RECORD: Record_ = { wins: 0, losses: 0, difficulty: 'normal' };

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1e7;
const isDifficulty = (x: unknown): x is Difficulty => typeof x === 'string' && (DIFFICULTIES as readonly string[]).includes(x);

export const validateRecord = (d: unknown): Record_ | null => {
  if (typeof d !== 'object' || d === null || Array.isArray(d)) return null;
  const r = d as Record<string, unknown>;
  if (!isCount(r.wins) || !isCount(r.losses)) return null;
  return { wins: r.wins, losses: r.losses, difficulty: isDifficulty(r.difficulty) ? r.difficulty : 'normal' };
};
