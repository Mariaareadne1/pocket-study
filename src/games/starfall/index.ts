/** STARFALL cartridge: title, pause, game over and high score around the pure simulation. */
import type { GamePhase } from '@/device/machine';
import type { Framebuffer } from '@/runtime/framebuffer';
import type { Pad } from '@/runtime/input';
import { Slot } from '@/runtime/storage';
import type { Game, GameHost } from '@/runtime/types';
import { Menu, anyPressed, drawHelp } from '../common/menu';
import { type Record_, type Run, SAVE_KEY, SAVE_VERSION, newRun, step, validateRecord } from './logic';
import { HELP_LINES, type Spark, THEME, drawBackdrop, drawHud, drawObj, drawOver, drawPlayer, drawSparks, drawTitle } from './view';

type Mode = 'title' | 'play' | 'menu' | 'help' | 'over';
const DEMO_SEED = 20261123;

export class StarfallGame implements Game {
  readonly id = 'starfall' as const;
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
        if (this.t - this.overAt > 0.8 && (pad.pressed('start') || pad.pressed('a'))) this.begin();
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
      case 'play': {
        if (pad.pressed('start')) {
          sfx('menuSelect');
          this.menu.open();
          this.mode = 'menu';
          return;
        }
        const axis = pad.axis();
        const r = step(this.run, { x: axis.x, y: axis.y, dash: pad.pressed('a'), pulse: pad.pressed('b') }, dt);
        this.run = r.run;
        for (const e of r.events) {
          if (e.type === 'star') {
            sfx(e.kind === 'big' ? 'bigStar' : 'star');
            this.sparks.push({ x: e.x, y: e.y, age: 0, label: `+${e.points}` });
          } else if (e.type === 'hit') sfx('hit');
          else if (e.type === 'dash') sfx('dash');
          else if (e.type === 'pulse') sfx('pulse');
          else if (e.type === 'level') sfx('level');
          else if (e.type === 'over') this.finish();
        }
        this.sparks = this.sparks.map((s) => ({ ...s, age: s.age + dt })).filter((s) => s.age < 0.6);
      }
    }
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
    const shake = this.run.shake > 0 ? Math.round(Math.sin(this.t * 90) * 2) : 0;
    drawBackdrop(fb, this.run.t);
    for (const o of this.run.objs) drawObj(fb, { ...o, x: o.x + shake }, this.run.t);
    drawPlayer(fb, { ...this.run.player, x: this.run.player.x + shake }, this.run.t);
    drawSparks(fb, this.sparks);
    drawHud(fb, this.run, this.record.best);
    if (this.mode === 'menu') this.menu.draw(fb, THEME, this.t);
    if (this.mode === 'help') drawHelp(fb, THEME, 'HOW TO PLAY', HELP_LINES);
    if (this.mode === 'over') drawOver(fb, this.run, this.record.best, this.newBest, this.t);
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
      lives: r.lives,
      level: r.level,
      t: Math.round(r.t * 100) / 100,
      player: [Math.round(r.player.x * 10) / 10, Math.round(r.player.y * 10) / 10],
      objects: r.objs.length,
      stars: r.objs.filter((o) => o.kind !== 'rock').length,
      rocks: r.objs.filter((o) => o.kind === 'rock').length,
      caught: r.caught,
      best: this.record.best,
      over: r.over,
    };
  }

  get state(): Run {
    return this.run;
  }
}
