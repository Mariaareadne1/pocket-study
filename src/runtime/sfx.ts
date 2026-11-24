/**
 * Original sound design, synthesised with Web Audio. Every sound is a pure function of
 * (context, destination, start time), so the same code plays live and renders offline for the
 * demo films. No samples, no third-party music.
 */
export type SfxName =
  // hardware
  | 'press'
  | 'release'
  | 'switchOn'
  | 'switchOff'
  | 'slide'
  | 'seat'
  | 'eject'
  | 'deny'
  | 'boot'
  | 'nocart'
  | 'powerDown'
  // shared menus
  | 'menuMove'
  | 'menuSelect'
  | 'menuBack'
  | 'start'
  // bloom
  | 'plant'
  | 'water'
  | 'grow'
  | 'bloom'
  | 'dig'
  | 'tool'
  | 'celebrate'
  // starfall
  | 'star'
  | 'bigStar'
  | 'hit'
  | 'dash'
  | 'pulse'
  | 'level'
  | 'gameOver'
  // little sky
  | 'place'
  | 'puff'
  | 'chirp'
  | 'glow'
  | 'brush'
  | 'erase'
  | 'undo'
  | 'shutter'
  | 'clear'
  // vine
  | 'gulp'
  | 'bonus'
  // glasshouse + rally
  | 'bounce'
  | 'paddle'
  | 'pane'
  | 'crack'
  | 'miss'
  | 'point'
  | 'win';

export const SFX_NAMES: readonly SfxName[] = [
  'press', 'release', 'switchOn', 'switchOff', 'slide', 'seat', 'eject', 'deny', 'boot', 'nocart', 'powerDown',
  'menuMove', 'menuSelect', 'menuBack', 'start',
  'plant', 'water', 'grow', 'bloom', 'dig', 'tool', 'celebrate',
  'star', 'bigStar', 'hit', 'dash', 'pulse', 'level', 'gameOver',
  'place', 'puff', 'chirp', 'glow', 'brush', 'erase', 'undo', 'shutter', 'clear',
  'gulp', 'bonus', 'bounce', 'paddle', 'pane', 'crack', 'miss', 'point', 'win',
];

/** Hardware sounds belong to the object; the rest come out of the speaker and stop on power-off. */
export const HARDWARE: ReadonlySet<SfxName> = new Set(['press', 'release', 'switchOn', 'switchOff', 'slide', 'seat', 'eject', 'deny']);

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (b) return b;
  b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff; // deterministic noise for repeatable renders
    d[i] = (s / 0x3fffffff - 1) * 0.9;
  }
  noiseCache.set(ctx, b);
  return b;
}

interface ToneOpts {
  type?: OscillatorType;
  f: number;
  f1?: number;
  dur: number;
  gain: number;
  attack?: number;
  /** Pitch glide time constant towards f1 (exponential). */
  glide?: number;
}

function tone(ctx: BaseAudioContext, out: AudioNode, t: number, o: ToneOpts): number {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.glide ?? o.dur));
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
  return t + o.dur;
}

interface NoiseOpts {
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  f: number;
  f1?: number;
  q?: number;
  attack?: number;
  offset?: number;
}

function noise(ctx: BaseAudioContext, out: AudioNode, t: number, o: NoiseOpts): number {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = o.filter;
  flt.frequency.setValueAtTime(o.f, t);
  if (o.f1 !== undefined) flt.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  flt.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const a = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(flt).connect(g).connect(out);
  src.start(t, o.offset ?? 0);
  src.stop(t + o.dur + 0.02);
  return t + o.dur;
}

const click = (ctx: BaseAudioContext, out: AudioNode, t: number, f: number, gain: number, dur = 0.014): number =>
  noise(ctx, out, t, { dur, gain, filter: 'bandpass', f, q: 3.2 });

const notes = (ctx: BaseAudioContext, out: AudioNode, t: number, fs: readonly number[], step: number, o: Omit<ToneOpts, 'f'>): number => {
  let end = t;
  fs.forEach((f, i) => (end = tone(ctx, out, t + i * step, { ...o, f })));
  return end;
};

