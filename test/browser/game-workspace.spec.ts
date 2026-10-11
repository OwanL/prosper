import { test, expect, type Page } from '@playwright/test';
import type { Control } from '../../src/shared/types';
import { spectatorFixture, type AuthoritativeFixture as AppSnapshot } from './fixture';
import {
  HISTORY_CADENCE,
  HISTORY_LIMIT,
  type CitizenHistory,
  type GlobalHistory,
  type HistoryMeta,
} from '../../src/shared/telemetry-types';
import { createWorld } from '../../src/world/core';
import { observe, updateKnowledge } from '../../src/world/observation';

// Frontend-only acceptance. Every /api/ request is fulfilled here, including
// unexpected requests: none may reach a runtime, provider, or durable ledger.
interface ApiMock {
  snapshot: AppSnapshot;
  stateError: boolean;
  posts: { path: string; body: unknown }[];
  unexpected: string[];
  gets: string[];
  errors: string[];
}
const mocks = new WeakMap<Page, ApiMock>();

function fixture(): AppSnapshot {
  const world = createWorld({
    seed: 17,
    runId: 'game-workspace-fixture',
    population: 3,
    autonomy: true,
  });
  world.tick = 120;
  const [first, second, third] = Object.values(world.citizens);
  first.name = 'Ada Fixture';
  second.name = 'Bram Fixture';
  third.name = 'Cora Fixture';
  first.x = 1;
  first.y = 1;
  second.x = 2;
  second.y = 1;
  third.x = 3;
  third.y = 1;
  second.gold = 12345;
  second.personality = 'OTHER_PRIVATE_PERSONALITY';
  second.goals = ['OTHER_PRIVATE_GOAL'];
  second.memories = [{ tick: 100, text: 'OTHER_PRIVATE_MEMORY' }];
  world.messages = [
    { id: 'public', tick: 119, from: first.id, text: 'Public fixture greeting.' },
    { id: 'private', tick: 119, from: second.id, to: third.id, text: 'OTHER_PRIVATE_MESSAGE' },
  ];
  updateKnowledge(world);
  return {
    world,
    status: {
      decisionTreeDebug: false,
      state: 'ready',
      running: false,
      speed: 1,
      mode: 'scripted',
      generation: 1,
      thinking: [],
    },
    budget: {
      requests: 3,
      limit: 20,
      pending: 1,
      spent: 0,
      tokens: 8000,
      maxTokens: 10000,
      unit: 'requests',
    },
    turns: [
      {
        id: 'fixture-turn',
        citizenId: first.id,
        tick: 120,
        generation: 1,
        status: 'completed',
        reason: 'Fixture policy review',
        observation: 'PRIVATE_DIAGNOSTIC_REQUEST',
        response: 'PRIVATE_DIAGNOSTIC_RESPONSE',
        calls: [],
        inputTokens: 300,
        outputTokens: 50,
      },
    ],
  };
}

function history(snapshot: AppSnapshot): GlobalHistory {
  const meta: HistoryMeta = {
    runId: snapshot.world.runId,
    tick: snapshot.world.tick,
    startedTick: 80,
    cadence: HISTORY_CADENCE,
    limit: HISTORY_LIMIT,
  };
  return {
    ...meta,
    frames: [80, 100, 120].map((tick, index) => ({
      tick,
      population: 3,
      meanHealth: 90 + index,
      meanFullness: 70 + index,
      markets: Object.fromEntries(
        ['food:1', 'wood:1', 'fibre:1'].map((item, commodity) => [
          item,
          {
            bid: 2 + commodity + index,
            ask: 4 + commodity + index,
            lastPrice: 3 + commodity,
            lastTick: 80,
            supply: 10,
            demand: 8,
            carried: 12 + index,
            held: 2,
            ground: 30,
            units: index + 1,
            turnover: (index + 1) * 3,
            fills: 1,
          },
        ]),
      ),
    })),
  };
}

