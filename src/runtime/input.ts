/**
 * Unified input. Every source (3D buttons, keyboard, touch pad, gamepad) holds actions under its
 * own source id, so two sources holding the same button never release each other, and dropping
 * one source (a cancelled touch, a lost pointer) cannot leave a button stuck.
 *
 * The physical layer (which buttons are depressed right now) is always tracked so the 3D buttons
 * move and click even when the console is off. Games only ever see `PadFrame`s polled by the
 * console runtime on its fixed tick, and only while the console is playable.
 */
export const ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'] as const;
export type Action = (typeof ACTIONS)[number];

export interface PadFrame {
  /** Held at the moment of polling, or pressed and released since the previous poll. */
  readonly held: ReadonlySet<Action>;
  /** Went down since the previous poll (sub-tick taps are never lost). */
  readonly pressed: ReadonlySet<Action>;
}

export type InputListener = (action: Action, down: boolean) => void;

export const EMPTY_FRAME: PadFrame = { held: new Set(), pressed: new Set() };

/** Taps queued between polls beyond this are dropped, so a long stall never replays a burst of input. */
const MAX_QUEUED_PRESSES = 4;

export class InputHub {
  private readonly holds = new Map<string, Set<Action>>();
  private readonly pressCount = new Map<Action, number>();
  private readonly listeners = new Set<InputListener>();

  /** Source ids holding `action`. */
  private holders(action: Action): number {
    let n = 0;
    for (const set of this.holds.values()) if (set.has(action)) n++;
    return n;
  }

  isHeld(action: Action): boolean {
    return this.holders(action) > 0;
  }

  get heldSet(): Set<Action> {
    const out = new Set<Action>();
    for (const set of this.holds.values()) for (const a of set) out.add(a);
    return out;
  }

  press(source: string, action: Action): void {
    let set = this.holds.get(source);
    if (!set) {
      set = new Set();
      this.holds.set(source, set);
    }
    if (set.has(action)) return; // key repeat or duplicate pointer event
    const wasHeld = this.isHeld(action);
    set.add(action);
    if (!wasHeld) {
      this.pressCount.set(action, Math.min((this.pressCount.get(action) ?? 0) + 1, MAX_QUEUED_PRESSES));
      for (const l of this.listeners) l(action, true);
    }
  }

  release(source: string, action: Action): void {
    const set = this.holds.get(source);
    if (!set || !set.has(action)) return;
    set.delete(action);
    if (set.size === 0) this.holds.delete(source);
    if (!this.isHeld(action)) for (const l of this.listeners) l(action, false);
  }

  /** Releases everything one source holds (pointer cancelled, touch lost, gamepad unplugged). */
  releaseSource(source: string): void {
    const set = this.holds.get(source);
    if (!set) return;
    for (const a of [...set]) this.release(source, a);
  }

  /** Releases everything (window blur, power off, eject, pause). */
  releaseAll(): void {
    for (const source of [...this.holds.keys()]) this.releaseSource(source);
  }

  /** Discards press edges that have not been polled yet (e.g. presses made while booting). */
  flush(): void {
    this.pressCount.clear();
  }

  /** One press edge per action per poll; quicker taps wait for the following polls instead of merging. */
  poll(): PadFrame {
    const pressed = new Set<Action>();
    for (const [a, n] of this.pressCount) {
      if (n <= 0) continue;
      pressed.add(a);
      if (n > 1) this.pressCount.set(a, n - 1);
      else this.pressCount.delete(a);
    }
    const held = this.heldSet;
    for (const a of pressed) held.add(a);
    return { held, pressed };
  }

  subscribe(l: InputListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get sources(): string[] {
    return [...this.holds.keys()];
  }
}

const REPEAT_DELAY = 0.3;
const REPEAT_RATE = 0.075;

/**
 * Per-game view of the pad: edges plus auto-repeat for cursors and menus. Fed one PadFrame per
 * fixed tick, so repeat timing is frame-rate independent.
 */
export class Pad {
  private frame: PadFrame = EMPTY_FRAME;
  private readonly heldFor = new Map<Action, number>();
  private readonly repeatAt = new Map<Action, number>();
  private readonly fired = new Set<Action>();

  update(frame: PadFrame, dt: number): void {
    this.frame = frame;
    this.fired.clear();
    for (const a of ACTIONS) {
      if (!frame.held.has(a)) {
        this.heldFor.delete(a);
        this.repeatAt.delete(a);
        continue;
      }
      if (frame.pressed.has(a)) {
        this.heldFor.set(a, 0);
        this.repeatAt.set(a, REPEAT_DELAY);
        this.fired.add(a);
        continue;
      }
      const t = (this.heldFor.get(a) ?? 0) + dt;
      this.heldFor.set(a, t);
      const next = this.repeatAt.get(a) ?? REPEAT_DELAY;
      if (t >= next) {
        this.fired.add(a);
        this.repeatAt.set(a, next + REPEAT_RATE);
      }
    }
  }

  held(a: Action): boolean {
    return this.frame.held.has(a);
  }

  pressed(a: Action): boolean {
    return this.frame.pressed.has(a);
  }

  /** True on the press and then at the repeat rate while held. */
  repeat(a: Action): boolean {
    return this.fired.has(a);
  }

  /** Seconds the action has been held (0 when not held). */
  heldTime(a: Action): number {
    return this.heldFor.get(a) ?? 0;
  }

  /** Horizontal/vertical axis from held directions. */
  axis(): { x: number; y: number } {
    const h = this.frame.held;
    return { x: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0), y: (h.has('down') ? 1 : 0) - (h.has('up') ? 1 : 0) };
  }

  reset(): void {
    this.frame = EMPTY_FRAME;
    this.heldFor.clear();
    this.repeatAt.clear();
    this.fired.clear();
  }
}

/**
 * Keyboard mapping (event.code → action). The A and B keys press the A and B buttons (what the
 * on-screen controls say); Z / Space and X are the classic alternatives, J and K for the right hand.
 */
export const KEY_MAP: Readonly<Record<string, Action>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyA: 'a',
  KeyZ: 'a',
  KeyJ: 'a',
  Space: 'a',
  KeyB: 'b',
  KeyX: 'b',
  KeyK: 'b',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
};

/** Key names shown to the player for each button, primary first. */
export const KEY_NAMES: Readonly<Record<Action, readonly string[]>> = {
  up: ['↑'],
  down: ['↓'],
  left: ['←'],
  right: ['→'],
  a: ['A', 'Z', 'Space'],
  b: ['B', 'X'],
  start: ['Enter'],
  select: ['Shift'],
};
