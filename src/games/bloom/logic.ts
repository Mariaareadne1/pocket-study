/**
 * BLOOM rules — pure functions over an immutable garden state.
 *
 * A plot holds a plant that advances seed → sprout → bud → bloom. Growth only accumulates while
 * the plot's soil is damp; moisture drains at a fixed rate, so every plant needs watering about
 * twice on its way to flowering. All timing is game time (fixed steps), never wall-clock time,
 * so a saved garden resumes exactly as it was left.
 */
import { isInt, isNum, isObj, isStr, type Validate } from '@/runtime/storage';

export const COLS = 9;
export const ROWS = 6;
export const GOAL = 8;

export const SEEDS = ['daisy', 'tulip', 'bell', 'sun'] as const;
export type Seed = (typeof SEEDS)[number];
export const TOOLS = ['seed', 'water', 'trowel'] as const;
export type Tool = (typeof TOOLS)[number];

export const Stage = { Empty: 0, Seed: 1, Sprout: 2, Bud: 3, Bloom: 4 } as const;
export type Stage = (typeof Stage)[keyof typeof Stage];

/** Watered seconds needed to leave each stage (index = stage). */
export const STAGE_TIME: readonly number[] = [0, 5, 6, 6];
/** Moisture lost per second (fully watered soil dries in 14 s). */
export const DRY_RATE = 1 / 14;

export interface Plot {
  readonly stage: Stage;
  readonly seed: Seed | null;
  readonly growth: number;
  readonly moisture: number;
}

export interface Garden {
  readonly plots: readonly Plot[];
  readonly cx: number;
  readonly cy: number;
  readonly tool: Tool;
  readonly seed: Seed;
  readonly time: number;
  readonly celebrated: boolean;
}

export type GardenEvent =
  | { type: 'grew'; index: number; stage: Stage }
  | { type: 'bloomed'; index: number }
  | { type: 'complete' };

export type ActResult = 'planted' | 'watered' | 'dug' | 'deny';

export const EMPTY_PLOT: Plot = { stage: Stage.Empty, seed: null, growth: 0, moisture: 0 };

export function newGarden(): Garden {
  return {
    plots: Array.from({ length: COLS * ROWS }, () => EMPTY_PLOT),
    cx: 4,
    cy: 2,
    tool: 'seed',
    seed: 'daisy',
    time: 0,
    celebrated: false,
  };
}

export const indexOf = (x: number, y: number): number => y * COLS + x;
export const inBounds = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < COLS && y < ROWS;

export function blooms(g: Garden): number {
  return g.plots.filter((p) => p.stage === Stage.Bloom).length;
}

export function moveCursor(g: Garden, dx: number, dy: number): Garden {
  const cx = Math.min(COLS - 1, Math.max(0, g.cx + dx));
  const cy = Math.min(ROWS - 1, Math.max(0, g.cy + dy));
  return cx === g.cx && cy === g.cy ? g : { ...g, cx, cy };
}

export function nextTool(g: Garden): Garden {
  return { ...g, tool: TOOLS[(TOOLS.indexOf(g.tool) + 1) % TOOLS.length] };
}

export function nextSeed(g: Garden): Garden {
  return { ...g, seed: SEEDS[(SEEDS.indexOf(g.seed) + 1) % SEEDS.length] };
}

const replacePlot = (g: Garden, i: number, p: Plot): Garden => ({ ...g, plots: g.plots.map((q, k) => (k === i ? p : q)) });

/** Applies the selected tool at the cursor. */
export function act(g: Garden): { garden: Garden; result: ActResult } {
  if (!inBounds(g.cx, g.cy)) return { garden: g, result: 'deny' };
  const i = indexOf(g.cx, g.cy);
  const p = g.plots[i];
  switch (g.tool) {
    case 'seed':
      if (p.stage !== Stage.Empty) return { garden: g, result: 'deny' };
      return { garden: replacePlot(g, i, { stage: Stage.Seed, seed: g.seed, growth: 0, moisture: p.moisture }), result: 'planted' };
    case 'water':
      return { garden: replacePlot(g, i, { ...p, moisture: 1 }), result: 'watered' };
    case 'trowel':
      if (p.stage === Stage.Empty) return { garden: g, result: 'deny' };
      return { garden: replacePlot(g, i, { ...EMPTY_PLOT, moisture: p.moisture }), result: 'dug' };
  }
}