async function mockApi(page: Page): Promise<ApiMock> {
  const mock: ApiMock = {
    snapshot: fixture(),
    stateError: false,
    posts: [],
    unexpected: [],
    gets: [],
    errors: [],
  };
  mocks.set(page, mock);
  page.on('pageerror', (error) => mock.errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      mock.gets.push(path);
      if (path === '/api/state') {
        await route.fulfill(
          mock.stateError ? { status: 503, body: 'Fixture offline' } : { json: spectatorFixture(mock.snapshot) },
        );
        return;
      }
      if (path === '/api/history/global') {
        await route.fulfill({ json: history(mock.snapshot) });
        return;
      }
      const citizen = /^\/api\/citizens\/([^/]+)\/(observation|history)$/.exec(path);
      if (citizen && mock.snapshot.world.citizens[decodeURIComponent(citizen[1])]) {
        const id = decodeURIComponent(citizen[1]);
        if (citizen[2] === 'observation') {
          await route.fulfill({ json: observe(mock.snapshot.world, id) });
        } else {
          const { frames: _frames, ...meta } = history(mock.snapshot);
          const data: CitizenHistory = {
            ...meta,
            citizenId: id,
            points: [80, 100, 120].map((tick) => ({
              tick,
              alive: true,
              cash: 100,
              escrow: 5,
              health: 95,
              fullness: 75,
            })),
          };
          await route.fulfill({ json: data });
        }
        return;
      }
    }
    if (request.method() === 'POST') {
      const body: unknown = request.postDataJSON();
      mock.posts.push({ path, body });
      if (path === '/api/control') {
        const command = body as Control;
        if (command.type === 'mode' && command.mode) {
          mock.snapshot.status.mode = command.mode;
          await route.fulfill({ json: spectatorFixture(mock.snapshot) });
          return;
        }
        if (command.type === 'reset') {
          mock.snapshot.world = createWorld({
            seed: 999,
            runId: 'game-workspace-reset',
            population: command.population ?? 3,
            autonomy: true,
          });
          mock.snapshot.status.running = false;
          mock.snapshot.status.mode = 'scripted';
          mock.snapshot.turns = [];
          await route.fulfill({ json: spectatorFixture(mock.snapshot) });
          return;
        }
      }
    }
    mock.unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 501, body: 'Blocked by game workspace fixture' });
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-run-id',
    mock.snapshot.world.runId,
  );
  return mock;
}

async function openPanel(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: 'World panels' })
    .getByRole('button', { name, exact: true })
    .click();
  await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
}
async function selectFirst(page: Page, mock: ApiMock) {
  await openPanel(page, 'Citizens');
  await page.getByLabel('Find citizens').fill('Ada Fixture');
  await page
    .getByRole('region', { name: 'Citizen roster' })
    .getByRole('button', { name: /Ada Fixture/ })
    .click();
  await expect(page.getByRole('region', { name: 'Citizen details' })).toBeVisible();
  await expect(page.getByTestId('citizen-inspector')).toHaveAttribute(
    'data-citizen-id',
    Object.keys(mock.snapshot.world.citizens)[0],
  );
}
async function noHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    ),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test.afterEach(async ({ page }) => {
  expect(mocks.get(page)?.unexpected ?? [], 'Every API request has an explicit mock').toEqual([]);
  expect(mocks.get(page)?.errors ?? [], 'No browser exceptions').toEqual([]);
});

