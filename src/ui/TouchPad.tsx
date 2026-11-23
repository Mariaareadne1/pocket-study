'use client';
import { useEffect, useRef } from 'react';
import type { PocketController } from '@/app/controller';
import type { Action } from '@/runtime/input';

type Props = { controller: PocketController };

const DIRS: { action: Action; label: string; cls: string }[] = [
  { action: 'up', label: 'Up', cls: 'ps-tp-up' },
  { action: 'left', label: 'Left', cls: 'ps-tp-left' },
  { action: 'right', label: 'Right', cls: 'ps-tp-right' },
  { action: 'down', label: 'Down', cls: 'ps-tp-down' },
];

/**
 * Large on-screen controls for touch devices. Each button holds its action while a pointer is
 * down on it (pointer capture keeps the hold even if the finger drifts) and always releases on
 * up, cancel, lost capture or unmount — so nothing can stick.
 */
export function TouchPad({ controller }: Props) {
  const held = useRef(new Set<Action>());

  useEffect(() => {
    const set = held.current;
    return () => {
      for (const a of set) controller.touch(a, false);
      set.clear();
    };
  }, [controller]);

  const bind = (action: Action) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      held.current.add(action);
      controller.touch(action, true);
    },
    onPointerUp: () => release(action),
    onPointerCancel: () => release(action),
    onLostPointerCapture: () => release(action),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  const release = (action: Action): void => {
    if (!held.current.delete(action)) return;
    controller.touch(action, false);
  };

  return (
    <div className="ps-touchpad" role="group" aria-label="Touch controls">
      <div className="ps-tp-dpad">
        {DIRS.map((d) => (
          <button key={d.action} type="button" className={`ps-tp-btn ${d.cls}`} aria-label={d.label} {...bind(d.action)}>
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="ps-tp-meta">
        <button type="button" className="ps-tp-pill" {...bind('select')}>
          Select
        </button>
        <button type="button" className="ps-tp-pill" {...bind('start')}>
          Start
        </button>
      </div>
      <div className="ps-tp-face">
        <button type="button" className="ps-tp-round ps-tp-b" aria-label="B" {...bind('b')}>
          B
        </button>
        <button type="button" className="ps-tp-round ps-tp-a" aria-label="A" {...bind('a')}>
          A
        </button>
      </div>
    </div>
  );
}
