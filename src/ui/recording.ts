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
  /** False when the take was recorded without the console's sound (its audio wasn't running). */
  sound: boolean;
}

export const MAX_SECONDS = 300;
const VIDEO_BITS = 10_000_000;
/** Frame rate of the scene recording (canvas mode). */
export const CANVAS_FPS = 60;

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

/** How long the audio clock is watched before a take, and the share of that time it must cover. */
export const CLOCK_CHECK_MS = 300;
const CLOCK_MIN_SHARE = 0.25;

/**
 * Whether an audio clock is really moving. A context can report "running" while its output
 * device is stalled; its stream then carries no samples and the recorder waits on it, so the
 * file stops after a second or so. Such takes are recorded without sound instead.
 */
export async function clockRuns(
  read: () => number | null,
  waitMs = CLOCK_CHECK_MS,
  wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
): Promise<boolean> {
  const t0 = read();
  if (t0 === null) return false;
  await wait(waitMs);
  const t1 = read();
  return t1 !== null && t1 - t0 >= (waitMs / 1000) * CLOCK_MIN_SHARE;
}

export const canCaptureCanvas = (): boolean => typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

/** Which source this browser supports; `forced` comes from `?rec=canvas|tab` (tests). */
export function recordMode(forced: string | null): RecordMode | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') return null;
  const tab = typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const canvas = canCaptureCanvas();
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
  const stream = await navigator.mediaDevices.getDisplayMedia(opts);
  // Under load the browser may shrink the capture; an mp4 (avc1) recording stops if its size
  // changes, so ask it to drop frames rather than resolution.
  const track = stream.getVideoTracks()[0];
  if (track) track.contentHint = 'detail';
  return stream;
}

/** A refusal this quick can't be a person pressing Cancel: no share prompt was ever shown. */
export const NO_PROMPT_MS = 600;

/**
 * True when tab capture was refused by the browser or the system rather than by the person: it's
 * unsupported or blocked (embedded browsers, OS screen-recording permission, policy), or it was
 * refused before a share prompt could have been answered. The recorder then films the 3D scene instead.
 */
export function captureBlocked(err: unknown, elapsedMs: number): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'NotSupportedError' || err.name === 'SecurityError' || err.name === 'InvalidStateError' || err.name === 'TypeError') return true;
  if (err.name !== 'NotAllowedError') return false;
  return elapsedMs < NO_PROMPT_MS || /system|policy|not allowed by the user agent/i.test(err.message);
}

/** Records one take. `onEnded` fires if the browser ends the capture (e.g. "Stop sharing"). */
export class DemoRecorder {
  private rec: MediaRecorder | null = null;
  private readonly chunks: Blob[] = [];
  private readonly mime: string;
  private readonly ext: 'mp4' | 'webm';
  private sound = false;
  private started = 0;
  private done: Promise<RecordingResult> | null = null;

  constructor(
    private readonly video: MediaStream,
    readonly mode: RecordMode,
    onEnded: () => void,
  ) {
    const picked = pickMime((m) => MediaRecorder.isTypeSupported(m));
    if (!picked) throw new Error('This browser can’t record video.');
    this.mime = picked.mime;
    this.ext = picked.ext;
    video.getVideoTracks()[0]?.addEventListener('ended', onEnded, { once: true });
  }

  /** Starts the take. The soundtrack is chosen only now, once the audio clock has been checked. */
  start(audio: MediaStream | null): void {
    const tracks = [...this.video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])];
    this.sound = tracks.length > this.video.getVideoTracks().length;
    this.rec = new MediaRecorder(new MediaStream(tracks), { mimeType: this.mime, videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: 192_000 });
    this.rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.started = performance.now();
    this.rec.start(1000);
  }

  get elapsed(): number {
    return this.started ? (performance.now() - this.started) / 1000 : 0;
  }

  stop(): Promise<RecordingResult> {
    if (this.done) return this.done;
    const rec = this.rec;
    if (!this.started || !rec) {
      // Sharing ended during the countdown: nothing was recorded.
      this.video.getTracks().forEach((t) => t.stop());
      this.done = Promise.reject(new DOMException('Stopped before recording began.', 'NotAllowedError'));
      return this.done;
    }
    const seconds = this.elapsed;
    this.done = new Promise<RecordingResult>((resolve, reject) => {
      rec.onstop = () => {
        this.video.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || (this.ext === 'mp4' ? 'video/mp4' : 'video/webm');
        const blob = new Blob(this.chunks, { type: type.split(';')[0] });
        if (blob.size === 0) reject(new Error('The recording came out empty.'));
        else resolve({ blob, ext: this.ext, seconds, mode: this.mode, sound: this.sound });
      };
      if (rec.state === 'inactive') rec.onstop?.(new Event('stop'));
      else rec.stop();
    });
    return this.done;
  }
}
