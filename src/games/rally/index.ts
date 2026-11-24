/** RALLY cartridge: title with difficulty, pause, match over and win/loss record around the pure simulation. */
import type { GamePhase } from '@/device/machine';
import type { Framebuffer } from '@/runtime/framebuffer';
import type { Pad } from '@/runtime/input';
import { Slot } from '@/runtime/storage';
import type { Game, GameHost } from '@/runtime/types';
import { Menu, anyPressed, drawHelp } from '../common/menu';
import {
  DEFAULT_RECORD,
  DIFFICULTIES,
  type Difficulty,
  type Match,
  type RallyEvent,
  type Record_,
  SAVE_KEY,
  SAVE_VERSION,
  type Side,
  newMatch,
  step,
  validateRecord,
} from './logic';
import { HELP_LINES, THEME, drawMatch, drawOver, drawTitle } from './view';

type Mode = 'title' | 'play' | 'menu' | 'help' | 'over';
const DEMO_SEED = 20261124;
const GLOW_TIME = 0.6;
const OVER_LOCK = 0.8;

export class RallyGame implements Game {
  readonly id = 'rally' as const;
  private mode: Mode = 'title';
  private match: Match;
  private record: Record_;
  private readonly slot: Slot<Record_>;
  private glow: { side: Side; until: number } | null = null;
  private t = 0;
  private overAt = 0;
  private readonly menu = new Menu('PAUSED', [
    { id: 'resume', label: 'RESUME' },
    { id: 'restart', label: 'RESTART' },
    { id: 'help', label: 'HOW TO PLAY' },
  ]);

  constructor(private readonly host: GameHost) {
    this.slot = new Slot(host.store, SAVE_KEY, SAVE_VERSION, validateRecord);
    this.record = this.slot.load().value ?? DEFAULT_RECORD;
    this.match = newMatch(this.seed(), this.record.difficulty);
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
    this.match = newMatch(this.seed(), this.record.difficulty);
    this.glow = null;
    this.mode = 'play';
    this.host.sfx('start');
  }

  private cycleDifficulty(dir: 1 | -1): void {
    const i = DIFFICULTIES.indexOf(this.record.difficulty);
    const difficulty: Difficulty = DIFFICULTIES[(i + dir + DIFFICULTIES.length) % DIFFICULTIES.length];
    this.record = { ...this.record, difficulty };
    this.slot.save(this.record);
    this.host.sfx('menuMove');
  }

  private updateTitle(pad: Pad): void {
    if (pad.pressed('start') || pad.pressed('a')) this.begin();
    else if (pad.pressed('select') || pad.pressed('right')) this.cycleDifficulty(1);
    else if (pad.pressed('left')) this.cycleDifficulty(-1);
  }

  private updateMenu(pad: Pad): void {
    const r = this.menu.update(pad, this.host.sfx.bind(this.host));
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
    const r = step(this.match, { y: pad.axis().y, serve: pad.pressed('a') }, dt);
    this.match = r.match;
    r.events.forEach((e) => this.onEvent(e));
  }

  private onEvent(e: RallyEvent): void {
    const sfx = this.host.sfx.bind(this.host);
    if (e.type === 'bounce') sfx('bounce');
    else if (e.type === 'paddle' || e.type === 'serve') sfx('paddle');
    else if (e.type === 'point') {
      sfx(e.side === 'you' ? 'point' : 'miss');
      this.glow = { side: e.side, until: this.t + GLOW_TIME };
    } else if (e.type === 'over') this.finish(e.winner);
  }

  update(pad: Pad, dt: number): void {
    this.t += dt;
    switch (this.mode) {
      case 'title':
        this.updateTitle(pad);
        return;
      case 'over':
        if (this.t - this.overAt > OVER_LOCK && (pad.pressed('start') || pad.pressed('a'))) this.begin();
        return;
      case 'help':
        if (anyPressed(pad)) {
          this.host.sfx('menuBack');
          this.mode = 'menu';
        }
        return;
      case 'menu':
        this.updateMenu(pad);
        return;
      case 'play':
        this.updatePlay(pad, dt);
    }
  }

  private finish(winner: Side): void {
    const won = winner === 'you';
    this.host.sfx(won ? 'win' : 'gameOver');
    this.mode = 'over';
    this.overAt = this.t;
    this.record = { ...this.record, wins: this.record.wins + (won ? 1 : 0), losses: this.record.losses + (won ? 0 : 1) };
    this.slot.save(this.record);
  }

  draw(fb: Framebuffer): boolean {
    if (this.mode === 'title') {
      drawTitle(fb, this.t, this.record.difficulty, this.record.wins, this.record.losses);
      return true;
    }
    const glow = this.glow && this.t < this.glow.until ? this.glow.side : null;
    drawMatch(fb, this.match, this.t, glow);
    if (this.mode === 'menu') this.menu.draw(fb, THEME, this.t);
    if (this.mode === 'help') drawHelp(fb, THEME, 'HOW TO PLAY', HELP_LINES);
    if (this.mode === 'over') drawOver(fb, this.match, this.record.wins, this.record.losses, this.t);
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
    this.glow = null;
  }

  inspect(): Record<string, unknown> {
    const m = this.match;
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    return {
      mode: this.mode,
      difficulty: m.difficulty,
      score: [m.score[0], m.score[1]],
      serving: m.serving,
      held: m.held,
      ball: [r1(m.ball.x), r1(m.ball.y)],
      paddles: [r1(m.you.y), r1(m.cpu.y)],
      hits: m.hits,
      wins: this.record.wins,
      losses: this.record.losses,
      over: m.over,
    };
  }

  get state(): Match {
    return this.match;
  }

  /** Difficulty currently selected (and saved) on the title screen. */
  get difficulty(): Difficulty {
    return this.record.difficulty;
  }
}
