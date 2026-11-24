'use client';
import { useEffect, useRef } from 'react';
import { ARROW, trackPointer } from './pointer';

/**
 * The mouse pointer for tab recordings: tab capture leaves out the system cursor, so this arrow
 * (page content, so it is in the film) follows the pointer while the system cursor is hidden.
 */
export function RecordPointer() {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const { stop } = trackPointer((p) => {
      const node = el.current;
      if (!node) return;
      node.style.transform = `translate(${p.x}px, ${p.y}px)`;
      node.dataset.show = String(p.seen && !p.touch);
      node.dataset.down = String(p.down);
    });
    return stop;
  }, []);
  return (
    <div ref={el} className="ps-pointer" aria-hidden="true" data-show="false">
      <i />
      <svg width="16" height="22" viewBox="-1 -1 16 22">
        <path d={ARROW} />
      </svg>
    </div>
  );
}
