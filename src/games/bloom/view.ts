/** BLOOM pixel art and screen layout (160×144). */
import { type Color, type Framebuffer, type Sprite, sprite } from '@/runtime/framebuffer';
import { text } from '@/runtime/font';
import type { Theme } from '../common/menu';
import { COLS, GOAL, type Garden, type Plot, ROWS, type Seed, Stage, type Tool, blooms } from './logic';

export const TILE = 16;
export const GX = 8;
export const GY = 27;

export const C = {
  sky0: 0x8ec3ec,
  sky1: 0xd3ebf8,
  hill0: 0xa9d49a,
  hill1: 0x93c584,
  post: 0xf4eee2,
  postShade: 0xd5c8b2,
  grass: 0x84c06e,
  grassDark: 0x6baa5d,
  grassLight: 0xa2d488,
  soil: 0xd1a877,
  soilEdge: 0xb48a5c,
  wet: 0x8a6342,
  wetEdge: 0x6c4a31,
  seedDot: 0x5b3f2a,
  cloud: 0xffffff,
  ui: 0xf3efe6,
  uiEdge: 0xd8d0c2,
  ink: 0x3a3e46,
  dim: 0x8a8778,
  accent: 0x6e8fc9,
  cursor: 0xffffff,
  cursorEdge: 0x2e3440,
} as const;

export const THEME: Theme = { panel: C.ui, edge: C.uiEdge, ink: C.ink, dim: C.dim, accent: C.accent, scrim: 0x2c3a4a };

export const SEED_COLOR: Record<Seed, { p: Color; P: Color; c: Color }> = {
  daisy: { p: 0xffffff, P: 0xe3def0, c: 0xf2c14e },
  tulip: { p: 0xf2958a, P: 0xd9706b, c: 0xf6b3a8 },
  bell: { p: 0xb9a6ec, P: 0x917cd6, c: 0xd6cbf6 },
  sun: { p: 0xf6cf55, P: 0xe0ae3a, c: 0x8e5e3a },
};

export const SEED_LABEL: Record<Seed, string> = { daisy: 'DAISY', tulip: 'TULIP', bell: 'BELL', sun: 'SUNNY' };
export const TOOL_LABEL: Record<Tool, string> = { seed: 'PLANT', water: 'WATER', trowel: 'DIG UP' };

const STEM = { k: 0x3e8448, e: 0x5dae5a, E: 0x8acf6e };

const HEADS: Record<Seed, readonly string[]> = {
  daisy: ['...p.p...', '.pp.p.pp.', '..ppcpp..', '.ppcccpp.', '..ppcpp..', '.pp.p.pp.', '...p.p...'],
  tulip: ['.........', '..p.p.p..', '..ppPpp..', '..pPpPp..', '..ppppp..', '...ppp...', '....k....'],
  bell: ['.........', '...ppp...', '..ppPpp..', '..pPppp..', '.ppppppp.', '.P.P.P.P.', '....k....'],
  sun: ['..p.p.p..', '.ppppppp.', '..pcccp..', '.ppcccpp.', '..pcccp..', '.ppppppp.', '..p.p.p..'],
};
const STEM_ROWS = ['....k....', '..eek....', '....kee..', '....k....'];
const BUD_ROWS = ['.........', '....P....', '...PpP...', '...PpP...', '....k....', '...ek....', '..eek....', '....kee..', '....k....'];
const SPROUT_ROWS = ['.E...E.', 'EeE.EeE', '.eEkEe.', '...k...', '...k...'];

const cache = new Map<string, Sprite>();
const cached = (key: string, make: () => Sprite): Sprite => {
  let s = cache.get(key);
  if (!s) {
    s = make();
    cache.set(key, s);
  }
  return s;
};

export const flowerSprite = (seed: Seed): Sprite =>
  cached(`flower:${seed}`, () => sprite([...HEADS[seed], ...STEM_ROWS], { ...SEED_COLOR[seed], ...STEM }));
const budSprite = (seed: Seed): Sprite => cached(`bud:${seed}`, () => sprite(BUD_ROWS, { ...SEED_COLOR[seed], ...STEM }));
const sproutSprite = (): Sprite => cached('sprout', () => sprite(SPROUT_ROWS, STEM));

