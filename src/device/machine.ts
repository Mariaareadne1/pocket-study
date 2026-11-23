/**
 * The device state machine — the single source of truth for what the physical object is doing.
 * Pure TypeScript, no rendering: the 3D stage reads it to pose parts, the console runtime reads
 * it to decide what software runs, and the tests drive it directly.
 *
 * Dimensions: power (off → booting → ready ⇄ playing ⇄ paused → shutting_down → off), the slot
 * (empty → inserting → inserted → ejecting → empty), and the hand (which tray cartridge is
 * selected or being dragged). Every method returns a result; refused transitions emit a
 * `blocked` event with a reason instead of silently doing something physically impossible.
 */
export const CART_IDS = ['bloom', 'starfall', 'littlesky'] as const;
export type CartId = (typeof CART_IDS)[number];
export const isCartId = (x: unknown): x is CartId => typeof x === 'string' && (CART_IDS as readonly string[]).includes(x);

export type Power = 'off' | 'booting' | 'ready' | 'playing' | 'paused' | 'shutting_down';
export type SlotState = 'empty' | 'inserting' | 'inserted' | 'ejecting';
export type CartPlace = 'tray' | 'selected' | 'dragging' | 'inserting' | 'inserted' | 'ejecting';
export type GamePhase = 'title' | 'playing' | 'paused' | 'over';
export type BlockReason = 'slot-occupied' | 'powered-on' | 'busy' | 'no-cart' | 'in-slot';

export const TIMING = {
  insert: 0.9,
  eject: 0.85,
  boot: 2.7,
  shutdown: 0.5,
} as const;

export interface DeviceState {
  readonly power: Power;
  /** Seconds since the power state last changed. */
  readonly powerT: number;
  readonly slot: SlotState;
  readonly slotT: number;
  /** Cartridge in (or entering / leaving) the slot. */
  readonly cart: CartId | null;
  readonly selected: CartId | null;
  readonly dragging: CartId | null;
  readonly nearSlot: boolean;
}

export type DeviceEvent =
  | { type: 'select'; cart: CartId | null }
  | { type: 'drag'; cart: CartId }
  | { type: 'drop-return'; cart: CartId }
  | { type: 'insert-start'; cart: CartId }
  | { type: 'seated'; cart: CartId }
  | { type: 'eject-start'; cart: CartId }
  | { type: 'ejected'; cart: CartId }
  | { type: 'power-on' }
  | { type: 'boot-done'; cart: CartId | null }
  | { type: 'power-off' }
  | { type: 'off' }
  | { type: 'blocked'; reason: BlockReason };

export interface Result {
  ok: boolean;
  reason?: BlockReason;
}

export const INITIAL: DeviceState = {
  power: 'off',
  powerT: 0,
  slot: 'empty',
  slotT: 0,
  cart: null,
  selected: null,
  dragging: null,
  nearSlot: false,
};

const OK: Result = { ok: true };

export class DeviceMachine {
  private s: DeviceState;
  private queue: DeviceEvent[] = [];

  constructor(initial: DeviceState = INITIAL) {
    this.s = initial;
  }

  get state(): DeviceState {
    return this.s;
  }

  /** Events since the last drain, in order. */
  drain(): DeviceEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  private set(patch: Partial<DeviceState>): void {
    this.s = { ...this.s, ...patch };
  }

  private emit(e: DeviceEvent): void {
    this.queue.push(e);
  }

  private block(reason: BlockReason): Result {
    this.emit({ type: 'blocked', reason });
    return { ok: false, reason };
  }

  get isOn(): boolean {
    return this.s.power !== 'off';
  }

  /** True when games may receive input. */
  get playable(): boolean {
    return this.s.power === 'ready' || this.s.power === 'playing' || this.s.power === 'paused';
  }

  placeOf(id: CartId): CartPlace {
    const s = this.s;
    if (s.cart === id) {
      if (s.slot === 'inserting') return 'inserting';
      if (s.slot === 'ejecting') return 'ejecting';
      return 'inserted';
    }
    if (s.dragging === id) return 'dragging';
    if (s.selected === id) return 'selected';
    return 'tray';
  }

  // ── the hand ──

  select(id: CartId | null): Result {
    if (id !== null && this.s.cart === id) return this.block('in-slot');
    if (this.s.dragging) return this.block('busy');
    if (this.s.selected === id) return OK;
    this.set({ selected: id });
    this.emit({ type: 'select', cart: id });
    return OK;
  }

