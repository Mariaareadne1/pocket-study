/**
 * The console runtime ties the physical device (state machine) to the software it runs: boot
 * firmware, cartridge game lifecycle, a fixed 60 Hz update loop, the display framebuffer, input
 * gating and the speaker. It is renderer-agnostic — the 3D stage only reads `fb`, `backlight`
 * and `machine.state`, and calls the same action methods the UI and keyboard call.
 */
import { createGame, SAVE_KEYS } from '@/games/registry';
import { BLOCK_MESSAGES, CART_IDS, type CartId, DeviceMachine, type DeviceEvent, type DeviceState, type GamePhase, TIMING } from '@/device/machine';
import type { AudioEngine } from './audio';
import { CHIME_AT, drawBoot, drawNoCart } from './boot';
import { Framebuffer } from './framebuffer';
import { InputHub, Pad } from './input';
import { Rng, seedFrom } from './rng';
import type { KeyValue } from './storage';
import type { Game, GameHost } from './types';

export const STEP = 1 / 60;
const MAX_CATCHUP = 0.25;
const OFF_COLOR = 0x000000;

export type ScreenMode = 'off' | 'boot' | 'nocart' | 'game' | 'shutdown';

export interface RuntimeOptions {
  store: KeyValue;
  audio: AudioEngine;
  seed?: number;
  demo?: boolean;
  exportImage?: (fb: Framebuffer, name: string) => void;
}

export interface ConsoleSnapshot {
  device: DeviceState;
  screen: ScreenMode;
  app: CartId | null;
  phase: GamePhase | null;
  message: string | null;
  messageId: number;
}

export type RuntimeListener = (s: ConsoleSnapshot) => void;

export class ConsoleRuntime {
  readonly machine = new DeviceMachine();
  readonly hub = new InputHub();
  readonly fb = new Framebuffer();
  private readonly pad = new Pad();
  private game: Game | null = null;
  private screen: ScreenMode = 'off';
  private acc = 0;
  private chimed = false;
  private message: string | null = null;
  private messageId = 0;
  private readonly listeners = new Set<RuntimeListener>();
  private readonly rng: Rng;
  private suspended = false;
  /** Display backlight 0..1, read by the screen shader. */
  backlight = 0;
  /** Virtual seconds since start (drives the audio timeline in capture mode). */
  time = 0;
  /** Number of fixed game updates run (tests use this to prove the loop is or isn't running). */
  updates = 0;
  /** Number of power-off cut points (film soundtrack). */
  readonly cuts: number[] = [];
  private lastSnap = '';
  private readonly unsubInput: () => void;

  constructor(private readonly opts: RuntimeOptions) {
    this.rng = new Rng(opts.seed ?? seedFrom(String(Date.now())));
    this.fb.clear(OFF_COLOR);
    // Physical clicks happen whatever the power state: the buttons are mechanical.
    this.unsubInput = this.hub.subscribe((_a, down) => opts.audio.play(down ? 'press' : 'release'));
  }

  // ───────────── actions (UI, stage, keyboard and tests all call these) ─────────────

  selectCart(id: CartId | null): void {
    this.machine.select(id);
    this.flush();
  }

  beginDrag(id: CartId): boolean {
    const r = this.machine.beginDrag(id);
    this.flush();
    return r.ok;
  }

  dragNear(near: boolean): void {
    this.machine.dragNear(near);
    this.flush();
  }

  endDrag(near: boolean): void {
    this.machine.endDrag(near);
    this.flush();
  }

  cancelDrag(): void {
    this.machine.cancelDrag();
    this.flush();
  }

  insert(id: CartId): boolean {
    const r = this.machine.insert(id);
    this.flush();
    return r.ok;
  }

  /** Accessible fallback: inserts the selected cartridge, or ejects the seated one. */
  insertOrEject(): void {
    const s = this.machine.state;
    if (s.slot === 'inserted') this.eject();
    else if (s.selected) this.insert(s.selected);
  }

  eject(): boolean {
    const r = this.machine.eject();
    this.flush();
    return r.ok;
  }

  togglePower(): void {
    this.machine.togglePower();
    this.flush();
  }

  /** Focus lost / tab hidden: release held input and pause the running game. */
  suspend(reason: 'blur' | 'hidden'): void {
    this.hub.releaseAll();
    if (this.game && this.game.phase === 'playing') this.game.pause();
    if (reason === 'hidden') this.suspended = true;
    this.syncPhase();
    this.emit();
  }

  resume(): void {
    this.suspended = false;
    this.acc = 0;
  }

  /** Escape key: pause the running game (its own menu handles resuming). */
  requestPause(): void {
    if (this.game && this.game.phase === 'playing') {
      this.game.pause();
      this.syncPhase();
      this.emit();
    }
  }

  /** Removes every saved game. The running game is stopped without saving first. */
  clearSaves(): void {
    if (this.game) {
      this.game.dispose();
      this.game = null;
    }
    if (this.machine.isOn) this.machine.powerOff();
    for (const id of CART_IDS) this.opts.store.remove(SAVE_KEYS[id]);
    this.flush();
    this.say('Saved progress cleared.');
  }

  // ───────────── loop ─────────────

