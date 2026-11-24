import { describe, expect, it } from 'vitest';
import { GlasshouseGame } from '@/games/glasshouse';
import { buildPanes, LAYOUTS, GRID, type Pane } from '@/games/glasshouse/layouts';
import {
  BALL,
  FIELD,
  MAX_ANGLE,
  MAX_LIVES,
  PADDLE,
  POINTS,
  SAVE_KEY,
  WALL,
  type Ball,
  type Run,
  ballSpeed,
  maxSpeed,
  newRun,
  step,
  validateRecord,
} from '@/games/glasshouse/logic';
import { drawLabelArt } from '@/games/glasshouse/view';
import { Framebuffer } from '@/runtime/framebuffer';
import { memoryStore } from '@/runtime/storage';
import { Driver, host } from './helpers';

const DT = 1 / 60;
const idle = { x: 0, launch: false };
const pane = (o: Partial<Pane> = {}): Pane => ({ id: 1, x: 70, y: 40, kind: 'glass', tint: 0, cracked: false, ...o });
/** A run with the banner gone and the given pebble / panes (a far-away spare pane keeps the level alive). */
const setup = (ball: Partial<Ball>, panes: readonly Pane[] = [], spare = true): Run => {
  const r = newRun(1);
  const extra = spare ? [pane({ id: 99, x: 5, y: 24 })] : [];
  return { ...r, banner: 0, panes: [...panes, ...extra], ball: { x: 80, y: 90, vx: 0, vy: 0, stuck: false, ...ball } };
};
const run = (r: Run, frames: number, input = idle): Run => {
  let s = r;
  for (let i = 0; i < frames; i++) s = step(s, input, DT).run;
  return s;
};

