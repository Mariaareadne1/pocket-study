/**
 * Versioned local persistence. Every record is an envelope `{ v, data, at }`; reading validates
 * the version and the shape, so a corrupted or outdated save never crashes the console — it is
 * reported as `corrupt` and the game starts fresh.
 */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

export const PREFIX = 'pocket-study:';

/** localStorage wrapped so private mode / quota errors degrade to "not saved". */
export function browserStore(prefix = PREFIX): KeyValue {
  const ls = (): Storage | null => {
    try {
      return typeof window !== 'undefined' ? window.localStorage : null;
    } catch {
      return null;
    }
  };
  return {
    get: (k) => {
      try {
        return ls()?.getItem(prefix + k) ?? null;
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        ls()?.setItem(prefix + k, v);
      } catch {
        /* quota or privacy mode: progress is simply not persisted */
      }
    },
    remove: (k) => {
      try {
        ls()?.removeItem(prefix + k);
      } catch {
        /* ignore */
      }
    },
    keys: () => {
      const s = ls();
      if (!s) return [];
      const out: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(prefix)) out.push(k.slice(prefix.length));
      }
      return out;
    },
  };
}

/** In-memory store for tests and the deterministic demo. */
export function memoryStore(seed: Record<string, string> = {}): KeyValue {
  const m = new Map(Object.entries(seed));
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    keys: () => [...m.keys()],
  };
}

export type LoadStatus = 'ok' | 'missing' | 'corrupt';

export interface Loaded<T> {
  value: T | null;
  status: LoadStatus;
}

/** Validator: returns the typed value or null if the shape is wrong. */
export type Validate<T> = (data: unknown) => T | null;

export class Slot<T> {
  constructor(
    private readonly store: KeyValue,
    readonly key: string,
    readonly version: number,
    private readonly validate: Validate<T>,
  ) {}

  load(): Loaded<T> {
    const raw = this.store.get(this.key);
    if (raw === null) return { value: null, status: 'missing' };
    try {
      const env: unknown = JSON.parse(raw);
      if (!isObj(env) || env.v !== this.version) return { value: null, status: 'corrupt' };
      const value = this.validate(env.data);
      return value === null ? { value: null, status: 'corrupt' } : { value, status: 'ok' };
    } catch {
      return { value: null, status: 'corrupt' };
    }
  }

  save(data: T): void {
    this.store.set(this.key, JSON.stringify({ v: this.version, at: Date.now(), data }));
  }

  clear(): void {
    this.store.remove(this.key);
  }
}

// ── tiny validation helpers ──

export const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
export const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const isInt = (x: unknown, lo: number, hi: number): x is number => isNum(x) && Number.isInteger(x) && x >= lo && x <= hi;
export const isStr = (x: unknown): x is string => typeof x === 'string';
export const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
export const clampNum = (x: unknown, lo: number, hi: number, d: number): number => (isNum(x) ? Math.min(hi, Math.max(lo, x)) : d);

/** Console-wide settings. */
export interface Settings {
  muted: boolean;
  volume: number;
  lastCart: string | null;
}

export const DEFAULT_SETTINGS: Settings = { muted: false, volume: 0.8, lastCart: null };

export const validateSettings: Validate<Settings> = (d) => {
  if (!isObj(d)) return null;
  return {
    muted: isBool(d.muted) ? d.muted : false,
    volume: clampNum(d.volume, 0, 1, 0.8),
    lastCart: isStr(d.lastCart) ? d.lastCart : null,
  };
};

export const settingsSlot = (store: KeyValue): Slot<Settings> => new Slot(store, 'settings', 1, validateSettings);
