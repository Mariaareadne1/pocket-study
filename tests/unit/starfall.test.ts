import { describe, expect, it } from 'vitest';
import { StarfallGame } from '@/games/starfall';
import { FIELD, INVULNERABLE, MAX_LIVES, PLAYER, type Obj, type Run, newRun, objBox, overlaps, playerBox, step } from '@/games/starfall/logic';
import { memoryStore } from '@/runtime/storage';
import { Driver, host } from './helpers';

const idle = { x: 0, y: 0, dash: false, pulse: false };
const quiet = (r: Run): Run => ({ ...r, spawnIn: 999 });
const withObj = (r: Run, o: Partial<Obj>): Run => ({
  ...r,
  objs: [{ id: 99, kind: 'star', x: 0, y: 0, vx: 0, vy: 0, spin: 0, ...o }],
});

describe('starfall simulation', () => {
  it('player moves at the documented speed and stays in bounds', () => {
    let r = quiet(newRun(1));
    const x0 = r.player.x;
    for (let i = 0; i < 30; i++) r = step(r, { ...idle, x: 1 }, 1 / 60).run;
    expect(r.player.x - x0).toBeCloseTo(PLAYER.speed * 0.5, 0);
    for (let i = 0; i < 600; i++) r = step(r, { ...idle, x: 1, y: 1 }, 1 / 60).run;
    expect(r.player.x).toBeLessThanOrEqual(FIELD.w - PLAYER.w - 2);
    expect(r.player.y).toBeLessThanOrEqual(PLAYER.maxY);
    for (let i = 0; i < 600; i++) r = step(r, { ...idle, x: -1, y: -1 }, 1 / 60).run;
    expect(r.player.x).toBeGreaterThanOrEqual(2);
    expect(r.player.y).toBeGreaterThanOrEqual(PLAYER.minY);
  });

  it('falling objects update over time and the same seed gives the same run', () => {
    const a: Run[] = [newRun(7)];
    const b: Run[] = [newRun(7)];
    for (let i = 0; i < 300; i++) {
      a.push(step(a.at(-1)!, idle, 1 / 60).run);
      b.push(step(b.at(-1)!, idle, 1 / 60).run);
    }
    const end = a.at(-1)!;
    expect(end.objs.length).toBeGreaterThan(0);
    expect(end).toEqual(b.at(-1));
    const o = end.objs[0];
    const later = step(end, idle, 0.1).run.objs.find((q) => q.id === o.id);
    expect(later!.y).toBeGreaterThan(o.y);
  });

  it('collision detection: overlapping a star scores, near-miss does not', () => {
    const r = quiet(newRun(1));
    const pb = playerBox(r.player);
    const hit = step(withObj(r, { x: pb.x, y: pb.y }), idle, 1 / 60);
    expect(hit.run.score).toBe(10);
    expect(hit.events[0]).toMatchObject({ type: 'star', points: 10 });
    const miss = step(withObj(r, { x: pb.x + pb.w + 3, y: pb.y - 20 }), idle, 1 / 60);
    expect(miss.run.score).toBe(0);
    expect(overlaps({ x: 0, y: 0, w: 2, h: 2 }, { x: 2, y: 0, w: 2, h: 2 })).toBe(false);
  });

  it('rocks cost a life, then grant invulnerability', () => {
    const r = quiet(newRun(1));
    const pb = playerBox(r.player);
    const rock = withObj(r, { kind: 'rock', x: pb.x, y: pb.y });
    const s = step(rock, idle, 1 / 60);
    expect(s.run.lives).toBe(MAX_LIVES - 1);
    expect(s.run.player.inv).toBeCloseTo(INVULNERABLE, 2);
    const again = step(withObj(s.run, { kind: 'rock', x: pb.x, y: pb.y }), idle, 1 / 60);
    expect(again.run.lives).toBe(MAX_LIVES - 1);
  });

  it('game over triggers when lives are depleted', () => {
    let r = quiet(newRun(1));
    for (let k = 0; k < MAX_LIVES; k++) {
      const pb = playerBox(r.player);
      r = step(withObj({ ...r, player: { ...r.player, inv: 0 } }, { kind: 'rock', x: pb.x, y: pb.y }), idle, 1 / 60).run;
    }
    expect(r.over).toBe(true);
    expect(r.lives).toBe(0);
    expect(step(r, idle, 1).run).toBe(r);
  });

  it('dash is invulnerable and has a cooldown', () => {
    let r = quiet(newRun(1));
    const d = step(r, { ...idle, dash: true, x: 1 }, 1 / 60);
    expect(d.events.map((e) => e.type)).toContain('dash');
    r = d.run;
    const pb = playerBox(r.player);
    expect(step(withObj(r, { kind: 'rock', x: pb.x, y: pb.y }), idle, 1 / 60).run.lives).toBe(MAX_LIVES);
    expect(step(r, { ...idle, dash: true }, 1 / 60).events.map((e) => e.type)).not.toContain('dash');
  });

  it('objects use their documented hit boxes', () => {
    expect(objBox({ id: 1, kind: 'rock', x: 10, y: 10, vx: 0, vy: 0, spin: 0 })).toEqual({ x: 11, y: 11, w: 6, h: 6 });
    expect(objBox({ id: 1, kind: 'star', x: 10, y: 10, vx: 0, vy: 0, spin: 0 })).toEqual({ x: 9, y: 9, w: 9, h: 9 });
  });
});

describe('starfall cartridge', () => {
  it('pause freezes gameplay', () => {
    const d = new Driver(new StarfallGame(host()));
    d.tap('start');
    d.seconds(2);
    d.tap('start');
    expect(d.game.phase).toBe('paused');
    const t = (d.game as StarfallGame).state.t;
    d.seconds(5);
    expect((d.game as StarfallGame).state.t).toBe(t);
    d.tap('start');
    d.seconds(1);
    expect((d.game as StarfallGame).state.t).toBeGreaterThan(t);
  });

  it('high score persists and restart resets the run', () => {
    const store = memoryStore();
    const g = new StarfallGame(host(store));
    const d = new Driver(g);
    d.tap('start');
    // Survive and sit still: rocks eventually end the run.
    for (let i = 0; i < 60 * 240 && g.phase !== 'over'; i++) d.step();
    expect(g.phase).toBe('over');
    const best = (g.inspect().best as number) ?? 0;
    const again = new StarfallGame(host(store));
    expect(again.inspect().best).toBe(best);
    d.seconds(1);
    d.tap('start');
    expect(g.phase).toBe('playing');
    expect(g.state.score).toBe(0);
    expect(g.state.lives).toBe(MAX_LIVES);
  });
});