  tick(dt: number): void {
    if (this.suspended) return;
    const d = Math.min(dt, MAX_CATCHUP);
    this.time += d;
    this.machine.tick(d);
    this.flush();
    const s = this.machine.state;

    this.backlight = this.targetBacklight(s);

    if (this.screen === 'boot') {
      if (!this.chimed && s.powerT >= CHIME_AT) {
        this.chimed = true;
        this.opts.audio.play('boot');
      }
      drawBoot(this.fb, s.powerT, s.slot === 'inserted' ? s.cart : null);
      this.hub.flush();
      return;
    }
    if (this.screen === 'shutdown') {
      this.fb.fadeTo(OFF_COLOR, Math.min(1, d * 9));
      return;
    }
    if (this.screen === 'nocart') {
      drawNoCart(this.fb, s.powerT);
      this.hub.flush();
      return;
    }
    if (this.screen !== 'game' || !this.game) return;
    this.acc += d;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.pad.update(this.hub.poll(), STEP);
      this.game.update(this.pad, STEP);
      this.updates++;
    }
    this.game.draw(this.fb);
    this.syncPhase();
  }

  private targetBacklight(s: DeviceState): number {
    switch (s.power) {
      case 'off':
        return 0;
      case 'booting':
        return Math.min(1, s.powerT / 0.28);
      case 'shutting_down':
        return Math.max(0, 1 - s.powerT / (TIMING.shutdown * 0.8));
      default:
        return 1;
    }
  }

  private syncPhase(): void {
    if (this.game) this.machine.setGamePhase(this.game.phase);
    this.emit();
  }

  // ───────────── device events → software ─────────────

  private flush(): void {
    for (const e of this.machine.drain()) this.handle(e);
    this.emit();
  }

  private handle(e: DeviceEvent): void {
    const audio = this.opts.audio;
    switch (e.type) {
      case 'insert-start':
        audio.play('slide');
        break;
      case 'seated':
        audio.play('seat');
        break;
      case 'eject-start':
        audio.play('eject');
        break;
      case 'power-on':
        audio.play('switchOn');
        this.hub.releaseAll();
        this.hub.flush();
        this.chimed = false;
        this.screen = 'boot';
        break;
      case 'boot-done':
        this.hub.flush();
        this.pad.reset();
        this.acc = 0;
        if (e.cart) this.startGame(e.cart);
        else {
          this.screen = 'nocart';
          audio.play('nocart');
        }
        break;
      case 'power-off':
        audio.play('switchOff');
        audio.silenceSpeaker();
        this.cuts.push(this.time);
        this.stopGame(true);
        this.hub.releaseAll();
        this.screen = 'shutdown';
        break;
      case 'off':
        this.screen = 'off';
        this.fb.clear(OFF_COLOR);
        break;
      case 'blocked':
        audio.play('deny');
        this.say(BLOCK_MESSAGES[e.reason]);
        break;
      default:
        break;
    }
  }

  private startGame(id: CartId): void {
    const host: GameHost = {
      rng: new Rng(this.rng.int(1, 2 ** 31 - 1) ^ seedFrom(id)),
      store: this.opts.store,
      sfx: (n) => this.opts.audio.play(n),
      exportImage: (fb, name) => this.opts.exportImage?.(fb, name),
      demo: this.opts.demo ?? false,
    };
    try {
      this.game = createGame(id, host);
      this.screen = 'game';
      this.machine.setGamePhase(this.game.phase);
    } catch (err) {
      this.game = null;
      this.screen = 'nocart';
      this.say('This cartridge could not start. Try switching off and on.');
      if (typeof console !== 'undefined') console.error('[pocket-study] cartridge failed to start', err);
    }
  }

  private stopGame(save: boolean): void {
    const g = this.game;
    if (!g) return;
    this.game = null;
    try {
      if (save) g.save();
    } finally {
      g.dispose();
    }
  }

  private say(msg: string): void {
    this.message = msg;
    this.messageId++;
  }

  // ───────────── observation ─────────────

  get running(): Game | null {
    return this.game;
  }

  get screenMode(): ScreenMode {
    return this.screen;
  }

  snapshot(): ConsoleSnapshot {
    return {
      device: this.machine.state,
      screen: this.screen,
      app: this.game?.id ?? null,
      phase: this.game?.phase ?? null,
      message: this.message,
      messageId: this.messageId,
    };
  }

  subscribe(l: RuntimeListener): () => void {
    this.listeners.add(l);
    l(this.snapshot());
    return () => this.listeners.delete(l);
  }

  private emit(): void {
    if (this.listeners.size === 0) return;
    const snap = this.snapshot();
    const s = snap.device;
    const key = `${s.power}|${s.slot}|${s.cart}|${s.selected}|${s.dragging}|${s.nearSlot}|${snap.screen}|${snap.app}|${snap.phase}|${snap.messageId}`;
    if (key === this.lastSnap) return;
    this.lastSnap = key;
    for (const l of this.listeners) l(snap);
  }

  inspect(): Record<string, unknown> {
    return {
      ...this.machine.state,
      screen: this.screen,
      app: this.game?.id ?? null,
      phase: this.game?.phase ?? null,
      game: this.game?.inspect() ?? null,
      backlight: this.backlight,
      updates: this.updates,
      held: [...this.hub.heldSet],
      sources: this.hub.sources,
      fbColors: this.fb.palette(),
      fbLit: this.fb.countNot(OFF_COLOR),
      fbVersion: this.fb.version,
      message: this.message,
    };
  }

  dispose(): void {
    this.stopGame(true);
    this.unsubInput();
    this.listeners.clear();
  }
}
