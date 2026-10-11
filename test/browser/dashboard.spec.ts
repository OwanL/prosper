import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spectatorFixture, type AuthoritativeFixture as AppSnapshot } from './fixture';
import { HISTORY_CADENCE, HISTORY_LIMIT, type HistoryMeta } from '../../src/shared/telemetry-types';
import { createWorld } from '../../src/world/core';
import { observe, updateKnowledge } from '../../src/world/observation';

// This suite is frontend-only: never continue an API route to a real runtime.
// Run with a frontend-only Vite and a config without browser/setup.ts when a
// retained live checkpoint must not be started by the normal global setup.
const visuals = mkdtempSync(join(tmpdir(), 'prosper-dashboard-after-'));
const mocks = new WeakMap<Page, ApiMock>();
interface ApiMock {
  snapshot: AppSnapshot;
  stateError: boolean;
  budgetFailures: number;
  gets: number;
  posts: { path: string; body: unknown }[];
  unexpected: string[];
}
const longText =
  'A deliberately long diagnostic statement about remembered intentions, committed work, ownership and remote settlement. '.repeat(
    5,
  );

function fixture(populated = true): AppSnapshot {
  const world = createWorld({ seed: 17, runId: 'dashboard-fixture-only' });
  world.tick = 123;
  const first = Object.values(world.citizens)[0]!;
  if (populated) {
    first.personality = longText;
    first.goals = Array.from({ length: 16 }, (_, i) => `Goal ${i}: ${longText}`);
    first.memories = Array.from({ length: 16 }, (_, i) => ({ tick: i, text: longText }));
    first.action = null;
    for (let i = 0; i < 32; i++) {
      const id = `fixture-citizen-${i}`;
      world.citizens[id] = {
        ...structuredClone(first),
        id,
        name: `Citizen ${i}`,
        x: i % world.width,
        y: 0,
      };
    }
    world.events = Array.from({ length: 24 }, (_, i) => ({
      id: `event-${i}`,
      tick: i,
      kind: 'harvest',
      text: longText,
    }));
    world.messages = Array.from({ length: 24 }, (_, i) => ({
      id: `message-${i}`,
      tick: i,
      from: first.id,
      text: longText,
    }));
    world.orders = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `order-${i}`,
        {
          id: `order-${i}`,
          citizenId: first.id,
          side: i % 2 ? 'buy' : 'sell',
          item: i % 3 ? 'food:1' : `building:fixture-long-asset-${i}`,
          quantity: 15,
          price: 7,
          createdTick: i,
          sequence: i,
          escrowGold: 0,
          escrowItems: {},
        },
      ]),
    );
  } else {
    world.citizens = {};
    world.events = [];
    world.messages = [];
    world.orders = {};
  }
  return {
    world,
    status: { decisionTreeDebug: false, state: 'ready', running: false, speed: 1, mode: 'live', generation: 1, thinking: [] },
    budget: {
      requests: 3,
      limit: 20,
      pending: 1,
      spent: 0,
      tokens: 8000,
      maxTokens: 10000,
      unit: 'requests',
    },
    turns: populated
      ? Array.from({ length: 10 }, (_, i) => ({
          id: `turn-${i}`,
          citizenId: first.id,
          tick: 123,
          generation: 1,
          status: 'yielded',
          reason: 'bounded review',
          stopReason: 'Tool-call bound reached; later reviews may continue.',
          // An older diagnostic error must not be shown as an error for a yielded turn.
          error: 'LEGACY_ERROR_MUST_NOT_APPEAR',
          response: longText,
          observation: longText.repeat(4),
          calls: [
            {
              command: { type: 'remember', text: longText },
              result: { ok: true, code: 'remembered', message: longText },
            },
          ],
        }))
      : [],
  };
}

