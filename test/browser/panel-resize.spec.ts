import { test, expect, type Locator, type Page } from '@playwright/test';
import type { AppSnapshot } from '../../src/shared/types';
import { createWorld } from '../../src/world/core';

// Every API request is intercepted; layout controls cannot touch a durable world.
async function offline(page: Page) {
  const world = createWorld({ seed: 19, runId: 'offline-panel-resize', population: 20 });
  const snapshot: AppSnapshot = {
    world,
    status: { state: 'ready', running: false, speed: 1, mode: 'scripted', generation: 1, thinking: [] },
    budget: { requests: 0, limit: 100, pending: 0, spent: 0, tokens: 0, maxTokens: 100000, unit: 'requests' },
    turns: [],
  };
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/state') await route.fulfill({ json: snapshot });
    else if (request.method() === 'GET' && path === '/api/history/global') {
      await route.fulfill({ json: { runId: world.runId, tick: world.tick, startedTick: 0, cadence: 20, limit: 256, frames: [] } });
    } else {
      unexpected.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 501, body: 'Offline fixture only' });
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-run-id', world.runId);
  await expect(page.getByRole('separator')).toHaveCount(3);
  return unexpected;
}

const splits = [
  { name: 'Resize citizens', pane: '#engine-left', axis: 'width', sign: 1, grow: 'ArrowRight', shrink: 'ArrowLeft', minimum: 160 },
  { name: 'Resize dossier', pane: '#engine-right', axis: 'width', sign: -1, grow: 'ArrowLeft', shrink: 'ArrowRight', minimum: 220 },
  { name: 'Resize bottom dock', pane: '#engine-dock', axis: 'height', sign: -1, grow: 'ArrowUp', shrink: 'ArrowDown', minimum: 100 },
] as const;
type Split = typeof splits[number];
async function size(page: Page, selector: string, axis: Split['axis']) {
  return page.locator(selector).evaluate((element, axis) => element.getBoundingClientRect()[axis], axis);
}
async function drag(page: Page, handle: Locator, split: Split, delta: number) {
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (split.axis === 'width' ? delta * split.sign : 0), y + (split.axis === 'height' ? delta * split.sign : 0), { steps: 5 });
  await page.mouse.up();
}
async function dimensions(page: Page) {
  return Promise.all(splits.map(split => size(page, split.pane, split.axis)));
}
async function expectDimensions(page: Page, expected: number[]) {
  await expect.poll(async () => Math.max(...(await dimensions(page)).map((n, i) => Math.abs(n - expected[i]!)))).toBeLessThan(2);
}
async function reset(page: Page) {
  await page.getByText('View', { exact: true }).click();
  await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
  // Close the disclosure if reset leaves it open, without toggling it back open.
  await page.locator('details').filter({ has: page.getByText('View', { exact: true }) }).evaluateAll(nodes => nodes.forEach(node => node.removeAttribute('open')));
}
async function contained(page: Page) {
  for (const split of splits) {
    expect(await size(page, split.pane, split.axis), split.name).toBeGreaterThanOrEqual(split.minimum - 1);
  }
  const map = await page.locator('.engine-map').boundingBox();
  expect(map!.width).toBeGreaterThanOrEqual(419);
  expect(map!.height).toBeGreaterThanOrEqual(419);
  const scene = await page.getByTestId('world-scene').boundingBox();
  expect(scene!.height).toBeGreaterThanOrEqual(240);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
}

test('three engine dividers resize physical panes, persist, collapse and reset without world requests', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const unexpected = await offline(page);
  const initial = await dimensions(page);
  for (const split of splits) {
    const handle = page.getByRole('separator', { name: split.name, exact: true });
    await expect(handle).toHaveAttribute('aria-orientation', split.axis === 'width' ? 'vertical' : 'horizontal');
    const before = await size(page, split.pane, split.axis);
    const mapBefore = await size(page, '.engine-map', split.axis);
    await drag(page, handle, split, 24);
    await expect.poll(() => size(page, split.pane, split.axis)).toBeGreaterThan(before + 15);
    await expect.poll(() => size(page, '.engine-map', split.axis)).toBeLessThan(mapBefore - 15);
  }
  await contained(page);
  const resized = await dimensions(page);
  await page.reload();
  await expectDimensions(page, resized);
  for (const split of splits) {
    await page.getByRole('separator', { name: split.name, exact: true }).press('Enter');
    await expect(page.locator(split.pane)).toHaveClass(/is-collapsed/);
    await expect.poll(() => size(page, split.pane, split.axis)).toBeLessThan(30);
  }
  await page.reload();
  for (const split of splits) await expect(page.locator(split.pane)).toHaveClass(/is-collapsed/);
  await reset(page);
  await expectDimensions(page, initial);
  await page.reload();
  await expectDimensions(page, initial);
  expect(unexpected).toEqual([]);
});

test('keyboard and extreme pointer resizing preserve pane minima and map space', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const unexpected = await offline(page);
  for (const split of splits) {
    const handle = page.getByRole('separator', { name: split.name, exact: true });
    const before = await size(page, split.pane, split.axis);
    await handle.press(split.grow);
    await expect.poll(() => size(page, split.pane, split.axis)).toBeGreaterThan(before + 5);
    await handle.press(split.shrink);
    expect(await size(page, split.pane, split.axis)).toBeCloseTo(before, 0);
    await handle.press('Home');
    const minimum = await size(page, split.pane, split.axis);
    expect(minimum).toBeCloseTo(split.minimum, 0);
    await drag(page, handle, split, -3000);
    expect(await size(page, split.pane, split.axis)).toBeCloseTo(minimum, 0);
    await contained(page);
    await handle.press('End');
    const maximum = await size(page, split.pane, split.axis);
    expect(maximum).toBeGreaterThan(minimum + 10);
    await drag(page, handle, split, 3000);
    expect(await size(page, split.pane, split.axis)).toBeCloseTo(maximum, 0);
    await contained(page);
    await reset(page);
  }
  expect(unexpected).toEqual([]);
});

test('focus collapses panes to rails; mobile shows one workspace and no resizing handles', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const unexpected = await offline(page);
  const before = await page.getByTestId('world-scene').boundingBox();
  await page.getByText('View', { exact: true }).click();
  await page.getByRole('button', { name: 'Focus world', exact: true }).click();
  for (const split of splits) await expect(page.locator(split.pane)).toHaveClass(/is-collapsed/);
  const focused = await page.getByTestId('world-scene').boundingBox();
  expect(focused!.width).toBeGreaterThan(before!.width + 400);
  expect(focused!.height).toBeGreaterThan(before!.height + 150);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('separator')).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Workspace view' });
  for (const [name, selector] of [['Citizens', '#engine-left'], ['Dossier', '#engine-right'], ['Analysis', '#engine-dock'], ['World', '.engine-map']] as const) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.locator(selector)).toBeVisible();
    for (const other of ['#engine-left', '#engine-right', '#engine-dock', '.engine-map'].filter(s => s !== selector)) await expect(page.locator(other)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
  }
  expect(unexpected).toEqual([]);
});
