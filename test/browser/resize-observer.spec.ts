import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/world/core';

for (const speech of [false, true]) {
  test(`mobile drawer geometry delivers without browser errors (speech ${speech})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const errors: string[] = [];
      Object.assign(window, { resizeBrowserErrors: errors });
      window.addEventListener('error', event => errors.push(event.message));
    });
    const world = createWorld({ seed: 19, runId: 'offline-mobile-resize', population: 5 });
    world.tick = 100;
    Object.values(world.citizens).forEach(c => { c.x = Math.floor(world.width / 2); c.y = Math.floor(world.height / 2); c.action = null; });
    world.messages = speech ? Object.values(world.citizens).map((c, i) => ({ id: `speech-${i}`, from: c.id, tick: world.tick, text: i === 0 ? 'Short.' : 'A longer public announcement. '.repeat(18) })) : [];
    const snapshot = { world, status: { state: 'ready', running: false, speed: 1, mode: 'scripted', generation: 1, thinking: [] }, budget: { requests: 0, limit: 100, pending: 0, spent: 0, tokens: 0, maxTokens: 100000, unit: 'requests' }, turns: [] };
    const unexpected: string[] = [];
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (request.method() === 'GET' && path === '/api/state') await route.fulfill({ json: snapshot });
      else if (request.method() === 'GET' && path === '/api/history/global') await route.fulfill({ json: { runId: world.runId, tick: world.tick, startedTick: 0, cadence: 20, limit: 256, frames: [] } });
      else { unexpected.push(`${request.method()} ${path}`); await route.fulfill({ status: 501, body: 'Offline fixture only' }); }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-run-id', world.runId);
    if (speech) await expect(page.locator('.speech-overlay-entry:not([hidden])').first()).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Workspace view' });
    for (let round = 0; round < 5; round++) {
      if (speech) {
        world.tick++;
        world.messages = world.messages.map((message, i) => ({ ...message, id: `round-${round}-${i}`, tick: world.tick, text: i === 0 ? `Round ${round}.` : message.text }));
        await expect(page.locator('.speech-overlay-entry:not([hidden])').filter({ hasText: `Round ${round}.` })).toBeVisible();
      }
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: round % 2 ? 740 : 844 });
        for (const name of ['Citizens', 'Dossier', 'Analysis', 'World']) {
          await nav.getByRole('button', { name, exact: true }).click();
          await expect(nav.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
          await expect(page.getByTestId('world-scene'))[name === 'World' ? 'toBeVisible' : 'toBeHidden']();
          // Allow rendering and native ResizeObserver delivery, not synthetic resize events only.
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          expect(errors).toEqual([]);
          const browserErrors = await page.evaluate(() => (window as unknown as { resizeBrowserErrors: string[] }).resizeBrowserErrors);
          expect(browserErrors).toEqual([]);
        }
      }
    }
    expect(unexpected).toEqual([]);
    expect(errors).toEqual([]);
  });
}
