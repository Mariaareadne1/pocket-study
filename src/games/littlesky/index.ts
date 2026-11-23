/** LITTLE SKY cartridge: the editor, its menu, undo, save and PNG export. */
import type { GamePhase } from '@/device/machine';
import { Framebuffer } from '@/runtime/framebuffer';
import type { Pad } from '@/runtime/input';
import type { SfxName } from '@/runtime/sfx';
import { Slot } from '@/runtime/storage';
import type { Game, GameHost } from '@/runtime/types';
import { Confirm, Menu, anyPressed, drawHelp } from '../common/menu';
import {
  BRUSH,
  CANVAS,
  History,
  type Kind,
  SAVE_KEY,
  SAVE_VERSION,
  type SavedSky,
  type Sky,
  TOOLS,
  type Tool,
  VARIANTS,
  clampX,
  clampY,
  clearSky,
  demoSky,
  deserialize,
  emptySky,
  erase,
  isEmpty,
  nextTheme,
  painted,
  paintLine,
  place,
  serialize,
  validateSaved,
} from './logic';
import { HELP_LINES, MENU_THEME, THEME_LABEL, drawCursor, drawTitle, drawToast, drawToolbar, renderSky } from './view';

type Mode = 'title' | 'edit' | 'menu' | 'help' | 'confirm';

const PLACE_SOUND: Record<Kind, SfxName> = { star: 'place', cloud: 'puff', moon: 'glow', bird: 'chirp', glow: 'glow' };

export class LittleSkyGame implements Game {
  readonly id = 'littlesky' as const;
  private mode: Mode = 'title';
  private sky: Sky;
  private readonly history = new History();
  private readonly slot: Slot<SavedSky>;
  private hasSave: boolean;
  private tool: Tool = 'star';
  private brush = 1;
  private variant = 0;
  private cx = 80;
  private cy = 60;
  private lastBrush: [number, number] | null = null;
  private t = 0;
  private toast: { msg: string; age: number } | null = null;
  private exports = 0;
  private readonly menu: Menu;
  private readonly confirm = new Confirm('CLEAR THE WHOLE SKY? (UNDO CAN BRING IT BACK)');

  constructor(private readonly host: GameHost) {
    this.slot = new Slot(host.store, SAVE_KEY, SAVE_VERSION, validateSaved);
    const loaded = this.slot.load();
    if (host.demo) {
      this.sky = demoSky();
      this.hasSave = true;
    } else if (loaded.value) {
      this.sky = deserialize(loaded.value);
      this.hasSave = true;
    } else {
      this.sky = emptySky('dusk');
      this.hasSave = false;
      if (loaded.status === 'corrupt') this.say('OLD SKY UNREADABLE');
    }
    this.menu = new Menu('LITTLE SKY', [
      { id: 'resume', label: 'RESUME' },
      { id: 'undo', label: () => `UNDO (${this.history.size})` },
      { id: 'theme', label: () => `SKY: ${THEME_LABEL[this.sky.theme]}` },
      { id: 'color', label: 'BRUSH COLOUR' },
      { id: 'save', label: 'SAVE' },
      { id: 'export', label: 'EXPORT PNG' },
      { id: 'clear', label: 'CLEAR SKY' },
      { id: 'help', label: 'HELP' },
    ]);
  }

  get phase(): GamePhase {
    return this.mode === 'title' ? 'title' : this.mode === 'edit' ? 'playing' : 'paused';
  }

  private sfx(n: SfxName): void {
    this.host.sfx(n);
  }

  private say(msg: string): void {
    this.toast = { msg, age: 0 };
  }

  private commit(next: Sky): boolean {
    if (next === this.sky) return false;
    this.history.push(this.sky);
    this.sky = next;
    return true;
  }

  update(pad: Pad, dt: number): void {
    this.t += dt;
    if (this.toast) this.toast = { ...this.toast, age: this.toast.age + dt };
    const sfx = (n: SfxName): void => this.sfx(n);
    switch (this.mode) {
      case 'title':
        if (pad.pressed('start') || pad.pressed('a')) {
          sfx('start');
          this.mode = 'edit';
        }
        return;
      case 'help':
        if (anyPressed(pad)) {
          sfx('menuBack');
          this.mode = 'menu';
        }
        return;
      case 'confirm': {
        const r = this.confirm.update(pad, sfx);
        if (r === true) {
          this.commit(clearSky(this.sky));
          sfx('clear');
          this.mode = 'edit';
        } else if (r === false) this.mode = 'menu';
        return;
      }
      case 'menu':
        this.menuStep(pad);
        return;
      case 'edit':
        this.edit(pad);
    }
  }

