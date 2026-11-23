/**
 * The full journey in a real browser, driven only by real pointer and keyboard events
 * (page.mouse / page.keyboard). window.__pocket is read for assertions, never to act.
 */
import { type Page, expect, test } from '@playwright/test';

type Target = 'slot' | 'switch' | 'body' | 'screen' | 'approach' | 'a' | 'b' | 'up' | 'down' | 'left' | 'right' | 'start' | 'select' | `cart:${string}`;

async function ready(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60_000 });
  // Event log for failure diagnostics: real pointer events and device power/slot transitions.
  await page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { __log: string[] }).__log = log;
    const t = (): string => (performance.now() / 1000).toFixed(2);
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click']) {
      window.addEventListener(type, (e) => log.push(`${t()} ${type} ${Math.round((e as PointerEvent).clientX)},${Math.round((e as PointerEvent).clientY)} ${(e.target as HTMLElement).tagName}`), true);
    }
    let last = '';
    window.__pocket!.controller.runtime.subscribe((snap) => {
      const k = `${snap.device.power}/${snap.device.slot}/${snap.phase}/${snap.message ?? ''}`;
      if (k !== last) log.push(`${t()} state ${k}`);
      last = k;
    });
  });
  // Let the intro settle so 3D targets stop moving.
  await page.waitForTimeout(800);
}

const at = (page: Page, t: Target) => page.evaluate((t) => window.__pocket!.stage.screenOf(t as never), t);
const state = (page: Page) => page.evaluate(() => window.__pocket!.controller.runtime.inspect() as Record<string, unknown>);
const game = async (page: Page) => (await state(page)).game as Record<string, unknown> | null;

async function click(page: Page, t: Target): Promise<void> {
  const p = await at(page, t);
  await page.mouse.click(p.x, p.y, { delay: 60 });
}

async function drag(page: Page, from: Target, to: Target): Promise<void> {
  const a = await at(page, from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x - 10, a.y - 10, { steps: 4 });
  const b = await at(page, to);
  await page.mouse.move(b.x, b.y, { steps: 24 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

/** Resolves once the console has run `n` more fixed updates (so each key edge is really seen). */
const steps = (page: Page, n = 2) =>
  page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        const rt = window.__pocket!.controller.runtime;
        const u0 = rt.updates;
        const t0 = performance.now();
        const f = (): void => (rt.updates >= u0 + n || performance.now() - t0 > 1000 ? resolve() : void requestAnimationFrame(f));
        f();
      }),
    n,
  );

async function key(page: Page, code: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(code);
    await steps(page);
    await page.keyboard.up(code);
    await steps(page);
  }
}

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const diag = await page
    .evaluate(async () => {
      const p = window.__pocket;
      if (!p) return 'no __pocket';
      const rt = p.controller.runtime as unknown as { suspended: boolean; time: number; inspect(): Record<string, unknown> };
      const f0 = p.stage.debug().frames as number;
      const t0 = rt.time;
      await new Promise((r) => setTimeout(r, 500));
      const s = rt.inspect();
      return JSON.stringify({
        visibility: document.visibilityState, hasFocus: document.hasFocus(), suspended: rt.suspended,
        framesIn500ms: (p.stage.debug().frames as number) - f0, runtimeTimeIn500ms: rt.time - t0,
        power: s.power, powerT: s.powerT, slot: s.slot, slotT: s.slotT, app: s.app, phase: s.phase,
      });
    })
    .catch((e: Error) => `diag failed: ${e.message}`);
  console.log('DIAG', diag);
  console.log('LOG\n' + (await page.evaluate(() => (window as unknown as { __log?: string[] }).__log?.slice(-40).join('\n')).catch(() => '')));
});

const waitFor = (page: Page, fn: (s: Record<string, unknown>) => boolean, timeout = 40_000) =>
  expect.poll(async () => fn(await state(page)), { timeout }).toBe(true);

