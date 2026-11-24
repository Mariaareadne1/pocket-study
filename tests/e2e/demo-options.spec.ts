/**
 * Demo options, driven by real clicks, select changes and key presses:
 *  - "Only <cartridge>" (and ?only=) leaves a single cartridge in the scene and on the tray.
 *  - While a game runs, the key guide shows that game's keyboard keys, and the Keys pill hides it.
 */
import { type Page, expect, test } from '@playwright/test';

const VIEW = { width: 1280, height: 800 };

async function open(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
}

const at = (page: Page, id: string) => page.evaluate((t) => window.__pocket!.stage.screenOf(t as never), `cart:${id}`);
const onScreen = (p: { x: number; y: number }): boolean => p.x > 0 && p.x < VIEW.width && p.y > 0 && p.y < VIEW.height;
/** The console's device state (inspect() spreads it at the top level). */
const device = (page: Page) => page.evaluate(() => window.__pocket!.controller.runtime.inspect() as { cart: string | null; slot: string; power: string });

test('?only= shows one cartridge, and the selector switches between one and all', async ({ page }) => {
  await open(page, '?only=vine');
  const show = page.getByRole('combobox', { name: 'Cartridges on show' });
  await expect(show).toHaveValue('vine');
  const tray = page.getByRole('navigation', { name: 'Cartridges' });
  await expect(tray.getByRole('button', { name: /cartridge \d\d/ })).toHaveCount(1);
  await expect(tray.getByRole('button', { name: /Vine, cartridge 04/ })).toBeVisible();
  expect(onScreen(await at(page, 'vine'))).toBe(true);
  for (const id of ['bloom', 'starfall', 'littlesky', 'glasshouse', 'rally']) expect(onScreen(await at(page, id)), id).toBe(false);

  await show.selectOption('');
  await expect(page).not.toHaveURL(/only=/);
  await expect(tray.getByRole('button', { name: /cartridge \d\d/ })).toHaveCount(6);
  await page.waitForTimeout(1500); // the others slide back in
  for (const id of ['bloom', 'starfall', 'littlesky', 'vine', 'glasshouse', 'rally']) expect(onScreen(await at(page, id)), id).toBe(true);

  await show.selectOption('rally');
  await expect(page).toHaveURL(/only=rally/);
  await expect(page.getByRole('heading', { name: /Rally/ })).toBeVisible();
  // With one cartridge on show, Insert needs no selection first.
  await page.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(async () => (await device(page)).slot, { timeout: 10_000 }).toBe('inserted');
  expect((await device(page)).cart).toBe('rally');
});

test('"No cartridges" leaves the console alone in the frame, ready to record', async ({ page }) => {
  await open(page);
  const show = page.getByRole('combobox', { name: 'Cartridges on show' });
  await show.selectOption('none');
  await expect(page).toHaveURL(/only=none/);
  const tray = page.getByRole('navigation', { name: 'Cartridges' });
  await expect(tray.getByRole('button', { name: /cartridge \d\d/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'The console' })).toBeVisible();
  await page.waitForTimeout(1500); // cartridges slide out, the camera centres the console
  for (const id of ['bloom', 'starfall', 'littlesky', 'vine', 'glasshouse', 'rally']) expect(onScreen(await at(page, id)), id).toBe(false);
  const screen = await page.evaluate(() => window.__pocket!.stage.screenOf('screen'));
  expect(Math.abs(screen.x - VIEW.width / 2)).toBeLessThan(40);
  await expect(page.getByRole('button', { name: /Record demo/ })).toBeEnabled();

  // It survives a reload through the address, and the console still switches on with nothing inserted.
  await page.reload();
  await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60_000 });
  await expect(page.getByRole('combobox', { name: 'Cartridges on show' })).toHaveValue('none');
  await page.getByRole('button', { name: 'Power on' }).click();
  await expect.poll(async () => (await device(page)).power, { timeout: 10_000 }).not.toBe('off');
});

test('an unknown ?only= value falls back to every cartridge', async ({ page }) => {
  await open(page, '?only=nope');
  await expect(page.getByRole('combobox', { name: 'Cartridges on show' })).toHaveValue('');
  await expect(page.getByRole('navigation', { name: 'Cartridges' }).getByRole('button', { name: /cartridge \d\d/ })).toHaveCount(6);
});

test('the key guide shows the playing game’s keys, and the Keys pill hides it', async ({ page }) => {
  await open(page, '?only=glasshouse');
  await page.getByRole('button', { name: 'Insert' }).click();
  await expect.poll(async () => (await device(page)).slot, { timeout: 10_000 }).toBe('inserted');
  const guide = page.getByRole('complementary', { name: 'Keyboard controls for Glasshouse' });
  await expect(guide).toHaveCount(0); // off: nothing to play yet
  await page.getByRole('button', { name: 'Power on' }).click();
  await expect(guide).toBeVisible({ timeout: 10_000 });
  for (const key of ['←', '→', 'A', 'Z', 'Space', 'Enter', 'Esc']) await expect(guide.locator('kbd', { hasText: new RegExp(`^${key}$`) })).toHaveCount(1);
  await expect(guide.getByText('launch')).toBeVisible();

  // The keys on the guide really drive the game.
  await page.waitForTimeout(3000); // boot
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await device(page)).power, { timeout: 5000 }).toBe('playing');
  await expect(page.locator('.ps-hint')).toHaveText('Arrows move · A launch · Enter/Esc pause');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await device(page)).power, { timeout: 5000 }).toBe('paused');

  const pill = page.getByRole('button', { name: 'Keys' });
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await pill.click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await page.waitForFunction(() => window.__pocket?.ready, null, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Keys' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Keys' }).click();
  await expect(page.getByRole('button', { name: 'Keys' })).toHaveAttribute('aria-pressed', 'true');
});
