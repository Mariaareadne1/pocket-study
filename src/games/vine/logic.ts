/**
 * VINE rules — a snake-genre simulation on a 20×16 grid of 8×8 cells. `step(run, input, dt)`
 * returns a new run and the events that happened; the RNG state lives inside the run, so a run is
 * exactly reproducible from its seed and input sequence (tests, demo films). Inputs are never
 * mutated.
 *
 * The vine moves one cell per tick. Turns are queued (up to two) so quick taps between ticks are
 * kept; a turn back onto the vine's own neck is ignored.
 */
import { Rng } from '@/runtime/rng';
import { isInt, isObj } from '@/runtime/storage';

export const GRID = { cols: 20, rows: 16, cell: 8, x: 0, y: 14 } as const;
export const TICK = { start: 0.16, min: 0.075, step: 0.005 } as const;
export const HURRY = 2;
export const MAX_QUEUE = 2;
export const DEW_POINTS = 10;
export const BLOSSOM = { every: 5, ttl: 6, points: 50, grow: 2 } as const;
export const LEVEL_EVERY = 10;
export const START_LENGTH = 3;

export type Dir = 'up' | 'down' | 'left' | 'right';
export type Cell = readonly [number, number];

export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
export const VEC: Readonly<Record<Dir, Cell>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const OPPOSITE: Readonly<Record<Dir, Dir>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export interface Blossom {
  readonly cell: Cell;
  readonly ttl: number;
}

export interface Run {
  readonly over: boolean;
  readonly t: number;
  readonly score: number;
  /** Head first. */
  readonly body: readonly Cell[];
  readonly dir: Dir;
  readonly queue: readonly Dir[];
  /** Cells still to grow (the tail stays put while > 0). */
  readonly grow: number;
  readonly food: Cell | null;
  readonly blossom: Blossom | null;
  readonly eaten: number;
  readonly interval: number;
  /** Seconds until the next tick (hurry drains it twice as fast). */
  readonly tickIn: number;
  readonly ticks: number;
  /** Where the vine bumped into something, for the crash flash. */
  readonly crash: Cell | null;
  readonly rng: number;
}

export interface StepInput {
  /** Directions pressed this frame, in order. */
  readonly turns: readonly Dir[];
  readonly hurry: boolean;
}

export type RunEvent =
  | { type: 'eat'; points: number; x: number; y: number }
  | { type: 'bonus'; points: number; x: number; y: number }
  | { type: 'blossom'; x: number; y: number }
  | { type: 'level'; eaten: number }
  | { type: 'crash'; x: number; y: number }
  | { type: 'over'; score: number };

export const sameCell = (a: Cell, b: Cell): boolean => a[0] === b[0] && a[1] === b[1];
export const inGrid = (c: Cell): boolean => c[0] >= 0 && c[1] >= 0 && c[0] < GRID.cols && c[1] < GRID.rows;
export const onCells = (c: Cell, cells: readonly Cell[]): boolean => cells.some((b) => sameCell(b, c));
export const nextInterval = (interval: number): number => Math.max(TICK.min, Math.round((interval - TICK.step) * 1e6) / 1e6);

/** Every grid cell not covered by `blocked`, in row-major order. */
export function freeCells(blocked: readonly Cell[]): Cell[] {
  const taken = new Set(blocked.map(([x, y]) => y * GRID.cols + x));
  const out: Cell[] = [];
  for (let y = 0; y < GRID.rows; y++) for (let x = 0; x < GRID.cols; x++) if (!taken.has(y * GRID.cols + x)) out.push([x, y]);
  return out;
}

const spawn = (rng: Rng, blocked: readonly Cell[]): Cell | null => {
  const free = freeCells(blocked);
  return free.length > 0 ? free[rng.int(0, free.length - 1)] : null;
};

export function newRun(seed: number): Run {
  const rng = new Rng(seed);
  const hy = Math.floor(GRID.rows / 2);
  const body: Cell[] = Array.from({ length: START_LENGTH }, (_, i): Cell => [7 - i, hy]);
  const food = spawn(rng, body);
  return {
    over: false,
    t: 0,
    score: 0,
    body,
    dir: 'right',
    queue: [],
    grow: 0,
    food,
    blossom: null,
    eaten: 0,
    interval: TICK.start,
    tickIn: TICK.start,
    ticks: 0,
    crash: null,
    rng: rng.snapshot,
  };
}