async function mockApi(page: Page, snapshot = fixture()): Promise<ApiMock> {
  const mock: ApiMock = {
    snapshot,
    stateError: false,
    budgetFailures: 0,
    gets: 0,
    posts: [],
    unexpected: [],
  };
  mocks.set(page, mock);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/state') {
      mock.gets++;
      await route.fulfill(
        mock.stateError
          ? { status: 503, body: 'Fixture backend unavailable' }
          : { json: spectatorFixture(mock.snapshot) },
      );
      return;
    }
    if (
      request.method() === 'GET' &&
      (path === '/api/history/global' || /^\/api\/citizens\/[^/]+\/history$/.test(path))
    ) {
      const base: HistoryMeta = {
        runId: mock.snapshot.world.runId,
        tick: mock.snapshot.world.tick,
        startedTick: 0,
        cadence: HISTORY_CADENCE,
        limit: HISTORY_LIMIT,
      };
      await route.fulfill({
        json:
          path === '/api/history/global'
            ? { ...base, frames: [] }
            : { ...base, citizenId: decodeURIComponent(path.split('/')[3]), points: [] },
      });
      return;
    }
    if (request.method() === 'POST') {
      const body: unknown = request.postDataJSON();
      mock.posts.push({ path, body });
      if (path === '/api/control' && (body as { type?: string }).type === 'reset') {
        mock.snapshot.world = createWorld({ seed: 999, runId: 'dashboard-reset-world' });
        mock.snapshot.status.running = false;
        mock.snapshot.turns = [];
        await route.fulfill({ json: spectatorFixture(mock.snapshot) });
        return;
      }
      if (path === '/api/budget') {
        if (mock.budgetFailures-- > 0) {
          await route.fulfill({ status: 503, body: 'Fixture apply failure' });
        } else {
          const caps = body as { maxRequests: number; maxTokens: number };
          mock.snapshot.budget.limit = caps.maxRequests;
          mock.snapshot.budget.maxTokens = caps.maxTokens;
          delete mock.snapshot.budget.blocked;
          await route.fulfill({ json: spectatorFixture(mock.snapshot) });
        }
        return;
      }
    }
    mock.unexpected.push(`${request.method()} ${path}`);
    await route.fulfill({ status: 501, body: 'Blocked by dashboard regression fixture' });
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-run-id',
    snapshot.world.runId,
  );
  return mock;
}

