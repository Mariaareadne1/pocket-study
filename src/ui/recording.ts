/**
 * Demo recorder. Two sources:
 *  - 'tab': the whole page via getDisplayMedia (Chrome/Edge offer "this tab" first). The Record
 *    control is removed from the page before recording starts, so it never appears in the film.
 *  - 'canvas': the 3D canvas only (browsers without screen capture, e.g. phones). Page controls
 *    are never in a canvas stream, so a Stop button can stay on screen.
 * The app's own Web Audio output is mixed in as the soundtrack either way.
 */
export type RecordMode = 'tab' | 'canvas';

export interface RecordingResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  seconds: number;
  mode: RecordMode;
}

export const MAX_SECONDS = 300;
const VIDEO_BITS = 10_000_000;
const CANVAS_FPS = 60;

const MIME_PREFERENCE = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

/** First container/codec the browser can record, mp4 preferred (plays everywhere). */
export function pickMime(isSupported: (m: string) => boolean): { mime: string; ext: 'mp4' | 'webm' } | null {
  const mime = MIME_PREFERENCE.find((m) => {
    try {
      return isSupported(m);
    } catch {
      return false;
    }
  });
  return mime ? { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}

const two = (n: number): string => String(n).padStart(2, '0');

export function demoFileName(at: Date, ext: string): string {
  const d = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  const t = `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
  return `handheld-demo-${d}-${t}.${ext}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${two(s % 60)}`;
}

/** Which source this browser supports; `forced` comes from `?rec=canvas|tab` (tests). */
export function recordMode(forced: string | null): RecordMode | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return null;
  const tab = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const canvas = typeof HTMLCanvasElement.prototype.captureStream === 'function';
  if (forced === 'canvas' && canvas) return 'canvas';
  if (forced === 'tab' && tab) return 'tab';
  return tab ? 'tab' : canvas ? 'canvas' : null;
}

/** Asks for this tab (must run inside the click handler: it needs a user gesture). */
export async function requestTab(): Promise<MediaStream> {
  const opts = {
    video: { frameRate: { ideal: 60 }, displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions;
  return navigator.mediaDevices.getDisplayMedia(opts);
}

export function canvasStream(canvas: HTMLCanvasElement): MediaStream {
  return canvas.captureStream(CANVAS_FPS);
}

/** Records one take. `onEnded` fires if the browser ends the capture (e.g. "Stop sharing"). */
export class DemoRecorder {
  private readonly rec: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly ext: 'mp4' | 'webm';
  private started = 0;
  private done: Promise<RecordingResult> | null = null;

  constructor(
    private readonly video: MediaStream,
    audio: MediaStream | null,
    readonly mode: RecordMode,
    onEnded: () => void,
  ) {
    const picked = pickMime((m) => MediaRecorder.isTypeSupported(m));
    if (!picked) throw new Error('This browser can’t record video.');
    this.ext = picked.ext;
    const tracks = [...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])];
    this.rec = new MediaRecorder(new MediaStream(tracks), { mimeType: picked.mime, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: 192_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    video.getVideoTracks()[0]?.addEventListener('ended', onEnded, { once: true });
  }

  start(): void {
    this.started = performance.now();
    this.rec.start(1000);
  }

  get elapsed(): number {
    return this.started ? (performance.now() - this.started) / 1000 : 0;
  }

  stop(): Promise<RecordingResult> {
    if (this.done) return this.done;
    if (!this.started) {
      // Sharing ended during the countdown: nothing was recorded.
      this.video.getTracks().forEach((t) => t.stop());
      this.done = Promise.reject(new DOMException('Stopped before recording began.', 'NotAllowedError'));
      return this.done;
    }
    const seconds = this.elapsed;
    this.done = new Promise<RecordingResult>((resolve, reject) => {
      this.rec.onstop = () => {
        this.video.getTracks().forEach((t) => t.stop());
        const type = this.rec.mimeType || (this.ext === 'mp4' ? 'video/mp4' : 'video/webm');
        const blob = new Blob(this.chunks, { type: type.split(';')[0] });
        if (blob.size === 0) reject(new Error('The recording came out empty.'));
        else resolve({ blob, ext: this.ext, seconds, mode: this.mode });
      };
      if (this.rec.state === 'inactive') this.rec.onstop?.(new Event('stop'));
      else this.rec.stop();
    });
    return this.done;
  }
}
