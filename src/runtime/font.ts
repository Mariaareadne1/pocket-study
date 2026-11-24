/**
 * The console's display typeface (glyph art in ./glyphs). Proportional: each glyph keeps its own
 * width plus one pixel of spacing. Lower case maps to upper case; unknown characters draw as '?'.
 */
import type { Color, Framebuffer } from './framebuffer';
import { GLYPH_ROWS } from './glyphs';

interface Glyph {
  readonly w: number;
  /** One bitmask per row, bit (w - 1) = leftmost column. */
  readonly rows: readonly number[];
}

const parse = (rows: readonly string[]): Glyph => {
  const w = Math.max(...rows.map((r) => r.length));
  return { w, rows: rows.map((r) => [...r.padEnd(w, '.')].reduce((m, ch) => (m << 1) | (ch === '#' ? 1 : 0), 0)) };
};

const G: Readonly<Record<string, Glyph>> = Object.fromEntries(Object.entries(GLYPH_ROWS).map(([k, rows]) => [k, parse(rows)]));

export const GLYPH_H = 7;
export const SPACING = 1;

const glyph = (ch: string): Glyph => G[ch.toUpperCase()] ?? G['?'];

/** Width of a single character including its trailing spacing. */
export const advance = (ch: string): number => glyph(ch).w + SPACING;

export function textWidth(s: string): number {
  if (s.length === 0) return 0;
  let w = 0;
  for (const ch of s) w += advance(ch);
  return w - SPACING;
}

export type Align = 'left' | 'center' | 'right';

export interface TextOpts {
  align?: Align;
  shadow?: Color;
  /** Scale factor (integer) for titles. */
  scale?: number;
}

/** Draws text; returns the drawn width in pixels. */
export function text(fb: Framebuffer, s: string, x: number, y: number, c: Color, opts: TextOpts = {}): number {
  const scale = opts.scale ?? 1;
  const w = textWidth(s) * scale;
  let ox = Math.round(x);
  if (opts.align === 'center') ox = Math.round(x - w / 2);
  else if (opts.align === 'right') ox = Math.round(x - w);
  const oy = Math.round(y);
  if (opts.shadow !== undefined) text(fb, s, ox + scale, oy + scale, opts.shadow, { scale });
  let gx = ox;
  for (const ch of s) {
    const g = glyph(ch);
    for (let j = 0; j < GLYPH_H; j++) {
      const bits = g.rows[j];
      if (!bits) continue;
      for (let i = 0; i < g.w; i++) {
        if (!(bits & (1 << (g.w - 1 - i)))) continue;
        if (scale === 1) fb.px(gx + i, oy + j, c);
        else fb.rect(gx + i * scale, oy + j * scale, scale, scale, c);
      }
    }
    gx += (g.w + SPACING) * scale;
  }
  fb.version++;
  return w;
}

export const hasGlyph = (ch: string): boolean => ch.toUpperCase() in G;

/** Wraps text into lines no wider than `maxWidth` pixels (the font is proportional). */
export function wrap(s: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (!line) line = word;
      else if (textWidth(`${line} ${word}`) <= maxWidth) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}
