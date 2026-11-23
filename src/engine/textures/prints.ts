/**
 * Printed markings on the object, drawn once into canvases. All lettering is original; no
 * manufacturer marks. `fonts.*` are CSS font-family strings the page has loaded.
 */
import * as THREE from 'three';

export interface Fonts {
  mono: string;
  serif: string;
  sans: string;
}

export const DEFAULT_FONTS: Fonts = {
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
};

/** px per mm: fine enough for 1.2 mm type to stay crisp in close shots. */
export const PX = 20;

export function mmCanvas(wMm: number, hMm: number, scale = PX): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.round(wMm * scale);
  c.height = Math.round(hMm * scale);
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  g.scale(scale, scale);
  return { c, g };
}

export function toTexture(c: HTMLCanvasElement, renderer?: THREE.WebGLRenderer, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer?.capabilities.getMaxAnisotropy() ?? 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

export function tracked(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number, align: 'left' | 'center' | 'right' = 'left'): void {
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * (chars.length - 1);
  let cx = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
  const prev = g.textAlign;
  g.textAlign = 'left';
  chars.forEach((ch, i) => {
    g.fillText(ch, cx, y);
    cx += widths[i] + track;
  });
  g.textAlign = prev;
}

/**
 * Printing on the graphite bezel (68 × 62 mm, centred on the bezel). Light ink on dark.
 * The bezel's local origin is its centre; the screen window is cut out by geometry.
 */
export function bezelPrint(fonts: Fonts, w: number, h: number, windowCy: number, windowH: number): HTMLCanvasElement {
  const { c, g } = mmCanvas(w, h);
  g.fillStyle = 'rgba(226, 222, 236, 0.86)';
  g.textBaseline = 'middle';
  // Under the window.
  const below = h / 2 - (windowCy - windowH / 2) + 4.2;
  g.font = `500 3.1px ${fonts.serif}`;
  tracked(g, 'Pocket Study', w / 2, below, 0.25, 'center');
  g.font = `600 1.25px ${fonts.mono}`;
  g.fillStyle = 'rgba(226, 222, 236, 0.55)';
  tracked(g, 'OBJECT STUDY / 002', w / 2, below + 3.2, 0.42, 'center');
  // Fine rules either side of the window top.
  g.fillRect(4, 4.2, 18, 0.16);
  g.fillRect(w - 22, 4.2, 18, 0.16);
  g.font = `600 1.1px ${fonts.mono}`;
  tracked(g, 'COLOUR LCD  160 × 144', w - 4, 2.7, 0.24, 'right');
  tracked(g, 'POWER', 6.8, 2.7, 0.3, 'left');
  return c;
}

/** Face printing on the front sheet (88 × 144 mm, whole face). Dark ink on clear. */
export function facePrint(
  fonts: Fonts,
  at: { a: [number, number]; b: [number, number]; start: [number, number]; select: [number, number]; dpad: [number, number] },
): HTMLCanvasElement {
  const W = 88;
  const H = 144;
  const { c, g } = mmCanvas(W, H, 12);
  const toC = ([x, y]: [number, number]): [number, number] => [x + W / 2, H / 2 - y];
  g.fillStyle = 'rgba(40, 34, 58, 0.82)';
  g.textBaseline = 'middle';
  g.font = `700 2.6px ${fonts.sans}`;
  const [ax, ay] = toC(at.a);
  const [bx, by] = toC(at.b);
  tracked(g, 'A', ax + 1.0, ay + 9.0, 0, 'center');
  tracked(g, 'B', bx + 1.0, by + 9.0, 0, 'center');
  g.font = `600 1.7px ${fonts.mono}`;
  for (const [label, p] of [
    ['SELECT', at.select],
    ['START', at.start],
  ] as const) {
    const [x, y] = toC(p);
    tracked(g, label, x, y + 4.4, 0.36, 'center');
  }
  // Tiny direction ticks round the pad.
  const [dx, dy] = toC(at.dpad);
  g.fillStyle = 'rgba(40, 34, 58, 0.5)';
  for (const [ox, oy, w, h] of [
    [0, -15.6, 0.3, 1.4],
    [0, 15.6, 0.3, 1.4],
    [-15.6, 0, 1.4, 0.3],
    [15.6, 0, 1.4, 0.3],
  ]) {
    g.fillRect(dx + ox - w / 2, dy + oy - h / 2, w, h);
  }
  // Speaker-side wordmark, very quiet.
  g.font = `600 1.4px ${fonts.mono}`;
  g.fillStyle = 'rgba(40, 34, 58, 0.42)';
  tracked(g, 'PS-002', W / 2, H - 4.5, 0.5, 'center');
  return c;
}

/** OFF / ON printed on the top edge beside the switch (14 × 4 mm). */
export function switchPrint(fonts: Fonts): HTMLCanvasElement {
  const { c, g } = mmCanvas(18, 4);
  g.fillStyle = 'rgba(40, 34, 58, 0.8)';
  g.textBaseline = 'middle';
  g.font = `700 1.5px ${fonts.mono}`;
  tracked(g, 'OFF', 1.0, 2, 0.2, 'left');
  tracked(g, 'ON', 17, 2, 0.2, 'right');
  return c;
}

/** Back printing (70 × 46 mm on the battery cover). */
export function backPrint(fonts: Fonts): HTMLCanvasElement {
  const W = 70;
  const H = 46;
  const { c, g } = mmCanvas(W, H);
  g.fillStyle = 'rgba(40, 34, 58, 0.78)';
  g.textBaseline = 'middle';
  g.font = `500 3.4px ${fonts.serif}`;
  tracked(g, 'Pocket Study', W / 2, 7, 0.2, 'center');
  g.font = `600 1.5px ${fonts.mono}`;
  const lines = ['MODEL PS-002', 'OBJECT STUDY / 002', '3.7 V  1000 mAh  LI-PO', 'CLEAR POLYCARBONATE · LAVENDER 04', 'DESIGNED AS A STUDY · NOT FOR SALE'];
  lines.forEach((l, i) => tracked(g, l, W / 2, 12.5 + i * 2.6, 0.3, 'center'));
  g.fillRect(W / 2 - 12, 27.8, 24, 0.15);
  g.font = `600 1.25px ${fonts.mono}`;
  tracked(g, 'CARTRIDGE ↑  INSERT LABEL OUT', W / 2, 31, 0.3, 'center');
  return c;
}