const ICONS = {
  water: sprite(['...bbb.....', '..b...b....', '.bbbbbbb..b', '.bBBBBBb.b.', '.bBBBBBbb..', '.bBBBBBb...', '.bbbbbbb...'], { b: 0x5a7fb8, B: 0x9cc0ec }),
  trowel: sprite(['......mm.', '.....mMm.', '....mMm..', '...mMm...', '..mmm....', '.ww......', 'ww.......'], { m: 0x8d96a3, M: 0xd7dce3, w: 0x9a6a3a }),
};
const packet = (seed: Seed): Sprite =>
  cached(`packet:${seed}`, () =>
    sprite(['.kkkkkkk.', '.kpppppk.', '.kpcpcpk.', '.kpppppk.', '.kpcpcpk.', '.kpppppk.', '.kkkkkkk.'], { k: 0x6c6a62, p: SEED_COLOR[seed].p, c: SEED_COLOR[seed].P }),
  );
const BUTTERFLY = [
  sprite(['pp.pp', 'ppkpp', '.pkp.'], { p: 0xffffff, k: 0x4a4a58 }),
  sprite(['.pkp.', '.pkp.', '..k..'], { p: 0xf1eefb, k: 0x4a4a58 }),
];
const CLOUD = sprite(['....wwww......', '..wwwwwwww....', '.wwwwwwwwwwww.', 'wwwwwwwwwwwwww'], { w: C.cloud });

export function drawSky(fb: Framebuffer, t: number): void {
  fb.gradient(0, GY - 1, [C.sky0, C.sky1], 6);
  const drift = (t * 3) % 200;
  fb.sprite(CLOUD, ((20 + drift) % 200) - 30, 4);
  fb.sprite(CLOUD, ((120 + drift * 0.7) % 200) - 30, 9);
  // Two soft hills behind the fence.
  for (let x = 0; x < fb.width; x++) {
    const h0 = Math.round(5 + 3 * Math.sin(x * 0.045 + 1));
    const h1 = Math.round(3 + 2 * Math.sin(x * 0.07 + 3));
    fb.rect(x, GY - 1 - h0, 1, h0, C.hill0);
    fb.rect(x, GY - 1 - h1, 1, h1, C.hill1);
  }
  // Fence.
  fb.rect(0, GY - 5, fb.width, 1, C.post);
  for (let x = 3; x < fb.width; x += 8) {
    fb.rect(x, GY - 8, 2, 7, C.post);
    fb.rect(x + 1, GY - 8, 1, 7, C.postShade);
  }
}

function drawPlot(fb: Framebuffer, p: Plot, x: number, y: number): void {
  const wet = p.moisture > 0;
  fb.rect(x + 2, y + 3, 12, 11, wet ? C.wet : C.soil);
  fb.rect(x + 2, y + 13, 12, 1, wet ? C.wetEdge : C.soilEdge);
  fb.rect(x + 2, y + 3, 1, 10, wet ? C.wetEdge : C.soilEdge);
  if (wet && p.moisture > 0.85) {
    fb.px(x + 5, y + 6, 0xb4cde8);
    fb.px(x + 10, y + 9, 0xb4cde8);
  }
}

function drawPlant(fb: Framebuffer, p: Plot, x: number, y: number, sway: number): void {
  if (p.stage === Stage.Empty || !p.seed) return;
  if (p.stage === Stage.Seed) {
    fb.px(x + 6, y + 8, C.seedDot);
    fb.px(x + 9, y + 7, C.seedDot);
    fb.px(x + 8, y + 10, C.seedDot);
    return;
  }
  if (p.stage === Stage.Sprout) return fb.sprite(sproutSprite(), x + 4, y + 6);
  if (p.stage === Stage.Bud) return fb.sprite(budSprite(p.seed), x + 3, y + 3);
  fb.sprite(flowerSprite(p.seed), x + 3 + sway, y - 1);
}

export function drawGarden(fb: Framebuffer, g: Garden, t: number): void {
  fb.rect(0, GY - 1, fb.width, ROWS * TILE + 3, C.grass);
  for (let i = 0; i < 40; i++) {
    const x = (i * 37) % fb.width;
    const y = GY + ((i * 53) % (ROWS * TILE));
    fb.px(x, y, C.grassLight);
    fb.px(x + 1, y + 1, C.grassDark);
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) drawPlot(fb, g.plots[r * COLS + c], GX + c * TILE, GY + r * TILE);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const sway = Math.sin(t * 2.2 + i * 1.7) > 0.6 ? 1 : 0;
      drawPlant(fb, g.plots[i], GX + c * TILE, GY + r * TILE, sway);
    }
}

export function drawCursor(fb: Framebuffer, g: Garden, t: number): void {
  const x = GX + g.cx * TILE;
  const y = GY + g.cy * TILE;
  const o = Math.floor(t * 4) % 2;
  const corner = (cx: number, cy: number, sx: number, sy: number): void => {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
    ]) {
      fb.px(cx + dx * sx, cy + dy * sy, C.cursor);
      fb.px(cx + dx * sx + sx, cy + dy * sy + sy, C.cursorEdge);
    }
  };
  corner(x - o, y - o, 1, 1);
  corner(x + 15 + o, y - o, -1, 1);
  corner(x - o, y + 15 + o, 1, -1);
  corner(x + 15 + o, y + 15 + o, -1, -1);
}

