/**
 * Audio engine: one AudioContext created on the first user gesture (autoplay rules), a master
 * gain into a gentle limiter, and two buses — `hardware` (clicks of the object itself) and
 * `speaker` (everything the console plays, cut instantly on power-off). A voice cap prevents
 * pile-ups; every scheduled sound is logged so tests can verify behaviour and the demo films can
 * be scored offline with exactly the same synthesis code.
 */
import { HARDWARE, playSfx, type SfxName } from './sfx';

const MAX_VOICES = 10;

export interface SoundEvent {
  t: number;
  name: SfxName;
}

export interface AudioStats {
  started: boolean;
  muted: boolean;
  volume: number;
  active: number;
  played: number;
  dropped: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private speaker: GainNode | null = null;
  private hardware: GainNode | null = null;
  private out: AudioNode | null = null;
  private tap: MediaStreamAudioDestinationNode | null = null;
  private ends: number[] = [];
  private stats = { played: 0, dropped: 0 };
  muted = false;
  volume = 0.8;
  /** Overrides the clock used for the timeline (virtual time in capture mode). */
  clock: (() => number) | null = null;
  /** When set, every sound is recorded here (capture mode / tests). */
  timeline: SoundEvent[] | null = null;
  /** Called for every sound request, even when muted or not started (instrumentation). */
  onSound: ((name: SfxName, played: boolean) => void) | null = null;

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (typeof window === 'undefined') return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      const { master, speaker, hardware, out } = buildGraph(this.ctx, this.ctx.destination);
      this.out = out;
      this.master = master;
      this.speaker = speaker;
      this.hardware = hardware;
      this.applyVolume();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  get started(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.ctx || !this.master) return;
    const target = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }

  play(name: SfxName): void {
    const t = this.clock ? this.clock() : this.ctx?.currentTime ?? 0;
    this.timeline?.push({ t, name });
    const ctx = this.ctx;
    if (!ctx || !this.speaker || !this.hardware || this.muted) {
      this.onSound?.(name, false);
      return;
    }
    const now = ctx.currentTime;
    this.ends = this.ends.filter((e) => e > now);
    if (this.ends.length >= MAX_VOICES) {
      this.stats.dropped++;
      this.onSound?.(name, false);
      return;
    }
    const bus = HARDWARE.has(name) ? this.hardware : this.speaker;
    this.ends.push(playSfx(ctx, bus, name, now + 0.005));
    this.stats.played++;
    this.onSound?.(name, true);
  }

  /** Cuts everything coming out of the speaker (power off, cartridge change, game reset). */
  silenceSpeaker(): void {
    const ctx = this.ctx;
    if (!ctx || !this.speaker || !this.master) return;
    const old = this.speaker;
    old.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
    const fresh = ctx.createGain();
    fresh.gain.value = 0.85;
    fresh.connect(this.master);
    this.speaker = fresh;
    window.setTimeout(() => old.disconnect(), 120);
    this.ends = [];
  }

  getStats(): AudioStats {
    const now = this.ctx?.currentTime ?? 0;
    return {
      started: this.started,
      muted: this.muted,
      volume: this.volume,
      active: this.ends.filter((e) => e > now).length,
      ...this.stats,
    };
  }

  /** A live copy of everything the console plays (after mute and volume), for recording demos. */
  recordingStream(): MediaStream | null {
    if (!this.ctx || !this.out || typeof this.ctx.createMediaStreamDestination !== 'function') return null;
    if (!this.tap) {
      this.tap = this.ctx.createMediaStreamDestination();
      this.out.connect(this.tap);
    }
    return this.tap.stream;
  }

  releaseRecording(): void {
    if (!this.tap) return;
    this.out?.disconnect(this.tap);
    this.tap.stream.getTracks().forEach((t) => t.stop());
    this.tap = null;
  }

  /** Suspends the context while the tab is hidden. */
  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
  }

  dispose(): void {
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = this.speaker = this.hardware = this.out = null;
    this.tap = null;
  }
}

function buildGraph(ctx: BaseAudioContext, dest: AudioNode): { master: GainNode; speaker: GainNode; hardware: GainNode; out: AudioNode } {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 8;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(limiter).connect(dest);
  const speaker = ctx.createGain();
  speaker.gain.value = 0.85;
  speaker.connect(master);
  const hardware = ctx.createGain();
  hardware.gain.value = 1;
  hardware.connect(master);
  return { master, speaker, hardware, out: limiter };
}

/** Renders a logged session offline (film soundtrack). Returns 16-bit stereo WAV bytes. */
export async function renderTimeline(events: readonly SoundEvent[], duration: number, cuts: readonly number[] = []): Promise<Uint8Array> {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  const { speaker, hardware, master } = buildGraph(ctx, ctx.destination);
  master.gain.value = 0.8;
  // Power-off cuts: the speaker bus is muted from each cut until the next sound after it.
  for (const c of cuts) {
    speaker.gain.setTargetAtTime(0, c, 0.01);
    const next = events.find((e) => e.t > c + 0.05 && !HARDWARE.has(e.name));
    if (next) speaker.gain.setValueAtTime(0.85, next.t - 0.002);
  }
  for (const e of events) if (e.t < duration) playSfx(ctx, HARDWARE.has(e.name) ? hardware : speaker, e.name, e.t + 0.005);
  const buf = await ctx.startRendering();
  return encodeWav(buf);
}

function encodeWav(buf: AudioBuffer): Uint8Array {
  const n = buf.length;
  const ch = buf.numberOfChannels;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string): void => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  w(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch).keys()].map((c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(out.buffer);
}
