import type { CartId, GamePhase } from '@/device/machine';
import type { Framebuffer } from './framebuffer';
import type { Pad } from './input';
import type { Rng } from './rng';
import type { SfxName } from './sfx';
import type { KeyValue } from './storage';

/** What the console offers a running cartridge. */
export interface GameHost {
  readonly rng: Rng;
  readonly store: KeyValue;
  sfx(name: SfxName): void;
  /** Saves the framebuffer content as a PNG download (Little Sky). */
  exportImage(fb: Framebuffer, name: string): void;
  /** Deterministic demo preset requested (film / tests); games may seed a starting state. */
  readonly demo: boolean;
}

export interface Game {
  readonly id: CartId;
  readonly phase: GamePhase;
  /** One fixed 1/60 s step. */
  update(pad: Pad, dt: number): void;
  /** Draws the current state; returns false when nothing changed (no texture upload needed). */
  draw(fb: Framebuffer): boolean;
  /** External pause (focus lost, Escape, page hidden). */
  pause(): void;
  save(): void;
  dispose(): void;
  /** Instrumentation for tests and the debug API. */
  inspect(): Record<string, unknown>;
}

export interface CartInfo {
  id: CartId;
  number: string;
  title: string;
  genre: string;
  blurb: string;
  controls: string;
}

export const CARTS: Record<CartId, CartInfo> = {
  bloom: {
    id: 'bloom',
    number: '01',
    title: 'Bloom',
    genre: 'A tiny garden',
    blurb: 'Plant seeds, keep the soil damp, and grow a garden of eight flowers.',
    controls: 'D-pad move · A use tool · B next tool · Select seed · Start menu',
  },
  starfall: {
    id: 'starfall',
    number: '02',
    title: 'Starfall',
    genre: 'Arcade',
    blurb: 'Catch falling stars, dodge the debris, and chase your best score.',
    controls: 'D-pad fly · A dash · B star pulse · Start pause',
  },
  littlesky: {
    id: 'littlesky',
    number: '03',
    title: 'Little Sky',
    genre: 'Sky maker',
    blurb: 'Paint a small sky with stars, clouds, moons and birds. Export it as a PNG.',
    controls: 'D-pad move · A place · B erase · Select tool · Start menu',
  },
  vine: {
    id: 'vine',
    number: '04',
    title: 'Vine',
    genre: 'Classic snake',
    blurb: 'Steer a growing vine to the dewdrops. It gets longer and faster; don’t run into a wall or yourself.',
    controls: 'D-pad steer · A hurry · Start pause',
  },
  glasshouse: {
    id: 'glasshouse',
    number: '05',
    title: 'Glasshouse',
    genre: 'Brick breaker',
    blurb: 'Bounce a pebble off your paddle and break every coloured pane of the glasshouse roof.',
    controls: 'D-pad move · A launch · Start pause',
  },
  rally: {
    id: 'rally',
    number: '06',
    title: 'Rally',
    genre: 'Paddle duel',
    blurb: 'A table game against the console. Angle your returns and be first to seven points.',
    controls: 'D-pad move · A serve · Select difficulty · Start pause',
  },
};