test('default workspace is a dominant map without empty inspector or drawers; map selection opens details', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await mockApi(page);
  await expect(page.getByRole('region', { name: 'World map' })).toBeVisible();
  await expect(page.locator('#game-panel')).toHaveCount(0);
  await expect(page.getByTestId('citizen-inspector')).toHaveCount(0);
  const map = (await page.getByRole('region', { name: 'World map' }).boundingBox())!;
  expect(map.width).toBeGreaterThan(1440 * 0.85);
  expect(map.height).toBeGreaterThan(900 * 0.65);
  const activity = (await page.locator('.game-activity-strip').boundingBox())!;
  expect(activity.height).toBeGreaterThan(20);
  expect(activity.y + activity.height).toBeLessThanOrEqual(900);
  for (const name of ['Citizens', 'World charts', 'Messages', 'World settings'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  await page.getByTestId(`citizen-${Object.keys(mock.snapshot.world.citizens)[0]}`).click();
  await expect(page.getByRole('region', { name: 'Citizen details' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  await expect(page.locator('#game-panel')).toHaveCount(0);
  await expect(page.getByTestId('world-scene')).toBeVisible();
  expect(mock.posts).toEqual([]);
});

test('the first pointer click on a chart sample cursor selects that sample', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockApi(page);
  await openPanel(page, 'World charts');
  const cursor = page.getByLabel('Population sample cursor');
  await expect(cursor).toHaveValue('2');
  const bounds = (await cursor.boundingBox())!;
  await cursor.click({ position: { x: bounds.width * 0.15, y: bounds.height / 2 } });
  await expect(cursor).not.toHaveValue('2');
  await expect(page.getByRole('tooltip')).not.toContainText('Tick 120');
});

test('Citizens search and selection open Now, Motivation and retained citizen History', async ({
  page,
}) => {
  const mock = await mockApi(page);
  await openPanel(page, 'Citizens');
  const roster = page.getByRole('region', { name: 'Citizen roster' });
  await page.getByLabel('Find citizens').fill('missing fixture');
  await expect(roster).toContainText('No citizens match your search.');
  await page.getByLabel('Find citizens').fill('Ada Fixture');
  const matchingCitizen = roster.locator('.roster-list > li').filter({ hasText: 'Ada Fixture' });
  await expect(matchingCitizen).toHaveCount(1);
  await matchingCitizen.getByRole('button', { name: /Ada Fixture/ }).click();
  const details = page.getByRole('region', { name: 'Citizen details' });
  await expect(details.getByRole('tab', { name: 'Now', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('citizen-inspector')).toBeVisible();
  await details.getByRole('tab', { name: 'Motivation', exact: true }).click();
  await expect(details).toContainText('Recent personal evidence');
  await details.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Citizen history' })).toContainText(
    'Gold holdings',
  );
  await expect(page.getByLabel('History metric')).toHaveValue('Gold holdings');
  expect(mock.gets).toContain(
    `/api/citizens/${Object.keys(mock.snapshot.world.citizens)[0]}/history`,
  );
  expect(mock.posts).toEqual([]);
});

test('world charts have Overview, combined checkbox bid/ask Markets and Resources', async ({
  page,
}) => {
  const mock = await mockApi(page);
  await openPanel(page, 'World charts');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('History metric')).toHaveValue('Population');
  await expect(page.getByRole('region', { name: 'Global history' })).toContainText(
    'recording began at t80',
  );
  await page.getByRole('tab', { name: 'Markets', exact: true }).click();
  await expect(page.getByLabel('History metric')).toHaveValue('Bid / ask comparison');
  await page.getByText('Commodities · 3 selected', { exact: true }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(
    page.getByText('Select at least one commodity to compare bid / ask history.'),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'food:1', exact: true }).check();
  await page.getByRole('checkbox', { name: 'wood:1', exact: true }).check();
  await page.getByText('Exact samples', { exact: true }).click();
  const series = page.getByLabel('Exact sample series');
  await expect(series.locator('option')).toHaveCount(4);
  await expect(series).toContainText('food:1 bid');
  await expect(series).toContainText('food:1 ask');
  await expect(series).toContainText('wood:1 bid');
  await expect(series).toContainText('wood:1 ask');
  await page.getByRole('checkbox', { name: 'wood:1', exact: true }).uncheck();
  await expect(series.locator('option')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Resources', exact: true }).click();
  await expect(page.getByLabel('History metric')).toHaveValue('Stock');
  await expect(page.getByLabel('History commodity')).toBeVisible();
  await expect(page.getByLabel('History tier')).toBeVisible();
  await page.getByLabel('History metric').selectOption('Open supply / demand');
  await expect(page.getByRole('region', { name: 'Global history' })).toContainText(
    'Open sell offers',
  );
  expect(mock.gets).toContain('/api/history/global');
  expect(mock.posts).toEqual([]);
});

test('settings require explicit live/reset confirmations; mocked reset is fresh, paused and preserves budget', async ({
  page,
}) => {
  const mock = await mockApi(page);
  const budget = structuredClone(mock.snapshot.budget);
  await openPanel(page, 'World settings');
  const mode = page.getByLabel('Planner mode', { exact: true });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('usage costs');
    await dialog.dismiss();
  });
  await mode.selectOption('live');
  await expect(mode).toHaveValue('scripted');
  expect(mock.posts).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  await mode.selectOption('live');
  await expect(page.getByTestId('planner-mode')).toHaveText('Live AI · calls enabled');
  const reset = page.getByRole('button', { name: 'Reset world', exact: true });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('saved first');
    expect(dialog.message()).toContain('new seed, paused');
    expect(dialog.message()).toContain('Spending and budget limits are kept');
    await dialog.dismiss();
  });
  await reset.click();
  expect(mock.posts).toEqual([{ path: '/api/control', body: { type: 'mode', mode: 'live' } }]);
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-run-id',
    'game-workspace-fixture',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await reset.click();
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-run-id',
    'game-workspace-reset',
  );
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-tick', '0');
  await expect(page.getByTestId('connection-status')).toHaveText('Paused');
  await expect(mode).toHaveValue('scripted');
  expect(mock.snapshot.budget).toEqual(budget);
  expect(mock.snapshot.turns).toEqual([]);
  expect(mock.posts).toEqual([
    { path: '/api/control', body: { type: 'mode', mode: 'live' } },
    { path: '/api/control', body: { type: 'reset' } },
  ]);
});

