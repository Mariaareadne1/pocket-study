import { InputHub, Pad, type Action } from '@/runtime/input';
import { Rng } from '@/runtime/rng';
import type { SfxName } from '@/runtime/sfx';
import { type KeyValue, memoryStore } from '@/runtime/storage';
import type { Game, GameHost } from '@/runtime/types';
import { Framebuffer } from '@/runtime/framebuffer';

export interface TestHost extends GameHost {
  sounds: SfxName[];
  exported: { fb: Framebuffer; name: string }[];
}

export function host(store: KeyValue = memoryStore(), demo = false): TestHost {
  const sounds: SfxName[] = [];
  const exported: { fb: Framebuffer; name: string }[] = [];
  return {
    rng: new Rng(42),
    store,
    demo,
    sounds,
    exported,
    sfx: (n) => void sounds.push(n),
    exportImage: (fb, name) => void exported.push({ fb, name }),
  };
}

/** Drives a game through the real Pad with scripted button presses. */
export class Driver {
  readonly hub = new InputHub();
  readonly pad = new Pad();
  readonly fb = new Framebuffer();
  constructor(readonly game: Game) {}

  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.pad.update(this.hub.poll(), 1 / 60);
      this.game.update(this.pad, 1 / 60);
    }
  }

  seconds(s: number): void {
    this.step(Math.round(s * 60));
  }

  tap(a: Action, frames = 2): void {
    this.hub.press('test', a);
    this.step(frames);
    this.hub.release('test', a);
    this.step(1);
  }

  hold(a: Action, seconds: number): void {
    this.hub.press('test', a);
    this.seconds(seconds);
    this.hub.release('test', a);
    this.step(1);
  }

  draw(): Framebuffer {
    this.game.draw(this.fb);
    return this.fb;
  }
}