  beginDrag(id: CartId): Result {
    if (this.s.cart === id) return this.block('in-slot');
    if (this.s.dragging && this.s.dragging !== id) return this.block('busy');
    this.set({ dragging: id, selected: id, nearSlot: false });
    this.emit({ type: 'drag', cart: id });
    return OK;
  }

  dragNear(near: boolean): void {
    if (!this.s.dragging || this.s.nearSlot === near) return;
    this.set({ nearSlot: near });
  }

  /** Ends a drag: inserts when released in the snap zone, otherwise returns the cartridge. */
  endDrag(near: boolean): Result {
    const id = this.s.dragging;
    if (!id) return OK;
    this.set({ dragging: null, nearSlot: false });
    if (near) {
      const r = this.insert(id);
      if (r.ok) return r;
      this.emit({ type: 'drop-return', cart: id });
      return r;
    }
    this.emit({ type: 'drop-return', cart: id });
    return OK;
  }

  /** Pointer cancelled mid-drag: the cartridge goes back where it was, nothing else changes. */
  cancelDrag(): void {
    const id = this.s.dragging;
    if (!id) return;
    this.set({ dragging: null, nearSlot: false });
    this.emit({ type: 'drop-return', cart: id });
  }

  // ── the slot ──

  insert(id: CartId): Result {
    if (this.s.slot !== 'empty') return this.block(this.s.cart === id ? 'in-slot' : 'slot-occupied');
    if (this.isOn) return this.block('powered-on');
    if (this.s.dragging && this.s.dragging !== id) return this.block('busy');
    this.set({ slot: 'inserting', slotT: 0, cart: id, selected: null, dragging: null, nearSlot: false });
    this.emit({ type: 'insert-start', cart: id });
    return OK;
  }

  eject(): Result {
    if (this.s.slot === 'empty') return this.block('no-cart');
    if (this.s.slot !== 'inserted') return this.block('busy');
    if (this.isOn) return this.block('powered-on');
    const cart = this.s.cart as CartId;
    this.set({ slot: 'ejecting', slotT: 0 });
    this.emit({ type: 'eject-start', cart });
    return OK;
  }

  // ── power ──

  powerOn(): Result {
    if (this.s.power !== 'off') return OK;
    if (this.s.slot === 'inserting' || this.s.slot === 'ejecting') return this.block('busy');
    this.set({ power: 'booting', powerT: 0 });
    this.emit({ type: 'power-on' });
    return OK;
  }

  powerOff(): Result {
    if (this.s.power === 'off' || this.s.power === 'shutting_down') return OK;
    this.set({ power: 'shutting_down', powerT: 0 });
    this.emit({ type: 'power-off' });
    return OK;
  }

  togglePower(): Result {
    return this.s.power === 'off' ? this.powerOn() : this.powerOff();
  }

  /** The running software reports its phase; the console state follows it. */
  setGamePhase(phase: GamePhase): void {
    if (!this.playable) return;
    const power: Power = phase === 'playing' ? 'playing' : phase === 'paused' ? 'paused' : 'ready';
    if (power !== this.s.power) this.set({ power, powerT: 0 });
  }

  tick(dt: number): void {
    const s = this.s;
    this.set({ powerT: s.powerT + dt, slotT: s.slotT + dt });
    if (s.slot === 'inserting' && this.s.slotT >= TIMING.insert) {
      this.set({ slot: 'inserted', slotT: 0 });
      this.emit({ type: 'seated', cart: s.cart as CartId });
    } else if (s.slot === 'ejecting' && this.s.slotT >= TIMING.eject) {
      const cart = s.cart as CartId;
      this.set({ slot: 'empty', slotT: 0, cart: null });
      this.emit({ type: 'ejected', cart });
    }
    if (s.power === 'booting' && this.s.powerT >= TIMING.boot) {
      this.set({ power: 'ready', powerT: 0 });
      this.emit({ type: 'boot-done', cart: this.s.slot === 'inserted' ? this.s.cart : null });
    } else if (s.power === 'shutting_down' && this.s.powerT >= TIMING.shutdown) {
      this.set({ power: 'off', powerT: 0 });
      this.emit({ type: 'off' });
    }
  }
}

export const BLOCK_MESSAGES: Record<BlockReason, string> = {
  'slot-occupied': 'The slot already holds a cartridge.',
  'powered-on': 'Switch the console off first.',
  busy: 'One moment — the cartridge is still moving.',
  'no-cart': 'There is no cartridge to eject.',
  'in-slot': 'That cartridge is already in the console.',
};
