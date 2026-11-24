import { describe, expect, it } from 'vitest';
import { RallyGame } from '@/games/rally';
import {
  BALL,
  type Ball,
  CPU_LEVELS,
  CPU_SERVE_DELAY,
  type Difficulty,
  EDGE_ANGLE,
  type Match,
  PADDLE,
  PADDLE_MAX,
  PADDLE_MIN,
  type RallyEvent,
  type StepInput,
  TABLE,
  WIN_SCORE,
  newMatch,
  returnAngle,
  step,
  validateRecord,
} from '@/games/rally/logic';
import { drawLabelArt } from '@/games/rally/view';
import { Framebuffer } from '@/runtime/framebuffer';
import { memoryStore } from '@/runtime/storage';
import { Driver, host } from './helpers';

const DT = 1 / 60;
const idle: StepInput = { y: 0, serve: false };
const inPlay = (m: Match, ball: Ball): Match => ({ ...m, held: false, ball });
const run = (m: Match, frames: number, input: StepInput = idle): { match: Match; events: RallyEvent[] } => {
  let match = m;
  const events: RallyEvent[] = [];
  for (let i = 0; i < frames; i++) {
    const r = step(match, input, DT);
    match = r.match;
    events.push(...r.events);
  }
  return { match, events };
};
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') Object.values(o).forEach(deepFreeze);
  return Object.freeze(o);
};

/** Ball streaking to the CPU's bottom corner while its paddle waits at the top. */
function cornerShot(difficulty: Difficulty): Match {
  const m = newMatch(3, difficulty);
  return {
    ...inPlay(m, { x: 20, y: TABLE.bottom - BALL.r - 1, vx: 80, vy: 0 }),
    cpu: { y: PADDLE_MIN, vy: 0 },
    ai: { react: CPU_LEVELS[difficulty].reaction, offset: 0 },
  };
}

