/**
 * GLASSHOUSE roof layouts. Each layout is up to 7 rows of up to 10 characters:
 *   '.'      empty
 *   'a'..'e' a stained-glass pane in one of five pastel tints (one hit)
 *   'F'      a frosted pane (first hit cracks it, the second breaks it)
 *   '#'      an iron strut (never breaks, does not count towards clearing)
 */
export const GRID = { x: 5, y: 24, cols: 10, rows: 7, w: 14, h: 6, gapX: 1, gapY: 1 } as const;

export type PaneKind = 'glass' | 'frost' | 'iron';

export interface Pane {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly kind: PaneKind;
  /** 0..4 for glass, ignored for frost and iron. */
  readonly tint: number;
  readonly cracked: boolean;
}

export interface Layout {
  readonly name: string;
  readonly rows: readonly string[];
}

export const LAYOUTS: readonly Layout[] = [
  {
    name: 'SEEDLING',
    rows: ['..aaaaaa..', '.abbbbbba.', 'abccccccba', 'abcddddcba', '..eeeeee..'],
  },
  {
    name: 'GABLE',
    rows: ['....aa....', '...abba...', '..abccba..', '.abcFFcba.', 'abcdFFdcba', 'eeeeeeeeee'],
  },
  {
    name: 'COLD FRAME',
    rows: ['FFFFFFFFFF', 'a.b.c.d.e.', '.a.b.c.d.e', 'aabbccddee', '..........', 'eeddccbbaa'],
  },
  {
    name: 'LATTICE',
    rows: ['aaa#aa#aaa', 'bFb.bb.bFb', 'cccccccccc', 'd#dd..dd#d', 'eeeeeeeeee', '.F.F..F.F.', 'bb.aaaa.bb'],
  },
  {
    name: 'ORANGERY',
    rows: ['c.c.c.c.c.', '.d.d.d.d.d', 'FaaaFFaaaF', 'bb#bbbb#bb', 'eeeeeeeeee', 'dFccFFccFd'],
  },
];

const TINTS = 'abcde';

function paneAt(ch: string, col: number, row: number): Pane | null {
  const base = {
    id: row * GRID.cols + col,
    x: GRID.x + col * (GRID.w + GRID.gapX),
    y: GRID.y + row * (GRID.h + GRID.gapY),
    cracked: false,
  };
  if (ch === 'F') return { ...base, kind: 'frost', tint: 0 };
  if (ch === '#') return { ...base, kind: 'iron', tint: 0 };
  const tint = TINTS.indexOf(ch);
  return tint >= 0 ? { ...base, kind: 'glass', tint } : null;
}

/** Turns a layout's rows into panes (characters outside the grid are ignored). */
export function buildPanes(layout: Layout): Pane[] {
  return layout.rows.slice(0, GRID.rows).flatMap((row, r) =>
    row
      .slice(0, GRID.cols)
      .split('')
      .map((ch, c) => paneAt(ch, c, r))
      .filter((p): p is Pane => p !== null),
  );
}

/** Level 1 is the first layout; after the last one the roofs repeat. */
export const layoutFor = (level: number): Layout => LAYOUTS[(level - 1) % LAYOUTS.length];
export const loopOf = (level: number): number => Math.floor((level - 1) / LAYOUTS.length);

export const isBreakable = (p: Pane): boolean => p.kind !== 'iron';
export const breakableCount = (panes: readonly Pane[]): number => panes.filter(isBreakable).length;
