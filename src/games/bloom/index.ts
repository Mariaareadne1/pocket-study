/** BLOOM cartridge: menus, sound and persistence around the pure garden rules. */
import type { GamePhase } from '@/device/machine';
import type { Framebuffer } from '@/runtime/framebuffer';
import type { Pad } from '@/runtime/input';
import { Slot } from '@/runtime/storage';
import type { Game, GameHost } from '@/runtime/types';
import { Confirm, Menu, anyPressed, drawHelp } from '../common/menu';
import { type Garden, SAVE_KEY, SAVE_VERSION, SEEDS, act, blooms, demoGarden, moveCursor, newGarden, nextSeed, nextTool, step, validateGarden } from './logic';
import { HELP_LINES, type Petal, SEED_COLOR, THEME, drawButterfly, drawCelebration, drawCursor, drawGarden, drawHud, drawSky, drawTitle } from './view';

type Mode = 'title' | 'play' | 'menu' | 'help' | 'confirm';
const SAVE_EVERY = 1.5;

export class BloomGame implements Game {
  readonly id = 'bloom' as const;
  private mode: Mode = 'title';
  private garden: Garden;
  private readonly slot: Slot<Garden>;
  private hasSave: boolean;
  private note: string | null = null;
  private t = 0;
  private dirty = false;
  private sinceSave = 0;
  private version = 0;
  private lastKey = '';
  private petals: Petal[] = [];
  private celebrateAge = -1;
  private readonly menu = new Menu('GARDEN', [
    { id: 'resume', label: 'RESUME' },
    { id: 'help', label: 'HOW TO GROW' },
    { id: 'new', label: 'NEW GARDEN' },
  ]);
  private readonly confirm = new Confirm('START A NEW GARDEN? THIS ONE WILL BE LOST.');

  constructor(private readonly host: GameHost) {
    this.slot = new Slot(host.store, SAVE_KEY, SAVE_VERSION, validateGarden);
    const loaded = this.slot.load();
    if (host.demo) {
      this.garden = demoGarden();
      this.hasSave = true;
    } else if (loaded.value) {
      this.garden = loaded.value;
      this.hasSave = true;
    } else {
      this.garden = newGarden();
      this.hasSave = false;
      if (loaded.status === 'corrupt') this.note = 'OLD SAVE UNREADABLE';
    }
  }

  get phase(): GamePhase {
    return this.mode === 'title' ? 'title' : this.mode === 'play' ? 'playing' : 'paused';
  }

  private set(g: Garden): void {
    if (g === this.garden) return;
    this.garden = g;
    this.version++;
  }

  update(pad: Pad, dt: number): void {
    this.t += dt;
    const sfx = this.host.sfx.bind(this.host);
    switch (this.mode) {
      case 'title':
        if (pad.pressed('start') || pad.pressed('a')) {
          sfx('start');
          this.mode = 'play';
          this.note = null;
          this.version++;
        }
        return;
      case 'menu': {
        const r = this.menu.update(pad, sfx);
        if (r.kind === 'back') this.mode = 'play';
        else if (r.kind === 'select') {
          if (r.id === 'resume') this.mode = 'play';
          else if (r.id === 'help') this.mode = 'help';
          else if (r.id === 'new') {
            this.confirm.open();
            this.mode = 'confirm';
          }
        }
        this.version++;
        return;
      }
      case 'help':
        if (anyPressed(pad)) {
          sfx('menuBack');
          this.mode = 'menu';
          this.version++;
        }
        return;
      case 'confirm': {
        const r = this.confirm.update(pad, sfx);
        if (r === true) {
          this.set(newGarden());
          this.petals = [];
          this.celebrateAge = -1;
          this.saveNow();
          this.mode = 'play';
        } else if (r === false) this.mode = 'menu';
        this.version++;
        return;
      }
      case 'play':
        this.play(pad, dt);
    }
  }

