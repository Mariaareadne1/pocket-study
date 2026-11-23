/**
 * Glue between the console runtime, audio, the 3D stage and the page: keyboard and gamepad
 * input, focus/visibility handling, PNG export and settings. Every input source — 3D buttons,
 * keyboard, on-screen touch pad, gamepad — feeds the same InputHub under its own source name, so
 * releasing one never cancels another and blur releases them all.
 */
import { type CartId, type DeviceState } from '@/device/machine';
import type { StageFrame, StageHandlers } from '@/engine/stage/Stage';
import { AudioEngine } from '@/runtime/audio';
import { ConsoleRuntime, type ConsoleSnapshot } from '@/runtime/console';
import type { Framebuffer } from '@/runtime/framebuffer';
import { type Action, KEY_MAP } from '@/runtime/input';
import { DEFAULT_SETTINGS, type KeyValue, type Settings, browserStore, memoryStore, settingsSlot } from '@/runtime/storage';

export interface ExportRecord {
  name: string;
  width: number;
  height: number;
  dataUrl: string;
}

export interface ControllerOptions {
  /** Capture/test mode: virtual clock, memory storage, deterministic seed. */
  capture?: boolean;
  demo?: boolean;
  seed?: number;
  /** Use in-memory saves (private mode, tests). */
  memory?: boolean;
}

const PAD_MAP: [number, Action][] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  [0, 'a'],
  [1, 'b'],
  [9, 'start'],
  [8, 'select'],
];

function framebufferToPng(fb: Framebuffer): string {
  const c = document.createElement('canvas');
  c.width = fb.width;
  c.height = fb.height;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas unavailable');
  const img = g.createImageData(fb.width, fb.height);
  img.data.set(fb.data);
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** Scales a pixel image up with hard edges (so an exported 160×128 sky stays crisp when viewed). */
function upscalePng(dataUrl: string, w: number, h: number, k: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * k;
      c.height = h * k;
      const g = c.getContext('2d');
      if (!g) return reject(new Error('2D canvas unavailable'));
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Could not encode image'));
    img.src = dataUrl;
  });
}