  private menuStep(pad: Pad): void {
    const r = this.menu.update(pad, (n) => this.sfx(n));
    if (r.kind === 'back') {
      this.mode = 'edit';
      return;
    }
    if (r.kind !== 'select') return;
    switch (r.id) {
      case 'resume':
        this.mode = 'edit';
        break;
      case 'undo':
        this.undo();
        break;
      case 'theme':
        this.commit(nextTheme(this.sky));
        break;
      case 'color':
        this.brush = (this.brush % BRUSH.length) + 1;
        this.tool = 'brush';
        break;
      case 'save':
        this.saveNow();
        this.say('SKY SAVED');
        break;
      case 'export':
        this.exportNow();
        break;
      case 'clear':
        this.confirm.open();
        this.mode = 'confirm';
        break;
      case 'help':
        this.mode = 'help';
        break;
    }
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) {
      this.sfx('deny');
      this.say('NOTHING TO UNDO');
      return;
    }
    this.sky = prev;
    this.sfx('undo');
  }

  private edit(pad: Pad): void {
    if (pad.pressed('start')) {
      this.sfx('menuSelect');
      this.menu.open();
      this.mode = 'menu';
      return;
    }
    const stepFor = (a: 'left' | 'right' | 'up' | 'down'): number => (pad.repeat(a) ? (pad.heldTime(a) > 1.2 ? 3 : pad.heldTime(a) > 0.6 ? 2 : 1) : 0);
    const px = this.cx;
    const py = this.cy;
    this.cx = clampX(this.cx + stepFor('right') - stepFor('left'));
    this.cy = clampY(this.cy + stepFor('down') - stepFor('up'));

    if (pad.pressed('select')) {
      this.tool = TOOLS[(TOOLS.indexOf(this.tool) + 1) % TOOLS.length];
      this.variant = 0;
      this.sfx('tool');
    }

    if (this.tool === 'brush') {
      if (pad.pressed('a')) {
        this.history.push(this.sky);
        this.lastBrush = [this.cx, this.cy];
        this.sfx('brush');
      }
      if (pad.held('a') && this.lastBrush) {
        this.sky = paintLine(this.sky, this.lastBrush[0], this.lastBrush[1], this.cx, this.cy, this.brush);
        if (this.cx !== px || this.cy !== py) this.sfx('brush');
        this.lastBrush = [this.cx, this.cy];
      } else this.lastBrush = null;
    } else if (pad.pressed('a')) {
      const kind = this.tool;
      const before = this.sky;
      this.commit(place(this.sky, kind, this.cx, this.cy, this.variant));
      if (this.sky === before) {
        this.sfx('deny');
        this.say('THE SKY IS FULL');
      } else this.sfx(PLACE_SOUND[kind]);
      this.variant = (this.variant + 1) % VARIANTS[kind];
    }

    if (pad.pressed('b')) {
      const r = erase(this.sky, this.cx, this.cy, this.t);
      if (this.commit(r.sky)) this.sfx('erase');
      else this.sfx('deny');
    } else if (pad.held('b') && (this.cx !== px || this.cy !== py)) {
      this.sky = erase(this.sky, this.cx, this.cy, this.t).sky;
    }
  }

  /** Renders the composition alone (no cursor, no toolbar) and hands it to the host. */
  private exportNow(): void {
    const out = new Framebuffer(CANVAS.w, CANVAS.h);
    renderSky(out, this.sky, this.t);
    this.host.exportImage(out, `little-sky-${String(++this.exports).padStart(2, '0')}.png`);
    this.sfx('shutter');
    this.say('PNG EXPORTED');
  }

  draw(fb: Framebuffer): boolean {
    if (this.mode === 'title') {
      drawTitle(fb, this.sky, this.t, this.hasSave);
      return true;
    }
    renderSky(fb, this.sky, this.t);
    drawToolbar(fb, this.tool, this.brush, this.sky);
    if (this.mode === 'edit') drawCursor(fb, this.cx, this.cy, this.tool, this.t);
    if (this.mode === 'menu') this.menu.draw(fb, MENU_THEME, this.t);
    if (this.mode === 'help') drawHelp(fb, MENU_THEME, 'LITTLE SKY', HELP_LINES);
    if (this.mode === 'confirm') this.confirm.draw(fb, MENU_THEME);
    if (this.toast) drawToast(fb, this.toast.msg, this.toast.age);
    return true;
  }

  pause(): void {
    if (this.mode === 'edit') {
      this.menu.open();
      this.mode = 'menu';
    }
  }

  private saveNow(): void {
    this.slot.save(serialize(this.sky));
    this.hasSave = true;
  }

  save(): void {
    if (this.mode !== 'title' || !isEmpty(this.sky)) this.saveNow();
  }

  dispose(): void {
    this.history.clear();
  }

  inspect(): Record<string, unknown> {
    return {
      mode: this.mode,
      tool: this.tool,
      cursor: [this.cx, this.cy],
      theme: this.sky.theme,
      elements: this.sky.elements.length,
      kinds: this.sky.elements.map((e) => e.kind).join(','),
      painted: painted(this.sky),
      undo: this.history.size,
      brush: this.brush,
      exports: this.exports,
    };
  }

  get state(): Sky {
    return this.sky;
  }
}
