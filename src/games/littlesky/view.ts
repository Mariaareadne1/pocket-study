/** LITTLE SKY rendering: the composition itself (also used for PNG export) and the editor UI. */
import { type Color, type Framebuffer, type Sprite, mix, sprite } from '@/runtime/framebuffer';
import { text } from '@/runtime/font';
import type { Theme as MenuTheme } from '../common/menu';
import { BRUSH, CANVAS, type Element, type Sky, type Theme, type Tool, positionAt } from './logic';

interface Look {
  sky: readonly Color[];
  hill: Color;
  hill2: Color;
  cloud: Color;
  cloudShade: Color;
  star: Color;
  bird: Color;
  glow: Color;
}

export const LOOKS: Record<Theme, Look> = {
  day: { sky: [0x7fb6ea, 0xb9dcf6, 0xeaf5fb], hill: 0x9ccf8e, hill2: 0x86bf7c, cloud: 0xffffff, cloudShade: 0xdbe9f6, star: 0xfff7d6, bird: 0x3b4a66, glow: 0xfff3b0 },
  dusk: { sky: [0x6a5fa8, 0xc49bc8, 0xf6c7a6], hill: 0x5e5486, hill2: 0x4b4472, cloud: 0xfbe3ea, cloudShade: 0xe0b6cf, star: 0xfff2c4, bird: 0x3e3360, glow: 0xffd9a0 },
  night: { sky: [0x0f1638, 0x252c63, 0x433f7d], hill: 0x1d1f45, hill2: 0x15173a, cloud: 0x5a5f9a, cloudShade: 0x454a83, star: 0xfff6d2, bird: 0xcfd3ff, glow: 0xbfd6ff },
};

export const THEME_LABEL: Record<Theme, string> = { day: 'DAY', dusk: 'DUSK', night: 'NIGHT' };
export const TOOL_LABEL: Record<Tool, string> = { star: 'STAR', cloud: 'CLOUD', moon: 'MOON', bird: 'BIRD', glow: 'GLOW', brush: 'BRUSH' };

export const UI = { bar: 0xf3efe6, edge: 0xd8d0c2, ink: 0x3a3e46, dim: 0x8a8778, accent: 0x8d7ad0 } as const;
export const MENU_THEME: MenuTheme = { panel: 0xf7f3ea, edge: 0xcfc4d8, ink: UI.ink, dim: UI.dim, accent: UI.accent, scrim: 0x2a2546 };

const cache = new Map<string, Sprite>();
const memo = (k: string, f: () => Sprite): Sprite => {
  let s = cache.get(k);
  if (!s) cache.set(k, (s = f()));
  return s;
};

const cloudSprite = (v: number, l: Look): Sprite =>
  memo(`cloud${v}${l.cloud}`, () =>
    v === 0
      ? sprite(['....wwww......', '..wwwwwwwww...', '.wwwwwwwwwwww.', 'ssssssssssssss'], { w: l.cloud, s: l.cloudShade })
      : sprite(
          ['.......wwww...........', '....wwwwwwwww.www.....', '..wwwwwwwwwwwwwwwww...', '.wwwwwwwwwwwwwwwwwwww.', 'wwwwwwwwwwwwwwwwwwwwww', '.sssssssssssssssssss..'],
          { w: l.cloud, s: l.cloudShade },
        ),
  );
const MOON = sprite(
  ['...mmmm....', '..mmmmm....', '.mmmmm.....', 'mmmmm......', 'mmmmm......', 'mmmmm......', 'mmmmmm.....', '.mmmmmm..m.', '.dmmmmmmmm.', '..ddmmmmm..', '....ddd....'],
  { m: 0xfff3c4, d: 0xe8d48e },
);
const birdSprite = (frame: number, l: Look): Sprite =>
  memo(`bird${frame}${l.bird}`, () => sprite(frame === 0 ? ['b.....b', '.b...b.', '..b.b..', '...b...'] : ['.......', 'bb...bb', '..bbb..', '...b...'], { b: l.bird }));

