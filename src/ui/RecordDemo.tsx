'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PocketController } from '@/app/controller';
import { CART_IDS } from '@/device/machine';
import type { OnShow, Stage } from '@/engine/stage/Stage';
import { PointerCompositor, watchPointer } from './pointer';
import { RecordPointer } from './RecordPointer';
import { CARTS } from '@/runtime/types';
import {
  CANVAS_FPS,
  DemoRecorder,
  MAX_SECONDS,
  type RecordMode,
  canCaptureCanvas,
  captureBlocked,
  clockRuns,
  demoFileName,
  formatDuration,
  recordMode,
  requestTab,
} from './recording';

type Phase = { kind: 'idle' } | { kind: 'asking' } | { kind: 'countdown'; n: number } | { kind: 'recording' } | { kind: 'saving' };

interface Props {
  controller: PocketController;
  stage: Stage;
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
export function RecordDemo({ controller, stage, onMessage, only, onOnly }: Props) {
  const [mode, setMode] = useState<RecordMode | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<DemoRecorder | null>(null);
  const cancelled = useRef(false);
  const comp = useRef<PointerCompositor | null>(null);

  /** The 3D scene with the pointer drawn in (canvas captures leave the cursor out). */
  const sceneStream = (): MediaStream => {
    const c = new PointerCompositor(stage.canvas);
    comp.current = c;
    stage.afterFrame = () => c.draw();
    return c.out.captureStream(CANVAS_FPS);
  };
  const releaseScene = useCallback((): void => {
    stage.holdResolution = false;
    if (!comp.current) return;
    stage.afterFrame = null;
    comp.current.dispose();
    comp.current = null;
  }, [stage]);

  useEffect(() => {
    setMode(recordMode(new URLSearchParams(window.location.search).get('rec')));
    watchPointer();
  }, []);

  const finish = useCallback(async () => {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    setPhase({ kind: 'saving' });
    try {
      const result = await r.stop();
      const name = demoFileName(new Date(), result.ext);
      saveBlob(result.blob, name);
      onMessage(`Saved ${name} (${formatDuration(result.seconds)}).${result.sound ? '' : ' No sound: the browser’s audio wasn’t running.'}`);
    } catch (err) {
      onMessage(message(err));
    } finally {
      controller.audio.releaseRecording();
      releaseScene();
      setPhase({ kind: 'idle' });
    }
  }, [controller, onMessage, releaseScene]);

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

  // While recording, every word and control on the page is hidden so the film shows only the console.
  // Set before the first recorded frame (start waits two frames after this commit).
  useEffect(() => {
    // A canvas recording never contains page UI, so the controls stay usable there.
    if (phase.kind !== 'recording' || mode !== 'tab') return;
    const root = document.documentElement;
    root.dataset.recording = '';
    return () => {
      delete root.dataset.recording;
    };
  }, [phase.kind, mode]);

  useEffect(() => {
    cancelled.current = false; // React dev mode mounts twice; the first cleanup must not stick
    return () => {
      cancelled.current = true;
      void rec.current?.stop().catch(() => undefined);
      rec.current = null;
      controller.audio.releaseRecording();
      releaseScene();
    };
  }, [controller, releaseScene]);

  const begin = async (): Promise<void> => {
    if (!mode) return;
    controller.unlockAudio();
    setPhase({ kind: 'asking' });
    let source: RecordMode = mode;
    let video: MediaStream;
    const asked = performance.now();
    const notes: string[] = [];
    try {
      // getDisplayMedia must be called synchronously inside the click (user gesture).
      video = mode === 'tab' ? await requestTab() : sceneStream();
    } catch (err) {
      // Blocked by the browser or system (not the person's Cancel): film the 3D scene instead,
      // and go straight to that next time.
      if (mode !== 'tab' || !captureBlocked(err, performance.now() - asked) || !canCaptureCanvas()) {
        onMessage(message(err));
        setPhase({ kind: 'idle' });
        return;
      }
      source = 'canvas';
      setMode('canvas');
      video = sceneStream();
      notes.push('This browser doesn’t allow tab capture, so it’s recording the console scene instead.');
    }
    if (notes.length) onMessage(notes.join(' '));
    let recorder: DemoRecorder;
    try {
      recorder = new DemoRecorder(video, source, () => void finish());
    } catch (err) {
      video.getTracks().forEach((t) => t.stop());
      releaseScene();
      onMessage(message(err));
      setPhase({ kind: 'idle' });
      return;
    }
    rec.current = recorder;
    // The audio clock is checked during the last second, right before the take: a context can run for
    // a moment after it's created and then stall, and a stalled soundtrack cuts the film short.
    let sound: Promise<boolean> | null = null;
    for (let n = COUNTDOWN; n > 0; n--) {
      setPhase({ kind: 'countdown', n });
      if (n === 1) sound = clockRuns(() => controller.audio.contextTime);
      await sleep(1000);
      if (cancelled.current || rec.current !== recorder) {
        releaseScene();
        return;
      }
    }
    const withSound = await (sound ?? clockRuns(() => controller.audio.contextTime));
    if (cancelled.current || rec.current !== recorder) {
      releaseScene();
      return;
    }
    setElapsed(0);
    stage.holdResolution = true;
    setPhase({ kind: 'recording' });
    await nextFrames(); // the control is gone from the page before the first recorded frame
    if (rec.current === recorder) recorder.start(withSound ? controller.audio.recordingStream() : null);
  };

  const tab = mode === 'tab';

  if (phase.kind === 'recording') {
    if (tab) return <RecordPointer />;
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
