'use client';
import type { CartId } from '@/device/machine';
import { CARTS } from '@/runtime/types';
import { guideRows } from './keys';

type Props = { cart: CartId };

/** The keyboard keys for the cartridge that's playing, drawn as keycaps beside the console. */
export function KeyGuide({ cart }: Props) {
  const rows = guideRows(CARTS[cart].controls);
  return (
    <aside className="ps-keys" aria-label={`Keyboard controls for ${CARTS[cart].title}`}>
      <p className="ps-keys-head">Keyboard</p>
      <dl>
        {rows.map((r) => (
          <div key={`${r.keys.join('')}-${r.label}`} className="ps-keys-row">
            <dt>
              {r.keys.map((k) => (
                <kbd key={k} data-wide={k.length > 1 || undefined}>
                  {k}
                </kbd>
              ))}
            </dt>
            <dd>{r.label}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