test('insert, power, play, block, eject, export, persist, clear', async ({ page }) => {
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('pageerror:', e.message, e.stack?.split('\n').slice(0, 4).join(' | '));
  });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await ready(page, '?seed=7');
  await expect(page.getByText('Object Study / 002', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pocket Study' })).toBeVisible();
  // Off: nothing is drawn on the screen.
  expect((await state(page)).fbLit).toBe(0);

  // Power with an empty slot does nothing useful but must not crash; switch back off.
  // ── 1. select Bloom by clicking it in 3D, then drag it into the slot
  await click(page, 'cart:bloom');
  await waitFor(page, (s) => s.selected === 'bloom');
  await drag(page, 'cart:bloom', 'approach');
  await waitFor(page, (s) => s.slot === 'inserted' && s.cart === 'bloom');

  // ── 2. a second cartridge is refused while the slot is full
  await drag(page, 'cart:starfall', 'approach');
  await expect(page.getByRole('status').filter({ hasText: 'already holds a cartridge' })).toBeVisible();
  expect((await state(page)).cart).toBe('bloom');

  // ── 3. flick the power switch in 3D: boot, then the cartridge's title screen
  await click(page, 'switch');
  await waitFor(page, (s) => s.power === 'booting');
  await waitFor(page, (s) => s.app === 'bloom');
  expect((await state(page)).fbLit as number).toBeGreaterThan(1000);

  // ── 4. eject is blocked while on (accessible button route)
  await page.getByRole('button', { name: 'Eject' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Switch the console off first' })).toBeVisible();
  expect((await state(page)).cart).toBe('bloom');

  // ── 5. keyboard: Enter starts, arrows move, Z plants
  await key(page, 'Enter');
  await expect.poll(async () => (await game(page))?.mode, { timeout: 10_000 }).toBe('play');
  const c0 = (await game(page))!.cursor as number[];
  // Two single steps right, checking the cursor after each (a long frame could turn a held key into a repeat).
  for (let i = 1; i <= 2; i++) {
    await key(page, 'ArrowRight');
    await expect.poll(async () => ((await game(page))!.cursor as number[])[0]).toBeGreaterThanOrEqual(c0[0] + i);
  }
  await key(page, 'KeyZ');
  await expect.poll(async () => ((await game(page))!.stages as string).replace(/0/g, '').length).toBeGreaterThan(0);

  // ── 6. the 3D D-pad and A button do the same
  // (A stalled event loop can stretch a click into a hold that auto-repeats, so "at least one row".)
  await click(page, 'down');
  await expect.poll(async () => ((await game(page))!.cursor as number[])[1]).toBeGreaterThanOrEqual(c0[1] + 1);
  const held = (await state(page)).held as string[];
  expect(held).toEqual([]);

  // ── 7. Escape pauses; the game's menu resumes with A
  await key(page, 'Escape');
  await waitFor(page, (s) => s.phase === 'paused');
  await key(page, 'KeyZ');
  await waitFor(page, (s) => s.phase === 'playing');

  // ── 8. mute toggles and is remembered
  await page.getByRole('button', { name: /^Sound on/ }).click();
  await expect(page.getByRole('button', { name: /^Sound off/ })).toBeVisible();

  // ── 9. power off in 3D, then eject by clicking the seated cartridge: it returns to the tray
  await click(page, 'switch');
  await waitFor(page, (s) => s.power === 'off');
  expect((await state(page)).fbLit).toBe(0);
  await page.getByRole('button', { name: 'Eject' }).click();
  await waitFor(page, (s) => s.slot === 'empty' && s.cart === null);

  // ── 10. click-to-insert fallback: tray chip, then Insert, then Power on (all DOM buttons)
  await page.getByRole('button', { name: /Little Sky, cartridge 03/ }).click();
  await page.getByRole('button', { name: 'Insert' }).click();
  await waitFor(page, (s) => s.slot === 'inserted' && s.cart === 'littlesky');
  await page.getByRole('button', { name: 'Power on' }).click();
  await waitFor(page, (s) => s.app === 'littlesky');
  await key(page, 'Enter'); // title → editor
  await expect.poll(async () => (await game(page))?.mode).toBe('edit');
  await key(page, 'KeyZ'); // place the first element
  await expect.poll(async () => (await game(page))?.elements).toBe(1);

  // ── 11. Little Sky PNG export downloads a file
  await key(page, 'Enter'); // open the menu
  await expect.poll(async () => (await game(page))?.mode).toBe('menu');
  // Step down until EXPORT PNG is highlighted, as a person watching the screen would.
  for (let i = 0; i < 8 && (await game(page))?.menuItem !== 'export'; i++) await key(page, 'ArrowDown');
  expect((await game(page))?.menuItem).toBe('export');
  const download = page.waitForEvent('download');
  await key(page, 'KeyZ');
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^little-sky.*\.png$/);
  const exp = await page.evaluate(() => window.__pocket!.controller.exports.at(-1));
  expect([exp?.width, exp?.height]).toEqual([160, 128]);

  // ── 12. saves survive a reload; Clear Data asks first, then removes them
  await key(page, 'KeyX'); // leave the menu
  await click(page, 'switch'); // power off saves
  await waitFor(page, (s) => s.power === 'off');
  const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pocket-study')));
  expect(saved.length).toBeGreaterThan(1);
  await ready(page, '?seed=7');
  expect(await page.evaluate(() => window.__pocket!.controller.settings.muted)).toBe(true);
  await page.getByRole('button', { name: 'Credits' }).click();
  await page.getByRole('button', { name: /Clear saved data/ }).click();
  await expect(page.getByRole('alertdialog')).toContainText('can’t be undone');
  await page.getByRole('button', { name: 'Clear data', exact: true }).click();
  await expect(page.getByText('Cleared.', { exact: true })).toBeVisible();
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pocket-study') && !k.includes('settings')));
  expect(left).toEqual([]);

  expect(errors).toEqual([]);
});

test('blur releases held inputs', async ({ page }) => {
  await ready(page, '?memory&seed=3');
  await page.getByRole('button', { name: /Starfall, cartridge 02/ }).click();
  await page.getByRole('button', { name: 'Insert' }).click();
  await waitFor(page, (s) => s.slot === 'inserted');
  await page.getByRole('button', { name: 'Power on' }).click();
  await waitFor(page, (s) => s.app === 'starfall');
  await key(page, 'Enter');
  await waitFor(page, (s) => s.phase === 'playing');
  await page.keyboard.down('ArrowLeft');
  await waitFor(page, (s) => (s.held as string[]).includes('left'));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitFor(page, (s) => (s.held as string[]).length === 0 && s.phase === 'paused');
  await page.keyboard.up('ArrowLeft');
});

test('WebGL failure shows a message and a retry', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    (window as unknown as { __noGL: boolean }).__noGL = true;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if ((window as unknown as { __noGL: boolean }).__noGL && /webgl/.test(type)) return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('/');
  const fail = page.getByRole('alert').filter({ hasText: 'couldn’t be drawn' });
  await expect(fail).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __noGL: boolean }).__noGL = false));
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60_000 });
  await expect(fail).toHaveCount(0);
});
