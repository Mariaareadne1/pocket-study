import type { CartId } from '@/device/machine';
import type { Game, GameHost } from '@/runtime/types';
import { BloomGame } from './bloom';
import { LittleSkyGame } from './littlesky';
import { StarfallGame } from './starfall';

/** The cartridge determines the application. */
export function createGame(id: CartId, host: GameHost): Game {
  switch (id) {
    case 'bloom':
      return new BloomGame(host);
    case 'starfall':
      return new StarfallGame(host);
    case 'littlesky':
      return new LittleSkyGame(host);
  }
}

export const SAVE_KEYS: Record<CartId, string> = { bloom: 'bloom', starfall: 'starfall', littlesky: 'littlesky' };
