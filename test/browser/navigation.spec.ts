import { test, expect, type Page } from '@playwright/test';
import type { AppSnapshot } from '../../src/shared/types';
import { createWorld } from '../../src/world/core';

async function offline(page: Page) {
  const world = createWorld({ seed: 19, runId: 'offline-navigation', population: 5 });
  const citizen = Object.values(world.citizens)[0];
  citizen.x = Math.floor(world.width * 0.35);
  citizen.y = Math.floor(world.height * 0.4);
  const snapshot: AppSnapshot = {
    world,
    status: {
      state: 'ready',
      running: false,
      speed: 1,
      mode: 'scripted',
      generation: 1,
      thinking: [],
    },
    budget: {
      requests: 0,
      limit: 100,
      pending: 0,
      spent: 0,
      tokens: 0,
      maxTokens: 100000,
      unit: 'requests',
    },
    turns: [],
  };
  const mutations: string[] = [];
  await page.addInitScript((id) => {
    localStorage.setItem('prosper.ui.selected', JSON.stringify(id));
  }, citizen.id);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'GET' && path === '/api/state')
      await route.fulfill({ json: snapshot });
    else if (route.request().method() === 'GET' && path === '/api/history/global')
      await route.fulfill({
        json: {
          runId: world.runId,
          tick: world.tick,
          startedTick: world.tick,
          cadence: 20,
          limit: 256,
          frames: [],
        },
      });
    else {
      mutations.push(route.request().url());
      await route.fulfill({ status: 501, body: 'Offline fixture only' });
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-run-id', world.runId);
  await page.getByRole('button', { name: 'World settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Follow selected citizen', exact: true }).check();
  await expect(
    page.getByRole('checkbox', { name: 'Follow selected citizen', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  await page.getByTestId('world-scene').scrollIntoViewIfNeeded();
  return { world, mutations };
}

const view = (page: Page) =>
  page.getByTestId('world-scene').evaluate((node) => {
    const b = (node as SVGSVGElement).viewBox.baseVal;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });

test('offline wheel is pointer anchored, releases follow and consumes only map scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { mutations } = await offline(page);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const map = page.getByTestId('world-scene');
  const anchor = await map.evaluate((node) => {
    const svg = node as SVGSVGElement;
    const b = svg.viewBox.baseVal;
    const p = new DOMPoint(b.x + b.width * 0.4, b.y + b.height * 0.45);
    const screen = p.matrixTransform(svg.getScreenCTM()!);
    return { x: p.x, y: p.y, screenX: screen.x, screenY: screen.y };
  });
  const scroll = await page.evaluate(() => scrollY);
  await page.mouse.move(anchor.screenX, anchor.screenY);
  const before = await view(page);
  await page.mouse.wheel(0, -80);
  await expect.poll(async () => (await view(page)).width).toBeLessThan(before.width);
  const after = await map.evaluate((node, anchor) => {
    const screen = new DOMPoint(anchor.x, anchor.y).matrixTransform(
      (node as SVGSVGElement).getScreenCTM()!,
    );
    return { x: screen.x, y: screen.y };
  }, anchor);
  expect(after.x).toBeCloseTo(anchor.screenX, 0);
  expect(after.y).toBeCloseTo(anchor.screenY, 0);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await page.getByRole('button', { name: 'World settings', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Follow selected citizen', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  const outsideCancelled = await page.evaluate(() => {
    const event = new WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
    document.querySelector('.map-footer')!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(outsideCancelled).toBe(false);
  expect(mutations).toEqual([]);
});

test('offline background drag takes over current follow center; focused keys pan, bound and fit', async ({
  page,
}) => {
  const { world, mutations } = await offline(page);
  const map = page.getByTestId('world-scene');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const before = await view(page);
  // Choose terrain, not an entity, using its actual presentation transform.
  const start = await map.evaluate((node) => {
    const svg = node as SVGSVGElement;
    const rect = [...svg.querySelectorAll('g[data-testid="spectator-terrain"] rect')].find(
      (rect) => {
        const box = rect.getBoundingClientRect();
        return box.width > 20 && box.height > 20;
      },
    )!;
    const box = rect.getBoundingClientRect(),
      map = svg.getBoundingClientRect();
    return { x: Math.max(box.left, map.left) + 8, y: Math.max(box.top, map.top) + 8 };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const taken = await view(page);
  expect(taken.x + taken.width / 2).toBeCloseTo(before.x + before.width / 2, 1);
  expect(taken.y + taken.height / 2).toBeCloseTo(before.y + before.height / 2, 1);
  await page.mouse.move(start.x + 35, start.y + 15, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByTestId('tile-inspector')).toHaveCount(0);
  await page.getByRole('button', { name: 'World settings', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Follow selected citizen', exact: true }),
  ).not.toBeChecked();
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  await map.focus();
  await page.keyboard.press('Shift+ArrowRight');
  const panned = await view(page);
  expect(panned.x).toBeGreaterThan(taken.x);
  for (let i = 0; i < 12; i++) await page.keyboard.press('+');
  expect((await view(page)).width).toBeCloseTo(world.width / 5, 3);
  await page.keyboard.press('Home');
  expect(await view(page)).toEqual({ x: 0, y: 0, width: world.width, height: world.height });
  await page.keyboard.press('Escape');
  expect(mutations).toEqual([]);
});
