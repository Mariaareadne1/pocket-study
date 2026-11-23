'use client';
import { useEffect, useRef, useState } from 'react';
import type { PocketController } from '@/app/controller';

type Props = { controller: PocketController; onClose: () => void };

/** Credits and data controls, in a native modal dialog (focus trap and Escape come for free). */
export function Credits({ controller, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    const close = (): void => onClose();
    d.addEventListener('close', close);
    return () => d.removeEventListener('close', close);
  }, [onClose]);

  const clear = (): void => {
    controller.clearData();
    setConfirming(false);
    setCleared(true);
  };

  return (
    <dialog ref={ref} className="ps-dialog" aria-labelledby="ps-credits-title">
      <p className="ps-kicker">Object Study / 002</p>
      <h2 id="ps-credits-title">Pocket Study</h2>
      <p>
        A transparent handheld console, built in the browser with three.js. Every cartridge is an original game drawn into a
        160 × 144 framebuffer on the object’s screen.
      </p>
      <h3>Rendering</h3>
      <p>
        The clear plastic is rendered with techniques adapted from{' '}
        <a href="https://github.com/annnguyentt/vibe-coding/tree/main/cd-case" target="_blank" rel="noopener noreferrer">
          Ann Nguyen’s CD Case
        </a>{' '}
        (made with{' '}
        <a href="https://www.typingmind.com" target="_blank" rel="noopener noreferrer">
          TypingMind
        </a>
        ): the baked studio, ray-traced refraction rods and the star pass. Thank you, Ann.
      </p>
      <h3>Code</h3>
      <p>
        The seeded random number generator comes from{' '}
        <a href="https://github.com/C0deWiz4rd010/retro-pocket-games" target="_blank" rel="noopener noreferrer">
          retro-pocket-games
        </a>{' '}
        (MIT). Everything else — the console, PCB, games, sprites, font and sounds — was made for this study. No console makers’
        marks, ROMs or game assets are used.
      </p>
      <h3>Saved data</h3>
      <p>Garden, high score and sky are saved in this browser only.</p>
      {confirming ? (
        <div className="ps-confirm" role="alertdialog" aria-labelledby="ps-confirm-q">
          <p id="ps-confirm-q">
            <strong>Clear all saved progress?</strong> Your garden, best score and sky will be deleted. This can’t be undone.
          </p>
          <div className="ps-row">
            <button type="button" className="ps-pill" onClick={() => setConfirming(false)} autoFocus>
              Keep it
            </button>
            <button type="button" className="ps-pill ps-pill-warn" onClick={clear}>
              Clear data
            </button>
          </div>
        </div>
      ) : (
        <div className="ps-row">
          <button type="button" className="ps-pill" onClick={() => setConfirming(true)}>
            Clear saved data…
          </button>
          {cleared && <span role="status">Cleared.</span>}
        </div>
      )}
      <form method="dialog" className="ps-row ps-row-end">
        <button type="submit" className="ps-pill ps-pill-ink">
          Close
        </button>
      </form>
    </dialog>
  );
}
