/** GLASSHOUSE cartridge: title, pause, game over and best score around the pure simulation. */
import type { GamePhase } from '@/device/machine';
import type { Framebuffer } from '@/runtime/framebuffer';
import type { Pad } from '@/runtime/input';
import type { SfxName } from '@/runtime/sfx';
import { Slot } from '@/runtime/storage';
import type { Game, GameHost } from '@/runtime/types';
import { Menu, anyPressed, drawHelp } from '../common/menu';
import { type Record_, type Run, type RunEvent, SAVE_KEY, SAVE_VERSION, breakableCount, newRun, step, validateRecord } from './logic';
import { HELP_LINES, type Shard, THEME, drawHud, drawOver, drawPrompt, drawScene, drawShards, drawTitle, paneColor } from './view';

type Mode = 'title' | 'play' | 'menu' | 'help' | 'over';
const DEMO_SEED = 20261124;
const SHARD_LIFE = 0.6;
const OVER_DELAY = 0.8;

const SOUND: Record<RunEvent['type'], SfxName | null> = {
  launch: 'paddle',
  bounce: 'bounce',
  paddle: 'paddle',
  pane: 'pane',
  crack: 'crack',
  miss: 'miss',
  clear: 'level',
  over: null,
};

export class GlasshouseGame implements Game {
  readonly id = 'glasshouse' as const;
  private mode: Mode = 'title';
  private run: Run;
  private record: Record_;
  private readonly slot: Slot<Record_>;
  private newBest = false;
  private shards: Shard[] = [];
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
    this.shards = [];
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
        if (this.t - this.overAt > OVER_DELAY && (pad.pressed('start') || pad.pressed('a'))) this.begin();
        return;
      case 'help':
        if (anyPressed(pad)) {
          sfx('menuBack');
          this.mode = 'menu';
        }
        return;
      case 'menu':
        this.updateMenu(pad, sfx);
        return;
      case 'play':
        this.updatePlay(pad, dt);
    }
  }

  private updateMenu(pad: Pad, sfx: (n: SfxName) => void): void {
    const r = this.menu.update(pad, sfx);
    if (r.kind === 'back') this.mode = 'play';
    else if (r.kind === 'select') {
      if (r.id === 'resume') this.mode = 'play';
      else if (r.id === 'restart') this.begin();
      else this.mode = 'help';
    }
  }

  private updatePlay(pad: Pad, dt: number): void {
    if (pad.pressed('start')) {
      this.host.sfx('menuSelect');
      this.menu.open();
      this.mode = 'menu';
      return;
    }
    const r = step(this.run, { x: pad.axis().x, launch: pad.pressed('a') }, dt);
    this.run = r.run;
    this.react(r.events);
    this.shards = this.shards.map((s) => ({ ...s, age: s.age + dt })).filter((s) => s.age < SHARD_LIFE);
  }

  /** Sounds (at most one of each name per frame), shards, and the end of the run. */
  private react(events: readonly RunEvent[]): void {
    const played = new Set<SfxName>();
    for (const e of events) {
      const name = SOUND[e.type];
      if (name && !played.has(name)) {
        played.add(name);
        this.host.sfx(name);
      }
      if (e.type === 'pane') this.shards = [...this.shards, { x: e.x, y: e.y, age: 0, color: paneColor(e), label: `+${e.points}` }];
      else if (e.type === 'crack') this.shards = [...this.shards, { x: e.x, y: e.y, age: 0.3, color: paneColor({ kind: 'frost', tint: 0 }), label: '' }];
      else if (e.type === 'over') this.finish();
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
    drawScene(fb, this.run);
    drawShards(fb, this.shards);
    drawHud(fb, this.run, this.record.best);
    if (this.mode === 'play') drawPrompt(fb, this.run, this.t);
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
    this.shards = [];
  }

  inspect(): Record<string, unknown> {
    const r = this.run;
    const round = (v: number): number => Math.round(v * 10) / 10;
    return {
      mode: this.mode,
      score: r.score,
      best: this.record.best,
      lives: r.lives,
      level: r.level,
      panes: breakableCount(r.panes),
      ball: [round(r.ball.x), round(r.ball.y)],
      stuck: r.ball.stuck,
      launched: !r.ball.stuck,
      paddle: round(r.paddle.x),
      over: r.over,
    };
  }

  get state(): Run {
    return this.run;
  }
}
