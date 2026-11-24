/**
 * "Record demo": real clicks and key presses, a real MediaRecorder file downloaded by the browser,
 * then checked with ffprobe and scanned frame by frame for the Record button's red dot, which
 * must never appear in a recording.
 */
import { type Page, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { PNG } from 'pngjs';

const BASE_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
// Full Chromium (new headless): the lightweight headless shell has no screen capture. The flag
// auto-accepts getDisplayMedia({ preferCurrentTab: true }) for this tab, so the tab path runs unattended.
test.use({ channel: 'chromium', launchOptions: { args: [...BASE_ARGS, '--auto-accept-this-tab-capture'] } });

const DOT = [0xd4, 0x47, 0x5c];

async function open(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
}

/** Probes the file and returns its duration in seconds; throws if there's no video stream. */
function probe(file: string): { duration: number; width: number; codec: string } {
  const out = JSON.parse(execFileSync(ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const v = out.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!v) throw new Error('no video stream');
  return { duration: Number(out.format.duration ?? v.duration ?? 0), width: v.width, codec: v.codec_name };
}

/** Pixels close to the Record button's red dot, in the bottom band's middle third (where the control sits). */
function countDot(png: PNG): number {
  let hits = 0;
  for (let y = Math.floor(png.height * 0.86); y < png.height; y++) {
    for (let x = Math.floor(png.width / 3); x < Math.floor((png.width * 2) / 3); x++) {
      const i = (y * png.width + x) * 4;
      if (Math.abs(png.data[i] - DOT[0]) < 14 && Math.abs(png.data[i + 1] - DOT[1]) < 14 && Math.abs(png.data[i + 2] - DOT[2]) < 14) hits++;
    }
  }
  return hits;
}

/** Sums countDot over frames sampled from the film at 4 fps. */
function dotPixels(file: string, dir: string): { frames: number; hits: number } {
  execFileSync(ffmpeg as unknown as string, ['-v', 'error', '-y', '-i', file, '-vf', 'fps=4', path.join(dir, 'f%03d.png')]);
  const frames = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  const hits = frames.reduce((n, f) => n + countDot(PNG.sync.read(fs.readFileSync(path.join(dir, f)))), 0);
  return { frames: frames.length, hits };
}

/** Where the test parks the mouse during a take: empty backdrop left of the console (1280 × 800 view). */
const PARK = { x: 300, y: 430 };

/** Dark arrow-fill pixels (#1c1b22) in a 30 px box below-right of the parked pointer's tip, in any frame. */
function pointerPixels(dir: string): number {
  let best = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.png'))) {
    const png = PNG.sync.read(fs.readFileSync(path.join(dir, f)));
    const k = png.width / 1280;
    let hits = 0;
    for (let y = Math.round(PARK.y * k); y < Math.round((PARK.y + 30) * k); y++) {
      for (let x = Math.round(PARK.x * k); x < Math.round((PARK.x + 30) * k); x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i] < 70 && png.data[i + 1] < 70 && png.data[i + 2] < 80) hits++;
      }
    }
    best = Math.max(best, hits);
  }
  return best;
}

async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(PARK.x + 40, PARK.y + 40);
  await page.mouse.move(PARK.x, PARK.y, { steps: 6 });
  await page.waitForTimeout(1200);
}

