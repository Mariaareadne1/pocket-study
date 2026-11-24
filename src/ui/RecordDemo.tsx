'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PocketController } from '@/app/controller';
import { CART_IDS } from '@/device/machine';
import type { OnShow } from '@/engine/stage/Stage';
import { CARTS } from '@/runtime/types';
import { DemoRecorder, MAX_SECONDS, type RecordMode, canvasStream, demoFileName, formatDuration, recordMode, requestTab } from './recording';

type Phase = { kind: 'idle' } | { kind: 'asking' } | { kind: 'countdown'; n: number } | { kind: 'recording' } | { kind: 'saving' };

interface Props {
  controller: PocketController;
  canvas: HTMLCanvasElement;
  onMessage: (text: string) => void;
  /** The single cartridge on show, 'none' for the console alone, or null for all of them. */
  only: OnShow;
  onOnly: (id: OnShow) => void;
}

const COUNTDOWN = 3;
const STOP_KEY = 'KeyR';

const nextFrames = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60))));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const message = (err: unknown): string => {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Recording cancelled.';
  return `Couldn’t record: ${err instanceof Error ? err.message : 'unknown error'}`;
};

/**
 * "Record demo" control. In tab mode the whole control (button, countdown, timer) is removed from
 * the page before the first recorded frame, so the film shows only the app. Stop with R or the
 * browser's own Stop sharing button. In canvas mode the Stop button stays visible: it is page UI,
 * which a canvas recording never contains.
 */
export function RecordDemo({ controller, canvas, onMessage, only, onOnly }: Props) {
  const [mode, setMode] = useState<RecordMode | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<DemoRecorder | null>(null);
  const cancelled = useRef(false);

  useEffect(() => setMode(recordMode(new URLSearchParams(window.location.search).get('rec'))), []);

  const finish = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase({ kind: 'saving' });
    try {
      const result = await r.stop();
      const name = demoFileName(new Date(), result.ext);
      saveBlob(result.blob, name);
      onMessage(`Saved ${name} (${formatDuration(result.seconds)}).`);
    } catch (err) {
      onMessage(message(err));
    } finally {
      controller.audio.releaseRecording();
      setPhase({ kind: 'idle' });
    }
  }, [controller, onMessage]);

  useEffect(() => {
    if (phase.kind !== 'recording') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== STOP_KEY || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      void finish();
    };
    const tick = window.setInterval(() => {
      const s = rec.current?.elapsed ?? 0;
      setElapsed(s);
      if (s >= MAX_SECONDS) void finish();
    }, 250);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearInterval(tick);
    };
  }, [phase.kind, finish]);

  useEffect(() => {
    cancelled.current = false; // React dev mode mounts twice; the first cleanup must not stick
    return () => {
      cancelled.current = true;
      void rec.current?.stop().catch(() => undefined);
      rec.current = null;
      controller.audio.releaseRecording();
    };
  }, [controller]);

  const begin = async (): Promise<void> => {
    if (!mode) return;
    controller.unlockAudio();
    setPhase({ kind: 'asking' });
    let video: MediaStream;
    try {
      // getDisplayMedia must be called synchronously inside the click (user gesture).
      video = mode === 'tab' ? await requestTab() : canvasStream(canvas);
    } catch (err) {
      onMessage(message(err));
      setPhase({ kind: 'idle' });
      return;
    }
    let recorder: DemoRecorder;
    try {
      recorder = new DemoRecorder(video, controller.audio.recordingStream(), mode, () => void finish());
    } catch (err) {
      video.getTracks().forEach((t) => t.stop());
      onMessage(message(err));
      setPhase({ kind: 'idle' });
      return;
    }
    rec.current = recorder;
    for (let n = COUNTDOWN; n > 0; n--) {
      setPhase({ kind: 'countdown', n });
      await sleep(1000);
      if (cancelled.current || rec.current !== recorder) return;
    }
    setElapsed(0);
    setPhase({ kind: 'recording' });
    await nextFrames(); // the control is gone from the page before the first recorded frame
    if (rec.current === recorder) recorder.start();
  };

  const tab = mode === 'tab';

  if (phase.kind === 'recording') {
    if (tab) return null;
    return (
      <div className="ps-rec">
        <button type="button" className="ps-pill ps-pill-rec" onClick={() => void finish()}>
          <i aria-hidden="true" /> Stop · {formatDuration(elapsed)}
        </button>
      </div>
    );
  }

  if (phase.kind === 'countdown') {
    return (
      <div className="ps-rec" role="status" aria-live="assertive">
        <p className="ps-rec-count">
          <b>{phase.n}</b>
          {tab ? 'This button hides while recording. Press R, or Stop sharing in the browser, to finish.' : 'Recording the console. Press Stop to finish.'}
        </p>
      </div>
    );
  }

  return (
    <div className="ps-rec">
      <label className="ps-pill ps-show" title="Show every cartridge, or just one for a demo">
        <span className="ps-sr">Cartridges on show</span>
        <select
          value={only ?? ''}
          onChange={(e) => onOnly(e.target.value === 'none' ? 'none' : (CART_IDS.find((c) => c === e.target.value) ?? null))}
          disabled={phase.kind !== 'idle'}
        >
          <option value="">All cartridges</option>
          <option value="none">No cartridges</option>
          {CART_IDS.map((id) => (
            <option key={id} value={id}>
              Only {CARTS[id].title}
            </option>
          ))}
        </select>
      </label>
      {mode && (
        <button
          type="button"
          className="ps-pill"
          onClick={() => void begin()}
          disabled={phase.kind !== 'idle'}
          aria-label={phase.kind === 'idle' ? 'Record demo' : undefined}
          title={tab ? 'Records this tab. The button hides while recording; press R to stop.' : 'Records the console scene with sound.'}
        >
          <i className="ps-rec-dot" aria-hidden="true" />{' '}
          {phase.kind === 'saving' ? (
            'Saving…'
          ) : phase.kind === 'asking' ? (
            'Choose “this tab”…'
          ) : (
            <span>
              Record<span className="ps-rec-long"> demo</span>
            </span>
          )}
        </button>
      )}
    </div>
  );
}