describe('rally simulation', () => {
  it('player paddle moves at the documented speed and is clamped to the table', () => {
    // Arrange
    const m = newMatch(1, 'normal');
    // Act
    const half = run(m, 30, { y: 1, serve: false }).match;
    const low = run(half, 300, { y: 1, serve: false }).match;
    const high = run(low, 300, { y: -1, serve: false }).match;
    // Assert
    expect(half.you.y - m.you.y).toBeCloseTo(PADDLE.speed * 0.5, 0);
    expect(low.you.y).toBe(PADDLE_MAX);
    expect(high.you.y).toBe(PADDLE_MIN);
  });

  it('the ball waits on the server until A is pressed, and the console serves on its own', () => {
    // Arrange
    const m = newMatch(1, 'normal');
    // Act
    const waited = run(m, 300).match;
    const served = step(waited, { y: 0, serve: true }, DT);
    const cpuServing: Match = { ...m, serving: 'cpu' };
    const early = run(cpuServing, Math.floor(CPU_SERVE_DELAY * 60) - 2).match;
    const late = run(early, 4);
    // Assert
    expect(waited.held).toBe(true);
    expect(waited.ball.x).toBe(m.ball.x);
    expect(served.match.held).toBe(false);
    expect(served.match.ball.vx).toBeGreaterThan(0);
    expect(served.events).toContainEqual({ type: 'serve', side: 'you' });
    expect(early.held).toBe(true);
    expect(late.match.held).toBe(false);
    expect(late.match.ball.vx).toBeLessThan(0);
  });

  it('the ball bounces off the top and bottom edges', () => {
    // Arrange
    const m = newMatch(1, 'normal');
    const up = inPlay(m, { x: 80, y: TABLE.top + 3, vx: 30, vy: -90 });
    const down = inPlay(m, { x: 80, y: TABLE.bottom - 3, vx: 30, vy: 90 });
    // Act
    const a = run(up, 4);
    const b = run(down, 4);
    // Assert
    expect(a.match.ball.vy).toBeGreaterThan(0);
    expect(a.match.ball.y).toBeGreaterThanOrEqual(TABLE.top + BALL.r);
    expect(a.events).toContainEqual({ type: 'bounce' });
    expect(b.match.ball.vy).toBeLessThan(0);
    expect(b.match.ball.y).toBeLessThanOrEqual(TABLE.bottom - BALL.r);
  });

  it('a centre hit returns the ball flat while an edge hit returns it at about 55 degrees', () => {
    // Arrange
    const m = newMatch(1, 'normal');
    const centre = m.you.y + PADDLE.h / 2;
    const toward = (y: number): Match => inPlay(m, { x: 24, y, vx: -60, vy: 0 });
    // Act
    const flat = run(toward(centre), 20).match.ball;
    const edge = run(toward(centre + PADDLE.h / 2 + 0.5), 20).match.ball;
    // Assert
    expect(flat.vx).toBeGreaterThan(0);
    expect(Math.abs(flat.vy)).toBeLessThan(1);
    expect(Math.atan2(edge.vy, edge.vx)).toBeGreaterThan((50 * Math.PI) / 180);
    expect(returnAngle(centre + PADDLE.h / 2 + BALL.r, m.you.y, 0)).toBeCloseTo(EDGE_ANGLE, 5);
    expect(returnAngle(centre, m.you.y, PADDLE.speed)).toBeGreaterThan(0);
  });

  it('a max-speed ball never passes through a paddle even with a huge time step', () => {
    // Arrange
    const m = newMatch(1, 'normal');
    const fast = inPlay(m, { x: 80, y: m.you.y + PADDLE.h / 2, vx: -BALL.max, vy: 0 });
    // Act
    const r = step(fast, idle, 0.5);
    // Assert
    expect(r.events).toContainEqual({ type: 'paddle', side: 'you', hits: 1 });
    expect(r.match.ball.vx).toBeGreaterThan(0);
    expect(r.match.ball.x).toBeGreaterThan(PADDLE.youX + PADDLE.w);
    expect(r.match.score).toEqual([0, 0]);
  });

  it('a miss scores for the other side and resets the serve to the side that missed', () => {
    // Arrange
    const m = { ...newMatch(1, 'normal'), you: { y: PADDLE_MIN, vy: 0 }, hits: 5 };
    const past = inPlay(m, { x: 40, y: TABLE.bottom - 4, vx: -100, vy: 0 });
    // Act
    const r = run(past, 60);
    // Assert
    expect(r.events).toContainEqual({ type: 'point', side: 'cpu', score: [0, 1] });
    expect(r.match.score).toEqual([0, 1]);
    expect(r.match.held).toBe(true);
    expect(r.match.serving).toBe('you');
    expect(r.match.hits).toBe(0);
  });

  it(`the match ends when a side reaches ${WIN_SCORE} and then stays frozen`, () => {
    // Arrange
    const m: Match = { ...newMatch(1, 'normal'), score: [WIN_SCORE - 1, 3] };
    const winner = inPlay(m, { x: TABLE.right, y: 30, vx: 120, vy: 0 });
    // Act
    const r = step(winner, idle, DT);
    // Assert
    expect(r.match.over).toBe(true);
    expect(r.match.winner).toBe('you');
    expect(r.events).toContainEqual({ type: 'over', winner: 'you' });
    expect(step(r.match, { y: 1, serve: true }, DT).match).toBe(r.match);
  });

  it('EASY cannot reach a long corner shot that HARD returns', () => {
    // Arrange
    const easy = cornerShot('easy');
    const hard = cornerShot('hard');
    // Act
    const e = run(easy, 150);
    const h = run(hard, 150);
    // Assert
    expect(CPU_LEVELS.easy.speed).toBeLessThan(CPU_LEVELS.hard.speed);
    expect(CPU_LEVELS.easy.speed).toBeLessThan(PADDLE.speed);
    expect(e.events).toContainEqual({ type: 'point', side: 'you', score: [1, 0] });
    expect(h.events.some((ev) => ev.type === 'paddle' && ev.side === 'cpu')).toBe(true);
    expect(h.match.score).toEqual([0, 0]);
  });

  it('the same seed and the same inputs give an identical match', () => {
    // Arrange
    const script = (i: number): StepInput => ({ y: Math.sin(i / 40) > 0 ? 1 : -1, serve: i % 90 === 0 });
    let a = newMatch(77, 'hard');
    let b = newMatch(77, 'hard');
    // Act
    for (let i = 0; i < 2400; i++) {
      a = step(a, script(i), DT).match;
      b = step(b, script(i), DT).match;
    }
    // Assert
    expect(a).toEqual(b);
    expect(a.t).toBeGreaterThan(0);
  });

  it('step never mutates its input', () => {
    // Arrange
    const m = deepFreeze(inPlay(newMatch(5, 'normal'), { x: 30, y: 40, vx: -90, vy: 40 }));
    const before = JSON.stringify(m);
    // Act
    const r = run(m, 200, { y: 1, serve: true });
    // Assert
    expect(JSON.stringify(m)).toBe(before);
    expect(r.match).not.toBe(m);
  });

  it('the save validator rejects bad shapes and defaults an unknown difficulty', () => {
    expect(validateRecord({ wins: 2, losses: 1, difficulty: 'hard' })).toEqual({ wins: 2, losses: 1, difficulty: 'hard' });
    expect(validateRecord({ wins: 2, losses: 1, difficulty: 'impossible' })).toEqual({ wins: 2, losses: 1, difficulty: 'normal' });
    expect(validateRecord({ wins: -1, losses: 0 })).toBeNull();
    expect(validateRecord([1, 2])).toBeNull();
    expect(validateRecord(null)).toBeNull();
  });
});

