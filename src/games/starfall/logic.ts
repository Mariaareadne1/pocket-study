/**
 * STARFALL rules — a pure, seeded simulation. `step(state, input, dt)` returns a new state and
 * the events that happened; the RNG state lives inside the game state, so a run is exactly
 * reproducible from its seed and input sequence (tests, demo films).
 *
 * Hitboxes are axis-aligned and deliberately forgiving for stars, tight for debris.
 */
import { Rng } from '@/runtime/rng';

export const FIELD = { w: 160, h: 144, top: 12 } as const;
export const PLAYER = { w: 12, h: 8, speed: 74, minY: 88, maxY: 132 } as const;
export const DASH = { time: 0.16, speed: 236, cooldown: 0.55 } as const;
export const PULSE = { time: 1.6, cooldown: 7, radius: 58, pull: 260 } as const;
export const INVULNERABLE = 1.4;
export const LEVEL_EVERY = 14;
export const MAX_LIVES = 3;

export type ObjKind = 'star' | 'big' | 'rock';
export const SIZE: Record<ObjKind, number> = { star: 7, big: 9, rock: 8 };

export interface Obj {
  readonly id: number;
  readonly kind: ObjKind;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly spin: number;
}

export interface Player {
  readonly x: number;
  readonly y: number;
  readonly facing: -1 | 1;
  readonly dash: number;
  readonly dashCd: number;
  readonly dashDir: readonly [number, number];
  readonly pulse: number;
  readonly pulseCd: number;
  readonly inv: number;
}

export interface Run {
  readonly over: boolean;
  readonly t: number;
  readonly score: number;
  readonly lives: number;
  readonly streak: number;
  readonly level: number;
  readonly player: Player;
  readonly objs: readonly Obj[];
  readonly spawnIn: number;
  readonly nextId: number;
  readonly rng: number;
  readonly shake: number;
  readonly caught: number;
}

export interface StepInput {
  x: number;
  y: number;
  dash: boolean;
  pulse: boolean;
}

