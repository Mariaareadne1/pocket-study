// Demo film of the real app, driven by real input.
//
// The page runs with ?capture: its render loop stops and this script advances the stage one
// frame at a time on a virtual clock. Every action in the film is a real browser input event
// (page.mouse / page.keyboard → Chrome's input pipeline → the app's own pointer and key handlers);
// nothing calls the controller directly. A small overlay draws the pointer and the keys being
// pressed, and it is driven only by those same DOM events, so it shows exactly what was input.
// The soundtrack is rendered offline from the app's own audio event log, then muxed by ffmpeg.
//
// usage: node scripts/film.mjs --variant=landscape|portrait [--base=http://localhost:5580] [--fps=30] [--keep]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? 'true']; }));
const variant = args.variant ?? 'landscape';
const base = args.base ?? 'http://localhost:5580';
const FPS = Number(args.fps ?? 30);
const DURATION = 22;
const VIEW = variant === 'portrait' ? { width: 540, height: 960, scale: 2 } : { width: 1280, height: 720, scale: 1.5 };

const outDir = path.resolve('demo');
const frameDir = path.join(outDir, 'frames', variant);
fs.rmSync(frameDir, { recursive: true, force: true });
fs.mkdirSync(frameDir, { recursive: true });

// ───────────── choreography ─────────────
// move: glide the pointer to a 3D target (re-resolved every frame, as the camera may move) or a viewport point.
// down/up: mouse button. key: [code, holdSeconds]. Times are seconds on the film clock.
const tap = (t, code, hold = 0.12) => ({ t, key: code, hold });
const click = (t) => [{ t, down: true }, { t: t + 0.12, up: true }];

const LANDSCAPE = [
  { t: 0.4, move: 'cart:starfall', dur: 1.0 },
  ...click(1.6),
  { t: 2.3, down: true },
  { t: 2.4, move: 'approach', dur: 1.3 },
  { t: 3.9, up: true },
  { t: 5.1, move: 'switch', dur: 0.9 },
  ...click(6.2),
  { t: 6.7, move: [0.9, 0.86], dur: 1.0 },
  tap(9.6, 'Enter'),
  tap(10.1, 'ArrowLeft', 1.1),
  tap(10.7, 'KeyZ'),
  tap(11.5, 'ArrowRight', 1.4),
  tap(12.3, 'KeyZ'),
  tap(13.1, 'KeyX'),
  tap(13.5, 'ArrowUp', 0.6),
  tap(13.6, 'ArrowLeft', 0.8),
  tap(14.8, 'Escape'),
  { t: 15.4, move: 'switch', dur: 0.9 },
  ...click(16.5),
  { t: 17.3, move: 'cart:starfall', dur: 0.8 },
  ...click(18.4),
  { t: 19.6, move: 'cart:bloom', dur: 0.9 },
  ...click(20.7),
];

const PORTRAIT = [
  { t: 0.4, move: 'cart:littlesky', dur: 1.0 },
  ...click(1.6),
  { t: 2.3, down: true },
  { t: 2.4, move: 'approach', dur: 1.3 },
  { t: 3.9, up: true },
  { t: 5.0, move: 'switch', dur: 0.9 },
  ...click(6.1),
  { t: 8.4, move: 'start', dur: 0.8 },
  ...click(9.4),
  { t: 9.9, move: 'a', dur: 0.6 },
  ...click(10.6),
  { t: 11.0, move: 'right', dur: 0.5 },
  { t: 11.6, down: true },
  { t: 12.3, up: true },
  { t: 12.5, move: 'a', dur: 0.5 },
  ...click(13.1),
  { t: 13.4, move: 'up', dur: 0.5 },
  { t: 14.0, down: true },
  { t: 14.4, up: true },
  { t: 14.6, move: 'select', dur: 0.5 },
  ...click(15.2),
  { t: 15.5, move: 'a', dur: 0.6 },
  ...click(16.2),
  { t: 16.8, move: 'switch', dur: 0.9 },
  ...click(17.9),
  { t: 18.8, move: 'cart:littlesky', dur: 0.8 },
  ...click(19.8),
  { t: 20.6, move: [0.5, 0.9], dur: 1.0 },
];

const SCRIPT = (variant === 'portrait' ? PORTRAIT : LANDSCAPE).sort((a, b) => a.t - b.t);