function drawStar(fb: Framebuffer, e: Element, x: number, y: number, t: number, l: Look): void {
  const tw = Math.sin(t * (2.2 + (e.id % 5) * 0.4) + e.id) > 0.55;
  if (e.v === 0) {
    fb.px(x, y, l.star);
    if (tw) {
      fb.px(x - 1, y, mix(l.star, 0x000000, 0.25));
      fb.px(x + 1, y, mix(l.star, 0x000000, 0.25));
    }
    return;
  }
  const arm = e.v === 1 ? 1 : tw ? 2 : 1;
  fb.px(x, y, 0xffffff);
  for (let k = 1; k <= arm; k++) {
    const c = k === 1 ? l.star : mix(l.star, l.sky[1], 0.4);
    fb.px(x - k, y, c);
    fb.px(x + k, y, c);
    fb.px(x, y - k, c);
    fb.px(x, y + k, c);
  }
  if (e.v === 2 && tw) {
    fb.px(x - 1, y - 1, l.star);
    fb.px(x + 1, y + 1, l.star);
    fb.px(x + 1, y - 1, l.star);
    fb.px(x - 1, y + 1, l.star);
  }
}

function drawGlow(fb: Framebuffer, x: number, y: number, t: number, id: number, l: Look): void {
  const pulse = 0.5 + 0.5 * Math.sin(t * 2 + id);
  for (let j = -3; j <= 3; j++)
    for (let i = -3; i <= 3; i++) {
      const d = Math.hypot(i, j);
      if (d > 3.2) continue;
      const a = Math.max(0, 1 - d / 3.4) * (0.55 + 0.35 * pulse);
      fb.px(x + i, y + j, mix(fb.get(x + i, y + j), l.glow, a));
    }
  fb.px(x, y, 0xffffff);
}

/** Renders the sky composition into a framebuffer at (0,0) — what you see is what exports. */
export function renderSky(fb: Framebuffer, sky: Sky, t: number): void {
  const l = LOOKS[sky.theme];
  fb.gradient(0, CANVAS.h, l.sky, 7);
  for (let x = 0; x < CANVAS.w; x++) {
    const h = Math.round(10 + 4 * Math.sin(x * 0.04 + 0.8) + 2 * Math.sin(x * 0.11));
    const h2 = Math.round(6 + 3 * Math.sin(x * 0.06 + 2.4));
    fb.rect(x, CANVAS.h - h, 1, h, l.hill);
    fb.rect(x, CANVAS.h - h2, 1, h2, l.hill2);
  }
  for (let y = 0; y < CANVAS.h; y++)
    for (let x = 0; x < CANVAS.w; x++) {
      const v = sky.paint[y * CANVAS.w + x];
      if (v) fb.px(x, y, BRUSH[v - 1]);
    }
  for (const e of sky.elements) {
    const p = positionAt(e, t);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    switch (e.kind) {
      case 'star':
        drawStar(fb, e, x, y, t, l);
        break;
      case 'cloud': {
        const s = cloudSprite(e.v, l);
        fb.sprite(s, x - Math.floor(s.w / 2), y - Math.floor(s.h / 2));
        break;
      }
      case 'moon':
        fb.sprite(MOON, x - 5, y - 5);
        break;
      case 'bird': {
        const s = birdSprite(Math.floor(t * 4 + e.id) % 2, l);
        fb.sprite(s, x - 3, y - 2 + (Math.sin(t * 2 + e.id) > 0 ? 0 : 1));
        break;
      }
      case 'glow':
        drawGlow(fb, x, y, t, e.id, l);
        break;
    }
  }
  fb.version++;
}

