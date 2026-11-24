/** VINE cartridge: title, pause, game over and high score around the pure simulation. */
import type { GamePhase } from '@/device/machine';
import type { Framebuffer } from '@/runtime/framebuffer';
import type { Pad } from '@/runtime/input';
import { Slot } from '@/runtime/storage';
import type { Game, GameHost } from '@/runtime/types';
import { Menu, anyPressed, drawHelp } from '../common/menu';
import { DIRS, type Record_, type Run, type RunEvent, SAVE_KEY, SAVE_VERSION, newRun, step, validateRecord } from './logic';
import { HELP_LINES, type Spark, THEME, drawOver, drawPlay, drawSparks, drawTitle } from './view';

type Mode = 'title' | 'play' | 'menu' | 'help' | 'over';
const DEMO_SEED = 20261124;
/** Crash flash plus a moment before Start can begin a new run. */
const OVER_LOCK = 0.8;
const SPARK_LIFE = 0.6;

export class VineGame implements Game {
  readonly id = 'vine' as const;
  private mode: Mode = 'title';
  private run: Run;
  private record: Record_;
  private readonly slot: Slot<Record_>;
  private newBest = false;
  private sparks: Spark[] = [];
  private t = 0;
  private overAt = 0;
  private readonly menu = new Menu('PAUSED', [
    { id: 'resume', label: 'RESUME' },
    { id: 'restart', label: 'RESTART' },
    { id: 'help', label: 'HOW TO PLAY' },
  ]);

  constructor(private readonly host: GameHost) {
    this.slot = new Slot(host.store, SAVE_KEY, SAVE_VERSION, validateRecord);
    this.record = this.slot.load().value ?? { best: 0, runs: 0 };
    this.run = newRun(this.seed());
  }

  private seed(): number {
    return this.host.demo ? DEMO_SEED : this.host.rng.int(1, 2 ** 31 - 1);
  }

  get phase(): GamePhase {
    if (this.mode === 'title') return 'title';
    if (this.mode === 'play') return 'playing';
    if (this.mode === 'over') return 'over';
    return 'paused';
  }

  private begin(): void {
    this.run = newRun(this.seed());
    this.sparks = [];
    this.newBest = false;
    this.mode = 'play';
    this.host.sfx('start');
  }

  update(pad: Pad, dt: number): void {
    this.t += dt;
    const sfx = this.host.sfx.bind(this.host);
    switch (this.mode) {
      case 'title':
        if (pad.pressed('start') || pad.pressed('a')) this.begin();
        return;
      case 'over':
        if (this.t - this.overAt > OVER_LOCK && (pad.pressed('start') || pad.pressed('a'))) this.begin();
        return;
      case 'help':
        if (anyPressed(pad)) {
          sfx('menuBack');
          this.mode = 'menu';
        }
        return;
      case 'menu': {
        const r = this.menu.update(pad, sfx);
        if (r.kind === 'back') this.mode = 'play';
        else if (r.kind === 'select') {
          if (r.id === 'resume') this.mode = 'play';
          else if (r.id === 'restart') this.begin();
          else this.mode = 'help';
        }
        return;
      }
      case 'play':
        this.play(pad, dt);
    }
  }

  private play(pad: Pad, dt: number): void {
    if (pad.pressed('start')) {
      this.host.sfx('menuSelect');
      this.menu.open();
      this.mode = 'menu';
      return;
    }
    const r = step(this.run, { turns: DIRS.filter((d) => pad.pressed(d)), hurry: pad.held('a') }, dt);
    this.run = r.run;
    for (const e of r.events) this.react(e);
    this.sparks = this.sparks.map((s) => ({ ...s, age: s.age + dt })).filter((s) => s.age < SPARK_LIFE);
  }

  private react(e: RunEvent): void {
    const sfx = this.host.sfx.bind(this.host);
    if (e.type === 'eat') {
      sfx('gulp');
      this.sparks = [...this.sparks, { x: e.x, y: e.y, age: 0, label: `+${e.points}` }];
    } else if (e.type === 'bonus') {
      sfx('bonus');
      this.sparks = [...this.sparks, { x: e.x, y: e.y, age: 0, label: `+${e.points}` }];
    } else if (e.type === 'level') sfx('level');
    else if (e.type === 'crash') sfx('hit');
    else if (e.type === 'over') this.finish();
  }

  private finish(): void {
    this.host.sfx('gameOver');
    this.mode = 'over';
    this.overAt = this.t;
    this.newBest = this.run.score > this.record.best;
    this.record = { best: Math.max(this.record.best, this.run.score), runs: this.record.runs + 1 };
    this.slot.save(this.record);
  }

  draw(fb: Framebuffer): boolean {
    if (this.mode === 'title') {
      drawTitle(fb, this.t, this.record.best);
      return true;
    }
    drawPlay(fb, this.run, this.record.best, this.run.t);
    drawSparks(fb, this.sparks);
    if (this.mode === 'menu') this.menu.draw(fb, THEME, this.t);
    if (this.mode === 'help') drawHelp(fb, THEME, 'HOW TO PLAY', HELP_LINES);
    if (this.mode === 'over') drawOver(fb, this.run, this.record.best, this.newBest, this.t - this.overAt, this.t);
    return true;
  }

  pause(): void {
    if (this.mode === 'play') {
      this.menu.open();
      this.mode = 'menu';
    }
  }

  save(): void {
    this.slot.save(this.record);
  }

  dispose(): void {
    this.sparks = [];
  }

  inspect(): Record<string, unknown> {
    const r = this.run;
    return {
      mode: this.mode,
      score: r.score,
      best: this.record.best,
      runs: this.record.runs,
      length: r.body.length,
      head: [r.body[0][0], r.body[0][1]],
      dir: r.dir,
      food: r.food ? [r.food[0], r.food[1]] : null,
      blossom: r.blossom ? [r.blossom.cell[0], r.blossom.cell[1]] : null,
      eaten: r.eaten,
      over: r.over,
      interval: r.interval,
    };
  }

  get state(): Run {
    return this.run;
  }
}
