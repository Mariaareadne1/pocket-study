// Captures baseline screenshots of Ann Nguyen's original CD case for docs/SOURCE_AUDIT.md.
// Run the reference dev server first: (cd ../_refs/vibe-coding/cd-case && npx next dev --port 9283)
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'docs/media/reference';
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:9283', { waitUntil: 'networkidle' });
await page.waitForSelector('main[data-ready]', { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/cd-case-rest.png` });
await page.keyboard.press('o');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/cd-case-opening.png` });
await page.waitForTimeout(1600);
await page.screenshot({ path: `${out}/cd-case-open.png` });
await page.mouse.move(720, 420);
await page.mouse.down();
await page.mouse.move(860, 380, { steps: 12 });
await page.screenshot({ path: `${out}/cd-case-drag.png` });
await page.mouse.up();
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => (++n < 90 ? requestAnimationFrame(f) : resolve((n * 1000) / (performance.now() - t0)));
      requestAnimationFrame(f);
    }),
);
console.log(JSON.stringify({ errors, fps: Math.round(fps) }));
await browser.close();
