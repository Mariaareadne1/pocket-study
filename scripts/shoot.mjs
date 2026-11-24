// Visual QA: renders the real app in headless Chrome (Metal) and saves screenshots.
// usage: node scripts/shoot.mjs [baseUrl] [outDir] [--w=1440 --h=900] [--shots=hero,side,...]
// Steps drive the same controller/runtime calls the UI uses; `wait` advances the virtual clock.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=')[1];
const pos = args.filter((a) => !a.startsWith('--'));
const base = pos[0] ?? 'http://localhost:5580';
const out = pos[1] ?? 'artifacts/shots';
const W = Number(flag('w', 1440));
const H = Number(flag('h', 900));
const DPR = Number(flag('dpr', 1));
const only = flag('shots', '').split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });

const insert = (id) => [['rt', 'selectCart', id], ['wait', 0.4], ['rt', 'insert', id], ['wait', 2.2]];
const power = [['rt', 'togglePower'], ['wait', 4.5]];
const SHOTS = {
  hero: [],
  side: [['orbit', 1.2, 0.1]],
  back: [['orbit', 2.9, 0.2]],
  top: [['orbit', -0.2, 0.9]],
  selected: [['rt', 'selectCart', 'bloom'], ['wait', 1]],
  inserted: insert('bloom'),
  boot: [...insert('bloom'), ['rt', 'togglePower'], ['wait', 1.2]],
  bloom: [...insert('bloom'), ...power, ['tap', 'start'], ['wait', 1.5], ['tap', 'a'], ['wait', 2]],
  starfall: [...insert('starfall'), ...power, ['tap', 'start'], ['wait', 1], ['tap', 'a'], ['wait', 3]],
  littlesky: [...insert('littlesky'), ...power, ['tap', 'start'], ['wait', 1], ['tap', 'a'], ['wait', 2]],
  vine: [...insert('vine'), ...power, ['tap', 'start'], ['wait', 0.8], ['tap', 'down'], ['wait', 0.5], ['tap', 'right'], ['wait', 0.6]],
  glasshouse: [...insert('glasshouse'), ...power, ['tap', 'start'], ['wait', 2], ['tap', 'a'], ['wait', 2.5]],
  rally: [...insert('rally'), ...power, ['tap', 'start'], ['wait', 0.6], ['tap', 'a'], ['wait', 2.2]],
};

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
for (const [name, steps] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${base}/?capture`);
  await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.__pocket.advance(1));
  for (const [kind, a, b] of steps) {
    await page.evaluate(([kind, a, b]) => {
      const { stage, controller, advance } = window.__pocket;
      const rt = controller.runtime;
      if (kind === 'orbit') stage.setOrbit(a, b);
      if (kind === 'rt') rt[a](b);
      if (kind === 'tap') { rt.hub.press('key:test', a); advance(4); rt.hub.release('key:test', a); }
      if (kind === 'wait') advance(Math.round(a * 60));
    }, [kind, a, b]);
  }
  await page.evaluate(() => window.__pocket.advance(60));
  const dbg = await page.evaluate(() => ({ ...window.__pocket.stage.debug(), rt: window.__pocket.inspect() }));
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(name, JSON.stringify(dbg).slice(0, 300));
  await page.close();
}
await browser.close();
if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
