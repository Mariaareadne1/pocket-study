'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadDataUrl } from '@/app/controller';
import { BLOCK_MESSAGES, CART_IDS, type CartId } from '@/device/machine';
import type { ConsoleSnapshot } from '@/runtime/console';
import { CARTS } from '@/runtime/types';
import { Credits } from './Credits';
import { KeyGuide } from './KeyGuide';
import { keyHint } from './keys';
import { RecordDemo } from './RecordDemo';
import type { OnShow } from '@/engine/stage/Stage';
import type { Engine } from './Experience';
import { TouchPad } from './TouchPad';
import { useConsole } from './useConsole';

type Props = { engine: Engine };

const POWER_LABEL: Record<string, string> = {
  off: 'Off',
  booting: 'Starting',
  ready: 'On',
  playing: 'Playing',
  paused: 'Paused',
  shutting_down: 'Switching off',
};

function hintFor(s: ConsoleSnapshot, only: OnShow): string {
  const d = s.device;
  if (d.dragging) return d.nearSlot ? 'Let go to slide it into the slot.' : 'Bring the cartridge up to the slot on the top edge.';
  if (d.slot === 'inserting') return 'Seating the cartridge…';
  if (d.slot === 'ejecting') return 'Ejecting…';
  if (d.power === 'off') {
    if (d.slot === 'inserted') return 'Flick the power switch on the top edge to switch on.';
    if (d.selected) return 'Drag it into the slot on top, or tap it again to insert.';
    if (only === 'none') return 'Just the console. Drag to turn it, or flick the power switch on the top edge.';
    return 'Choose a cartridge, then drag it into the slot on top.';
  }
  if (d.power === 'booting') return 'Starting up…';
  if (d.power === 'shutting_down') return 'Switching off…';
  if (!d.cart) return 'No cartridge. Switch off, then insert one.';
  if (s.phase === 'title') return 'Press Start (Enter) to begin.';
  if (s.phase === 'paused') return 'Paused — Start or B to resume.';
  if (s.phase === 'over') return 'Press Start to play again.';
  return keyHint(CARTS[d.cart].controls);
}

const KEYS_PREF = 'ps-show-keys';

function readKeysPref(): boolean {
  try {
    return window.localStorage.getItem(KEYS_PREF) !== '0';
  } catch {
    return true;
  }
}

function writeKeysPref(on: boolean): void {
  try {
    window.localStorage.setItem(KEYS_PREF, on ? '1' : '0');
  } catch {
    // storage blocked (private window): the choice just isn't remembered
  }
}

/** `?only=vine` shows a single cartridge, `?only=none` the console alone (for demos). Unknown values are ignored. */
function readOnly(): OnShow {
  const id = new URLSearchParams(window.location.search).get('only');
  if (id === 'none') return 'none';
  return CART_IDS.find((c) => c === id) ?? null;
}

function writeOnly(id: OnShow): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('only', id);
  else url.searchParams.delete('only');
  window.history.replaceState(window.history.state, '', url);
}

