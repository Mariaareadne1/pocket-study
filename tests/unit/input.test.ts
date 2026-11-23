import { describe, expect, it } from 'vitest';
import { InputHub, Pad } from '@/runtime/input';

describe('input hub', () => {
  it('press and release each direction', () => {
    const hub = new InputHub();
    for (const a of ['up', 'down', 'left', 'right'] as const) {
      hub.press('kbd', a);
      expect(hub.isHeld(a)).toBe(true);
      hub.release('kbd', a);
      expect(hub.isHeld(a)).toBe(false);
    }
  });

  it('keyboard and 3D button are equivalent and do not release each other', () => {
    const hub = new InputHub();
    const log: string[] = [];
    hub.subscribe((a, d) => log.push(`${a}:${d ? 'down' : 'up'}`));
    hub.press('kbd', 'a');
    hub.press('pointer:1', 'a');
    hub.release('kbd', 'a');
    expect(hub.isHeld('a')).toBe(true);
    hub.release('pointer:1', 'a');
    expect(hub.isHeld('a')).toBe(false);
    expect(log).toEqual(['a:down', 'a:up']);
  });

  it('a sub-tick tap is still seen by the next poll', () => {
    const hub = new InputHub();
    hub.press('touch:3', 'b');
    hub.release('touch:3', 'b');
    const f = hub.poll();
    expect(f.pressed.has('b')).toBe(true);
    expect(f.held.has('b')).toBe(true);
    expect(hub.poll().pressed.size).toBe(0);
  });

  it('several taps between two polls are each delivered, one per poll', () => {
    const hub = new InputHub();
    for (let i = 0; i < 3; i++) {
      hub.press('kbd', 'down');
      hub.release('kbd', 'down');
    }
    const seen = [hub.poll(), hub.poll(), hub.poll(), hub.poll()].map((f) => f.pressed.has('down'));
    expect(seen).toEqual([true, true, true, false]);
  });

  it('a flood of queued taps is capped so a stall does not replay seconds of input', () => {
    const hub = new InputHub();
    for (let i = 0; i < 20; i++) {
      hub.press('kbd', 'a');
      hub.release('kbd', 'a');
    }
    let n = 0;
    while (hub.poll().pressed.has('a')) n++;
    expect(n).toBe(4);
  });

  it('press and hold produces one press edge', () => {
    const hub = new InputHub();
    hub.press('kbd', 'right');
    hub.press('kbd', 'right'); // OS key repeat
    expect(hub.poll().pressed.has('right')).toBe(true);
    const next = hub.poll();
    expect(next.pressed.has('right')).toBe(false);
    expect(next.held.has('right')).toBe(true);
  });

  it('multiple simultaneous actions', () => {
    const hub = new InputHub();
    hub.press('kbd', 'left');
    hub.press('kbd', 'a');
    hub.press('pointer:2', 'up');
    expect([...hub.poll().held].sort()).toEqual(['a', 'left', 'up']);
  });

  it('pointer / touch cancellation releases only that source', () => {
    const hub = new InputHub();
    hub.press('touch:7', 'left');
    hub.press('touch:7', 'a');
    hub.press('kbd', 'b');
    hub.releaseSource('touch:7');
    expect([...hub.heldSet]).toEqual(['b']);
  });

  it('releaseAll leaves nothing stuck (blur, power off, eject)', () => {
    const hub = new InputHub();
    hub.press('kbd', 'start');
    hub.press('pointer:9', 'down');
    hub.releaseAll();
    expect(hub.heldSet.size).toBe(0);
    expect(hub.sources).toEqual([]);
  });

  it('flush discards edges made while the console could not listen', () => {
    const hub = new InputHub();
    hub.press('kbd', 'a');
    hub.flush();
    expect(hub.poll().pressed.size).toBe(0);
  });
});

describe('pad auto-repeat', () => {
  it('fires on press, then after the delay at a fixed rate, independent of frame timing', () => {
    const hub = new InputHub();
    const pad = new Pad();
    hub.press('kbd', 'down');
    let fired = 0;
    for (let i = 0; i < 60; i++) {
      pad.update(hub.poll(), 1 / 60);
      if (pad.repeat('down')) fired++;
    }
    // 1 press + repeats at 0.3 s then every 0.075 s up to 1 s → 1 + floor((1-0.3)/0.075)+1
    expect(fired).toBeGreaterThanOrEqual(9);
    expect(fired).toBeLessThanOrEqual(11);
  });
});
