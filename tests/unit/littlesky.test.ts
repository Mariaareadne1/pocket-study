import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { LittleSkyGame } from '@/games/littlesky';
import { CANVAS, History, deserialize, elementAt, emptySky, erase, place, painted, paintLine, serialize, validateSaved } from '@/games/littlesky/logic';
import { renderSky } from '@/games/littlesky/view';
import { Framebuffer } from '@/runtime/framebuffer';
import { memoryStore } from '@/runtime/storage';
import { Driver, host } from './helpers';

describe('little sky composition', () => {
  it('adds and removes elements', () => {
    let s = emptySky();
    s = place(s, 'moon', 40, 30);
    expect(s.elements).toHaveLength(1);
    expect(elementAt(s, 41, 31, 0)).toBe(0);
    const r = erase(s, 40, 30, 0);
    expect(r.removed?.kind).toBe('moon');
    expect(r.sky.elements).toHaveLength(0);
  });

  it('paints lines and erases paint', () => {
    let s = paintLine(emptySky(), 10, 10, 20, 10, 3);
    expect(painted(s)).toBe(11);
    s = erase(s, 15, 10, 0).sky;
    expect(painted(s)).toBe(8);
  });

  it('undo restores previous skies', () => {
    const h = new History();
    const a = emptySky();
    const b = place(a, 'star', 5, 5);
    h.push(a);
    expect(h.pop()).toBe(a);
    expect(h.pop()).toBeNull();
    void b;
  });

  it('save and reload round-trips exactly', () => {
    let s = place(emptySky('night'), 'bird', 70, 40);
    s = paintLine(s, 0, 0, 159, 127, 5);
    const saved = JSON.parse(JSON.stringify(serialize(s)));
    const v = validateSaved(saved);
    expect(v).not.toBeNull();
    const back = deserialize(v!);
    expect(back.theme).toBe('night');
    expect(back.elements).toEqual(s.elements);
    expect([...back.paint]).toEqual([...s.paint]);
    expect(validateSaved({ ...saved, paint: 'AAAA' })).toBeNull();
  });
});

describe('little sky cartridge', () => {
  it('cursor movement, tool change, place, erase, undo, clear', () => {
    const g = new LittleSkyGame(host());
    const d = new Driver(g);
    d.tap('start');
    expect(g.inspect().cursor).toEqual([80, 60]);
    d.tap('right');
    d.tap('down');
    expect(g.inspect().cursor).toEqual([81, 61]);
    d.tap('a');
    expect(g.inspect().elements).toBe(1);
    d.tap('select');
    expect(g.inspect().tool).toBe('cloud');
    d.tap('b');
    expect(g.inspect().elements).toBe(0);
    g.undo();
    expect(g.inspect().elements).toBe(1);
    // Brush: hold A while moving draws a line.
    for (let i = 0; i < 4; i++) d.tap('select'); // cloud → moon → bird → glow → brush
    expect(g.inspect().tool).toBe('brush');
    d.hub.press('test', 'a');
    d.step(2);
    d.hub.press('test', 'right');
    d.seconds(0.5);
    d.hub.releaseAll();
    d.step(2);
    expect(g.inspect().painted as number).toBeGreaterThan(3);
    // Clear via menu with confirmation.
    d.tap('start');
    for (let i = 0; i < 6; i++) d.tap('down');
    d.tap('a');
    d.tap('right');
    d.tap('a');
    expect(g.inspect().elements).toBe(0);
    expect(g.inspect().painted).toBe(0);
  });

  it('exports the real artwork as a PNG of the right size with content', () => {
    const h = host(memoryStore(), true);
    const g = new LittleSkyGame(h);
    const d = new Driver(g);
    d.tap('start');
    d.tap('start');
    for (let i = 0; i < 5; i++) d.tap('down');
    d.tap('a');
    expect(h.exported).toHaveLength(1);
    const fb = h.exported[0].fb;
    expect([fb.width, fb.height]).toEqual([CANVAS.w, CANVAS.h]);
    // Same pixels as rendering the composition directly.
    const ref = new Framebuffer(CANVAS.w, CANVAS.h);
    renderSky(ref, g.state, (g as unknown as { t: number }).t);
    expect(Buffer.from(fb.data).equals(Buffer.from(ref.data))).toBe(true);
    // Encode like the browser exporter and validate the PNG.
    const png = new PNG({ width: fb.width, height: fb.height });
    png.data = Buffer.from(fb.data);
    const decoded = PNG.sync.read(PNG.sync.write(png));
    expect([decoded.width, decoded.height]).toEqual([160, 128]);
    expect(new Set(new Uint32Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.length / 4)).size).toBeGreaterThan(10);
  });

  it('saves and restores a composition through the cartridge', () => {
    const store = memoryStore();
    const g = new LittleSkyGame(host(store));
    const d = new Driver(g);
    d.tap('start');
    d.tap('a');
    d.tap('left');
    d.tap('a');
    g.save();
    const again = new LittleSkyGame(host(store));
    expect(again.inspect().elements).toBe(2);
  });
});
