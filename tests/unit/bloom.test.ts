import { describe, expect, it } from 'vitest';
import { BloomGame } from '@/games/bloom';
import {
  COLS,
  DRY_RATE,
  GOAL,
  ROWS,
  STAGE_TIME,
  Stage,
  act,
  blooms,
  indexOf,
  moveCursor,
  newGarden,
  step,
  validateGarden,
  type Garden,
} from '@/games/bloom/logic';
import { memoryStore } from '@/runtime/storage';
import { Driver, host } from './helpers';

const advance = (g: Garden, seconds: number): Garden => {
  let s = g;
  for (let i = 0; i < Math.round(seconds * 60); i++) s = step(s, 1 / 60).garden;
  return s;
};
const plotAt = (g: Garden) => g.plots[indexOf(g.cx, g.cy)];

describe('bloom rules', () => {
  it('planting changes garden state', () => {
    const g = newGarden();
    const r = act(g);
    expect(r.result).toBe('planted');
    expect(plotAt(r.garden)).toMatchObject({ stage: Stage.Seed, seed: 'daisy' });
    expect(plotAt(g).stage).toBe(Stage.Empty); // immutable
  });

  it('cannot plant twice in the same plot', () => {
    const g = act(newGarden()).garden;
    expect(act(g).result).toBe('deny');
  });

  it('a dry seed never grows; watering makes it grow', () => {
    let g = act(newGarden()).garden;
    g = advance(g, 30);
    expect(plotAt(g).stage).toBe(Stage.Seed);
    g = act({ ...g, tool: 'water' }).garden;
    expect(plotAt(g).moisture).toBe(1);
    g = advance(g, STAGE_TIME[1] + 0.1);
    expect(plotAt(g).stage).toBe(Stage.Sprout);
  });

  it('moisture dries at the documented rate and growth stops when dry', () => {
    let g = act(newGarden()).garden;
    g = act({ ...g, tool: 'water' }).garden;
    g = advance(g, 1 / DRY_RATE + 0.5);
    const p = plotAt(g);
    expect(p.moisture).toBe(0);
    // Total watered time is 14 s: seed(5) + sprout(6) = 11, then 3 s into bud.
    expect(p.stage).toBe(Stage.Bud);
    expect(p.growth).toBeCloseTo(1 / DRY_RATE - STAGE_TIME[1] - STAGE_TIME[2], 1);
    const later = advance(g, 20);
    expect(plotAt(later).growth).toBeCloseTo(p.growth, 5);
  });

  it('a watered plant reaches bloom after the sum of its stage times', () => {
    let g = act(newGarden()).garden;
    const water = (x: Garden): Garden => act({ ...x, tool: 'water' }).garden;
    g = water(g);
    g = advance(g, 10);
    g = water(g);
    g = advance(g, 7.5);
    expect(plotAt(g).stage).toBe(Stage.Bloom);
  });

  it('never indexes outside the grid', () => {
    let g = newGarden();
    g = moveCursor(g, -50, -50);
    expect([g.cx, g.cy]).toEqual([0, 0]);
    g = moveCursor(g, 99, 99);
    expect([g.cx, g.cy]).toEqual([COLS - 1, ROWS - 1]);
    expect(act(g).result).toBe('planted');
  });

  it('the completion event fires once when the garden reaches the goal', () => {
    let g = newGarden();
    const plots = g.plots.map((p, i) => (i < GOAL - 1 ? { stage: Stage.Bloom, seed: 'bell' as const, growth: 0, moisture: 0 } : p));
    plots[GOAL - 1] = { stage: Stage.Bud, seed: 'sun', growth: STAGE_TIME[3] - 0.01, moisture: 1 };
    g = { ...g, plots };
    const r = step(g, 1 / 60);
    expect(r.events.map((e) => e.type)).toEqual(['grew', 'bloomed', 'complete']);
    expect(blooms(r.garden)).toBe(GOAL);
    expect(step(r.garden, 1 / 60).events).toEqual([]);
  });

  it('rejects corrupt saves', () => {
    expect(validateGarden(null)).toBeNull();
    expect(validateGarden({ plots: [] })).toBeNull();
    const good = newGarden();
    expect(validateGarden(JSON.parse(JSON.stringify(good)))).toEqual(good);
    const bad = JSON.parse(JSON.stringify(good));
    bad.plots[3] = { stage: 2, seed: null, growth: 0, moisture: 0 };
    expect(validateGarden(bad)).toBeNull();
  });
});

describe('bloom cartridge', () => {
  it('plays through the real pad: plant, water, grow, save and reload', () => {
    const store = memoryStore();
    const d = new Driver(new BloomGame(host(store)));
    d.tap('start');
    expect(d.game.phase).toBe('playing');
    d.tap('right');
    d.tap('a'); // plant at (5,2)
    d.tap('b'); // → water
    d.tap('a');
    d.seconds(6);
    const g1 = (d.game as BloomGame).state;
    expect(g1.plots[indexOf(5, 2)].stage).toBe(Stage.Sprout);
    d.game.save();
    const reloaded = new BloomGame(host(store));
    expect(reloaded.state.plots[indexOf(5, 2)]).toEqual(g1.plots[indexOf(5, 2)]);
  });

  it('pause genuinely stops growth', () => {
    const d = new Driver(new BloomGame(host()));
    d.tap('start');
    d.tap('a');
    d.tap('b');
    d.tap('a');
    d.tap('start'); // open menu
    expect(d.game.phase).toBe('paused');
    const before = (d.game as BloomGame).state.time;
    d.seconds(10);
    expect((d.game as BloomGame).state.time).toBe(before);
  });

  it('New Garden asks for confirmation and resets', () => {
    const d = new Driver(new BloomGame(host()));
    d.tap('start');
    d.tap('a');
    d.tap('start');
    d.tap('down');
    d.tap('down');
    d.tap('a'); // NEW GARDEN → confirm (defaults to NO)
    d.tap('a');
    expect(blooms((d.game as BloomGame).state) + (d.game as BloomGame).state.plots.filter((p) => p.stage).length).toBe(1);
    expect(d.game.inspect().mode).toBe('menu'); // cancel returns to the menu, still on NEW GARDEN
    d.tap('a');
    d.tap('right'); // toggle to YES
    d.tap('a');
    expect((d.game as BloomGame).state.plots.every((p) => p.stage === Stage.Empty)).toBe(true);
  });

  it('a corrupted save does not crash the cartridge', () => {
    const store = memoryStore({ bloom: '{"v":1,"data":{"plots":"nope"}}' });
    const g = new BloomGame(host(store));
    expect(g.state.plots.every((p) => p.stage === Stage.Empty)).toBe(true);
    const d = new Driver(g);
    expect(d.draw().palette()).toBeGreaterThan(4);
  });

  it('draws a real garden into the framebuffer', () => {
    const d = new Driver(new BloomGame(host(memoryStore(), true)));
    d.tap('start');
    const fb = d.draw();
    expect(fb.palette()).toBeGreaterThan(12);
    expect(fb.countNot(0)).toBe(fb.width * fb.height);
  });
});
