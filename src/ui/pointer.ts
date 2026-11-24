/**
 * The pointer in demo recordings. Browsers leave the system cursor out of tab and canvas captures,
 * so the recorder draws its own: a DOM arrow on the page for tab recordings, and the same arrow
 * composited into the video for canvas recordings. Touches show as a soft dot while pressed.
 */
export interface PointerState {
  x: number;
  y: number;
  /** Mouse or pen (arrow), or touch (dot). */
  touch: boolean;
  down: boolean;
  /** Seen at least once (nothing is drawn before the pointer has moved over the page). */
  seen: boolean;
}

/** The arrow outline in CSS px, tip at (0, 0). Shared by the DOM cursor and the canvas drawing. */
export const ARROW = 'M0 0 L0 17 L4.2 13.1 L7.1 19.6 L10 18.3 L7.2 12 L12.6 12 Z';
const TOUCH_R = 14;

const TYPES = ['pointermove', 'pointerdown', 'pointerup', 'pointercancel'] as const;

/** Where the pointer was last seen, so a recording can show it before it next moves. */
const last: PointerState = { x: 0, y: 0, touch: false, down: false, seen: false };
let watching = false;

const update = (state: PointerState, e: PointerEvent): void => {
  state.x = e.clientX;
  state.y = e.clientY;
  state.touch = e.pointerType === 'touch';
  state.seen = true;
  if (e.type === 'pointerdown') state.down = true;
  else if (e.type === 'pointerup' || e.type === 'pointercancel') state.down = false;
};

/** Starts remembering the pointer position for the page's lifetime (idempotent). */
export function watchPointer(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  TYPES.forEach((t) => window.addEventListener(t, (e) => update(last, e), { capture: true, passive: true }));
}

/** Tracks the page pointer from its last known position; `stop()` removes the listeners. */
export function trackPointer(onChange?: (p: PointerState) => void): { state: PointerState; stop: () => void } {
  const state: PointerState = { ...last, down: false };
  const on = (e: PointerEvent): void => {
    update(state, e);
    onChange?.(state);
  };
  TYPES.forEach((t) => window.addEventListener(t, on, { capture: true, passive: true }));
  if (state.seen) onChange?.(state);
  return { state, stop: () => TYPES.forEach((t) => window.removeEventListener(t, on, { capture: true })) };
}

/** Draws the pointer into a 2D context; `scale` maps CSS px to the context's pixels. */
export function drawPointer(ctx: CanvasRenderingContext2D, p: PointerState, x: number, y: number, scale: number): void {
  if (!p.seen) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  if (p.touch) {
    if (p.down) {
      ctx.beginPath();
      ctx.arc(0, 0, TOUCH_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28, 27, 34, 0.22)';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (p.down) {
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(91, 74, 156, 0.25)';
    ctx.fill();
  }
  const arrow = new Path2D(ARROW);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#1c1b22';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.stroke(arrow);
  ctx.shadowColor = 'transparent';
  ctx.fill(arrow);
  ctx.restore();
}

/**
 * A canvas stream of the 3D scene with the pointer drawn on top. `draw()` must run right after each
 * scene frame (Stage.afterFrame), while the WebGL drawing buffer still holds the picture.
 */
export class PointerCompositor {
  readonly out: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly pointer: ReturnType<typeof trackPointer>;

  constructor(private readonly scene: HTMLCanvasElement) {
    this.out = document.createElement('canvas');
    const ctx = this.out.getContext('2d');
    if (!ctx) throw new Error('This browser can’t draw the recording.');
    this.ctx = ctx;
    this.pointer = trackPointer();
    // The video's size is fixed for the whole take: an mp4 (avc1) recording stops if it changes.
    // Even dimensions keep H.264 happy.
    this.out.width = Math.max(2, scene.width & ~1);
    this.out.height = Math.max(2, scene.height & ~1);
    this.draw();
  }

  draw(): void {
    const { scene, out, ctx } = this;
    ctx.drawImage(scene, 0, 0, out.width, out.height);
    const r = scene.getBoundingClientRect();
    const k = r.width > 0 ? out.width / r.width : 1;
    drawPointer(this.ctx, this.pointer.state, (this.pointer.state.x - r.left) * k, (this.pointer.state.y - r.top) * k, k);
  }

  dispose(): void {
    this.pointer.stop();
  }
}
