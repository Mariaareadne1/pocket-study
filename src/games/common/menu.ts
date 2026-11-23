/** Shared on-screen menu, confirm and help panels, drawn into the framebuffer. */
import type { Color, Framebuffer } from '@/runtime/framebuffer';
import { text, textWidth, wrap } from '@/runtime/font';
import type { Pad } from '@/runtime/input';
import type { SfxName } from '@/runtime/sfx';

export interface Theme {
  panel: Color;
  edge: Color;
  ink: Color;
  dim: Color;
  accent: Color;
  scrim: Color;
}

export interface MenuItem {
  id: string;
  label: string | (() => string);
}

export type MenuResult = { kind: 'none' } | { kind: 'select'; id: string } | { kind: 'back' };

const NONE: MenuResult = { kind: 'none' };

export class Menu {
  index = 0;
  constructor(
    readonly title: string,
    private readonly items: readonly MenuItem[],
  ) {}

  open(): void {
    this.index = 0;
  }

  get current(): string {
    return this.items[this.index].id;
  }

  update(pad: Pad, sfx: (n: SfxName) => void): MenuResult {
    if (pad.repeat('down')) {
      this.index = (this.index + 1) % this.items.length;
      sfx('menuMove');
    } else if (pad.repeat('up')) {
      this.index = (this.index - 1 + this.items.length) % this.items.length;
      sfx('menuMove');
    } else if (pad.pressed('a')) {
      sfx('menuSelect');
      return { kind: 'select', id: this.items[this.index].id };
    } else if (pad.pressed('b') || pad.pressed('start')) {
      sfx('menuBack');
      return { kind: 'back' };
    }
    return NONE;
  }

  draw(fb: Framebuffer, th: Theme, t: number): void {
    fb.shade(0, 0, fb.width, fb.height, th.scrim, 0.55);
    const labels = this.items.map((i) => (typeof i.label === 'string' ? i.label : i.label()));
    const w = Math.max(textWidth(this.title), ...labels.map((l) => textWidth(l) + 10)) + 16;
    const h = 22 + labels.length * 11;
    const x = Math.round((fb.width - w) / 2);
    const y = Math.round((fb.height - h) / 2);
    fb.panel(x, y, w, h, th.panel, th.edge);
    text(fb, this.title, x + w / 2, y + 5, th.dim, { align: 'center' });
    fb.rect(x + 6, y + 14, w - 12, 1, th.edge);
    labels.forEach((l, i) => {
      const ly = y + 19 + i * 11;
      const on = i === this.index;
      if (on) {
        fb.rect(x + 4, ly - 2, w - 8, 11, th.accent);
        text(fb, '>', x + 7 + (Math.floor(t * 2.5) % 2), ly, th.panel);
      }
      text(fb, l, x + 14, ly, on ? th.panel : th.ink);
    });
  }
}

/** Yes/No confirmation for destructive actions. Defaults to No. */
export class Confirm {
  private yes = false;
  constructor(private readonly message: string) {}

  open(): void {
    this.yes = false;
  }

  /** Returns true (confirmed), false (cancelled) or null (still open). */
  update(pad: Pad, sfx: (n: SfxName) => void): boolean | null {
    if (pad.pressed('left') || pad.pressed('right') || pad.pressed('up') || pad.pressed('down')) {
      this.yes = !this.yes;
      sfx('menuMove');
    }
    if (pad.pressed('a')) {
      sfx(this.yes ? 'menuSelect' : 'menuBack');
      return this.yes;
    }
    if (pad.pressed('b') || pad.pressed('start')) {
      sfx('menuBack');
      return false;
    }
    return null;
  }

  draw(fb: Framebuffer, th: Theme): void {
    fb.shade(0, 0, fb.width, fb.height, th.scrim, 0.6);
    const lines = wrap(this.message, 20);
    const w = 132;
    const h = 30 + lines.length * 9;
    const x = (fb.width - w) / 2;
    const y = (fb.height - h) / 2;
    fb.panel(x, y, w, h, th.panel, th.edge);
    lines.forEach((l, i) => text(fb, l, fb.width / 2, y + 6 + i * 9, th.ink, { align: 'center' }));
    const by = y + h - 14;
    const opt = (label: string, cx: number, on: boolean): void => {
      if (on) fb.rect(cx - 18, by - 2, 36, 11, th.accent);
      text(fb, label, cx, by, on ? th.panel : th.dim, { align: 'center' });
    };
    opt('NO', fb.width / 2 - 26, !this.yes);
    opt('YES', fb.width / 2 + 26, this.yes);
  }
}

/** Static help page; any button closes it. */
export function drawHelp(fb: Framebuffer, th: Theme, title: string, lines: readonly string[]): void {
  fb.shade(0, 0, fb.width, fb.height, th.scrim, 0.6);
  const x = 8;
  const y = 10;
  const w = fb.width - 16;
  const h = fb.height - 20;
  fb.panel(x, y, w, h, th.panel, th.edge);
  text(fb, title, fb.width / 2, y + 6, th.dim, { align: 'center' });
  fb.rect(x + 6, y + 16, w - 12, 1, th.edge);
  lines.forEach((l, i) => text(fb, l, x + 7, y + 22 + i * 10, th.ink));
  text(fb, 'ANY BUTTON: BACK', fb.width / 2, y + h - 11, th.dim, { align: 'center' });
}

export const anyPressed = (pad: Pad): boolean =>
  pad.pressed('a') || pad.pressed('b') || pad.pressed('start') || pad.pressed('select');
