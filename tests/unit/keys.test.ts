import { describe, expect, it } from 'vitest';
import { KEY_MAP } from '@/runtime/input';
import { guideRows, keyHint, keyRows } from '@/ui/keys';
import { CARTS } from '@/runtime/types';

describe('keyboard controls', () => {
  it('the A and B keys press the A and B buttons; arrows steer', () => {
    expect(KEY_MAP.KeyA).toBe('a');
    expect(KEY_MAP.KeyB).toBe('b');
    expect(KEY_MAP.Space).toBe('a');
    expect(KEY_MAP.ArrowLeft).toBe('left');
    expect(KEY_MAP.Enter).toBe('start');
  });

  it('maps a cartridge’s device controls to keyboard keys', () => {
    const rows = keyRows('D-pad move · A use tool · B next tool · Select seed · Start menu');
    expect(rows).toEqual([
      { keys: ['←', '↑', '↓', '→'], label: 'move' },
      { keys: ['A', 'Z', 'Space'], label: 'use tool' },
      { keys: ['B', 'X'], label: 'next tool' },
      { keys: ['Shift'], label: 'seed' },
      { keys: ['Enter'], label: 'menu' },
    ]);
  });

  it('writes a one-line hint, with Escape folded into the pause key', () => {
    expect(keyHint('D-pad fly · A dash · Start pause')).toBe('Arrows fly · A dash · Enter/Esc pause');
    expect(keyHint('D-pad move · A use tool · Start menu')).toBe('Arrows move · A use tool · Enter menu · Esc pause');
  });

  it('adds Escape to the guide as its own row only when no key already pauses', () => {
    expect(guideRows('D-pad fly · Start pause').at(-1)).toEqual({ keys: ['Enter', 'Esc'], label: 'pause' });
    expect(guideRows('D-pad fly · Start menu').at(-1)).toEqual({ keys: ['Esc'], label: 'pause' });
  });

  it('every cartridge’s controls resolve to keys', () => {
    for (const c of Object.values(CARTS)) {
      for (const r of keyRows(c.controls)) expect(r.keys.length, `${c.id}: ${r.label}`).toBeGreaterThan(0);
    }
  });
});
