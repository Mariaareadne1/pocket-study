import { describe, expect, it } from 'vitest';
import { TIMING } from '@/device/machine';
import { AudioEngine } from '@/runtime/audio';
import { ConsoleRuntime } from '@/runtime/console';
import { memoryStore } from '@/runtime/storage';

function make(): { rt: ConsoleRuntime; audio: AudioEngine; store: ReturnType<typeof memoryStore> } {
  const audio = new AudioEngine();
  audio.timeline = [];
  const store = memoryStore();
  return { rt: new ConsoleRuntime({ store, audio, seed: 1 }), audio, store };
}
const run = (rt: ConsoleRuntime, s: number): void => {
  for (let i = 0; i < Math.round(s * 60); i++) rt.tick(1 / 60);
};
const sounds = (a: AudioEngine): string[] => (a.timeline ?? []).map((e) => e.name);

describe('console runtime', () => {
  it('screen is black and nothing runs while off', () => {
    const { rt } = make();
    run(rt, 1);
    expect(rt.screenMode).toBe('off');
    expect(rt.fb.countNot(0)).toBe(0);
    expect(rt.backlight).toBe(0);
  });

  it('power on with no cartridge shows the empty-slot screen', () => {
    const { rt, audio } = make();
    rt.togglePower();
    run(rt, TIMING.boot + 0.2);
    expect(rt.screenMode).toBe('nocart');
    expect(rt.fb.palette()).toBeGreaterThan(2);
    expect(sounds(audio)).toEqual(expect.arrayContaining(['switchOn', 'boot', 'nocart']));
  });

  it('insert → power → boot → game runs and receives input; power off stops everything', () => {
    const { rt, audio } = make();
    rt.insert('starfall');
    run(rt, 1);
    rt.togglePower();
    run(rt, 1);
    expect(rt.screenMode).toBe('boot');
    expect(rt.updates).toBe(0);
    run(rt, 2);
    expect(rt.running?.id).toBe('starfall');
    expect(rt.machine.state.power).toBe('ready');
    rt.hub.press('kbd', 'start');
    run(rt, 0.1);
    rt.hub.release('kbd', 'start');
    expect(rt.machine.state.power).toBe('playing');
    const u = rt.updates;
    run(rt, 1);
    expect(rt.updates - u).toBe(60);
    rt.togglePower();
    expect(rt.running).toBeNull();
    run(rt, 1);
    expect(rt.screenMode).toBe('off');
    expect(rt.fb.countNot(0)).toBe(0);
    const after = rt.updates;
    rt.hub.press('kbd', 'a');
    run(rt, 1);
    expect(rt.updates).toBe(after);
    expect(sounds(audio)).toEqual(expect.arrayContaining(['slide', 'seat', 'switchOn', 'boot', 'start', 'switchOff']));
  });

  it('ejecting during play is blocked with a message; works after power off', () => {
    const { rt } = make();
    rt.insert('bloom');
    run(rt, 1);
    rt.togglePower();
    run(rt, 3);
    expect(rt.eject()).toBe(false);
    expect(rt.snapshot().message).toMatch(/switch the console off/i);
    rt.togglePower();
    run(rt, 1);
    expect(rt.eject()).toBe(true);
    run(rt, 1);
    expect(rt.machine.state.slot).toBe('empty');
  });

  it('losing focus releases held inputs and pauses the game', () => {
    const { rt } = make();
    rt.insert('starfall');
    run(rt, 1);
    rt.togglePower();
    run(rt, 3);
    rt.hub.press('kbd', 'start');
    run(rt, 0.05);
    rt.hub.release('kbd', 'start');
    rt.hub.press('kbd', 'left');
    run(rt, 0.2);
    rt.suspend('blur');
    expect(rt.hub.heldSet.size).toBe(0);
    expect(rt.machine.state.power).toBe('paused');
  });

  it('switching cartridges disposes the old game and saves it', () => {
    const { rt, store } = make();
    rt.insert('bloom');
    run(rt, 1);
    rt.togglePower();
    run(rt, 3);
    rt.hub.press('kbd', 'start');
    run(rt, 0.05);
    rt.hub.release('kbd', 'start');
    rt.hub.press('kbd', 'a');
    run(rt, 0.05);
    rt.hub.release('kbd', 'a');
    rt.togglePower();
    run(rt, 1);
    expect(store.get('bloom')).not.toBeNull();
    rt.eject();
    run(rt, 1);
    rt.insert('littlesky');
    run(rt, 1);
    rt.togglePower();
    run(rt, 3);
    expect(rt.running?.id).toBe('littlesky');
  });

  it('clear saved data removes every game save', () => {
    const { rt, store } = make();
    store.set('bloom', 'x');
    store.set('starfall', 'y');
    rt.clearSaves();
    expect(store.get('bloom')).toBeNull();
    expect(store.get('starfall')).toBeNull();
  });
});
