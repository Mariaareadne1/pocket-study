/**
 * Turns a cartridge's on-device controls ("D-pad move · A use tool · Start menu") into the keys a
 * player presses on a keyboard, for the key guide and the hint line.
 */
import { KEY_NAMES } from '@/runtime/input';

export interface KeyRow {
  keys: readonly string[];
  label: string;
}

const BUTTONS: Readonly<Record<string, readonly string[]>> = {
  'D-pad': ['←', '↑', '↓', '→'],
  A: KEY_NAMES.a,
  B: KEY_NAMES.b,
  Start: KEY_NAMES.start,
  Select: KEY_NAMES.select,
};

export function keyRows(controls: string): KeyRow[] {
  return controls
    .split('·')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const button = Object.keys(BUTTONS).find((b) => part === b || part.startsWith(`${b} `));
      return button ? { keys: BUTTONS[button], label: part.slice(button.length).trim() } : { keys: [], label: part };
    });
}

/** The rows for the key guide: the cartridge's controls plus Esc, which pauses any game. */
export function guideRows(controls: string): KeyRow[] {
  const rows = keyRows(controls);
  const pause = rows.findIndex((r) => r.label === 'pause');
  if (pause < 0) return [...rows, { keys: ['Esc'], label: 'pause' }];
  return rows.map((r, i) => (i === pause ? { ...r, keys: [...r.keys, 'Esc'] } : r));
}

/** One line for the hint: "Arrows move · A use tool · Enter menu · Esc pause". */
export function keyHint(controls: string): string {
  return guideRows(controls)
    .map((r) => {
      if (r.keys.length === 0) return r.label;
      const first = r.keys[0] === '←' ? 'Arrows' : r.keys[0];
      const key = r.keys.includes('Esc') && first !== 'Esc' ? `${first}/Esc` : first;
      return `${key} ${r.label}`.trim();
    })
    .join(' · ');
}
