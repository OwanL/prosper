import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spectatorFixture, type AuthoritativeFixture as AppSnapshot } from './fixture';
import { createWorld, dispatch, tickWorld } from '../../src/world/core';
import { enableAutonomy } from '../../src/world/autonomy';
import { claimTerritory, formAlliance } from '../../src/world/society';
import { observe, updateKnowledge } from '../../src/world/observation';

const visuals = mkdtempSync(join(tmpdir(), 'prosper-spectator-mocked-evidence-'));

function sceneFixture(population = 6): AppSnapshot {
  const world = createWorld({ seed: 31, population: 6, runId: 'MOCKED-UI-FIXTURE-NOT-EMERGENCE' });
  const [ada, bram, cora] = Object.values(world.citizens);
  ada.x = 10;
  ada.y = 10;
  bram.x = 11;
  bram.y = 10;
  cora.x = 9;
  cora.y = 10;
  // The combat/trade records below come from real dispatcher mechanics. The starting
  // placement/population is a presentation fixture, not evidence of autonomous behavior.
  expect(dispatch(world, ada.id, { type: 'attack', targetId: bram.id }).ok).toBe(true);
  tickWorld(world, 8);
  dispatch(world, cora.id, { type: 'order', side: 'sell', item: 'food:1', quantity: 1, price: 4 });
  dispatch(world, ada.id, { type: 'order', side: 'buy', item: 'food:1', quantity: 1, price: 4 });
  enableAutonomy(world, ada, { stance: 'assertive', livelihood: 'wood', accessPrice: 8 });
  enableAutonomy(world, cora);
  claimTerritory(world, ada, [8, 8, 12, 12]);
  formAlliance(world, ada, cora);
  dispatch(world, ada.id, {
    type: 'message',
    text: 'The center grove is claimed. Pay eight gold or find another wood source.',
  });
  dispatch(world, cora.id, {
    type: 'message',
    to: ada.id,
    text: 'I will sell food and watch the western path.',
  });
  ada.autonomy!.intent = 'Protect the center grove and negotiate access';
  ada.fullness = 16;
  for (let i = Object.keys(world.citizens).length; i < population; i++) {
    const template = Object.values(world.citizens)[i % 6];
    const id = `fixture-crowd-${i}`;
    world.citizens[id] = {
      ...structuredClone(template),
      id,
      name: `Observer fixture ${i}`,
      x: i % 21,
      y: Math.floor(i / 21) * 3,
      action: null,
      autonomy: undefined,
      strategy: undefined,
    };
  }
  updateKnowledge(world);
  return {
    world,
    status: {
      decisionTreeDebug: false,
      state: 'ready',
      running: true,
      speed: 1,
      mode: 'scripted',
      generation: 1,
      thinking: [ada.id],
      planner: {
        model: 'fixture-provider',
        maxRequestsPerTurn: 1,
        maxOutputTokens: 1024,
        maxConcurrent: 2,
        reviewInterval: 1200,
        minRequestIntervalTicks: 20,
        minRequestIntervalMs: 30000,
        maxRequestsPerHour: 30,
        totalRequests: 2,
        totalInputTokens: 800,
        totalOutputTokens: 180,
        citizenTicks: 10000,
        requestsPer1000CitizenTicks: 0.2,
      },
    },
    budget: {
      requests: 0,
      pending: 0,
      spent: 0,
      limit: 20,
      tokens: 0,
      maxTokens: 40000,
      unit: 'requests',
    },
    turns: [],
  };
}

async function mount(page: Page, snapshot = sceneFixture()) {
  const posts: string[] = [];
  const unexpected: string[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') {
      posts.push(path);
      await route.fulfill({ status: 403, body: 'Read-only fixture' });
      return;
    }
    if (path === '/api/state') {
      await route.fulfill({ json: spectatorFixture(snapshot) });
      return;
    }
    if (path === '/api/history/global') {
      await route.fulfill({ json: { runId: snapshot.world.runId, tick: snapshot.world.tick, startedTick: 0, cadence: 20, limit: 256, frames: [] } });
      return;
    }
    if (/^\/api\/citizens\/[^/]+\/observation$/.test(path)) {
      await route.fulfill({
        json: observe(snapshot.world, decodeURIComponent(path.split('/')[3]!)),
      });
      return;
    }
    unexpected.push(path);
    await route.fulfill({ status: 501, body: 'Fixture blocks unhandled API requests' });
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-run-id',
    snapshot.world.runId,
  );
  return { snapshot, posts, unexpected };
}

async function view(page: Page) {
  await page.getByText('View', { exact: true }).click();
}
async function closeView(page: Page) {
  await page.locator('details').filter({ has: page.getByText('View', { exact: true }) }).evaluateAll(nodes => nodes.forEach(node => node.removeAttribute('open')));
}
async function stories(page: Page) {
  await page.getByRole('tab', { name: 'Events / Comms', exact: true }).click();
  await page.getByText('World stories', { exact: true }).click();
}
async function director(page: Page, enabled: boolean) {
  await view(page);
  await page.getByLabel('Director camera', { exact: true }).setChecked(enabled);
  await closeView(page);
}