async function playALittle(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Bloom, cartridge 01/ }).click();
  await page.getByRole('button', { name: 'Insert' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Power on' }).click();
  await page.waitForTimeout(1500);
}

async function saveDownload(page: Page, stop: () => Promise<void>): Promise<string> {
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await stop();
  const dl = await pending;
  expect(dl.suggestedFilename()).toMatch(/^handheld-demo-\d{4}-\d{2}-\d{2}-\d{6}\.(mp4|webm)$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-rec-'));
  const file = path.join(dir, dl.suggestedFilename());
  await dl.saveAs(file);
  return file;
}

test('tab recording hides the Record button for the whole take', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, '?rec=tab');
  const record = page.getByRole('button', { name: /Record demo/ });
  await expect(record).toBeVisible();
  // Control: the detector does see the dot while the button is on the page.
  expect(countDot(PNG.sync.read(await page.screenshot()))).toBeGreaterThan(10);
  await playALittle(page);
  await record.click();
  await expect(page.getByRole('status').filter({ hasText: 'Press R' })).toBeVisible();
  // Countdown ends → every part of the control leaves the page.
  await expect(page.locator('.ps-rec')).toHaveCount(0, { timeout: 10_000 });
  // Every word and control on the page is hidden too: the film is only the console.
  const pageText = ['.ps-mast', '.ps-actions', '.ps-card', '.ps-tray'];
  for (const sel of pageText) await expect(page.locator(sel)).toBeHidden();
  await page.keyboard.press('Enter'); // keys still drive the console while the page is bare
  await page.waitForTimeout(3000);
  await parkPointer(page);
  await expect(page.locator('.ps-pointer svg')).toBeVisible();
  await expect(page.locator('.ps-rec')).toHaveCount(0);
  const file = await saveDownload(page, () => page.keyboard.press('KeyR'));
  for (const sel of pageText) await expect(page.locator(sel)).toBeVisible();
  await expect(page.getByText(/^Saved handheld-demo-/)).toBeVisible();
  await expect(record).toBeVisible();

  const info = probe(file);
  expect(info.duration).toBeGreaterThan(2);
  const scan = dotPixels(file, path.dirname(file));
  if (process.env.KEEP_FILM) fs.copyFileSync(path.join(path.dirname(file), 'f008.png'), process.env.KEEP_FILM);
  expect(scan.frames).toBeGreaterThan(6);
  expect(scan.hits).toBe(0);
  // The mouse is in the film (tab capture leaves out the system cursor; the page draws one).
  expect(pointerPixels(path.dirname(file))).toBeGreaterThan(20);
});

test('canvas recording keeps a Stop button that is not in the film', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, '?rec=canvas');
  await page.getByRole('button', { name: /Record demo/ }).click();
  const stop = page.getByRole('button', { name: /^Stop/ });
  await expect(stop).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Record demo/ })).toHaveCount(0);
  await playALittle(page);
  await parkPointer(page);
  const file = await saveDownload(page, () => stop.click());
  const info = probe(file);
  expect(info.duration).toBeGreaterThan(2);
  expect(dotPixels(file, path.dirname(file)).hits).toBe(0);
  // The pointer is drawn into the scene recording too.
  expect(pointerPixels(path.dirname(file))).toBeGreaterThan(20);
});

test('cancelling the share prompt leaves the button ready', async ({ page }) => {
  await open(page, '?rec=tab');
  // A person answers the prompt after a moment; only then is it a cancel.
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = () => new Promise((_, reject) => setTimeout(() => reject(new DOMException('Permission denied', 'NotAllowedError')), 1500));
  });
  await page.getByRole('button', { name: /Record demo/ }).click();
  await expect(page.getByText('Recording cancelled.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Record demo/ })).toBeEnabled();
});

test('when the browser blocks tab capture, it records the console scene instead', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, '?rec=tab');
  // Embedded browsers refuse at once, without showing a prompt (seen in the Claude app: 148 ms).
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
  });
  await page.getByRole('button', { name: /Record demo/ }).click();
  await expect(page.getByText(/recording the console scene instead/)).toBeVisible();
  await expect(page.getByText('Recording cancelled.')).toHaveCount(0);
  const stop = page.getByRole('button', { name: /^Stop/ });
  await expect(stop).toBeVisible({ timeout: 10_000 });
  await playALittle(page);
  const file = await saveDownload(page, () => stop.click());
  expect(probe(file).duration).toBeGreaterThan(2);
  // Next time it goes straight to the scene recording, with no failed request first.
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = () => {
      throw new Error('should not be asked again');
    };
  });
  await page.getByRole('button', { name: /Record demo/ }).click();
  await expect(page.getByRole('button', { name: /^Stop/ })).toBeVisible({ timeout: 10_000 });
});