test('uses full screen width and labels speech bubbles without interpreting message markup', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const snapshot = fixture();
  const [first, second] = Object.values(snapshot.world.citizens);
  first.x = second.x = 0;
  first.y = second.y = snapshot.world.height - 1;
  snapshot.world.messages = [
    { id: 'public-speech', tick: 1, from: first.id, text: 'A public challenge.\nAnswer plainly.' },
    {
      id: 'private-speech',
      tick: 2,
      from: second.id,
      to: first.id,
      text: '<script>window.speechInjected = true</script>',
    },
    { id: 'player-speech', tick: 3, from: 'player', text: 'A player announcement.' },
  ];
  const mock = await mockApi(page, snapshot);
  const app = await page.getByTestId('prosper-app').boundingBox();
  expect(app!.width).toBe(1920);
  await page.getByRole('tab', { name: 'Comms', exact: true }).click();
  const feed = page.getByTestId('communications-scroll');
  await expect(feed.locator('.speech-bubble')).toHaveCount(3);
  const publicEntry = feed.locator('.message-entry').filter({ hasText: 'A public challenge.' });
  await expect(publicEntry.locator('.message-speaker strong')).toHaveText(first.name);
  await expect(publicEntry.locator('.message-speaker')).toContainText('Public');
  await expect(publicEntry.locator('.speech-bubble')).toHaveCSS('white-space', 'pre-wrap');
  const privateEntry = feed.locator('.message-entry').filter({ hasText: 'window.speechInjected' });
  await expect(privateEntry.locator('.message-speaker strong')).toHaveText(second.name);
  await expect(privateEntry.locator('.message-speaker')).toContainText(`→ ${first.name} · Private`);
  await expect(privateEntry.locator('script')).toHaveCount(0);
  await expect(feed.locator('.message-speaker strong').filter({ hasText: 'Player' })).toHaveCount(
    1,
  );
  await expect(page.locator('.map-speech-button')).toHaveCount(2);
  await expect
    .poll(async () =>
      page.locator('.map-speech-button').evaluateAll((buttons) => {
        const [a, b] = buttons.map((button) => button.getBoundingClientRect());
        return a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      }),
    )
    .toBe(true);
  const mapSpeech = page.locator('.map-speech-button').filter({ hasText: 'A public challenge.' });
  await mapSpeech.focus();
  await expect(page.getByRole('tooltip')).toContainText('A public challenge.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  mock.snapshot.world.tick += 300;
  await expect(page.locator('.map-speech-button')).toHaveCount(0);
  expect(mock.posts).toEqual([]);
  await noOverflow(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});

test('shows live gold balances beside names without exposing other citizens money in knowledge view', async ({
  page,
}) => {
  const snapshot = fixture();
  const [first, other] = Object.values(snapshot.world.citizens);
  snapshot.world.citizens = { [first.id]: first, [other.id]: other };
  first.x = 1;
  first.y = 1;
  other.x = 2;
  other.y = 1;
  first.gold = 0;
  other.gold = 12345;
  updateKnowledge(snapshot.world);
  const mock = await mockApi(page, snapshot);
  await page.route('**/api/citizens/*/observation', (route) =>
    route.fulfill({ json: observe(snapshot.world, first.id) }),
  );
  const entry = page.getByTestId(`roster-${first.id}`);
  const otherEntry = page.getByTestId(`roster-${other.id}`);
  await expect(entry).toContainText(`${first.name} · 0 gold`);
  await expect(otherEntry).toContainText(`${other.name} · 12,345 gold`);
  await entry.click();
  const dossier = page.getByTestId('citizen-inspector');
  await expect(dossier.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  await expect(dossier.locator('.citizen-name-line').getByTestId('citizen-gold')).toHaveText(
    '0 gold',
  );
  first.gold = 1005;
  await expect(entry.getByTestId('citizen-gold')).toContainText('1,005 gold');
  await expect(dossier.getByTestId('citizen-gold')).toHaveText('1,005 gold');
  await page.getByText('View', { exact: true }).click();
  await page.getByLabel('Citizen knowledge', { exact: true }).check();
  await expect(entry.getByTestId('citizen-gold')).toContainText('1,005 gold');
  await expect(otherEntry).toBeVisible();
  await expect(otherEntry.getByTestId('citizen-gold')).toHaveCount(0);
  await expect(dossier.getByTestId('citizen-gold')).toHaveText('1,005 gold');
  expect(mock.posts).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});

test('reset requires confirmation, starts a fresh paused world, and retains the budget', async ({
  page,
}) => {
  const mock = await mockApi(page);
  const budget = structuredClone(mock.snapshot.budget);
  await page.getByText('World settings', { exact: true }).click();
  const button = page.getByRole('button', { name: 'Reset world', exact: true });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('saved first');
    expect(dialog.message()).toContain('new seed, paused');
    expect(dialog.message()).toContain('Spending and budget limits are kept');
    await dialog.dismiss();
  });
  await button.click();
  expect(mock.posts).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  await button.click();
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-run-id',
    'dashboard-reset-world',
  );
  expect(mock.posts).toEqual([{ path: '/api/control', body: { type: 'reset' } }]);
  expect(mock.snapshot.budget).toEqual(budget);
  await expect(page.getByRole('button', { name: '▶ Play', exact: true })).toBeVisible();
  mock.snapshot.status.state = 'reloading';
  await expect(button).toBeDisabled();
});

test.afterEach(async ({ page }) => {
  expect(
    mocks.get(page)?.unexpected ?? [],
    'Every API request must have an explicit fixture',
  ).toEqual([]);
});

async function noOverflow(page: Page, vertical = false) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    x: scrollX,
    y: scrollY,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(dimensions.x).toBe(0);
  if (vertical) {
    expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.height);
    expect(dimensions.y).toBe(0);
  }
}

async function withinViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(box!.height).toBeGreaterThan(20);
}

async function openReasoning(page: Page) {
  await page.getByRole('tab', { name: 'Reasoning', exact: true }).click();
}