test('World is a read-only presentation with claims, causal action, truthful event locations and remote trade', async ({
  page,
}, testInfo) => {
  const mock = await mount(page);
  const ada = Object.values(mock.snapshot.world.citizens)[0];
  await page.getByTestId(`roster-${ada.id}`).click();
  await stories(page);
  await expect(page.getByTestId('world-pulse')).toContainText('6 alive');
  await expect(page.getByTestId('story-rail')).toContainText('Trade');
  await expect(page.getByTestId('story-rail')).toContainText('remote');
  await expect(page.locator('.territory-overlays rect')).toHaveCount(1);
  await expect(page.getByTestId(`combat-${ada.id}`)).toBeVisible();
  await page.getByRole('tab', { name: 'Policy', exact: true }).click();
  await expect(page.getByTestId('citizen-motivation')).toContainText('Protect the center grove');
  await expect(page.getByTestId('citizen-motivation')).toContainText('local scripted');
  const trade = mock.snapshot.world.events.find((event) => event.kind === 'trade')!;
  await expect(page.getByTestId(`event-marker-${trade.id}`)).toHaveCount(0);
  const attack = mock.snapshot.world.events.find((event) => event.kind === 'attack')!;
  await page.getByTestId(`story-${attack.id}`).click();
  await view(page);
  await expect(page.getByLabel('Director camera', { exact: true })).not.toBeChecked();
  await closeView(page);
  await expect(page.getByTestId('camera-caption')).toContainText(
    `recorded (${attack.x}, ${attack.y})`,
  );
  await page.getByLabel('Reset map view').click();
  await expect(page.getByTestId('camera-caption')).toHaveCount(0);
  await page.mouse.move(1430, 890);
  await page.keyboard.press('Escape');
  const screenshot = join(visuals, 'watch-six-citizens-mocked.png');
  await page.screenshot({ path: screenshot, animations: 'disabled' });
  testInfo.annotations.push({ type: 'mocked-ui-evidence', description: screenshot });
  expect(mock.posts).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});

test('director holds shots, manual citizen selection overrides it, knowledge view hides global overlays', async ({
  page,
}) => {
  const mock = await mount(page);
  const ada = Object.values(mock.snapshot.world.citizens)[0];
  await stories(page);
  await director(page, true);
  await expect(page.getByTestId('camera-caption')).toContainText('Combat');
  const shot = await page.getByTestId('camera-caption').textContent();
  mock.snapshot.world.tick++;
  mock.snapshot.world.events.push({
    id: 'fixture-later-death',
    kind: 'death',
    tick: mock.snapshot.world.tick,
    text: 'Fixture later higher-priority event',
    x: 1,
    y: 1,
  });
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-tick',
    String(mock.snapshot.world.tick),
  );
  await expect(page.getByTestId('camera-caption')).toHaveText(shot!);
  await page.getByTestId(`roster-${ada.id}`).click();
  await view(page);
  await expect(page.getByLabel('Director camera', { exact: true })).not.toBeChecked();
  await expect(page.getByTestId('camera-caption')).toHaveCount(0);
  await page.getByLabel('Citizen knowledge', { exact: true }).check();
  await closeView(page);
  await expect(page.locator('.territory-overlays')).toHaveCount(0);
  await expect(page.getByTestId('world-pulse')).toHaveCount(0);
  await expect(page.getByTestId('story-rail')).toHaveCount(0);
  await expect(page.locator('.event-markers')).toHaveCount(0);
  expect(mock.posts).toEqual([]);
});

test('100 citizens stay watchable with crowd labels, reduced motion, keyboard and contained mobile layout', async ({
  page,
}, testInfo) => {
  const mock = await mount(page, sceneFixture(100));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stories(page);
  await director(page, false);
  await expect(page.locator('.citizen')).toHaveCount(100);
  await expect(page.locator('.nameplate')).toHaveCount(0);
  await expect(page.getByTestId('world-pulse')).toContainText('100 alive');
  const ada = Object.values(mock.snapshot.world.citizens)[0];
  await page.getByTestId(`citizen-${ada.id}`).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(`roster-${ada.id}`)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.nameplate')).toHaveCount(1);
  await expect(page.locator('.citizen .sprite').first()).toHaveCSS('animation-name', 'none');
  const performanceSample = await page.evaluate(async () => {
    const start = performance.now();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return {
      twoFramesMs: performance.now() - start,
      svgElements: document.querySelectorAll('.world-scene *').length,
    };
  });
  testInfo.annotations.push({
    type: 'presentation-performance-observation',
    description: JSON.stringify(performanceSample),
  });
  const desktop = join(visuals, 'watch-100-citizens-mocked.png');
  await page.mouse.move(1430, 890);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: desktop, animations: 'disabled' });
  testInfo.annotations.push({ type: 'mocked-ui-evidence', description: desktop });
  const dimensions = await page.evaluate(() => ({
    w: innerWidth,
    h: innerHeight,
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
  }));
  expect(dimensions.sw).toBeLessThanOrEqual(dimensions.w);
  expect(dimensions.sh).toBeLessThanOrEqual(dimensions.h);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  const mobile = join(visuals, 'watch-100-mobile-mocked.png');
  await page.screenshot({ path: mobile, fullPage: true, animations: 'disabled' });
  testInfo.annotations.push({ type: 'mocked-ui-evidence', description: mobile });
  expect(mock.posts).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});

test('harness efficiency labels session measurements and leaves cumulative budgets visible', async ({
  page,
}) => {
  const mock = await mount(page);
  await page.getByRole('tab', { name: 'Reasoning', exact: true }).click();
  await expect(page.getByTestId('harness-summary')).toContainText('Scripted strategy reviews');
  await expect(page.getByTestId('harness-summary')).toContainText(
    '0.20 calls / 1,000 citizen ticks',
  );
  await expect(page.getByTestId('harness-summary')).toContainText('average 400 in / 90 out');
  await expect(page.getByTestId('harness-summary')).not.toContainText('fixture-provider');
  await expect(page.getByTestId('reasoning-scroll')).toContainText('Tokens 0 / 40,000');
  expect(mock.posts).toEqual([]);
  expect(mock.unexpected).toEqual([]);
});