/** Schedules a sound; returns when it ends. */
export function playSfx(ctx: BaseAudioContext, out: AudioNode, name: SfxName, t: number): number {
  switch (name) {
    case 'press':
      tone(ctx, out, t, { f: 210, f1: 120, dur: 0.035, gain: 0.12 });
      return click(ctx, out, t, 2300, 0.22);
    case 'release':
      return click(ctx, out, t, 3400, 0.1, 0.01);
    case 'switchOn':
      click(ctx, out, t, 1700, 0.3);
      noise(ctx, out, t + 0.004, { dur: 0.05, gain: 0.04, filter: 'highpass', f: 2500 });
      return click(ctx, out, t + 0.045, 2900, 0.26);
    case 'switchOff':
      click(ctx, out, t, 2900, 0.24);
      noise(ctx, out, t + 0.004, { dur: 0.05, gain: 0.04, filter: 'highpass', f: 2500 });
      return click(ctx, out, t + 0.04, 1500, 0.28);
    case 'slide':
      return noise(ctx, out, t, { dur: 0.36, gain: 0.07, filter: 'bandpass', f: 700, f1: 2100, q: 0.8, attack: 0.05 });
    case 'seat':
      tone(ctx, out, t, { f: 140, f1: 70, dur: 0.09, gain: 0.3 });
      click(ctx, out, t, 1900, 0.32, 0.02);
      return click(ctx, out, t + 0.028, 3100, 0.14);
    case 'eject':
      click(ctx, out, t, 2100, 0.28);
      tone(ctx, out, t + 0.01, { type: 'triangle', f: 260, f1: 520, dur: 0.07, gain: 0.07 });
      return noise(ctx, out, t + 0.02, { dur: 0.22, gain: 0.05, filter: 'bandpass', f: 1800, f1: 900, q: 0.9 });
    case 'deny':
      tone(ctx, out, t, { type: 'square', f: 150, dur: 0.06, gain: 0.05 });
      return tone(ctx, out, t + 0.09, { type: 'square', f: 130, dur: 0.08, gain: 0.05 });
    case 'boot': {
      // Pocket Study chime: a rising fifth with a soft octave shimmer.
      tone(ctx, out, t, { type: 'triangle', f: 659.25, dur: 0.5, gain: 0.16 });
      tone(ctx, out, t + 0.11, { type: 'triangle', f: 987.77, dur: 0.9, gain: 0.15 });
      tone(ctx, out, t + 0.11, { f: 1975.5, dur: 0.7, gain: 0.035, attack: 0.04 });
      return tone(ctx, out, t + 0.22, { f: 1318.5, dur: 1.0, gain: 0.05, attack: 0.06 });
    }
    case 'nocart':
      tone(ctx, out, t, { type: 'triangle', f: 440, dur: 0.18, gain: 0.09 });
      return tone(ctx, out, t + 0.2, { type: 'triangle', f: 349.2, dur: 0.3, gain: 0.08 });
    case 'powerDown':
      return tone(ctx, out, t, { f: 700, f1: 180, dur: 0.16, gain: 0.05, glide: 0.14 });
    case 'menuMove':
      return tone(ctx, out, t, { type: 'square', f: 1320, dur: 0.025, gain: 0.025 });
    case 'menuSelect':
      return notes(ctx, out, t, [880, 1320], 0.045, { type: 'square', dur: 0.04, gain: 0.03 });
    case 'menuBack':
      return notes(ctx, out, t, [1320, 880], 0.045, { type: 'square', dur: 0.04, gain: 0.025 });
    case 'start':
      return notes(ctx, out, t, [784, 1046.5, 1568], 0.06, { type: 'triangle', dur: 0.12, gain: 0.08 });
    case 'plant':
      tone(ctx, out, t, { type: 'triangle', f: 620, f1: 380, dur: 0.09, gain: 0.09 });
      return noise(ctx, out, t, { dur: 0.06, gain: 0.05, filter: 'lowpass', f: 900 });
    case 'water': {
      let end = t;
      [0, 0.05, 0.09, 0.15, 0.2].forEach((dt, i) => (end = tone(ctx, out, t + dt, { f: [720, 980, 840, 1180, 900][i], f1: [1100, 1500, 1300, 1700, 1400][i], dur: 0.05, gain: 0.05 })));
      noise(ctx, out, t, { dur: 0.28, gain: 0.025, filter: 'highpass', f: 3000 });
      return end;
    }
    case 'grow':
      return tone(ctx, out, t, { f: 1568, dur: 0.12, gain: 0.03 });
    case 'bloom':
      return notes(ctx, out, t, [1046.5, 1318.5, 1568], 0.07, { type: 'triangle', dur: 0.22, gain: 0.06 });
    case 'dig':
      return noise(ctx, out, t, { dur: 0.1, gain: 0.09, filter: 'lowpass', f: 600, f1: 300 });
    case 'tool':
      return tone(ctx, out, t, { type: 'square', f: 990, dur: 0.03, gain: 0.025 });
    case 'celebrate':
      return notes(ctx, out, t, [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568], 0.09, { type: 'triangle', dur: 0.4, gain: 0.07 });
    case 'star':
      return notes(ctx, out, t, [1760, 2637], 0.04, { type: 'square', dur: 0.05, gain: 0.03 });
    case 'bigStar':
      return notes(ctx, out, t, [1318.5, 1760, 2093, 2637], 0.04, { type: 'square', dur: 0.06, gain: 0.03 });
    case 'hit':
      noise(ctx, out, t, { dur: 0.22, gain: 0.14, filter: 'lowpass', f: 1800, f1: 300 });
      return tone(ctx, out, t, { type: 'square', f: 220, f1: 90, dur: 0.22, gain: 0.04 });
    case 'dash':
      return noise(ctx, out, t, { dur: 0.1, gain: 0.08, filter: 'bandpass', f: 1200, f1: 5000, q: 1.2 });
    case 'pulse':
      return tone(ctx, out, t, { type: 'triangle', f: 300, f1: 1200, dur: 0.32, gain: 0.07, glide: 0.28 });
    case 'level':
      return notes(ctx, out, t, [987.77, 1318.5], 0.08, { type: 'triangle', dur: 0.14, gain: 0.06 });
    case 'gameOver':
      return notes(ctx, out, t, [523.25, 392, 329.63, 261.63], 0.16, { type: 'triangle', dur: 0.3, gain: 0.08 });
    case 'place':
      return tone(ctx, out, t, { f: 1046.5, f1: 1046.5, dur: 0.14, gain: 0.05 });
    case 'puff':
      return noise(ctx, out, t, { dur: 0.22, gain: 0.06, filter: 'lowpass', f: 1400, f1: 400, attack: 0.03 });
    case 'chirp':
      tone(ctx, out, t, { f: 2200, f1: 3200, dur: 0.05, gain: 0.03 });
      return tone(ctx, out, t + 0.07, { f: 2400, f1: 3400, dur: 0.05, gain: 0.025 });
    case 'glow':
      return tone(ctx, out, t, { f: 1568, dur: 0.5, gain: 0.035, attack: 0.03 });
    case 'brush':
      return tone(ctx, out, t, { type: 'square', f: 1760, dur: 0.012, gain: 0.012 });
    case 'erase':
      return noise(ctx, out, t, { dur: 0.06, gain: 0.05, filter: 'highpass', f: 2500 });
    case 'undo':
      return notes(ctx, out, t, [1175, 784], 0.05, { type: 'triangle', dur: 0.08, gain: 0.05 });
    case 'shutter':
      click(ctx, out, t, 2600, 0.2);
      noise(ctx, out, t + 0.01, { dur: 0.08, gain: 0.05, filter: 'highpass', f: 3500 });
      return click(ctx, out, t + 0.07, 1800, 0.16);
    case 'clear':
      return tone(ctx, out, t, { type: 'triangle', f: 1200, f1: 300, dur: 0.3, gain: 0.05, glide: 0.28 });
    case 'gulp':
      return tone(ctx, out, t, { type: 'square', f: 520, f1: 1040, dur: 0.06, gain: 0.035, glide: 0.05 });
    case 'bonus':
      return notes(ctx, out, t, [1318.5, 1568, 2093], 0.05, { type: 'square', dur: 0.07, gain: 0.03 });
    case 'bounce':
      return tone(ctx, out, t, { type: 'square', f: 440, dur: 0.025, gain: 0.03 });
    case 'paddle':
      return tone(ctx, out, t, { type: 'square', f: 660, dur: 0.035, gain: 0.04 });
    case 'pane':
      tone(ctx, out, t, { type: 'triangle', f: 1760, f1: 2400, dur: 0.06, gain: 0.04 });
      return noise(ctx, out, t, { dur: 0.08, gain: 0.04, filter: 'highpass', f: 4200 });
    case 'crack':
      return click(ctx, out, t, 3600, 0.12, 0.02);
    case 'miss':
      return tone(ctx, out, t, { type: 'square', f: 330, f1: 110, dur: 0.3, gain: 0.04, glide: 0.25 });
    case 'point':
      return notes(ctx, out, t, [988, 1319], 0.06, { type: 'square', dur: 0.06, gain: 0.03 });
    case 'win':
      return notes(ctx, out, t, [784, 988, 1175, 1568], 0.1, { type: 'triangle', dur: 0.3, gain: 0.07 });
  }
}