/** Advances growth and drying by dt seconds. */
export function step(g: Garden, dt: number): { garden: Garden; events: GardenEvent[] } {
  const events: GardenEvent[] = [];
  const plots = g.plots.map((p, index) => {
    const moisture = Math.max(0, p.moisture - DRY_RATE * dt);
    if (p.stage === Stage.Empty || p.stage === Stage.Bloom) return moisture === p.moisture ? p : { ...p, moisture };
    // Growth only counts the part of dt during which the soil was still damp.
    const damp = p.moisture > 0 ? Math.min(dt, p.moisture / DRY_RATE) : 0;
    let growth = p.growth + damp;
    let stage: Stage = p.stage;
    if (growth >= STAGE_TIME[stage]) {
      growth -= STAGE_TIME[stage];
      stage = (stage + 1) as Stage;
      events.push({ type: 'grew', index, stage });
      if (stage === Stage.Bloom) {
        events.push({ type: 'bloomed', index });
        growth = 0;
      }
    }
    return { ...p, moisture, growth, stage };
  });
  let celebrated = g.celebrated;
  const next: Garden = { ...g, plots, time: g.time + dt };
  if (!celebrated && blooms(next) >= GOAL) {
    celebrated = true;
    events.push({ type: 'complete' });
  }
  return { garden: celebrated === g.celebrated ? next : { ...next, celebrated }, events };
}

/** Stage progress 0..1 of a plot towards its next stage. */
export function progress(p: Plot): number {
  if (p.stage === Stage.Empty || p.stage === Stage.Bloom) return p.stage === Stage.Bloom ? 1 : 0;
  return Math.min(1, p.growth / STAGE_TIME[p.stage]);
}

// ── persistence ──

export const SAVE_KEY = 'bloom';
export const SAVE_VERSION = 1;

const validPlot = (x: unknown): Plot | null => {
  if (!isObj(x) || !isInt(x.stage, 0, 4) || !isNum(x.growth) || !isNum(x.moisture)) return null;
  const seed = x.seed === null ? null : isStr(x.seed) && (SEEDS as readonly string[]).includes(x.seed) ? (x.seed as Seed) : undefined;
  if (seed === undefined) return null;
  if ((x.stage === 0) !== (seed === null)) return null;
  return { stage: x.stage as Stage, seed, growth: Math.max(0, x.growth), moisture: Math.min(1, Math.max(0, x.moisture)) };
};

export const validateGarden: Validate<Garden> = (d) => {
  if (!isObj(d) || !Array.isArray(d.plots) || d.plots.length !== COLS * ROWS) return null;
  const plots = d.plots.map(validPlot);
  if (plots.some((p) => p === null)) return null;
  if (!isInt(d.cx, 0, COLS - 1) || !isInt(d.cy, 0, ROWS - 1) || !isNum(d.time)) return null;
  const tool = (TOOLS as readonly unknown[]).includes(d.tool) ? (d.tool as Tool) : 'seed';
  const seed = (SEEDS as readonly unknown[]).includes(d.seed) ? (d.seed as Seed) : 'daisy';
  return { plots: plots as Plot[], cx: d.cx, cy: d.cy, tool, seed, time: d.time, celebrated: d.celebrated === true };
};

/** Demo preset: a garden part-way grown, two dry buds waiting for water next to the cursor. */
export function demoGarden(): Garden {
  const g = newGarden();
  const at = (x: number, y: number, p: Partial<Plot>): [number, Plot] => [indexOf(x, y), { ...EMPTY_PLOT, ...p }];
  const set = new Map<number, Plot>([
    at(1, 1, { stage: Stage.Bloom, seed: 'tulip', moisture: 0.5 }),
    at(2, 3, { stage: Stage.Bloom, seed: 'daisy', moisture: 0.3 }),
    at(6, 1, { stage: Stage.Bloom, seed: 'bell', moisture: 0.6 }),
    at(7, 4, { stage: Stage.Bloom, seed: 'sun', moisture: 0.2 }),
    at(1, 4, { stage: Stage.Bloom, seed: 'bell', moisture: 0.4 }),
    at(4, 2, { stage: Stage.Bud, seed: 'tulip', growth: 5.5, moisture: 0 }),
    at(5, 2, { stage: Stage.Bud, seed: 'sun', growth: 5.2, moisture: 0 }),
    at(3, 4, { stage: Stage.Sprout, seed: 'daisy', growth: 3, moisture: 0.7 }),
    at(6, 3, { stage: Stage.Seed, seed: 'bell', growth: 1, moisture: 0.9 }),
  ]);
  return { ...g, plots: g.plots.map((p, i) => set.get(i) ?? p), cx: 3, cy: 2, tool: 'water' };
}
