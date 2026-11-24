'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PocketController } from '@/app/controller';
import { Stage } from '@/engine/stage/Stage';
import { renderTimeline } from '@/runtime/audio';
import { SCREEN_H, SCREEN_W } from '@/runtime/framebuffer';
import { FONTS, fontsReady } from './fonts';
import { Hud } from './Hud';

export interface Engine {
  controller: PocketController;
  stage: Stage;
}

declare global {
  interface Window {
    __pocket?: {
      controller: PocketController;
      stage: Stage;
      ready: boolean;
      inspect: () => Record<string, unknown>;
      /** Capture/tests: advance the virtual clock by n frames at 60 fps, rendering each. */
      advance: (frames: number, dt?: number) => void;
      /** Capture only: renders the logged sounds offline and returns a base64 WAV. */
      soundtrack?: (duration: number, offset?: number) => Promise<string>;
    };
  }
}

function query(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export default function Experience() {
  const host = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);

  const retry = useCallback(() => {
    setFailed(null);
    setLoading(true);
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    let stage: Stage | null = null;
    const q = query();
    const capture = q.has('capture');
    const seedParam = Number(q.get('seed'));
    const controller = new PocketController({
      capture,
      demo: q.has('demo') || capture,
      memory: q.has('memory'),
      seed: Number.isFinite(seedParam) && seedParam > 0 ? seedParam : capture ? 2026 : undefined,
    });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || q.has('reduced');

    const onKeyDown = (e: KeyboardEvent): void => {
      if (controller.keyDown(e)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (controller.keyUp(e)) e.preventDefault();
    };
    const onBlur = (): void => {
      stage?.cancelGestures();
      controller.suspend('blur');
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        stage?.cancelGestures();
        controller.suspend('hidden');
      } else controller.resume();
    };

    (async () => {
      await fontsReady();
      if (disposed || !host.current) return;
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (disposed || !host.current) return;
      if (!webglAvailable()) {
        setFailed('WebGL 2 is not available in this browser.');
        setLoading(false);
        return;
      }
      try {
        stage = new Stage(
          host.current,
          { frame: controller.frame, tick: controller.tick, ...controller.handlers() },
          {
            fonts: FONTS,
            screen: { pixels: controller.runtime.fb.data, width: SCREEN_W, height: SCREEN_H },
            manual: capture,
            preserveBuffer: true,
            reducedMotion: reduced,
            maxDpr: q.has('dpr') ? Number(q.get('dpr')) || 2 : 2,
          },
        );
      } catch (err) {
        setFailed(err instanceof Error ? err.message : 'WebGL could not start.');
        setLoading(false);
        return;
      }
      if (disposed) {
        stage.dispose();
        return;
      }
      const s = stage;
      s.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        setFailed('The graphics context was lost (the GPU may have been reset).');
      });
      window.__pocket = {
        controller,
        stage: s,
        ready: true,
        inspect: () => ({ ...controller.runtime.inspect(), stage: s.debug(), audio: controller.audio.getStats(), exports: controller.exports.length }),
        advance: (frames, dt = 1 / 60) => {
          for (let i = 0; i < frames; i++) s.advance(dt);
        },
      };
      if (capture) {
        window.__pocket.soundtrack = async (duration, offset = 0) => {
          const events = (controller.audio.timeline ?? []).map((ev) => ({ ...ev, t: ev.t - offset })).filter((ev) => ev.t >= 0);
          const cuts = controller.runtime.cuts.map((c) => c - offset).filter((c) => c >= 0);
          const wav = await renderTimeline(events, duration, cuts);
          let bin = '';
          for (let i = 0; i < wav.length; i += 0x8000) bin += String.fromCharCode(...wav.subarray(i, i + 0x8000));
          return btoa(bin);
        };
      }
      setEngine({ controller, stage: s });
      setLoading(false);
    })();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      stage?.dispose();
      controller.dispose();
      setEngine(null);
      delete window.__pocket;
    };
  }, [attempt]);

  return (
    <main className="ps" data-ready={engine ? '' : undefined}>
      <div className="ps-stage" ref={host} key={attempt} />
      {loading && !failed && (
        <div className="ps-loading" role="status">
          Assembling the object…
        </div>
      )}
      {failed && (
        <div className="ps-fail" role="alert">
          <p className="ps-kicker">Object Study / 002</p>
          <h1>The console couldn’t be drawn.</h1>
          <p>
            The console is rendered with WebGL 2, and this browser or device couldn’t start it. A recent Chrome, Safari or Firefox with
            hardware acceleration on should work.
          </p>
          <p className="ps-fail-detail">{failed}</p>
          <button type="button" className="ps-pill ps-pill-ink" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {engine && !failed && <Hud engine={engine} />}
    </main>
  );
}
