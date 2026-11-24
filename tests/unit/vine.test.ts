import { describe, expect, it } from 'vitest';
import { VineGame } from '@/games/vine';
import {
  BLOSSOM,
  type Cell,
  type Dir,
  GRID,
  type Run,
  SAVE_KEY,
  START_LENGTH,
  type StepInput,
  TICK,
  newRun,
  onCells,
  step,
  validateRecord,
} from '@/games/vine/logic';
import { drawLabelArt } from '@/games/vine/view';
import { Framebuffer } from '@/runtime/framebuffer';
import { memoryStore } from '@/runtime/storage';
import { Driver, host } from './helpers';

const idle: StepInput = { turns: [], hurry: false };
const turn = (...turns: Dir[]): StepInput => ({ turns, hurry: false });
/** Advances exactly one tick. */
const tick = (r: Run, input: StepInput = idle): ReturnType<typeof step> => step(r, input, r.tickIn);
const head = (r: Run): Cell => r.body[0];

const deepFreeze = <T>(o: T): T => {
  if (typeof o === 'object' && o !== null) {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe('vine simulation', () => {
  it('moves exactly one cell per tick and not before the tick is due', () => {
    // Arrange
    const r = newRun(1);
    const [x0, y0] = head(r);
    // Act
    const early = step(r, idle, TICK.start / 2).run;
    const onTick = step(early, idle, TICK.start / 2).run;
    // Assert
    expect(head(early)).toEqual([x0, y0]);
    expect(head(onTick)).toEqual([x0 + 1, y0]);
    expect(onTick.body.length).toBe(START_LENGTH);
  });

  it('ignores a 180 degree reversal', () => {
    const r = newRun(1);
    const [x0, y0] = head(r);
    const next = tick(r, turn('left')).run;
    expect(next.dir).toBe('right');
    expect(head(next)).toEqual([x0 + 1, y0]);
  });

  it('keeps two quick turns made between ticks and applies them on consecutive ticks', () => {
    // Arrange: heading right, tap up then left within one tick window.
    const r = newRun(1);
    const [x0, y0] = head(r);
    const a = step(r, turn('up'), 1 / 60).run;
    const b = step(a, turn('left'), 1 / 60).run;
    // Act
    const t1 = tick(b).run;
    const t2 = tick(t1).run;
    // Assert
    expect(b.queue).toEqual(['up', 'left']);
    expect(head(t1)).toEqual([x0, y0 - 1]);
    expect(head(t2)).toEqual([x0 - 1, y0 - 1]);
    expect(t2.dir).toBe('left');
  });

  it('eating a dewdrop grows the vine by one, scores 10 and speeds it up', () => {
    const r0 = newRun(3);
    const [x, y] = head(r0);
    const r = { ...r0, food: [x + 1, y] as Cell };
    const { run, events } = tick(r);
    expect(run.score).toBe(10);
    expect(run.body.length).toBe(START_LENGTH + 1);
    expect(run.interval).toBeCloseTo(TICK.start - TICK.step, 6);
    expect(events).toContainEqual({ type: 'eat', points: 10, x: x + 1, y });
    expect(onCells(run.food!, run.body)).toBe(false);
  });

  it('every fifth dewdrop spawns a blossom worth 50 that grows two and wilts after six seconds', () => {
    const r0 = newRun(4);
    const [x, y] = head(r0);
    const fifth = tick({ ...r0, eaten: BLOSSOM.every - 1, food: [x + 1, y] }).run;
    expect(fifth.blossom).not.toBeNull();
    const wilted = step({ ...fifth, tickIn: 999 }, idle, BLOSSOM.ttl + 0.01).run;
    expect(wilted.blossom).toBeNull();
    const [hx, hy] = head(fifth);
    const ate = tick({ ...fifth, food: null, grow: 0, blossom: { cell: [hx + 1, hy], ttl: 3 } });
    expect(ate.run.score).toBe(fifth.score + BLOSSOM.points);
    expect(ate.events.map((e) => e.type)).toContain('bonus');
    expect(tick(ate.run).run.body.length).toBe(fifth.body.length + 2);
  });

  it('ends the run when the vine hits a wall', () => {
    const r = { ...newRun(1), body: [[GRID.cols - 1, 4], [GRID.cols - 2, 4], [GRID.cols - 3, 4]] as Cell[] };
    const { run, events } = tick(r);
    expect(run.over).toBe(true);
    expect(run.crash).toEqual([GRID.cols, 4]);
    expect(events.map((e) => e.type)).toEqual(['crash', 'over']);
    expect(step(run, idle, 1).run).toBe(run);
  });

  it('ends the run when the vine runs into itself, but may follow its own moving tail', () => {
    // Heading up into a coil: [5,4] is part of the body.
    const coil: Cell[] = [[5, 5], [5, 6], [4, 6], [4, 5], [4, 4], [5, 4], [6, 4]];
    expect(tick({ ...newRun(1), dir: 'up', body: coil }).run.over).toBe(true);
    // A closed loop where the head moves into the cell the tail is leaving.
    const loop: Cell[] = [[5, 5], [5, 6], [4, 6], [4, 5]];
    const chase = tick({ ...newRun(1), dir: 'left', body: loop, food: null }).run;
    expect(chase.over).toBe(false);
    expect(head(chase)).toEqual([4, 5]);
  });

  it('never spawns food on the vine, even on a nearly full board', () => {
    for (let seed = 1; seed <= 25; seed++) {
      // Arrange: the vine fills rows 1..15; only row 0 is free.
      const rest: Cell[] = [];
      for (let y = 1; y < GRID.rows; y++) for (let x = 0; x < GRID.cols; x++) rest.push([x, y]);
      const r: Run = { ...newRun(seed), dir: 'right', body: [[0, 0], ...rest], food: [1, 0] };
      // Act
      const { run } = tick(r);
      // Assert
      expect(run.food).not.toBeNull();
      expect(onCells(run.food!, run.body)).toBe(false);
      expect(run.food![1]).toBe(0);
    }
  });

  it('never places food on the vine during long random play', () => {
    for (let seed = 1; seed <= 10; seed++) {
      let r = newRun(seed);
      for (let i = 0; i < 2000 && !r.over; i++) {
        r = step(r, { turns: i % 7 === 0 ? [(['up', 'left', 'down', 'right'] as const)[(i / 7) % 4]] : [], hurry: false }, 1 / 60).run;
        if (r.food) expect(onCells(r.food, r.body)).toBe(false);
      }
    }
  });

  it('holding hurry ticks about twice as fast', () => {
    const r = newRun(1);
    const slow = step(r, idle, TICK.start * 0.6).run;
    const fast = step(r, { turns: [], hurry: true }, TICK.start * 0.6).run;
    expect(slow.ticks).toBe(0);
    expect(fast.ticks).toBe(1);
  });

  it('same seed and same input give an identical run', () => {
    const script = (i: number): StepInput => turn(...((['up', 'right', 'down', 'right'] as const).filter((_, k) => i === 20 + k * 30)));
    let a = newRun(99);
    let b = newRun(99);
    for (let i = 0; i < 600; i++) {
      a = step(a, script(i), 1 / 60).run;
      b = step(b, script(i), 1 / 60).run;
    }
    expect(a).toEqual(b);
    expect(a.ticks).toBeGreaterThan(0);
  });

  it('never mutates the input run', () => {
    const r0 = newRun(5);
    const [x, y] = head(r0);
    const r = deepFreeze({ ...r0, food: [x + 1, y] as Cell, eaten: BLOSSOM.every - 1 });
    const before = JSON.stringify(r);
    const out = step(r, { turns: ['up', 'left'], hurry: true }, 0.5);
    expect(JSON.stringify(r)).toBe(before);
    expect(out.run).not.toBe(r);
  });

  it('validates saved records and rejects corrupt shapes', () => {
    expect(validateRecord({ best: 120, runs: 4 })).toEqual({ best: 120, runs: 4 });
    expect(validateRecord({ best: 50 })).toEqual({ best: 50, runs: 0 });
    expect(validateRecord({ best: -1, runs: 1 })).toBeNull();
    expect(validateRecord({ best: 'lots' })).toBeNull();
    expect(validateRecord(null)).toBeNull();
  });
});

describe('vine cartridge', () => {
  it('title moves to play on Start', () => {
    const g = new VineGame(host());
    const d = new Driver(g);
    expect(g.phase).toBe('title');
    d.tap('start');
    expect(g.phase).toBe('playing');
    expect(g.inspect().mode).toBe('play');
  });

  it('pause menu freezes the simulation until resumed', () => {
    const g = new VineGame(host());
    const d = new Driver(g);
    d.tap('start');
    d.tap('start');
    expect(g.phase).toBe('paused');
    const frozen = g.state;
    d.seconds(3);
    expect(g.state).toBe(frozen);
    d.tap('a'); // RESUME
    d.seconds(0.5);
    expect(g.phase).toBe('playing');
    expect(g.state.ticks).toBeGreaterThan(frozen.ticks);
  });

  it('saves best and runs, reloads them, and recovers from a corrupt save', () => {
    // Arrange
    const store = memoryStore();
    store.set(SAVE_KEY, JSON.stringify({ v: 1, at: 0, data: { best: 120, runs: 4 } }));
    const g = new VineGame(host(store));
    const d = new Driver(g);
    expect(g.inspect().best).toBe(120);
    // Act: start and steer into a wall.
    d.tap('start');
    for (let i = 0; i < 60 * 10 && g.phase !== 'over'; i++) d.step();
    // Assert
    expect(g.phase).toBe('over');
    const again = new VineGame(host(store));
    expect(again.inspect()).toMatchObject({ best: 120, runs: 5 });
    for (const raw of ['not json', JSON.stringify({ v: 1, data: { best: 'x' } }), JSON.stringify({ v: 9, data: { best: 1 } })]) {
      const fresh = new VineGame(host(memoryStore({ [SAVE_KEY]: raw })));
      expect(fresh.inspect()).toMatchObject({ best: 0, runs: 0 });
    }
  });

  it('draws a non-blank title, game screen and label art', () => {
    const g = new VineGame(host());
    const d = new Driver(g);
    expect(d.draw().palette()).toBeGreaterThan(8);
    d.tap('start');
    expect(d.draw().palette()).toBeGreaterThan(8);
    const label = new Framebuffer();
    drawLabelArt(label);
    expect(label.palette()).toBeGreaterThan(12);
  });
});