function useCoarse(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(pointer: coarse)');
    const on = (): void => setCoarse(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return coarse;
}

export function Hud({ engine }: Props) {
  const { controller, stage } = engine;
  const snap = useConsole(controller);
  const d = snap.device;
  const coarse = useCoarse();
  const [muted, setMuted] = useState(controller.settings.muted);
  const [touch, setTouch] = useState<boolean | null>(null);
  const [credits, setCredits] = useState(false);
  const [keys, setKeys] = useState(true);
  const [only, setOnlyState] = useState<OnShow>(null);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<number>(0);

  const show = useCallback((text: string): void => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text });
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => setKeys(readKeysPref()), []);

  useEffect(() => {
    const id = readOnly();
    stage.setOnly(id);
    setOnlyState(id);
  }, [stage]);

  const setOnly = useCallback(
    (id: OnShow): void => {
      stage.setOnly(id);
      writeOnly(id);
      setOnlyState(id);
    },
    [stage],
  );

  useEffect(() => {
    if (snap.message) show(snap.message);
  }, [snap.messageId, snap.message, show]);

  useEffect(() => {
    controller.onExport = (r) => show(r.width ? `Saved ${r.name} (${r.width} × ${r.height}).` : `Couldn’t export: ${r.name}`);
    return () => {
      controller.onExport = null;
      window.clearTimeout(toastTimer.current);
    };
  }, [controller, show]);

  useEffect(() => {
    if (d.cart && d.slot === 'inserted') controller.setLastCart(d.cart);
  }, [controller, d.cart, d.slot]);

  const focusCart: CartId | null = d.dragging ?? d.cart ?? d.selected;
  const soloCart = only === 'none' ? null : only;
  const cardCart = focusCart ?? soloCart;
  const info = cardCart ? CARTS[cardCart] : null;
  const trayIds = CART_IDS.filter((id) => only === null || id === only || id === d.cart || id === d.selected);
  const on = d.power !== 'off';
  const showTouch = (touch ?? coarse) && on;
  const showKeys = keys && !coarse && !showTouch && on && d.cart !== null && d.slot === 'inserted';
  const toggleKeys = (): void => {
    writeKeysPref(!keys);
    setKeys(!keys);
  };

  const toggleMute = (): void => {
    controller.unlockAudio();
    controller.setMuted(!muted);
    setMuted(!muted);
  };
  const photo = (): void => {
    try {
      downloadDataUrl(stage.snapshot(), 'handheld.png');
      show('Saved handheld.png.');
    } catch {
      show('Couldn’t capture the scene in this browser.');
    }
  };
  const insertOrEject = (): void => {
    controller.unlockAudio();
    if (d.slot === 'inserted') controller.runtime.eject();
    else if (d.selected) controller.runtime.insert(d.selected);
    else if (soloCart) controller.runtime.insert(soloCart);
    else show(BLOCK_MESSAGES['no-cart']);
  };
  const power = (): void => {
    controller.unlockAudio();
    controller.runtime.togglePower();
  };

  return (
    <>
      <header className="ps-mast">
        <p className="ps-kicker">Object Study / 002</p>
        <h1 className="ps-sr">Handheld console</h1>
        <p className="ps-hint" aria-live="polite">
          {hintFor(snap, only)}
        </p>
      </header>

      <nav className="ps-actions" aria-label="View and sound">
        <button type="button" className="ps-pill" aria-pressed={!muted} onClick={toggleMute}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
        {!coarse && (
          <button type="button" className="ps-pill" aria-pressed={keys} onClick={toggleKeys} title="Show the keyboard controls while playing">
            Keys
          </button>
        )}
        <button type="button" className="ps-pill" onClick={() => stage.resetView()}>
          Reset view
        </button>
        <button type="button" className="ps-pill" onClick={photo}>
          Photo
        </button>
        <button type="button" className="ps-pill" onClick={() => setCredits(true)}>
          Credits
        </button>
      </nav>

      <section className="ps-card" aria-labelledby="ps-card-title">
        <div className="ps-card-head">
          <span className="ps-status" data-power={d.power}>
            <i aria-hidden="true" /> {POWER_LABEL[d.power]}
          </span>
          <span className="ps-slot">{d.slot === 'inserted' && d.cart ? `Slot · ${CARTS[d.cart].title}` : d.slot === 'empty' ? 'Slot empty' : 'Slot busy'}</span>
        </div>
        {info ? (
          <>
            <p className="ps-card-num">Cartridge {info.number}</p>
            <h2 id="ps-card-title" className="ps-card-title">
              {info.title} <span>{info.genre}</span>
            </h2>
            <p className="ps-card-blurb">{info.blurb}</p>
            <p className="ps-card-controls">{info.controls}</p>
          </>
        ) : (
          <>
            <h2 id="ps-card-title" className="ps-card-title">
              {only === 'none' ? 'The console' : 'Six cartridges'}
            </h2>
            <p className="ps-card-blurb">
              {only === 'none'
                ? 'No cartridges on show, just the handheld. Bring them back with the menu at the bottom.'
                : 'A garden, a starfield and a little sky, plus three classics: a vine, a glasshouse and a rally. Pick one to read about it.'}
            </p>
          </>
        )}
        <div className="ps-card-actions">
          <button type="button" className="ps-pill" onClick={insertOrEject} disabled={d.slot === 'inserting' || d.slot === 'ejecting'}>
            {d.slot === 'inserted' ? 'Eject' : 'Insert'}
          </button>
          <button type="button" className="ps-pill ps-pill-ink" onClick={power} aria-pressed={on}>
            {on ? 'Power off' : 'Power on'}
          </button>
        </div>
      </section>

      <nav className="ps-tray" aria-label="Cartridges">
        {trayIds.map((id) => {
          const c = CARTS[id];
          const where = d.cart === id ? 'in the console' : d.selected === id ? 'selected' : 'on the tray';
          return (
            <button
              key={id}
              type="button"
              className="ps-chip"
              aria-pressed={d.selected === id || d.cart === id}
              aria-label={`${c.title}, cartridge ${c.number}, ${where}`}
              data-cart={id}
              onClick={() => {
                controller.unlockAudio();
                controller.tapCart(id);
              }}
            >
              <b>{c.number}</b> {c.title}
            </button>
          );
        })}
        {coarse || touch !== null ? (
          <button type="button" className="ps-chip ps-chip-quiet" aria-pressed={showTouch} onClick={() => setTouch(!(touch ?? coarse))}>
            Touch pad
          </button>
        ) : null}
      </nav>

      {showKeys && d.cart && <KeyGuide cart={d.cart} />}

      {!showTouch && <RecordDemo controller={controller} canvas={stage.canvas} onMessage={show} only={only} onOnly={setOnly} />}

      {toast && (
        <p key={toast.id} className="ps-toast" role="status">
          {toast.text}
        </p>
      )}

      {showTouch && <TouchPad controller={controller} />}
      {credits && <Credits controller={controller} onClose={() => setCredits(false)} />}
    </>
  );
}
