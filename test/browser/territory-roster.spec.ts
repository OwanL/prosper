import { test, expect } from '@playwright/test';
import { createWorld } from '../../src/world/core';
import { projectSpectatorWorld } from '../../src/server/snapshot';
import { citizenColor, projectWorld, unaffiliatedColor } from '../../src/ui/model';

// Exercise the real React workspace; all API traffic is synthetic and cannot
// mutate the isolated runtime or any user's durable world.
test('territory roster sorts, expands, selects and shares membership colors', async ({ page }) => {
  const world = createWorld({ seed: 17, population: 3, autonomy: true });
  const [ada, bram, cora] = Object.values(world.citizens);
  ada.name = 'Ada Fixture'; bram.name = 'Bram Fixture'; cora.name = 'Cora Fixture';
  ada.gold = 2; bram.gold = 30; cora.gold = 10;
  ada.inventory = { 'wood:2': 8, 'wood:1': 1.25, 'food:1': 0.5 };
  // Keep members and their claimed signs in the fitted central map view.
  ada.x = cora.x = Math.floor(world.width / 2); ada.y = cora.y = Math.floor(world.height / 2);
  bram.x = cora.x + 1; bram.y = cora.y;
  bram.inventory = { 'food:1': 1 }; cora.inventory = { 'fibre:1': 4 };
  world.territories = {
    'Alpha territory': { id: 'Alpha territory', ownerId: cora.id, createdTick: 0,
      members: { [cora.id]: { citizenId: cora.id, joinedTick: 0, sequence: 0 },
        [bram.id]: { citizenId: bram.id, joinedTick: 0, sequence: 1 } }, admissions: [] },
  };
  world.signs = { marker: { id: 'marker', territoryId: 'Alpha territory', x: cora.x, y: cora.y,
    woodTier: 1, health: 16, maxHealth: 16 } };
  const snapshot = { world: projectSpectatorWorld(world), status: { decisionTreeDebug: false, state: 'ready', running: false, speed: 1,
    mode: 'scripted', generation: 1, thinking: [] },
    budget: { requests: 0, limit: 20, pending: 0, spent: 0, tokens: 0, maxTokens: 10000, unit: 'requests' }, turns: [] };
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/state') await route.fulfill({ json: snapshot });
    else if (path === '/api/motion') await route.fulfill({ status: 204 });
    else { unexpected.push(path); await route.fulfill({ status: 404, json: { error: 'Unexpected fixture request' } }); }
  });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'World panels' }).getByRole('button', { name: 'Citizens', exact: true }).click();
  const rows = page.locator('.roster-list > li');
  const names = () => rows.locator('.roster-heading strong').allTextContents();
  await expect.poll(names).toEqual(['Ada Fixture', 'Bram Fixture', 'Cora Fixture']);
  await expect(rows.first().locator('.roster-resource-summary')).toHaveText('food 0.5wood 9.25');
  await expect(rows.first().locator('.roster-resources')).not.toHaveAttribute('open', '');
  await page.getByLabel('Sort by', { exact: true }).selectOption('gold');
  await expect.poll(names).toEqual(['Bram Fixture', 'Cora Fixture', 'Ada Fixture']);
  await page.getByLabel('Sort by', { exact: true }).selectOption('resources');
  await expect.poll(names).toEqual(['Ada Fixture', 'Cora Fixture', 'Bram Fixture']);
  await rows.first().getByText('Resources by tier', { exact: true }).click();
  await expect(rows.first().getByText('wood T2: 8', { exact: true })).toBeVisible();
  await expect(rows.first().getByText('food T1: 0.5', { exact: true })).toBeVisible();
  await page.getByLabel('Sort by', { exact: true }).selectOption('membership');
  await expect.poll(names).toEqual(['Bram Fixture', 'Cora Fixture', 'Ada Fixture']);
  const color = citizenColor(projectWorld(world).citizens.find(c => c.value.id === cora.id)!.value);
  const swatches = await rows.locator('.roster-swatch').evaluateAll(nodes => nodes.map(n => (n as HTMLElement).style.background));
  expect(swatches[0]).toBe(swatches[1]); expect(swatches[2]).not.toBe(swatches[0]);
  await expect(page.getByTestId(`territory-tile-${cora.x},${cora.y}`).locator('rect').first()).toHaveAttribute('fill', color);
  await expect(page.getByTestId(`citizen-${bram.id}`).locator('.sprite > path').nth(1)).toHaveAttribute('fill', color);
  await expect(page.getByTestId(`citizen-${ada.id}`).locator('.sprite > path').nth(1)).toHaveAttribute('fill', unaffiliatedColor);
  await expect(page.getByTestId(`territory-tile-${cora.x},${cora.y}`).locator('title').first()).toContainText(projectWorld(world).citizens.find(c => c.value.id === cora.id)!.value.territory!.label);
  await rows.first().getByRole('button').click();
  const inspector = page.getByTestId('citizen-inspector');
  await expect(inspector.getByRole('heading', { name: 'Bram Fixture', exact: true })).toBeVisible();
  const territory = projectWorld(world).citizens.find(c => c.value.id === bram.id)!.value.territory!;
  await expect(inspector.getByTestId('inspector-membership')).toHaveText(`${territory.label} · member`);
  expect(await inspector.locator('.portrait').evaluate(n => (n as HTMLElement).style.background)).toBe(swatches[0]);
  expect(await inspector.getByTestId('inspector-membership').locator('.roster-swatch').evaluate(n => (n as HTMLElement).style.background)).toBe(swatches[0]);
  await page.getByRole('navigation', { name: 'World panels' }).getByRole('button', { name: 'Citizens', exact: true }).click();
  await expect(rows.filter({ hasText: 'Bram Fixture' }).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Sort by', { exact: true }).selectOption('membership');
  await rows.filter({ hasText: 'Ada Fixture' }).getByText('Resources by tier', { exact: true }).click();
  await expect(page.getByTestId(`territory-tile-${cora.x},${cora.y}`)).toBeVisible();
  expect(await page.locator('.citizen-roster').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});
