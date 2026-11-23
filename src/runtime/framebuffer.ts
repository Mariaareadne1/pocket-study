/**
 * The console's display memory: a 160×144 RGBA software framebuffer. Games draw into it with
 * integer-pixel primitives; the 3D screen uploads it as a nearest-sampled texture. Being plain
 * memory, it can be inspected pixel by pixel in unit tests and encoded to PNG for export.
 */
export const SCREEN_W = 160;
export const SCREEN_H = 144;

/** 0xRRGGBB */
export type Color = number;

export interface Sprite {
  readonly w: number;
  readonly h: number;
  /** One colour per pixel, -1 = transparent. */
  readonly px: Int32Array;
}

const pack = (c: Color): number => ((255 << 24) | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255)) >>> 0;

/** Bayer 4×4 for ordered-dither gradients. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export function mix(a: Color, b: Color, t: number): Color {
  const k = Math.min(1, Math.max(0, t));
  const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k));
  const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k));
  const bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * k));
  return (r << 16) | (g << 8) | bl;
}

export class Framebuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  private readonly u32: Uint32Array;
  /** Incremented on every draw call that changes pixels; the screen re-uploads when it moves. */
  version = 0;

  constructor(width = SCREEN_W, height = SCREEN_H) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.u32 = new Uint32Array(this.data.buffer);
  }

  clear(c: Color): void {
    this.u32.fill(pack(c));
    this.version++;
  }

  px(x: number, y: number, c: Color): void {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.u32[y * this.width + x] = pack(c);
  }

  get(x: number, y: number): Color {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    const i = (y * this.width + x) * 4;
    return (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return;
    const p = pack(c);
    for (let yy = y0; yy < y1; yy++) this.u32.fill(p, yy * this.width + x0, yy * this.width + x1);
    this.version++;
  }

  frame(x: number, y: number, w: number, h: number, c: Color): void {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y + 1, 1, h - 2, c);
    this.rect(x + w - 1, y + 1, 1, h - 2, c);
  }

  /** Rounded panel (1-pixel corner bevel). */
  panel(x: number, y: number, w: number, h: number, fill: Color, edge?: Color): void {
    this.rect(x + 1, y, w - 2, h, fill);
    this.rect(x, y + 1, 1, h - 2, fill);
    this.rect(x + w - 1, y + 1, 1, h - 2, fill);
    if (edge !== undefined) {
      this.rect(x + 1, y, w - 2, 1, edge);
      this.rect(x + 1, y + h - 1, w - 2, 1, edge);
      this.rect(x, y + 1, 1, h - 2, edge);
      this.rect(x + w - 1, y + 1, 1, h - 2, edge);
    }
  }

  /** Alpha-blends a colour into a rectangle. */
  shade(x: number, y: number, w: number, h: number, c: Color, a: number): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, mix(this.get(xx, yy), c, a));
    this.version++;
  }

  /** Vertical gradient with ordered dithering between quantised steps (keeps the pixel look). */
  gradient(y0: number, y1: number, stops: readonly Color[], steps = 8): void {
    const h = Math.max(1, y1 - y0);
    for (let y = Math.max(0, y0); y < Math.min(this.height, y1); y++) {
      const t = ((y - y0) / h) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      const local = (t - i) * steps;
      const lo = Math.floor(local);
      for (let x = 0; x < this.width; x++) {
        const k = local - lo > BAYER[(y & 3) * 4 + (x & 3)] ? lo + 1 : lo;
        this.u32[y * this.width + x] = pack(mix(stops[i], stops[i + 1], k / steps));
      }
    }
    this.version++;
  }

  sprite(s: Sprite, x: number, y: number, flipX = false, tint?: Color): void {
    const ox = Math.round(x);
    const oy = Math.round(y);
    for (let j = 0; j < s.h; j++) {
      for (let i = 0; i < s.w; i++) {
        const c = s.px[j * s.w + (flipX ? s.w - 1 - i : i)];
        if (c >= 0) this.px(ox + i, oy + j, tint ?? c);
      }
    }
    this.version++;
  }

  /** Copies pixels from another framebuffer of the same size. */
  copyFrom(other: Framebuffer): void {
    this.data.set(other.data);
    this.version++;
  }

  /** Mixes every pixel towards a colour (fades). */
  fadeTo(c: Color, t: number): void {
    if (t <= 0) return;
    const r = (c >> 16) & 255;
    const g = (c >> 8) & 255;
    const b = c & 255;
    const d = this.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] += (r - d[i]) * t;
      d[i + 1] += (g - d[i + 1]) * t;
      d[i + 2] += (b - d[i + 2]) * t;
    }
    this.version++;
  }

  /** Number of pixels that differ from a colour (used by tests and export validation). */
  countNot(c: Color): number {
    const p = pack(c);
    let n = 0;
    for (let i = 0; i < this.u32.length; i++) if (this.u32[i] !== p) n++;
    return n;
  }

  /** Number of distinct colours (sanity check that a screen is not blank). */
  palette(): number {
    return new Set(this.u32).size;
  }
}

/**
 * Parses a sprite from rows of characters. `.` (or space) is transparent; every other character
 * is looked up in the palette.
 */
export function sprite(rows: readonly string[], palette: Readonly<Record<string, Color>>): Sprite {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const px = new Int32Array(w * h).fill(-1);
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      const c = palette[ch];
      if (c === undefined) throw new Error(`sprite: no colour for '${ch}'`);
      px[j * w + i] = c;
    }
  });
  return { w, h, px };
}