const TOOL_ICONS: Record<Tool, Sprite> = {
  star: sprite(['..y..', '..y..', 'yyWyy', '..y..', '..y..'], { y: 0xe0b24a, W: 0xfff0b0 }),
  cloud: sprite(['..ww....', '.wwwwww.', 'wwwwwwww', 'ssssssss'], { w: 0xffffff, s: 0xbcc8d8 }),
  moon: sprite(['.mmm.', 'mm...', 'mm...', 'mm..m', '.mmm.'], { m: 0xd8b84e }),
  bird: sprite(['b...b', '.b.b.', '..b..'], { b: 0x3b4a66 }),
  glow: sprite(['.g.', 'gWg', '.g.'], { g: 0xf0c060, W: 0xffffff }),
  brush: sprite(['....k', '...k.', '..k..', '.pp..', 'pp...'], { k: 0x8a6a4a, p: 0x8d7ad0 }),
};

export function drawToolbar(fb: Framebuffer, tool: Tool, brush: number, sky: Sky): void {
  const y = CANVAS.h;
  fb.rect(0, y, fb.width, fb.height - y, UI.bar);
  fb.rect(0, y, fb.width, 1, UI.edge);
  (Object.keys(TOOL_ICONS) as Tool[]).forEach((k, i) => {
    const x = 3 + i * 13;
    if (k === tool) fb.panel(x - 2, y + 2, 13, 12, 0xffffff, UI.accent);
    const s = TOOL_ICONS[k];
    fb.sprite(s, x + Math.floor((9 - s.w) / 2), y + 3 + Math.floor((9 - s.h) / 2));
  });
  fb.panel(84, y + 3, 9, 10, BRUSH[brush - 1], UI.edge);
  text(fb, TOOL_LABEL[tool], 97, y + 5, UI.ink);
  text(fb, THEME_LABEL[sky.theme], fb.width - 3, y + 5, UI.dim, { align: 'right' });
}

export function drawCursor(fb: Framebuffer, x: number, y: number, tool: Tool, t: number): void {
  const ink = Math.floor(t * 3) % 2 === 0 ? 0xffffff : 0xfff2c4;
  const edge = 0x2a2546;
  const gap = tool === 'brush' ? 1 : 2;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    for (let k = gap; k <= gap + 2; k++) {
      fb.px(x + dx * k + dy, y + dy * k + dx, edge);
      fb.px(x + dx * k, y + dy * k, ink);
    }
  }
  if (tool === 'brush') fb.px(x, y, ink);
}

export function drawToast(fb: Framebuffer, msg: string, age: number): void {
  if (age > 1.4) return;
  const w = msg.length * 6 + 10;
  fb.panel((fb.width - w) / 2, 4, w, 12, 0xfffdf7, UI.edge);
  text(fb, msg, fb.width / 2, 7, UI.ink, { align: 'center' });
}

export function drawTitle(fb: Framebuffer, sky: Sky, t: number, hasSave: boolean): void {
  renderSky(fb, sky, t);
  fb.rect(0, CANVAS.h, fb.width, fb.height - CANVAS.h, UI.bar);
  fb.panel(26, 40, 108, 40, 0xfffdf7, MENU_THEME.edge);
  text(fb, 'LITTLE SKY', fb.width / 2, 47, 0x5b4a9a, { align: 'center', scale: 1 });
  text(fb, 'A SKY MAKER', fb.width / 2, 58, UI.dim, { align: 'center' });
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, hasSave ? 'START: YOUR SKY' : 'START: NEW SKY', fb.width / 2, 68, UI.ink, { align: 'center' });
  text(fb, 'CARTRIDGE 03', fb.width / 2, CANVAS.h + 5, UI.dim, { align: 'center' });
}

export const HELP_LINES = ['D-PAD  MOVE CURSOR', 'A      PLACE / PAINT', 'B      ERASE', 'SELECT NEXT TOOL', 'START  MENU', '', 'HOLD A WITH THE BRUSH', 'TO DRAW LINES.'];