describe('glasshouse simulation', () => {
  it('paddle moves at about its documented speed and stays inside the frame', () => {
    // Arrange
    const r0 = { ...newRun(1), banner: 0 };
    // Act
    const right = run(r0, 30, { x: 1, launch: false });
    const farRight = run(right, 300, { x: 1, launch: false });
    const farLeft = run(farRight, 400, { x: -1, launch: false });
    // Assert
    expect(right.paddle.x - r0.paddle.x).toBeGreaterThan(PADDLE.speed * 0.5 - 10);
    expect(right.paddle.x - r0.paddle.x).toBeLessThanOrEqual(PADDLE.speed * 0.5);
    expect(farRight.paddle.x).toBe(WALL.r - PADDLE.w);
    expect(farLeft.paddle.x).toBe(WALL.l);
  });

  it('pebble rides the paddle until A launches it, and not during the level banner', () => {
    // Arrange
    const r0 = newRun(3);
    // Act
    const carried = run(r0, 20, { x: 1, launch: false });
    const early = step(carried, { x: 0, launch: true }, DT).run;
    const ready = run(early, 90);
    const launched = step(ready, { x: 0, launch: true }, DT);
    // Assert
    expect(carried.ball.stuck).toBe(true);
    expect(carried.ball.x).toBeCloseTo(carried.paddle.x + PADDLE.w / 2, 5);
    expect(carried.ball.y).toBe(PADDLE.y - BALL.r);
    expect(early.ball.stuck).toBe(true);
    expect(launched.run.ball.stuck).toBe(false);
    expect(launched.run.ball.vy).toBeLessThan(0);
    expect(launched.events.map((e) => e.type)).toContain('launch');
  });

  it('side wall bounce reverses only the horizontal component', () => {
    // Arrange
    const r = setup({ x: WALL.r - BALL.r - 0.5, y: 100, vx: 60, vy: -50 });
    // Act
    const s = step(r, idle, DT);
    // Assert
    expect(s.run.ball.vx).toBe(-60);
    expect(s.run.ball.vy).toBe(-50);
    expect(s.events.map((e) => e.type)).toContain('bounce');
  });

  it('paddle centre hit sends the pebble straight up, an edge hit at about 60 degrees', () => {
    // Arrange
    const r0 = setup({}, []);
    const centre = r0.paddle.x + PADDLE.w / 2;
    const atCentre = setup({ x: centre, y: PADDLE.y - BALL.r - 0.5, vx: 0, vy: 80 });
    const atEdge = setup({ x: r0.paddle.x + PADDLE.w, y: PADDLE.y - BALL.r - 0.5, vx: 0, vy: 80 });
    // Act
    const c = step(atCentre, idle, DT);
    const e = step(atEdge, idle, DT);
    // Assert
    expect(c.events.map((ev) => ev.type)).toContain('paddle');
    expect(c.run.ball.vx).toBeCloseTo(0, 6);
    expect(c.run.ball.vy).toBeLessThan(0);
    expect(Math.atan2(e.run.ball.vx, -e.run.ball.vy)).toBeCloseTo(MAX_ANGLE, 3);
  });

  it('breaking a glass pane scores 10, removes it and speeds the pebble up a little', () => {
    // Arrange
    const target = pane({ id: 7, x: 70, y: 40 });
    const r = setup({ x: 77, y: 40 + GRID.h + BALL.r + 0.5, vx: 0, vy: -ballSpeed(1, 0) }, [target]);
    // Act
    const s = step(r, idle, DT);
    // Assert
    expect(s.run.score).toBe(POINTS.glass);
    expect(s.run.panes.find((p) => p.id === 7)).toBeUndefined();
    expect(s.run.ball.vy).toBeGreaterThan(0);
    expect(Math.hypot(s.run.ball.vx, s.run.ball.vy)).toBeCloseTo(ballSpeed(1, 1), 5);
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'pane', points: POINTS.glass }));
  });

  it('a frosted pane cracks on the first hit and breaks for 25 on the second', () => {
    // Arrange
    const frost = pane({ id: 8, kind: 'frost' });
    const below = { x: 77, y: 40 + GRID.h + BALL.r + 0.5, vx: 0, vy: -80 };
    // Act
    const first = step(setup(below, [frost]), idle, DT);
    const second = step({ ...first.run, ball: { ...first.run.ball, ...below } }, idle, DT);
    // Assert
    expect(first.run.panes.find((p) => p.id === 8)?.cracked).toBe(true);
    expect(first.run.score).toBe(0);
    expect(first.events.map((e) => e.type)).toContain('crack');
    expect(second.run.panes.find((p) => p.id === 8)).toBeUndefined();
    expect(second.run.score).toBe(POINTS.frost);
  });

  it('never tunnels through a pane or the paddle at max speed with a large dt', () => {
    // Arrange
    const thin = pane({ id: 5, x: 74, y: 40 });
    const up = setup({ x: 80, y: 70, vx: 0, vy: -maxSpeed(1) }, [thin]);
    const down = setup({ x: 80, y: 100, vx: 0, vy: maxSpeed(1) });
    // Act
    const a = step(up, idle, 0.4).run;
    const b = step(down, idle, 0.4).run;
    // Assert
    expect(a.panes.find((p) => p.id === 5)).toBeUndefined();
    expect(a.ball.vy).toBeGreaterThan(0);
    expect(a.ball.y).toBeGreaterThan(40 + GRID.h);
    expect(b.ball.vy).toBeLessThan(0);
    expect(b.ball.y).toBeLessThan(PADDLE.y);
  });

  it('missing the pebble costs a life and the last life ends the run', () => {
    // Arrange
    const falling = (r: Run): Run => ({ ...r, ball: { x: 10, y: FIELD.h + BALL.r - 0.5, vx: 0, vy: 120, stuck: false } });
    let r = setup({});
    // Act
    const first = step(falling(r), idle, DT);
    for (let i = 0; i < MAX_LIVES; i++) r = step(falling(r), idle, DT).run;
    // Assert
    expect(first.run.lives).toBe(MAX_LIVES - 1);
    expect(first.run.ball.stuck).toBe(true);
    expect(first.events.map((e) => e.type)).toContain('miss');
    expect(r.over).toBe(true);
    expect(r.lives).toBe(0);
    expect(step(r, idle, 1).run).toBe(r);
  });

  it('clearing the last pane gives the bonus and loads the next layout, looping faster', () => {
    // Arrange
    const last = setup({ x: 77, y: 40 + GRID.h + BALL.r + 0.5, vx: 0, vy: -80 }, [pane({ id: 3 }), pane({ id: 4, kind: 'iron', x: 100 })], false);
    const looped = { ...last, level: LAYOUTS.length };
    // Act
    const s = step(last, idle, DT);
    const l = step(looped, idle, DT).run;
    // Assert
    expect(s.run.level).toBe(2);
    expect(s.run.score).toBe(POINTS.glass + POINTS.clear);
    expect(s.run.panes).toEqual(buildPanes(LAYOUTS[1]));
    expect(s.run.ball.stuck).toBe(true);
    expect(s.events).toContainEqual({ type: 'clear', level: 2, bonus: POINTS.clear });
    expect(l.level).toBe(LAYOUTS.length + 1);
    expect(l.panes).toEqual(buildPanes(LAYOUTS[0]));
    expect(ballSpeed(l.level, 0)).toBeCloseTo(ballSpeed(1, 0) * 1.15, 6);
  });

  it('step never mutates its input and the same seed and inputs give the same run', () => {
    // Arrange
    const r0 = { ...newRun(9), banner: 0 };
    const snapshot = JSON.stringify(r0);
    const inputs = Array.from({ length: 400 }, (_, i) => ({ x: Math.sin(i / 20), launch: i === 2 }));
    // Act
    const a = inputs.reduce((r, inp) => step(r, inp, DT).run, r0);
    const b = inputs.reduce((r, inp) => step(r, inp, DT).run, r0);
    // Assert
    expect(JSON.stringify(r0)).toBe(snapshot);
    expect(a).toEqual(b);
    expect(a.t).toBeGreaterThan(6);
  });

  it('every layout fits the grid and has something to break', () => {
    for (const l of LAYOUTS) {
      expect(l.rows.length).toBeLessThanOrEqual(GRID.rows);
      for (const row of l.rows) expect(row).toMatch(/^[.a-eF#]{1,10}$/);
      expect(buildPanes(l).some((p) => p.kind !== 'iron')).toBe(true);
    }
    expect(LAYOUTS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('glasshouse cartridge', () => {
  it('pause menu freezes the simulation and resume continues it', () => {
    // Arrange
    const g = new GlasshouseGame(host());
    const d = new Driver(g);
    d.tap('start');
    d.seconds(2);
    d.tap('a');
    d.seconds(0.5);
    // Act
    d.tap('start');
    const frozen = g.state;
    d.seconds(3);
    // Assert
    expect(g.phase).toBe('paused');
    expect(g.state).toBe(frozen);
    d.tap('start');
    d.seconds(0.5);
    expect(g.phase).toBe('playing');
    expect(g.state.t).toBeGreaterThan(frozen.t);
  });

  it('best score round-trips through the store and a corrupt save starts fresh', () => {
    // Arrange
    const store = memoryStore();
    const g = new GlasshouseGame(host(store));
    const d = new Driver(g);
    d.tap('start');
    // Act: dodge the pebble on purpose until the run ends.
    for (let i = 0; i < 60 * 300 && g.phase !== 'over'; i++) {
      const { ball, paddle } = g.state;
      const away = ball.x > paddle.x + PADDLE.w / 2 ? 'left' : 'right';
      d.hub.press('test', away);
      d.hub.release('test', away === 'left' ? 'right' : 'left');
      if (ball.stuck && i % 30 === 0) d.tap('a');
      else d.step();
    }
    const best = g.inspect().best as number;
    const reloaded = new GlasshouseGame(host(store));
    const corrupt = new GlasshouseGame(host(memoryStore({ [SAVE_KEY]: '{"v":1,"data":{"best":"lots"}}' })));
    const garbage = new GlasshouseGame(host(memoryStore({ [SAVE_KEY]: 'not json' })));
    // Assert
    expect(g.phase).toBe('over');
    expect(best).toBe(g.state.score);
    expect(reloaded.inspect().best).toBe(best);
    expect(corrupt.inspect().best).toBe(0);
    expect(garbage.inspect().best).toBe(0);
    expect(validateRecord({ best: 12.7, runs: -1 })).toEqual({ best: 12, runs: 0 });
    expect(validateRecord([1])).toBeNull();
  });

  it('inspect reports the documented keys and the label art fills the screen', () => {
    // Arrange
    const g = new GlasshouseGame(host());
    const fb = new Framebuffer();
    // Act
    drawLabelArt(fb);
    // Assert
    expect(Object.keys(g.inspect()).sort()).toEqual(['ball', 'best', 'level', 'launched', 'lives', 'mode', 'over', 'paddle', 'panes', 'score', 'stuck'].sort());
    expect(fb.palette()).toBeGreaterThan(20);
    expect(fb.countNot(0)).toBe(fb.width * fb.height);
  });
});