export type RunEvent =
  | { type: 'star'; kind: 'star' | 'big'; points: number; x: number; y: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'dash' }
  | { type: 'pulse' }
  | { type: 'level'; level: number }
  | { type: 'over'; score: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Player hitbox: the hull without its wing tips. */
export const playerBox = (p: Player): Box => ({ x: p.x + 2, y: p.y + 2, w: PLAYER.w - 4, h: PLAYER.h - 3 });

export function objBox(o: Obj): Box {
  const s = SIZE[o.kind];
  return o.kind === 'rock' ? { x: o.x + 1, y: o.y + 1, w: s - 2, h: s - 2 } : { x: o.x - 1, y: o.y - 1, w: s + 2, h: s + 2 };
}

export function newRun(seed: number): Run {
  return {
    over: false,
    t: 0,
    score: 0,
    lives: MAX_LIVES,
    streak: 0,
    level: 1,
    player: { x: (FIELD.w - PLAYER.w) / 2, y: 120, facing: 1, dash: 0, dashCd: 0, dashDir: [1, 0], pulse: 0, pulseCd: 0, inv: 0 },
    objs: [],
    spawnIn: 0.8,
    nextId: 1,
    rng: new Rng(seed).snapshot,
    shake: 0,
    caught: 0,
  };
}

export const multiplier = (streak: number): number => Math.min(4, 1 + Math.floor(streak / 5));
export const spawnInterval = (level: number): number => Math.max(0.3, 0.92 - (level - 1) * 0.07);
export const fallSpeed = (level: number): number => 30 + (level - 1) * 5;
export const rockChance = (level: number): number => Math.min(0.5, 0.22 + (level - 1) * 0.035);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function movePlayer(p: Player, input: StepInput, dt: number, events: RunEvent[]): Player {
  const ix = Math.sign(input.x);
  const iy = Math.sign(input.y);
  const facing: -1 | 1 = ix < 0 ? -1 : ix > 0 ? 1 : p.facing;
  let { dash, dashCd, dashDir, pulse, pulseCd } = p;
  const { inv } = p;
  if (input.dash && dashCd <= 0 && dash <= 0) {
    dash = DASH.time;
    dashCd = DASH.cooldown;
    dashDir = ix || iy ? [ix, iy] : [facing, 0];
    events.push({ type: 'dash' });
  }
  if (input.pulse && pulseCd <= 0) {
    pulse = PULSE.time;
    pulseCd = PULSE.cooldown;
    events.push({ type: 'pulse' });
  }
  let vx = ix * PLAYER.speed;
  let vy = iy * PLAYER.speed * 0.8;
  if (dash > 0) {
    const len = Math.hypot(dashDir[0], dashDir[1]) || 1;
    vx = (dashDir[0] / len) * DASH.speed;
    vy = (dashDir[1] / len) * DASH.speed * 0.6;
  }
  return {
    x: clamp(p.x + vx * dt, 2, FIELD.w - PLAYER.w - 2),
    y: clamp(p.y + vy * dt, PLAYER.minY, PLAYER.maxY),
    facing,
    dash: Math.max(0, dash - dt),
    dashCd: Math.max(0, dashCd - dt),
    dashDir,
    pulse: Math.max(0, pulse - dt),
    pulseCd: Math.max(0, pulseCd - dt),
    inv: Math.max(0, inv - dt),
  };
}

export function step(run: Run, input: StepInput, dt: number): { run: Run; events: RunEvent[] } {
  if (run.over) return { run, events: [] };
  const events: RunEvent[] = [];
  const rng = new Rng(0);
  rng.restore(run.rng);
  const t = run.t + dt;
  const level = 1 + Math.floor(t / LEVEL_EVERY);
  if (level > run.level) events.push({ type: 'level', level });

  let player = movePlayer(run.player, input, dt, events);
  const invulnerable = player.inv > 0 || player.dash > 0;

  // Spawning.
  let spawnIn = run.spawnIn - dt;
  let nextId = run.nextId;
  const spawned: Obj[] = [];
  while (spawnIn <= 0) {
    const r = rng.next();
    const kind: ObjKind = r < rockChance(level) ? 'rock' : r > 0.95 ? 'big' : 'star';
    const s = SIZE[kind];
    spawned.push({
      id: nextId++,
      kind,
      x: rng.range(2, FIELD.w - s - 2),
      y: FIELD.top - s,
      vx: kind === 'rock' ? rng.range(-6, 6) : 0,
      vy: fallSpeed(level) * (kind === 'rock' ? rng.range(1.0, 1.35) : rng.range(0.75, 1.1)),
      spin: rng.range(0, 4),
    });
    spawnIn += spawnInterval(level) * rng.range(0.7, 1.3);
  }

  // Motion, pulse attraction, collisions.
  const pc = { x: player.x + PLAYER.w / 2, y: player.y + PLAYER.h / 2 };
  const pb = playerBox(player);
  let { score, lives, streak, shake, caught } = run;
  const objs: Obj[] = [];
  for (const o0 of [...run.objs, ...spawned]) {
    let { vx, vy } = o0;
    if (player.pulse > 0 && o0.kind !== 'rock') {
      const dx = pc.x - o0.x;
      const dy = pc.y - o0.y;
      const d = Math.hypot(dx, dy);
      if (d < PULSE.radius && d > 0.001) {
        vx += (dx / d) * PULSE.pull * dt;
        vy += (dy / d) * PULSE.pull * dt;
      }
    }
    const o: Obj = { ...o0, vx, vy, x: o0.x + vx * dt, y: o0.y + vy * dt, spin: o0.spin + dt * 6 };
    if (o.y > FIELD.h + 2 || o.x < -12 || o.x > FIELD.w + 12) {
      if (o.kind !== 'rock') streak = 0;
      continue;
    }
    if (overlaps(pb, objBox(o))) {
      if (o.kind === 'rock') {
        if (invulnerable) {
          objs.push(o);
          continue;
        }
        lives -= 1;
        streak = 0;
        shake = 0.3;
        player = { ...player, inv: INVULNERABLE };
        events.push({ type: 'hit', x: o.x, y: o.y });
        continue;
      }
      const points = (o.kind === 'big' ? 50 : 10) * multiplier(streak);
      streak += 1;
      score += points;
      caught += 1;
      events.push({ type: 'star', kind: o.kind, points, x: o.x, y: o.y });
      continue;
    }
    objs.push(o);
  }
  const over = lives <= 0;
  if (over) events.push({ type: 'over', score });
  return {
    run: {
      over,
      t,
      score,
      lives: Math.max(0, lives),
      streak,
      level,
      player,
      objs,
      spawnIn,
      nextId,
      rng: rng.snapshot,
      shake: Math.max(0, shake - dt),
      caught,
    },
    events,
  };
}

// ── high score persistence ──

export const SAVE_KEY = 'starfall';
export const SAVE_VERSION = 1;

export interface Record_ {
  best: number;
  runs: number;
}

export const validateRecord = (d: unknown): Record_ | null => {
  if (typeof d !== 'object' || d === null) return null;
  const r = d as Record<string, unknown>;
  if (typeof r.best !== 'number' || !Number.isFinite(r.best) || r.best < 0) return null;
  return { best: Math.floor(r.best), runs: typeof r.runs === 'number' && r.runs >= 0 ? Math.floor(r.runs) : 0 };
};