export function downloadDataUrl(dataUrl: string, name: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export class PocketController {
  readonly audio = new AudioEngine();
  readonly runtime: ConsoleRuntime;
  readonly store: KeyValue;
  readonly capture: boolean;
  /** Exports made this session (tests read the most recent one). */
  readonly exports: ExportRecord[] = [];
  /** Set when an export is downloaded; the UI shows a toast. */
  onExport: ((r: ExportRecord) => void) | null = null;
  settings: Settings;
  private readonly settingsStore;
  private readonly keysDown = new Map<string, Action>();
  private padHeld = new Set<Action>();
  private disposed = false;
  private virtual = 0;

  constructor(opts: ControllerOptions = {}) {
    this.capture = opts.capture ?? false;
    this.store = opts.memory || this.capture ? memoryStore() : browserStore();
    this.settingsStore = settingsSlot(this.store);
    this.settings = this.settingsStore.load().value ?? DEFAULT_SETTINGS;
    this.audio.setMuted(this.settings.muted);
    this.audio.setVolume(this.settings.volume);
    if (this.capture) {
      this.audio.timeline = [];
      this.audio.clock = () => this.virtual;
    }
    this.runtime = new ConsoleRuntime({
      store: this.store,
      audio: this.audio,
      seed: opts.seed,
      demo: opts.demo,
      exportImage: (fb, name) => void this.exportImage(fb, name),
    });
  }

  // ───────────── stage wiring ─────────────

  readonly frame = (): StageFrame => ({
    device: this.runtime.machine.state,
    held: this.runtime.hub.heldSet,
    backlight: this.runtime.backlight,
    screenVersion: this.runtime.fb.version,
  });

  readonly tick = (dt: number): void => {
    if (this.disposed) return;
    this.virtual += dt;
    this.pollGamepad();
    this.runtime.tick(dt);
  };

  handlers(): Omit<StageHandlers, 'frame' | 'tick' | 'onReady'> {
    return {
      onButton: (action, down) => {
        this.unlockAudio();
        if (down) this.runtime.hub.press('pointer', action);
        else this.runtime.hub.release('pointer', action);
      },
      onSwitch: () => {
        this.unlockAudio();
        this.runtime.togglePower();
      },
      onSlotTap: () => {
        this.unlockAudio();
        this.runtime.insertOrEject();
      },
      onCartTap: (id) => {
        this.unlockAudio();
        this.tapCart(id);
      },
      onCartGrab: (id) => {
        this.unlockAudio();
        return this.runtime.beginDrag(id);
      },
      onCartMove: (near) => this.runtime.dragNear(near),
      onCartDrop: (near) => this.runtime.endDrag(near),
      onCartCancel: () => this.runtime.cancelDrag(),
      onInteract: () => this.unlockAudio(),
    };
  }

  /** Tap on a cartridge: select it; tap the selected one again to insert it; tap the seated one to eject. */
  tapCart(id: CartId): void {
    const s = this.runtime.machine.state;
    if (s.cart === id) {
      this.runtime.eject();
      return;
    }
    if (s.selected === id) {
      this.runtime.insert(id);
      return;
    }
    this.runtime.selectCart(id);
  }

  // ───────────── keyboard ─────────────

  /** Returns true when the key was used (so the caller can preventDefault). */
  keyDown(e: Pick<KeyboardEvent, 'code' | 'repeat' | 'target' | 'altKey' | 'ctrlKey' | 'metaKey'>): boolean {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    if (isTextField(e.target)) return false;
    if (e.code === 'Escape') {
      this.runtime.requestPause();
      return true;
    }
    const action = KEY_MAP[e.code];
    if (!action) return false;
    this.unlockAudio();
    if (e.repeat) return true;
    this.keysDown.set(e.code, action);
    this.runtime.hub.press(`key:${e.code}`, action);
    return true;
  }

  keyUp(e: Pick<KeyboardEvent, 'code'>): boolean {
    const action = this.keysDown.get(e.code);
    if (!action) return false;
    this.keysDown.delete(e.code);
    this.runtime.hub.release(`key:${e.code}`, action);
    return true;
  }

  // ───────────── touch pad (DOM buttons) ─────────────

  touch(action: Action, down: boolean): void {
    this.unlockAudio();
    if (down) this.runtime.hub.press(`touch:${action}`, action);
    else this.runtime.hub.release(`touch:${action}`, action);
  }

  // ───────────── gamepad ─────────────

  private pollGamepad(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let pads: (Gamepad | null)[] = [];
    try {
      pads = [...navigator.getGamepads()];
    } catch {
      return;
    }
    const pad = pads.find((p): p is Gamepad => !!p && p.connected);
    const now = new Set<Action>();
    if (pad) {
      for (const [i, a] of PAD_MAP) if (pad.buttons[i]?.pressed) now.add(a);
      const [ax = 0, ay = 0] = pad.axes;
      if (ax < -0.5) now.add('left');
      if (ax > 0.5) now.add('right');
      if (ay < -0.5) now.add('up');
      if (ay > 0.5) now.add('down');
    }
    for (const a of now) if (!this.padHeld.has(a)) this.runtime.hub.press('gamepad', a);
    for (const a of this.padHeld) if (!now.has(a)) this.runtime.hub.release('gamepad', a);
    this.padHeld = now;
  }

  // ───────────── lifecycle ─────────────

  /** Window blur or tab hidden: drop every held input and pause the game. */
  suspend(reason: 'blur' | 'hidden'): void {
    this.keysDown.clear();
    this.padHeld.clear();
    this.runtime.suspend(reason);
    if (reason === 'hidden') this.audio.suspend(true);
  }

  resume(): void {
    this.runtime.resume();
    this.audio.suspend(false);
  }

  unlockAudio(): void {
    this.audio.unlock();
  }

  setMuted(muted: boolean): void {
    this.settings = { ...this.settings, muted };
    this.audio.setMuted(muted);
    this.settingsStore.save(this.settings);
  }

  setLastCart(id: CartId | null): void {
    this.settings = { ...this.settings, lastCart: id };
    this.settingsStore.save(this.settings);
  }

  clearData(): void {
    this.runtime.clearSaves();
    this.settingsStore.clear();
    this.settings = this.settingsStore.load().value ?? DEFAULT_SETTINGS;
    this.audio.setMuted(this.settings.muted);
  }

  snapshot(): ConsoleSnapshot {
    return this.runtime.snapshot();
  }

  get device(): DeviceState {
    return this.runtime.machine.state;
  }

  get virtualTime(): number {
    return this.virtual;
  }

  private async exportImage(fb: Framebuffer, name: string): Promise<void> {
    try {
      const raw = framebufferToPng(fb);
      const record: ExportRecord = { name, width: fb.width, height: fb.height, dataUrl: raw };
      this.exports.push(record);
      if (!this.capture) {
        // The download is the artwork at 4× with hard pixels; the raw 1× PNG is kept for tests.
        downloadDataUrl(await upscalePng(raw, fb.width, fb.height, 4), name);
      }
      this.onExport?.(record);
    } catch (err) {
      this.onExport?.({ name: `failed: ${err instanceof Error ? err.message : 'unknown error'}`, width: 0, height: 0, dataUrl: '' });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.runtime.dispose();
    this.audio.dispose();
  }
}

function isTextField(t: EventTarget | null): boolean {
  if (!t || typeof (t as HTMLElement).tagName !== 'string') return false;
  const el = t as HTMLElement;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}
