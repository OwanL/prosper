import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld, dispatch } from '../../src/world/core';
import { enableAutonomy } from '../../src/world/autonomy';
import { claimTerritory, formAlliance } from '../../src/world/society';
import type { AppSnapshot } from '../../src/shared/types';

const visuals = mkdtempSync(join(tmpdir(), 'prosper-economy-mocked-visuals-'));

async function mount(page: Page, snapshot: AppSnapshot) {
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/state') await route.fulfill({ json: snapshot });
    else if (request.method() === 'GET' && path === '/api/history/global') {
      await route.fulfill({ json: { runId: snapshot.world.runId, tick: snapshot.world.tick, startedTick: 0, cadence: 20, limit: 256, frames: [] } });
    } else {
      unexpected.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 403, json: { error: 'No unhandled requests in presentation mock' } });
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-run-id', snapshot.world.runId);
  return unexpected;
}

test('offline economy lives in the Market dock, with disclosures and read-only focus', async ({ page }) => {
  const world = createWorld({ seed: 31, runId: 'MOCKED-ECONOMY-DISCLOSURE' });
  const [buyer, seller] = Object.values(world.citizens);
  expect(dispatch(world, buyer.id, { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 2 }).ok).toBe(true);
  expect(dispatch(world, seller.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 5 }).ok).toBe(true);
  const unexpected = await mount(page, {
    world,
    status: { state: 'ready', running: false, speed: 1, mode: 'scripted', generation: 1, thinking: [] },
    budget: { requests: 0, pending: 0, spent: 0, limit: 100, tokens: 0, maxTokens: 100000, unit: 'requests' },
    turns: [],
  });
  await expect(page.getByTestId('world-scene')).toBeVisible();
  await expect(page.getByTestId('planner-mode')).toContainText('LOCAL AI');
  await page.screenshot({ path: join(visuals, 'real-dashboard-after.png') });
  await expect(page.getByRole('tab', { name: 'Global charts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Global history' })).toBeVisible();
  await page.getByRole('tab', { name: 'Market', exact: true }).click();
  await expect(page.getByTestId('market-panel')).toContainText('bid 2 · ask 5');
  await expect(page.getByTestId('market-panel').locator('.order-buy')).toHaveCount(1);
  await expect(page.getByTestId('market-panel').locator('.order-sell')).toHaveCount(1);
  await page.getByText('Stock, production & market', { exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'T6', exact: true })).toBeVisible();
  await expect(page.getByText(/not lifetime volume/)).toBeVisible();
  await page.screenshot({ path: join(visuals, 'real-economy-expanded-after.png') });
  await page.getByText('Stock, production & market', { exact: true }).click();
  await page.getByText('View', { exact: true }).click();
  await page.getByRole('button', { name: 'Focus world', exact: true }).click();
  await expect(page.getByTestId('world-scene')).toBeVisible();
  await page.mouse.move(1430, 990);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: join(visuals, 'real-watch-after.png') });
  expect(unexpected).toEqual([]);
});

test('scoped mock: 100 citizens, shared rival territory, active pursuit and persistent recent strike', async ({
  page,
}) => {
  const world = createWorld({ seed: 31, population: 100, runId: 'MOCKED-ECONOMY-NOT-EMERGENCE' });
  const [a, b, c] = Object.values(world.citizens);
  a!.x = 8;
  a!.y = 8;
  b!.x = 11;
  b!.y = 8;
  for (const actor of [a!, b!, c!]) enableAutonomy(world, actor);
  formAlliance(world, a!, c!);
  claimTerritory(world, a!, [7, 7, 12, 12]);
  claimTerritory(world, b!, [10, 8, 14, 14]);
  expect(dispatch(world, a!.id, { type: 'attack', targetId: b!.id }).ok).toBe(true);
  world.tick = 2000;
  // Deliberately old retained event: recent strike panel must not imply it is active.
  world.significantEvents = [
    {
      id: 'retained-strike',
      kind: 'attack',
      tick: 40,
      text: `${a!.id} hit ${b!.id}`,
      citizenId: a!.id,
      targetId: b!.id,
      x: 8,
      y: 8,
    },
  ];
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
      pending: 0,
      spent: 0,
      limit: 100,
      tokens: 0,
      maxTokens: 100000,
      unit: 'requests',
    },
    turns: [],
  };
  const mutations = await mount(page, snapshot);
  await page.getByRole('tab', { name: 'Events / Comms', exact: true }).click();
  await page.getByText('World stories', { exact: true }).click();
  await expect(page.getByTestId(`combat-${a!.id}`)).toBeVisible();
  await expect(page.getByTestId('contested-overlap')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Recent strikes · recorded, not active' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /focus attacker/ }).click();
  await expect(page.getByTestId('citizen-inspector')).toHaveAttribute('data-citizen-id', a!.id);
  await page.getByText('Claims & alliance members', { exact: true }).click();
  await expect(page.getByText(/members:/)).toBeVisible();
  await page.screenshot({ path: join(visuals, 'mocked-100-conflict-after.png') });
  await page.getByRole('checkbox', { name: 'Attack arrows', exact: true }).uncheck();
  await expect(page.getByTestId(`combat-${a!.id}`)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /focus attacker/ })).toBeVisible();
  a!.action = null;
  await expect(page.getByText('No active attacks', { exact: true })).toBeVisible();
  await expect(page.locator('.conflict-view > details > summary')).toContainText('0 active attacks');
  await expect(page.getByTestId('world-pulse')).toContainText('0 attacking');
  await expect(page.getByRole('button', { name: /Tick 40/ })).toBeVisible();
  await page.screenshot({ path: join(visuals, 'mocked-empty-combat-after.png') });
  expect(mutations).toEqual([]);
  console.log(`ECONOMY_MOCKED_SCREENSHOTS ${visuals}`);
});