/** Appends accepted turns: no repeats of the last heading, no reversals, at most MAX_QUEUE. */
export function queueTurns(dir: Dir, queue: readonly Dir[], turns: readonly Dir[]): readonly Dir[] {
  let out = queue;
  for (const d of turns) {
    const last = out.at(-1) ?? dir;
    if (out.length >= MAX_QUEUE || d === last || d === OPPOSITE[last]) continue;
    out = [...out, d];
  }
  return out;
}

const ageBlossom = (b: Blossom | null, dt: number): Blossom | null => (b && b.ttl - dt > 0 ? { ...b, ttl: b.ttl - dt } : null);

/** The tail cell moves away this tick unless the vine is still growing. */
const hitsSelf = (head: Cell, body: readonly Cell[], grow: number): boolean =>
  onCells(head, grow > 0 ? body : body.slice(0, -1));

function eatDew(run: Run, body: readonly Cell[], rng: Rng, events: RunEvent[]): Run {
  const [x, y] = body[0];
  const eaten = run.eaten + 1;
  events.push({ type: 'eat', points: DEW_POINTS, x, y });
  if (eaten % LEVEL_EVERY === 0) events.push({ type: 'level', eaten });
  const food = spawn(rng, run.blossom ? [...body, run.blossom.cell] : body);
  let blossom = run.blossom;
  if (eaten % BLOSSOM.every === 0) {
    const cell = spawn(rng, food ? [...body, food] : body);
    blossom = cell ? { cell, ttl: BLOSSOM.ttl } : null;
    if (cell) events.push({ type: 'blossom', x: cell[0], y: cell[1] });
  }
  return { ...run, eaten, food, blossom, score: run.score + DEW_POINTS, interval: nextInterval(run.interval) };
}

function eatBlossom(run: Run, events: RunEvent[]): Run {
  const [x, y] = run.body[0];
  events.push({ type: 'bonus', points: BLOSSOM.points, x, y });
  return { ...run, blossom: null, score: run.score + BLOSSOM.points };
}

/** One grid move. */
function advance(run: Run, rng: Rng, events: RunEvent[]): Run {
  const dir = run.queue[0] ?? run.dir;
  const queue = run.queue.slice(1);
  const [dx, dy] = VEC[dir];
  const head: Cell = [run.body[0][0] + dx, run.body[0][1] + dy];
  const ticks = run.ticks + 1;
  if (!inGrid(head) || hitsSelf(head, run.body, run.grow)) {
    events.push({ type: 'crash', x: head[0], y: head[1] }, { type: 'over', score: run.score });
    return { ...run, dir, queue, ticks, over: true, crash: head };
  }
  const ateDew = run.food !== null && sameCell(head, run.food);
  const ateBlossom = run.blossom !== null && sameCell(head, run.blossom.cell);
  const pending = run.grow + (ateDew ? 1 : 0) + (ateBlossom ? BLOSSOM.grow : 0);
  const body = pending > 0 ? [head, ...run.body] : [head, ...run.body.slice(0, -1)];
  const moved: Run = { ...run, dir, queue, ticks, body, grow: Math.max(0, pending - 1) };
  const afterBlossom = ateBlossom ? eatBlossom(moved, events) : moved;
  return ateDew ? eatDew(afterBlossom, body, rng, events) : afterBlossom;
}

export function step(run: Run, input: StepInput, dt: number): { run: Run; events: RunEvent[] } {
  if (run.over) return { run, events: [] };
  const events: RunEvent[] = [];
  const rng = new Rng(0);
  rng.restore(run.rng);
  let next: Run = {
    ...run,
    t: run.t + dt,
    queue: queueTurns(run.dir, run.queue, input.turns),
    blossom: ageBlossom(run.blossom, dt),
    tickIn: run.tickIn - dt * (input.hurry ? HURRY : 1),
  };
  while (next.tickIn <= 1e-9 && !next.over) next = advance({ ...next, tickIn: next.tickIn + next.interval }, rng, events);
  return { run: { ...next, rng: rng.snapshot }, events };
}

// ── high score persistence ──

export const SAVE_KEY = 'vine';
export const SAVE_VERSION = 1;

export interface Record_ {
  best: number;
  runs: number;
}

const MAX_SAVED = 1e9;

export const validateRecord = (d: unknown): Record_ | null => {
  if (!isObj(d) || !isInt(d.best, 0, MAX_SAVED)) return null;
  return { best: d.best, runs: isInt(d.runs, 0, MAX_SAVED) ? d.runs : 0 };
};
