/**
 * LITTLE SKY composition model — pure operations over an immutable sky: placed elements
 * (stars, clouds, moons, birds, glows) on top of a pixel paint layer and a theme gradient.
 * Every edit returns a new sky, which makes undo a plain stack of previous skies.
 */
import { isInt, isObj, type Validate } from '@/runtime/storage';

export const CANVAS = { w: 160, h: 128 } as const;
export const KINDS = ['star', 'cloud', 'moon', 'bird', 'glow'] as const;
export type Kind = (typeof KINDS)[number];
export const TOOLS = ['star', 'cloud', 'moon', 'bird', 'glow', 'brush'] as const;
export type Tool = (typeof TOOLS)[number];
export const THEMES = ['day', 'dusk', 'night'] as const;
export type Theme = (typeof THEMES)[number];
export const MAX_ELEMENTS = 160;
export const UNDO_LIMIT = 40;
export const CLOUD_SPEED = 2.2;

/** Brush colours; paint value 0 = unpainted, 1..8 = BRUSH[n-1]. */
export const BRUSH = [0xffffff, 0xfff1c9, 0xf6b49a, 0xe58fa6, 0xb39ae6, 0x8cc4ee, 0x6fc2b8, 0x2e3452] as const;

export interface Element {
  readonly id: number;
  readonly kind: Kind;
  readonly x: number;
  readonly y: number;
  /** Variant (size / style). */
  readonly v: number;
}

export interface Sky {
  readonly theme: Theme;
  readonly elements: readonly Element[];
  readonly paint: Uint8Array;
  readonly nextId: number;
}

export const VARIANTS: Record<Kind, number> = { star: 3, cloud: 2, moon: 1, bird: 1, glow: 1 };

/** Half extents of each element's hit box. */
export function extent(e: Pick<Element, 'kind' | 'v'>): { hw: number; hh: number } {
  switch (e.kind) {
    case 'star':
      return e.v === 0 ? { hw: 1, hh: 1 } : { hw: 2, hh: 2 };
    case 'cloud':
      return e.v === 0 ? { hw: 7, hh: 3 } : { hw: 11, hh: 4 };
    case 'moon':
      return { hw: 5, hh: 5 };
    case 'bird':
      return { hw: 3, hh: 2 };
    case 'glow':
      return { hw: 3, hh: 3 };
  }
}

export function emptySky(theme: Theme = 'dusk'): Sky {
  return { theme, elements: [], paint: new Uint8Array(CANVAS.w * CANVAS.h), nextId: 1 };
}

export const clampX = (x: number): number => Math.min(CANVAS.w - 1, Math.max(0, Math.round(x)));
export const clampY = (y: number): number => Math.min(CANVAS.h - 1, Math.max(0, Math.round(y)));

/** Where an element is drawn at time t (clouds drift and wrap). */
export function positionAt(e: Element, t: number): { x: number; y: number } {
  if (e.kind !== 'cloud') return { x: e.x, y: e.y };
  const { hw } = extent(e);
  const span = CANVAS.w + hw * 2;
  const speed = CLOUD_SPEED * (e.v === 0 ? 1.4 : 1);
  const x = (((e.x + hw + t * speed) % span) + span) % span - hw;
  return { x, y: e.y };
}

export function place(sky: Sky, kind: Kind, x: number, y: number, v = 0): Sky {
  if (sky.elements.length >= MAX_ELEMENTS) return sky;
  const el: Element = { id: sky.nextId, kind, x: clampX(x), y: clampY(y), v: Math.max(0, Math.min(VARIANTS[kind] - 1, v)) };
  return { ...sky, elements: [...sky.elements, el], nextId: sky.nextId + 1 };
}

/** Topmost element under a point at time t, or -1. */
export function elementAt(sky: Sky, x: number, y: number, t: number): number {
  for (let i = sky.elements.length - 1; i >= 0; i--) {
    const e = sky.elements[i];
    const p = positionAt(e, t);
    const { hw, hh } = extent(e);
    if (Math.abs(x - p.x) <= hw + 1 && Math.abs(y - p.y) <= hh + 1) return i;
  }
  return -1;
}

