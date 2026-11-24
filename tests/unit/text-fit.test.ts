/**
 * The console font is proportional and wider than a 5 × 7 font, so every string a game draws is
 * checked here: it must stay on the 160 × 144 screen, and text that starts inside a panel (menus,
 * help pages, dialogs) must end inside it. Each game is driven by seeded random button presses for
 * long enough to reach its title, play, menus, help pages, confirmations and game over.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CART_IDS, type CartId } from '@/device/machine';
import { createGame } from '@/games/registry';
import { drawBoot, drawNoCart } from '@/runtime/boot';
import * as font from '@/runtime/font';
import { Framebuffer, SCREEN_H, SCREEN_W } from '@/runtime/framebuffer';
import { ACTIONS, type Action } from '@/runtime/input';
import { Rng } from '@/runtime/rng';
import { Driver, host } from './helpers';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Draw order within the frame: text only belongs to a panel drawn before it. */
  seq: number;
}
interface Drawn extends Box {
  s: string;
  where: string;
}

let drawn: Drawn[] = [];
let panels: Box[] = [];
let where = '';
let seq = 0;

vi.mock('@/runtime/font', async (load) => {
  const real = await load<typeof import('@/runtime/font')>();
  return {
    ...real,
    text: (fb: Framebuffer, s: string, x: number, y: number, c: number, opts: import('@/runtime/font').TextOpts = {}) => {
      const scale = opts.scale ?? 1;
      const w = real.textWidth(s) * scale;
      const ox = opts.align === 'center' ? Math.round(x - w / 2) : opts.align === 'right' ? Math.round(x - w) : Math.round(x);
      if (s.trim()) drawn.push({ s, x: ox, y: Math.round(y), w, h: real.GLYPH_H * scale, where, seq: seq++ });
      return real.text(fb, s, x, y, c, opts);
    },
  };
});

const realPanel = Framebuffer.prototype.panel;
vi.spyOn(Framebuffer.prototype, 'panel').mockImplementation(function (this: Framebuffer, x, y, w, h, fill, edge) {
  panels.push({ x, y, w, h, seq: seq++ });
  return realPanel.call(this, x, y, w, h, fill, edge);
});

afterEach(() => {
  drawn = [];
  panels = [];
});

type Rect = Omit<Box, 'seq'>;
const inside = (b: Rect, o: Rect, slack = 0): boolean => b.x >= o.x - slack && b.y >= o.y - slack && b.x + b.w <= o.x + o.w + slack && b.y + b.h <= o.y + o.h + slack;
const startsIn = (b: Rect, o: Rect): boolean => b.x >= o.x && b.x < o.x + o.w && b.y >= o.y && b.y < o.y + o.h;

/** Problems with the text drawn in one frame, given the panels drawn in that frame. */
function problems(frame: Drawn[], framePanels: Box[]): string[] {
  const screen = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };
  const out: string[] = [];
  for (const t of frame) {
    if (!inside(t, screen)) out.push(`off screen: "${t.s}" at ${t.x},${t.y} (${t.w} px) in ${t.where}`);
    const panel = framePanels.filter((p) => p.seq < t.seq && startsIn(t, p)).at(-1);
    if (panel && !inside(t, panel, -1)) out.push(`outside its panel: "${t.s}" at ${t.x},${t.y} (${t.w} px) in ${t.where}`);
  }
  return out;
}

function drawFrame(d: Driver, label: string): string[] {
  where = label;
  drawn = [];
  panels = [];
  d.draw();
  return problems(drawn, panels);
}

const BUTTON_WEIGHTS: readonly Action[] = [...ACTIONS, 'a', 'a', 'down', 'down', 'start', 'select', 'b'];

function explore(id: CartId, seed: number, frames: number): string[] {
  const d = new Driver(createGame(id, host()));
  const rng = new Rng(seed);
  const issues = new Set<string>();
  const check = (): void => drawFrame(d, `${id} (${d.game.phase})`).forEach((p) => issues.add(p));
  check();
  for (let f = 0; f < frames; f += 6) {
    const a = BUTTON_WEIGHTS[Math.floor(rng.next() * BUTTON_WEIGHTS.length)];
    if (rng.next() < 0.5) d.tap(a);
    else d.step(5);
    check();
  }
  return [...issues];
}

describe('console text fits the screen', () => {
  it.each(CART_IDS)('%s: every string stays on screen and inside its panel', (id) => {
    const issues = [1, 2, 3, 4].flatMap((seed) => explore(id, seed, 60 * 90));
    expect(issues).toEqual([]);
  });

  it('boot and no-cartridge screens fit for every cartridge', () => {
    const fb = new Framebuffer();
    const issues: string[] = [];
    for (const id of [...CART_IDS, null]) {
      for (let t = 0; t < 4; t += 0.1) {
        where = `boot ${id ?? 'none'} t=${t.toFixed(1)}`;
        drawn = [];
        panels = [];
        drawBoot(fb, t, id);
        issues.push(...problems(drawn, panels));
      }
    }
    where = 'no cartridge';
    drawn = [];
    drawNoCart(fb, 1);
    issues.push(...problems(drawn, []));
    expect([...new Set(issues)]).toEqual([]);
  });

  it('wraps by pixel width, not character count', () => {
    const lines = font.wrap('MMMM MMMM IIII IIII', 60);
    expect(lines.every((l) => font.textWidth(l) <= 60)).toBe(true);
    expect(lines).toEqual(['MMMM', 'MMMM IIII', 'IIII']);
  });
});