describe('rally cartridge', () => {
  it('difficulty is chosen on the title screen and remembered by the save', () => {
    // Arrange
    const store = memoryStore();
    const d = new Driver(new RallyGame(host(store)));
    // Act
    d.tap('select');
    const afterSelect = (d.game as RallyGame).difficulty;
    d.tap('right');
    d.tap('left');
    d.tap('left');
    const reloaded = new RallyGame(host(store));
    // Assert
    expect(afterSelect).toBe('hard');
    expect((d.game as RallyGame).difficulty).toBe('normal');
    expect(reloaded.inspect().difficulty).toBe('normal');
    d.tap('right');
    expect(new RallyGame(host(store)).difficulty).toBe('hard');
  });

  it('pause freezes the simulation', () => {
    // Arrange
    const g = new RallyGame(host());
    const d = new Driver(g);
    d.tap('start');
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
    d.seconds(0.2);
    expect(g.phase).toBe('playing');
    expect(g.state.t).toBeGreaterThan(frozen.t);
  });

  it('a full match records a win or loss that survives a reload, and a corrupt save starts fresh', () => {
    // Arrange
    const store = memoryStore();
    const g = new RallyGame(host(store));
    const d = new Driver(g);
    d.tap('start');
    // Act: serve whenever it is our turn, otherwise stand still.
    for (let i = 0; i < 60 * 600 && g.phase !== 'over'; i++) {
      if (g.state.held && g.state.serving === 'you') d.tap('a');
      else d.step();
    }
    const info = g.inspect();
    const reloaded = new RallyGame(host(store)).inspect();
    const corrupt = new RallyGame(host(memoryStore({ rally: '{not json' }))).inspect();
    // Assert
    expect(g.phase).toBe('over');
    expect((info.wins as number) + (info.losses as number)).toBe(1);
    expect(Math.max(...(info.score as number[]))).toBe(WIN_SCORE);
    expect(reloaded).toMatchObject({ wins: info.wins, losses: info.losses });
    expect(corrupt).toMatchObject({ wins: 0, losses: 0, difficulty: 'normal', mode: 'title' });
  });

  it('draws a non-blank title, match and label scene', () => {
    // Arrange
    const d = new Driver(new RallyGame(host()));
    const label = new Framebuffer();
    // Act
    const title = d.draw().palette();
    d.tap('start');
    const play = d.draw().palette();
    drawLabelArt(label);
    // Assert
    expect(title).toBeGreaterThan(8);
    expect(play).toBeGreaterThan(8);
    expect(label.palette()).toBeGreaterThan(8);
  });
});