  private play(pad: Pad, dt: number): void {
    const sfx = this.host.sfx.bind(this.host);
    if (pad.pressed('start')) {
      sfx('menuSelect');
      this.menu.open();
      this.mode = 'menu';
      this.saveNow();
      this.version++;
      return;
    }
    let g = this.garden;
    const dx = (pad.repeat('right') ? 1 : 0) - (pad.repeat('left') ? 1 : 0);
    const dy = (pad.repeat('down') ? 1 : 0) - (pad.repeat('up') ? 1 : 0);
    if (dx || dy) {
      const moved = moveCursor(g, dx, dy);
      if (moved !== g) sfx('menuMove');
      g = moved;
    }
    if (pad.pressed('b')) {
      g = nextTool(g);
      sfx('tool');
    }
    if (pad.pressed('select')) {
      g = g.tool === 'seed' ? nextSeed(g) : { ...nextSeed(g), tool: 'seed' };
      sfx('tool');
    }
    if (pad.pressed('a')) {
      const r = act(g);
      g = r.garden;
      sfx(r.result === 'planted' ? 'plant' : r.result === 'watered' ? 'water' : r.result === 'dug' ? 'dig' : 'deny');
      if (r.result !== 'deny') this.dirty = true;
    }
    const s = step(g, dt);
    for (const e of s.events) {
      if (e.type === 'bloomed') sfx('bloom');
      else if (e.type === 'grew') sfx('grow');
      else if (e.type === 'complete') this.celebrate();
      this.dirty = true;
    }
    this.set(s.garden);
    this.tickPetals(dt);
    this.sinceSave += dt;
    if (this.dirty && this.sinceSave >= SAVE_EVERY) this.saveNow();
  }

  private celebrate(): void {
    this.host.sfx('celebrate');
    this.celebrateAge = 0;
    const rng = this.host.rng;
    this.petals = Array.from({ length: 46 }, () => {
      const seed = rng.pick(SEEDS);
      return { x: rng.range(0, 160), y: rng.range(-60, 0), vx: rng.range(-4, 4), vy: rng.range(14, 26), c: SEED_COLOR[seed].p === 0xffffff ? 0xfdfcff : SEED_COLOR[seed].p, phase: rng.range(0, 6) };
    });
  }

  private tickPetals(dt: number): void {
    if (this.celebrateAge < 0) return;
    this.celebrateAge += dt;
    this.petals = this.petals.map((p) => ({ ...p, x: p.x + p.vx * dt, y: p.y + p.vy * dt })).filter((p) => p.y < 150);
    if (this.petals.length === 0 && this.celebrateAge > 4.2) this.celebrateAge = -1;
    this.version++;
  }

  draw(fb: Framebuffer): boolean {
    const key = `${this.mode}:${this.version}:${Math.floor(this.t * 8)}`;
    if (key === this.lastKey) return false;
    this.lastKey = key;
    if (this.mode === 'title') {
      drawTitle(fb, this.t, this.hasSave, this.note);
      return true;
    }
    drawSky(fb, this.t);
    drawGarden(fb, this.garden, this.t);
    if (blooms(this.garden) > 0) drawButterfly(fb, this.t);
    drawHud(fb, this.garden);
    if (this.mode === 'play') drawCursor(fb, this.garden, this.t);
    if (this.celebrateAge >= 0) drawCelebration(fb, this.petals, this.t, this.celebrateAge);
    if (this.mode === 'menu') this.menu.draw(fb, THEME, this.t);
    if (this.mode === 'help') drawHelp(fb, THEME, 'HOW TO GROW', HELP_LINES);
    if (this.mode === 'confirm') this.confirm.draw(fb, THEME);
    return true;
  }

  pause(): void {
    if (this.mode === 'play') {
      this.menu.open();
      this.mode = 'menu';
      this.version++;
    }
    this.saveNow();
  }

  private saveNow(): void {
    this.slot.save(this.garden);
    this.hasSave = true;
    this.dirty = false;
    this.sinceSave = 0;
  }

  save(): void {
    if (this.mode !== 'title' || this.dirty) this.saveNow();
  }

  dispose(): void {
    this.petals = [];
  }

  inspect(): Record<string, unknown> {
    const g = this.garden;
    return {
      mode: this.mode,
      cursor: [g.cx, g.cy],
      tool: g.tool,
      seed: g.seed,
      blooms: blooms(g),
      celebrated: g.celebrated,
      time: Math.round(g.time * 100) / 100,
      stages: g.plots.map((p) => p.stage).join(''),
      wet: g.plots.filter((p) => p.moisture > 0).length,
    };
  }

  /** Test/debug hook. */
  get state(): Garden {
    return this.garden;
  }
}