// Overlay: a pointer dot (grows on press) and a key strip, driven only by real DOM input events.
const OVERLAY = () => {
  const dot = document.createElement('div');
  dot.id = 'film-pointer';
  Object.assign(dot.style, {
    position: 'fixed', left: '0', top: '0', width: '22px', height: '22px', margin: '-11px 0 0 -11px', borderRadius: '50%',
    background: 'rgba(60,40,110,0.18)', border: '1.5px solid rgba(60,40,110,0.55)', pointerEvents: 'none', zIndex: '99999',
    transition: 'transform 90ms ease-out, background 90ms', opacity: '0',
  });
  const keys = document.createElement('div');
  Object.assign(keys.style, {
    position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)', display: 'flex', gap: '6px',
    pointerEvents: 'none', zIndex: '99999', font: '600 12px/1 ui-monospace, Menlo, monospace',
  });
  document.body.append(dot, keys);
  window.addEventListener('pointermove', (e) => { dot.style.opacity = '1'; dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px) scale(${dot.dataset.down ? 0.75 : 1})`; }, true);
  window.addEventListener('pointerdown', (e) => { dot.dataset.down = '1'; dot.style.background = 'rgba(60,40,110,0.4)'; dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px) scale(0.75)`; }, true);
  window.addEventListener('pointerup', (e) => { delete dot.dataset.down; dot.style.background = 'rgba(60,40,110,0.18)'; dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px) scale(1)`; }, true);
  const LABEL = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', KeyZ: 'Z', KeyX: 'X', Enter: 'Enter', Escape: 'Esc' };
  const shown = new Map();
  window.addEventListener('keydown', (e) => {
    if (shown.has(e.code)) return;
    const k = document.createElement('span');
    k.textContent = LABEL[e.code] ?? e.code;
    Object.assign(k.style, { padding: '6px 9px', borderRadius: '6px', background: 'rgba(30,24,48,0.82)', color: '#f4f1fb' });
    keys.append(k);
    shown.set(e.code, k);
  }, true);
  window.addEventListener('keyup', (e) => { shown.get(e.code)?.remove(); shown.delete(e.code); }, true);
};

// ───────────── run ─────────────
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: VIEW.width, height: VIEW.height }, deviceScaleFactor: VIEW.scale });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}/?capture`);
await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60000 });
await page.addStyleTag({ content: '*{cursor:none!important}' });
await page.evaluate(OVERLAY);
const offset = await page.evaluate(() => {
  window.__pocket.advance(60); // settle springs before frame 0
  return window.__pocket.controller.virtualTime;
});

const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const where = async (target) =>
  Array.isArray(target) ? { x: target[0] * VIEW.width, y: target[1] * VIEW.height } : page.evaluate((t) => window.__pocket.stage.screenOf(t), target);

/** The virtual clock only moves when we advance it, so a retried screenshot captures the same frame. */
async function shoot(file) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.screenshot({ path: file, type: 'jpeg', quality: 93, timeout: 60000 });
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`\nscreenshot retry ${attempt}: ${err.message.split('\n')[0]}`);
    }
  }
}

let pos = { x: VIEW.width * 0.72, y: VIEW.height * 0.8 };
let glide = null;
const releases = []; // [time, code]
let next = 0;
const frames = Math.round(DURATION * FPS);
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  const t = f / FPS;
  while (next < SCRIPT.length && SCRIPT[next].t <= t) {
    const s = SCRIPT[next++];
    if (s.move) glide = { from: { ...pos }, target: s.move, start: s.t, dur: s.dur };
    if (s.down) await page.mouse.down();
    if (s.up) await page.mouse.up();
    if (s.key) {
      await page.keyboard.down(s.key);
      releases.push([s.t + s.hold, s.key]);
    }
  }
  for (let i = releases.length - 1; i >= 0; i--) {
    if (releases[i][0] <= t) {
      await page.keyboard.up(releases[i][1]);
      releases.splice(i, 1);
    }
  }
  if (glide) {
    // Re-resolve the target every frame: the camera may still be moving (it pulls back after power off).
    const to = await where(glide.target);
    const k = ease((t - glide.start) / glide.dur);
    pos = { x: glide.from.x + (to.x - glide.from.x) * k, y: glide.from.y + (to.y - glide.from.y) * k };
    await page.mouse.move(pos.x, pos.y);
    if (k >= 1) glide = null;
  }
  await page.evaluate((dt) => window.__pocket.stage.advance(dt), 1 / FPS);
  await shoot(path.join(frameDir, `${String(f).padStart(5, '0')}.jpg`));
  if (f % 60 === 0) process.stdout.write(`\r${variant}: frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
process.stdout.write('\n');

const log = await page.evaluate(() => {
  const s = window.__pocket.controller.runtime.inspect();
  return { power: s.power, slot: s.slot, cart: s.cart, selected: s.selected, app: s.app, updates: s.updates };
});
console.log('final state', JSON.stringify(log));
const b64 = await page.evaluate(({ d, o }) => window.__pocket.soundtrack(d, o), { d: DURATION, o: offset });
const wavPath = path.join(outDir, 'frames', `${variant}.wav`);
fs.writeFileSync(wavPath, Buffer.from(b64, 'base64'));
await browser.close();
if (errors.length) {
  console.error('page errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}

const mp4 = path.join(outDir, `pocket-study-${variant}.mp4`);
execFileSync(ffmpeg, [
  '-y', '-loglevel', 'error',
  '-framerate', String(FPS), '-i', path.join(frameDir, '%05d.jpg'),
  '-i', wavPath,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
  '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-shortest', '-movflags', '+faststart',
  mp4,
]);
console.log('wrote', mp4, `${(fs.statSync(mp4).size / 1048576).toFixed(1)} MB`);
if (!args.keep) fs.rmSync(frameDir, { recursive: true, force: true });