async function activateScrollPane(page: Page, id: string) {
  const tab = {
    'roster-scroll': 'Citizens',
    'dossier-scroll': 'Dossier',
    'world-events-scroll': 'Events',
    'communications-scroll': 'Comms',
    'market-scroll': 'Market',
    'reasoning-scroll': 'Reasoning',
  }[id];
  await page.getByRole('tab', { name: tab!, exact: true }).click();
  await expect(page.getByRole('tab', { name: tab!, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  if (id === 'reasoning-scroll') {
    await expandReceipts(page);
    await page.getByText('Budget settings · total caps', { exact: true }).click();
  }
}

async function expandReceipts(page: Page) {
  // Open all receipts in one operation; clicking every summary would scroll the
  // pane between opens and hide the initial dashboard composition in evidence.
  await page.locator('[data-turn-id]').evaluateAll((nodes) => {
    for (const node of nodes) {
      (node as HTMLDetailsElement).open = true;
      const nested = node.querySelector('details');
      if (nested) nested.open = true;
    }
  });
  await expect(page.locator('[data-turn-id][open]')).toHaveCount(10);
}

const scrollIds = [
  'roster-scroll',
  'dossier-scroll',
  'world-events-scroll',
  'communications-scroll',
  'market-scroll',
  'reasoning-scroll',
];
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
]) {
  test(`populated dashboard fits ${viewport.width}x${viewport.height}; panels scroll independently`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const mock = await mockApi(page);
    await page.getByTestId(`roster-${Object.keys(mock.snapshot.world.citizens)[0]}`).click();
    for (const selector of ['.engine-left', '.engine-right', '.engine-dock', '.engine-map']) {
      await withinViewport(page, page.locator(selector));
    }
    const mapBox = (await page.locator('.engine-map').boundingBox())!;
    const leftBox = (await page.locator('.engine-left').boundingBox())!;
    const rightBox = (await page.locator('.engine-right').boundingBox())!;
    const dockBox = (await page.locator('.engine-dock').boundingBox())!;
    expect(leftBox.x + leftBox.width).toBeLessThanOrEqual(mapBox.x);
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(rightBox.x);
    expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(dockBox.y);
    expect(mapBox.width).toBeGreaterThan(leftBox.width);
    expect(mapBox.width).toBeGreaterThan(rightBox.width);
    expect(mapBox.height).toBeGreaterThan(dockBox.height);
    await expect(page.getByRole('separator')).toHaveCount(3);
    await withinViewport(page, page.getByRole('region', { name: 'World map' }));
    await withinViewport(page, page.locator('.roster'));
    await withinViewport(page, page.getByTestId('world-scene'));
    await noOverflow(page, true);
    const screenshot = join(visuals, `dashboard-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    testInfo.annotations.push({ type: 'visual-evidence', description: screenshot });
    for (const id of scrollIds) {
      await activateScrollPane(page, id);
      const pane = page.getByTestId(id);
      await withinViewport(page, pane);
      const peers = page.locator('[data-testid$="-scroll"]:visible');
      const before = await peers.evaluateAll(
        (nodes, activeId) =>
          nodes
            .filter((node) => node.getAttribute('data-testid') !== activeId)
            .map((node) => ({ id: node.getAttribute('data-testid')!, top: node.scrollTop })),
        id,
      );
      const size = await pane.evaluate((e) => ({ client: e.clientHeight, scroll: e.scrollHeight }));
      expect(size.scroll, `${id} is populated enough to overflow internally`).toBeGreaterThan(
        size.client,
      );
      await pane.hover();
      await page.mouse.wheel(0, 450);
      await expect.poll(() => pane.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
      for (const other of before) {
        expect(
          await page.getByTestId(other.id).evaluate((e) => e.scrollTop),
          `${id} must not scroll ${other.id}`,
        ).toBe(other.top);
      }
      await pane.focus();
      await page.keyboard.press('Home');
      await expect.poll(() => pane.evaluate((e) => e.scrollTop)).toBe(0);
      await noOverflow(page, true);
    }
    await page.getByRole('button', { name: 'Reset layout', exact: true }).click();
    await noOverflow(page, true);
    expect(mock.posts).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('empty panels, reload, runtime error and disconnected state retain the world', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const mock = await mockApi(page, fixture(false));
  await expect(page.getByText('No known citizens', { exact: false })).toBeVisible();
  await expect(
    page.getByText('Select a citizen to inspect their state.', { exact: false }),
  ).toBeVisible();
  for (const [tab, text] of [
    ['Events', 'No recent events'],
    ['Comms', 'No messages'],
    ['Market', 'No open orders'],
    ['Reasoning', 'No reasoning turns recorded'],
  ]) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByText(text, { exact: false })).toBeVisible();
  }
  await noOverflow(page, true);
  mock.snapshot.status.state = 'reloading';
  await expect(page.getByTestId('connection-status')).toContainText('Backend reloading');
  await expect(page.getByRole('button', { name: '▶ Play' })).toBeDisabled();
  await noOverflow(page, true);
  mock.snapshot.status.state = 'error';
  mock.snapshot.status.error = 'Fixture restore failed; recoverable checkpoint retained';
  await expect(page.getByTestId('connection-status')).toContainText(
    'Runtime error: Fixture restore failed',
  );
  await expect(page.getByRole('button', { name: 'Step', exact: true })).toBeDisabled();
  mock.stateError = true;
  await expect(page.getByTestId('connection-status')).toContainText(
    'Reconnecting / backend unavailable',
  );
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-tick', '123');
  await expect(page.getByTestId('world-scene')).toBeVisible();
  await noOverflow(page, true);
  mock.stateError = false;
  mock.snapshot.status.state = 'ready';
  delete mock.snapshot.status.error;
  await expect(page.getByRole('button', { name: '▶ Play' })).toBeEnabled();
  expect(mock.posts).toEqual([]);
});

test('initial missing snapshot is usable and horizontally contained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, body: 'Fixture offline' }));
  await page.goto('/');
  await expect(page.getByText('Waiting for an authoritative world snapshot…')).toBeVisible();
  await expect(page.getByRole('button', { name: '▶ Play' })).toBeDisabled();
  await noOverflow(page);
});

for (const width of [390, 320]) {
  test(`populated mobile ${width}px has no horizontal document overflow`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const mock = await mockApi(page);
    const views = page.getByRole('navigation', { name: 'Workspace view' });
    for (const [name, selector] of [
      ['World', '.engine-map'],
      ['Citizens', '.engine-left'],
      ['Dossier', '.engine-right'],
      ['Analysis', '.engine-dock'],
    ]) {
      await views.getByRole('button', { name, exact: true }).click();
      await expect(views.getByRole('button', { name, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await withinViewport(page, page.locator(selector));
      for (const other of ['.engine-map', '.engine-left', '.engine-right', '.engine-dock'].filter(
        (s) => s !== selector,
      )) {
        await expect(page.locator(other)).toBeHidden();
      }
      if (name === 'Citizens')
        await page.getByTestId(`roster-${Object.keys(mock.snapshot.world.citizens)[0]}`).click();
      if (name === 'Dossier') await expect(page.getByTestId('citizen-inspector')).toBeVisible();
      if (name === 'Analysis') {
        for (const tab of ['Market', 'Events / Comms', 'Reasoning']) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          await noOverflow(page, true);
        }
        await expandReceipts(page);
        await page.getByText('Budget settings · total caps', { exact: true }).click();
      }
      await noOverflow(page, true);
    }
    await views.getByRole('button', { name: 'World', exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    const screenshot = join(visuals, `mobile-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
    testInfo.annotations.push({ type: 'visual-evidence', description: screenshot });
    expect(mock.posts).toEqual([]);
  });
}

test('tooltips support hover, pointer persistence, keyboard, Escape and disabled controls', async ({
  page,
}) => {
  const mock = await mockApi(page);
  const play = page.getByRole('button', { name: '▶ Play' });
  await play.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Resume ticks');
  const description = await play.getAttribute('aria-describedby');
  await expect(tooltip).toHaveAttribute('id', description!);
  await expect(play).not.toHaveAttribute('title');
  await tooltip.hover();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await page.mouse.move(0, 0);
  await page.getByText('World settings', { exact: true }).click();
  // Keep this keyboard probe independent of whichever menu control is under the pointer.
  await page.mouse.move(0, 0);
  await page.getByLabel('Scenario name').focus();
  await page.keyboard.press('Tab'); // Empty scenario: the disabled Load wrapper is keyboard accessible.
  const loadWrapper = page.getByRole('button', { name: 'Load', exact: true }).locator('..');
  await expect(loadWrapper).toBeFocused();
  await expect(tooltip).toContainText('Disabled: enter a scenario name');
  await expect(page.getByRole('button', { name: 'Load', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(loadWrapper).toBeFocused();
  await expect(tooltip).toHaveCount(1);
  await expect(tooltip).toContainText('Disabled: enter a scenario name');
  await page.mouse.move(0, 0);
  await page.getByText('World settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Step', exact: true }).focus();
  await expect(tooltip).toContainText('Advance exactly one');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  mock.snapshot.status.state = 'reloading';
  await expect(play).toBeDisabled();
  await play.locator('..').hover();
  await expect(tooltip).toContainText('Disabled: runtime is not ready');
  await withinViewport(page, tooltip);
  expect(mock.posts).toEqual([]);
});

test('portalled tooltips are viewport-clamped and escape internally scrolled panels', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockApi(page);
  await openReasoning(page);
  await page.getByText('Budget settings · total caps', { exact: true }).click();
  const apply = page.getByRole('button', { name: 'Apply budget' });
  await apply.scrollIntoViewIfNeeded();
  await apply.focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toContainText('Apply these total caps');
  await withinViewport(page, tooltip);
  expect(await tooltip.evaluate((e) => e.parentElement === document.body)).toBe(true);
  expect(
    await tooltip.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return (
        document
          .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          ?.closest('[role="tooltip"]') === e
      );
    }),
    'Tooltip is painted above panels, not clipped or occluded',
  ).toBe(true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole('button', { name: '▶ Play' }).focus();
  await expect(tooltip).toContainText('Resume ticks');
  await withinViewport(page, tooltip);
  await noOverflow(page);
});

for (const reason of ['requests', 'tokens'] as const) {
  test(`budget explains ${reason} limit without treating bounded yields as errors`, async ({
    page,
  }) => {
    const snapshot = fixture();
    snapshot.status.running = true;
    snapshot.budget.blocked = {
      reason,
      requestedTokens: 3000,
      remainingTokens: 2000,
      message: 'Fixture reservation cannot fit the cumulative cap',
    };
    if (reason === 'requests') snapshot.budget.limit = snapshot.budget.requests;
    await mockApi(page, snapshot);
    await openReasoning(page);
    await expect(page.getByTestId('reasoning-scroll')).toContainText(
      'Requests 3 / ' + snapshot.budget.limit,
    );
    await expect(page.getByTestId('reasoning-scroll')).toContainText('Tokens 8,000 / 10,000');
    await expect(page.getByTestId('reasoning-blocked')).toContainText(
      reason === 'tokens' ? 'token cap' : 'request cap',
    );
    await expect(page.getByTestId('reasoning-blocked')).toContainText(
      'Next request needs 3,000 tokens; 2,000 remain',
    );
    await expect(page.getByTestId('reasoning-blocked')).toContainText(
      'World clock running; physical work continues',
    );
    if (reason === 'tokens') expect(snapshot.budget.requests).toBeLessThan(snapshot.budget.limit);
    await page.locator('[data-turn-id="turn-9"] > summary').click();
    await expect(page.locator('[data-turn-id="turn-9"]')).toContainText('Bounded review · yielded');
    await expect(page.locator('[data-turn-id="turn-9"]')).toContainText(
      'committed effects are retained',
    );
    await expect(page.getByTestId('reasoning-scroll')).not.toContainText(
      'LEGACY_ERROR_MUST_NOT_APPEAR',
    );
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  });
}

test('budget drafts survive polling; only explicit Apply POSTs caps; failed apply can retry', async ({
  page,
}) => {
  const mock = await mockApi(page);
  const initialWorld = structuredClone(mock.snapshot.world);
  await openReasoning(page);
  await page.getByText('Budget settings · total caps', { exact: true }).click();
  const requests = page.getByLabel('Total request cap', { exact: true });
  const tokens = page.getByLabel('Total token cap', { exact: true });
  await requests.fill('30');
  await tokens.fill('15000');
  const before = mock.gets;
  mock.snapshot.budget.limit = 21;
  mock.snapshot.budget.maxTokens = 11000;
  await expect.poll(() => mock.gets).toBeGreaterThan(before + 1);
  await expect(requests).toHaveValue('30');
  await expect(tokens).toHaveValue('15000');
  expect(mock.posts).toEqual([]);
  mock.budgetFailures = 1;
  await page.getByRole('button', { name: 'Apply budget' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Budget not confirmed: 503: Fixture apply failure',
  );
  await expect(requests).toHaveValue('30');
  await expect(tokens).toHaveValue('15000');
  await page.getByRole('button', { name: 'Apply budget' }).click();
  await expect(
    page.getByText('Budget applied. Prior usage and world retained; a paused run stays paused.'),
  ).toBeVisible();
  expect(mock.posts).toEqual(
    Array.from({ length: 2 }, () => ({
      path: '/api/budget',
      body: { maxRequests: 30, maxTokens: 15000 },
    })),
  );
  expect(mock.snapshot.world).toEqual(initialWorld);
  expect(mock.snapshot.status.running).toBe(false);
  expect(mock.snapshot.budget).toMatchObject({
    requests: 3,
    tokens: 8000,
    pending: 1,
    limit: 30,
    maxTokens: 15000,
  });
  await expect(page.getByTestId('reasoning-scroll')).toContainText('Requests 3 / 30');
  await expect(page.getByTestId('reasoning-scroll')).toContainText('Tokens 8,000 / 15,000');
});