export function drawButterfly(fb: Framebuffer, t: number): void {
  const x = 80 + 58 * Math.sin(t * 0.31) * Math.cos(t * 0.13);
  const y = 70 + 32 * Math.sin(t * 0.47 + 1);
  fb.sprite(BUTTERFLY[Math.floor(t * 6) % 2], x, y);
}

export function drawHud(fb: Framebuffer, g: Garden): void {
  const n = blooms(g);
  fb.panel(fb.width - 46, 2, 44, 11, 0xf7f4ec, C.uiEdge);
  fb.sprite(flowerSprite('daisy'), fb.width - 46, 1);
  text(fb, `${Math.min(n, 99)}/${GOAL}`, fb.width - 5, 4, C.ink, { align: 'right' });
  // Toolbar.
  const y = GY + ROWS * TILE + 2;
  fb.rect(0, y, fb.width, fb.height - y, C.ui);
  fb.rect(0, y, fb.width, 1, C.uiEdge);
  const tools: Tool[] = ['seed', 'water', 'trowel'];
  tools.forEach((tool, i) => {
    const x = 4 + i * 17;
    const on = g.tool === tool;
    if (on) fb.panel(x - 2, y + 2, 16, 13, 0xffffff, C.accent);
    if (tool === 'seed') fb.sprite(packet(g.seed), x, y + 5);
    else fb.sprite(ICONS[tool], x + (tool === 'water' ? -1 : 1), y + 5);
  });
  text(fb, TOOL_LABEL[g.tool], 58, y + 1, C.ink);
  text(fb, g.tool === 'seed' ? SEED_LABEL[g.seed] : g.tool === 'water' ? 'SOIL' : 'PLANT', 58, y + 11, C.dim);
  text(fb, 'B:TOOL', fb.width - 4, y + 1, C.dim, { align: 'right' });
  text(fb, 'SEL:SEED', fb.width - 4, y + 11, C.dim, { align: 'right' });
}

export interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: Color;
  phase: number;
}

export function drawCelebration(fb: Framebuffer, petals: readonly Petal[], t: number, age: number): void {
  for (const p of petals) {
    const x = p.x + Math.sin(t * 2 + p.phase) * 3;
    fb.px(x, p.y, p.c);
    fb.px(x + 1, p.y, p.c);
  }
  if (age < 4.2) {
    const w = 132;
    const x = (fb.width - w) / 2;
    fb.panel(x, 50, w, 26, 0xfffdf7, C.uiEdge);
    text(fb, 'THE GARDEN', fb.width / 2, 55, C.ink, { align: 'center' });
    text(fb, 'IS IN BLOOM', fb.width / 2, 65, 0xd9706b, { align: 'center' });
  }
}

export function drawTitle(fb: Framebuffer, t: number, hasSave: boolean, note: string | null): void {
  fb.gradient(0, fb.height, [0xa7d2f1, 0xe9f5fb, 0xf6f1e6], 6);
  for (let x = 0; x < fb.width; x++) {
    const h = Math.round(18 + 4 * Math.sin(x * 0.05 + 0.5));
    fb.rect(x, fb.height - h, 1, h, C.grass);
  }
  const seeds: Seed[] = ['daisy', 'tulip', 'bell', 'sun', 'tulip', 'daisy', 'bell', 'sun'];
  seeds.forEach((s, i) => fb.sprite(flowerSprite(s), 10 + i * 18 + (Math.sin(t * 2 + i) > 0.7 ? 1 : 0), fb.height - 30));
  text(fb, 'BLOOM', fb.width / 2, 34, 0x3f6a4a, { align: 'center', scale: 3, shadow: 0xffffff });
  text(fb, 'A TINY GARDEN', fb.width / 2, 62, C.dim, { align: 'center' });
  if (Math.floor(t * 1.6) % 2 === 0) text(fb, hasSave ? 'START: CONTINUE' : 'START: NEW GARDEN', fb.width / 2, 82, C.ink, { align: 'center' });
  if (note) text(fb, note, fb.width / 2, 94, 0xb0574e, { align: 'center' });
}

export const HELP_LINES = [
  'D-PAD  MOVE',
  'A      USE TOOL',
  'B      NEXT TOOL',
  'SELECT NEXT SEED',
  '',
  'WATER KEEPS SOIL DAMP.',
  'PLANTS ONLY GROW WET.',
  `GROW ${GOAL} FLOWERS!`,
];
