import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('keyboard character selection and reduced-motion mobile layout', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await request.post('/api/control', {
    data: { type: 'scenario', scenario: 'village', population: 6 },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-app-state', 'ready');
  await expect(page.getByTestId('planner-mode')).toContainText('Local AI');
  const character = page.locator('.world-scene .citizen').first();
  const id = await character.getAttribute('data-entity-id');
  await character.focus();
  await expect(character.locator('.focus-ring')).toHaveCSS('opacity', '1');
  await expect(character).toHaveCSS('transition-duration', '0s');
  await expect(character.locator('.arm')).toHaveCSS('animation-name', 'none');
  await character.press('Enter');
  // Selecting directly on the mobile map opens details without an extra workspace toggle.
  const details = page.getByRole('region', { name: 'Citizen details', exact: true });
  await expect(details).toBeVisible();
  await expect(page.getByTestId('citizen-inspector')).toHaveAttribute('data-citizen-id', id!);
  const citizenName = await page.getByTestId('citizen-inspector').getByRole('heading').first().innerText();
  const workspace = page.getByRole('region', { name: 'World workspace', exact: true });
  await expect(workspace).toBeHidden();
  const back = page.getByRole('button', { name: 'Back to world', exact: true });
  await expect(back).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const nowTab = page.getByRole('tab', { name: 'Now', exact: true });
  await nowTab.focus();
  await page.keyboard.press('ArrowRight');
  const motivation = page.getByRole('tab', { name: 'Motivation', exact: true });
  await expect(motivation).toBeFocused();
  await expect(motivation).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  const history = page.getByRole('tab', { name: 'History', exact: true });
  await expect(history).toBeFocused();
  await expect(history).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(nowTab).toBeFocused();
  await expect(nowTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('citizen-inspector')).toHaveAttribute('data-citizen-id', id!);
  await back.click();
  await expect(workspace).toBeVisible();
  await expect(details).toHaveCount(0);
  await expect(page.getByTestId('citizen-inspector')).toHaveCount(0);

  // Selection remains available, but details do not consume the world after closing.
  await page.getByRole('button', { name: `Inspect ${citizenName}`, exact: true }).click();
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(workspace).toBeVisible();
  await expect(details).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = join(tmpdir(), 'prosper-browser-visual');
  mkdirSync(directory, { recursive: true });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: join(directory, 'mobile.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});