export function paintAt(sky: Sky, x: number, y: number, color: number, size = 1): Sky {
  const px = clampX(x);
  const py = clampY(y);
  const r = Math.floor(size / 2);
  let changed = false;
  for (let j = py - r; j <= py + r; j++)
    for (let i = px - r; i <= px + r; i++) {
      if (i < 0 || j < 0 || i >= CANVAS.w || j >= CANVAS.h) continue;
      if (sky.paint[j * CANVAS.w + i] !== color) changed = true;
    }
  if (!changed) return sky;
  const paint = sky.paint.slice();
  for (let j = py - r; j <= py + r; j++)
    for (let i = px - r; i <= px + r; i++) {
      if (i < 0 || j < 0 || i >= CANVAS.w || j >= CANVAS.h) continue;
      paint[j * CANVAS.w + i] = color;
    }
  return { ...sky, paint };
}

/** Paints every pixel on the segment (x0,y0)→(x1,y1). */
export function paintLine(sky: Sky, x0: number, y0: number, x1: number, y1: number, color: number, size = 1): Sky {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  let s = sky;
  for (let k = 0; k <= n; k++) s = paintAt(s, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, color, size);
  return s;
}

/** Erases the topmost element under the point; if there is none, clears a 3×3 patch of paint. */
export function erase(sky: Sky, x: number, y: number, t: number): { sky: Sky; removed: Element | null } {
  const i = elementAt(sky, x, y, t);
  if (i >= 0) return { sky: { ...sky, elements: sky.elements.filter((_, k) => k !== i) }, removed: sky.elements[i] };
  return { sky: paintAt(sky, x, y, 0, 3), removed: null };
}

export const clearSky = (sky: Sky): Sky => emptySky(sky.theme);

export const nextTheme = (sky: Sky): Sky => ({ ...sky, theme: THEMES[(THEMES.indexOf(sky.theme) + 1) % THEMES.length] });

export const painted = (sky: Sky): number => sky.paint.reduce((n, v) => n + (v ? 1 : 0), 0);

export const isEmpty = (sky: Sky): boolean => sky.elements.length === 0 && painted(sky) === 0;

/** Bounded undo stack. */
export class History {
  private stack: Sky[] = [];

  push(sky: Sky): void {
    this.stack = [...this.stack.slice(-(UNDO_LIMIT - 1)), sky];
  }

  pop(): Sky | null {
    const last = this.stack.at(-1) ?? null;
    this.stack = this.stack.slice(0, -1);
    return last;
  }

  get size(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack = [];
  }
}

// ── persistence ──

export const SAVE_KEY = 'littlesky';
export const SAVE_VERSION = 1;

export interface SavedSky {
  theme: Theme;
  elements: Element[];
  paint: string;
  nextId: number;
}

const toB64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};

export const serialize = (sky: Sky): SavedSky => ({ theme: sky.theme, elements: [...sky.elements], paint: toB64(sky.paint), nextId: sky.nextId });

export function deserialize(d: SavedSky): Sky {
  return { theme: d.theme, elements: d.elements, paint: fromB64(d.paint), nextId: d.nextId };
}

export const validateSaved: Validate<SavedSky> = (d) => {
  if (!isObj(d) || !(THEMES as readonly unknown[]).includes(d.theme) || !Array.isArray(d.elements) || typeof d.paint !== 'string') return null;
  const elements: Element[] = [];
  for (const e of d.elements) {
    if (!isObj(e) || !(KINDS as readonly unknown[]).includes(e.kind) || !isInt(e.id, 1, 1e9)) return null;
    if (!isInt(e.x, 0, CANVAS.w - 1) || !isInt(e.y, 0, CANVAS.h - 1) || !isInt(e.v, 0, 3)) return null;
    elements.push({ id: e.id, kind: e.kind as Kind, x: e.x, y: e.y, v: e.v });
  }
  if (elements.length > MAX_ELEMENTS) return null;
  try {
    const paint = fromB64(d.paint);
    if (paint.length !== CANVAS.w * CANVAS.h || paint.some((v) => v > BRUSH.length)) return null;
  } catch {
    return null;
  }
  const nextId = isInt(d.nextId, 1, 1e9) ? d.nextId : Math.max(0, ...elements.map((e) => e.id)) + 1;
  return { theme: d.theme as Theme, elements, paint: d.paint, nextId };
};

/** Demo preset: an evening sky started, ready for a moon and stars. */
export function demoSky(): Sky {
  let s = emptySky('dusk');
  s = place(s, 'cloud', 34, 70, 1);
  s = place(s, 'cloud', 118, 54, 0);
  s = place(s, 'star', 24, 22, 1);
  s = place(s, 'star', 60, 14, 0);
  s = place(s, 'star', 140, 30, 2);
  s = place(s, 'bird', 92, 86, 0);
  s = paintLine(s, 0, 108, 159, 104, 8, 1);
  return s;
}
