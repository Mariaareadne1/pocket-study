import { describe, expect, it } from 'vitest';
import { DeviceMachine, TIMING } from '@/device/machine';

const run = (m: DeviceMachine, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) m.tick(dt);
};
const types = (m: DeviceMachine): string[] => m.drain().map((e) => e.type);

describe('device state machine', () => {
  it('powers on without a cartridge and reports an empty slot at boot completion', () => {
    const m = new DeviceMachine();
    m.powerOn();
    expect(m.state.power).toBe('booting');
    run(m, TIMING.boot + 0.05);
    const ev = m.drain();
    expect(ev.find((e) => e.type === 'boot-done')).toEqual({ type: 'boot-done', cart: null });
    expect(m.state.power).toBe('ready');
  });

  it('inserts the first cartridge and seats it after the insertion animation', () => {
    const m = new DeviceMachine();
    expect(m.insert('bloom').ok).toBe(true);
    expect(m.state.slot).toBe('inserting');
    expect(m.placeOf('bloom')).toBe('inserting');
    run(m, TIMING.insert + 0.05);
    expect(m.state.slot).toBe('inserted');
    expect(types(m)).toEqual(['insert-start', 'seated']);
  });

  it('refuses a second cartridge while the slot is occupied', () => {
    const m = new DeviceMachine();
    m.insert('bloom');
    run(m, 1);
    m.drain();
    const r = m.insert('starfall');
    expect(r).toEqual({ ok: false, reason: 'slot-occupied' });
    expect(m.state.cart).toBe('bloom');
    expect(m.drain()).toEqual([{ type: 'blocked', reason: 'slot-occupied' }]);
  });

  it('boots the seated cartridge', () => {
    const m = new DeviceMachine();
    m.insert('starfall');
    run(m, 1);
    m.powerOn();
    run(m, TIMING.boot + 0.05);
    expect(m.drain().find((e) => e.type === 'boot-done')).toEqual({ type: 'boot-done', cart: 'starfall' });
  });

  it('blocks ejecting while powered on, allows it after power off', () => {
    const m = new DeviceMachine();
    m.insert('bloom');
    run(m, 1);
    m.powerOn();
    run(m, 3);
    expect(m.eject()).toEqual({ ok: false, reason: 'powered-on' });
    m.powerOff();
    expect(m.state.power).toBe('shutting_down');
    run(m, TIMING.shutdown + 0.05);
    expect(m.state.power).toBe('off');
    expect(m.eject().ok).toBe(true);
    run(m, TIMING.eject + 0.05);
    expect(m.state.slot).toBe('empty');
    expect(m.state.cart).toBeNull();
    expect(m.placeOf('bloom')).toBe('tray');
  });

  it('blocks inserting while powered on', () => {
    const m = new DeviceMachine();
    m.powerOn();
    expect(m.insert('bloom')).toEqual({ ok: false, reason: 'powered-on' });
    expect(m.state.slot).toBe('empty');
  });

  it('blocks power while the cartridge is moving', () => {
    const m = new DeviceMachine();
    m.insert('bloom');
    expect(m.powerOn()).toEqual({ ok: false, reason: 'busy' });
    expect(m.state.power).toBe('off');
  });

  it('survives rapid repeated power toggles without skipping states', () => {
    const m = new DeviceMachine();
    for (let i = 0; i < 20; i++) m.togglePower();
    // Even count of toggles: on → shutting_down → (toggle while shutting down is a no-op) …
    expect(['booting', 'shutting_down', 'off']).toContain(m.state.power);
    run(m, 4);
    expect(['ready', 'off']).toContain(m.state.power);
  });

  it('returns a dragged cartridge when released outside the snap zone', () => {
    const m = new DeviceMachine();
    m.beginDrag('littlesky');
    expect(m.placeOf('littlesky')).toBe('dragging');
    m.dragNear(true);
    expect(m.state.nearSlot).toBe(true);
    m.endDrag(false);
    expect(m.state.slot).toBe('empty');
    expect(m.placeOf('littlesky')).toBe('selected');
    expect(types(m)).toEqual(['drag', 'drop-return']);
  });

  it('inserts when the drag ends in the snap zone', () => {
    const m = new DeviceMachine();
    m.beginDrag('littlesky');
    m.endDrag(true);
    expect(m.state.slot).toBe('inserting');
    expect(m.state.dragging).toBeNull();
  });

  it('an interrupted drag (pointer cancel) changes nothing but the hand', () => {
    const m = new DeviceMachine();
    m.beginDrag('bloom');
    m.dragNear(true);
    m.cancelDrag();
    expect(m.state).toMatchObject({ slot: 'empty', dragging: null, nearSlot: false, power: 'off' });
  });

  it('a drop near an occupied slot bounces the cartridge back', () => {
    const m = new DeviceMachine();
    m.insert('bloom');
    run(m, 1);
    m.drain();
    m.beginDrag('starfall');
    m.endDrag(true);
    expect(m.state.cart).toBe('bloom');
    expect(types(m)).toEqual(['drag', 'blocked', 'drop-return']);
  });

  it('cannot pick up the cartridge that is in the slot', () => {
    const m = new DeviceMachine();
    m.insert('bloom');
    expect(m.beginDrag('bloom')).toEqual({ ok: false, reason: 'in-slot' });
  });

  it('mirrors the running game phase only while playable', () => {
    const m = new DeviceMachine();
    m.setGamePhase('playing');
    expect(m.state.power).toBe('off');
    m.powerOn();
    run(m, 3);
    m.setGamePhase('playing');
    expect(m.state.power).toBe('playing');
    m.setGamePhase('paused');
    expect(m.state.power).toBe('paused');
    m.setGamePhase('over');
    expect(m.state.power).toBe('ready');
  });
});
