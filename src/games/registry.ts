import type { CartId } from '@/device/machine';
import type { Game, GameHost } from '@/runtime/types';
import { BloomGame } from './bloom';
import { GlasshouseGame } from './glasshouse';
import { LittleSkyGame } from './littlesky';
import { RallyGame } from './rally';
import { StarfallGame } from './starfall';
import { VineGame } from './vine';

/** The cartridge determines the application. */
export function createGame(id: CartId, host: GameHost): Game {
  switch (id) {
    case 'bloom':
      return new BloomGame(host);
    case 'starfall':
      return new StarfallGame(host);
    case 'littlesky':
      return new LittleSkyGame(host);
    case 'vine':
      return new VineGame(host);
    case 'glasshouse':
      return new GlasshouseGame(host);
    case 'rally':
      return new RallyGame(host);
  }
}

export const SAVE_KEYS: Record<CartId, string> = {
  bloom: 'bloom',
  starfall: 'starfall',
  littlesky: 'littlesky',
  vine: 'vine',
  glasshouse: 'glasshouse',
  rally: 'rally',
};
