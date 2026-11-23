import { useSyncExternalStore } from 'react';
import type { PocketController } from '@/app/controller';
import type { ConsoleSnapshot } from '@/runtime/console';

/** Subscribes a component to the console's coarse state (power, slot, app, phase, message). */
export function useConsole(controller: PocketController): ConsoleSnapshot {
  return useSyncExternalStore(
    (cb) => controller.runtime.subscribe(() => cb()),
    () => cached(controller),
    () => cached(controller),
  );
}

// useSyncExternalStore needs a stable snapshot between changes.
const last = new WeakMap<PocketController, { key: string; snap: ConsoleSnapshot }>();
function cached(c: PocketController): ConsoleSnapshot {
  const snap = c.runtime.snapshot();
  const s = snap.device;
  const key = `${s.power}|${s.slot}|${s.cart}|${s.selected}|${s.dragging}|${s.nearSlot}|${snap.screen}|${snap.app}|${snap.phase}|${snap.messageId}`;
  const prev = last.get(c);
  if (prev && prev.key === key) return prev.snap;
  last.set(c, { key, snap });
  return snap;
}