test('reload, runtime error and disconnection disable commands while retaining the last map', async ({
  page,
}) => {
  const mock = await mockApi(page);
  await openPanel(page, 'World settings');
  for (const state of ['reloading', 'error'] as const) {
    mock.snapshot.status.state = state;
    if (state === 'error') mock.snapshot.status.error = 'Fixture checkpoint recovery failed';
    await expect(page.getByTestId('connection-status')).toHaveText(
      state === 'reloading' ? 'Reloading' : 'Runtime error',
    );
    await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Simulation speed')).toBeDisabled();
    await expect(page.getByLabel('Planner mode', { exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Step one tick', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reset world', exact: true })).toBeDisabled();
    await expect(page.getByTestId('world-scene')).toBeVisible();
  }
  await expect(page.getByRole('alert')).toContainText('Fixture checkpoint recovery failed');
  mock.stateError = true;
  await expect(page.getByTestId('connection-status')).toHaveText('Reconnecting');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-run-id',
    'game-workspace-fixture',
  );
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-tick', '120');
  await expect(page.getByTestId('world-scene')).toBeVisible();
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeDisabled();
  mock.stateError = false;
  mock.snapshot.status.state = 'ready';
  delete mock.snapshot.status.error;
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeEnabled();
  expect(mock.posts).toEqual([]);
});

test('mobile 390px returns to the world; citizen knowledge hides global, other-private and diagnostic data', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mock = await mockApi(page);
  await noHorizontalOverflow(page);
  await selectFirst(page, mock);
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  await expect(page.locator('#game-panel')).toHaveCount(0);
  await expect(page.getByTestId('world-scene')).toBeVisible();
  await openPanel(page, 'World settings');
  await page.getByLabel('Citizen knowledge', { exact: true }).check();
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  await expect(page.getByText('Perspective · Ada Fixture', { exact: true })).toBeVisible();
  await expect(page.getByTestId('world-scene')).toBeVisible();
  await noHorizontalOverflow(page);
  await openPanel(page, 'World settings');
  await page.getByRole('button', { name: 'Open diagnostics', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Diagnostics', exact: true })).toContainText(
    'Diagnostics are hidden in citizen knowledge view.',
  );
  await expect(page.locator('body')).not.toContainText('PRIVATE_DIAGNOSTIC_REQUEST');
  await expect(page.locator('body')).not.toContainText('PRIVATE_DIAGNOSTIC_RESPONSE');
  await openPanel(page, 'World charts');
  await expect(page.getByRole('region', { name: 'Analytics', exact: true })).toContainText(
    'Global analytics are hidden',
  );
  await expect(page.getByRole('region', { name: 'Global history' })).toHaveCount(0);
  await noHorizontalOverflow(page);
  await openPanel(page, 'Messages');
  await expect(page.getByRole('region', { name: 'Communications' })).toContainText(
    'Public fixture greeting.',
  );
  await expect(page.locator('body')).not.toContainText('OTHER_PRIVATE_MESSAGE');
  await openPanel(page, 'Citizens');
  await page.getByLabel('Find citizens').fill('Bram Fixture');
  await page
    .getByRole('region', { name: 'Citizen roster' })
    .getByRole('button', { name: /Bram Fixture/ })
    .click();
  const details = page.getByRole('region', { name: 'Citizen details' });
  await expect(details).toContainText('Private details are available only for the observer.');
  await expect(page.getByTestId('citizen-gold')).toHaveCount(0);
  for (const secret of [
    'OTHER_PRIVATE_PERSONALITY',
    'OTHER_PRIVATE_GOAL',
    'OTHER_PRIVATE_MEMORY',
    '12,345 gold',
  ])
    await expect(page.locator('body')).not.toContainText(secret);
  await details.getByRole('tab', { name: 'Motivation', exact: true }).click();
  await expect(details).toContainText('Private motivation is available only for the observer');
  await details.getByRole('tab', { name: 'History', exact: true }).click();
  await expect(details).toContainText('Private historical graphs are hidden');
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Back to world', exact: true }).click();
  await expect(page.locator('#game-panel')).toHaveCount(0);
  await expect(page.getByTestId('world-scene')).toBeVisible();
  await noHorizontalOverflow(page);
  expect(mock.gets.some((path) => path.endsWith('/observation'))).toBe(true);
  expect(
    mock.gets.some((path) => path.endsWith('/history') || path === '/api/history/global'),
  ).toBe(false);
  expect(mock.posts).toEqual([]);
});
