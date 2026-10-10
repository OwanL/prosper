import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld } from '../../src/world/core';
import { TIERS } from '../../src/shared/types';
import type { CitizenHistory, GlobalHistory, MarketSample } from '../../src/shared/telemetry-types';

const visuals = mkdtempSync(join(tmpdir(), 'prosper-history-visuals-'));
const world = createWorld({ runId: 'history-fixture', population: 2 });
world.tick = 37;
const ids = Object.keys(world.citizens);
const row: MarketSample = {
  bid: null,
  ask: 7,
  lastPrice: null,
  lastTick: null,
  supply: 10,
  demand: 0,
  carried: 20,
  held: 3,
  ground: 250,
  units: 2,
  turnover: 14,
  fills: 1,
};
const global: GlobalHistory = {
  runId: world.runId,
  tick: 77,
  startedTick: 37,
  cadence: 20,
  limit: 256,
  frames: [37, 57, 77].map((tick, i) => ({
    tick,
    population: 2,
    meanHealth: 100,
    meanFullness: 80,
    markets: { 'food:1': { ...row, bid: i === 1 ? 5 : null }, 'building:archived-station': row },
  })),
};
const citizen = (citizenId: string): CitizenHistory => ({
  runId: world.runId,
  tick: 77,
  startedTick: 37,
  cadence: 20,
  limit: 256,
  citizenId,
  points: [
    { tick: 37, alive: true, cash: 50, escrow: 10, health: 100, fullness: 80 },
    { tick: 57, alive: true, cash: 40, escrow: 20, health: 80, fullness: 60 },
    { tick: 77, alive: false, cash: 0, escrow: 0, health: 0, fullness: 0 },
  ],
});
async function mount(page: Page, scope: 'global' | 'citizen' = 'global', enabled = true) {
  const main = await (await page.request.get('/src/ui/main.tsx')).text();
  const reactUrl = main.match(/"([^"\n]*\/react\.js[^"\n]*)"/)?.[1];
  const domUrl = main.match(/"([^"\n]*\/react-dom_client\.js[^"\n]*)"/)?.[1];
  if (!reactUrl || !domUrl) throw new Error('Fixture requires the Vite development server');
  page.on('pageerror', (error) => console.error('History fixture page error:', error.message));
  await page.route('**/history-charts-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><head><style>body{margin:0;background:#101922;color:white}#fixture{width:min(1100px,100%);margin:20px auto}</style></head><body><div id="fixture"></div><script type="module">
    import React from ${JSON.stringify(reactUrl)};
    import ReactDom from ${JSON.stringify(domUrl)};
    const {createRoot} = ReactDom;
    import {injectIntoGlobalHook} from '/@react-refresh';
    injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const {default: HistoryCharts} = await import('/src/ui/HistoryCharts.tsx');
    const root = createRoot(document.getElementById('fixture'));
    let props = {world:${JSON.stringify(world)},scope:${JSON.stringify(scope)},enabled:${enabled},selectedId:${JSON.stringify(ids[0])}};
    window.updateHistoryFixture = patch => {props={...props,...patch,world:{...props.world,...patch.world}};root.render(React.createElement(HistoryCharts,props));};
    window.updateHistoryFixture({});
  </script></body></html>`,
    }),
  );
  await page.goto('/history-charts-fixture');
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { updateHistoryFixture?: unknown }).updateHistoryFixture ===
      'function',
  );
}
async function update(page: Page, patch: object) {
  await page.evaluate(
    (value) =>
      (window as unknown as { updateHistoryFixture: (patch: object) => void }).updateHistoryFixture(
        value,
      ),
    patch,
  );
}

test('sample-window fetching, hover/focus exact values, fallback and compact layout', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('**/api/**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({ json: global });
  });
  await mount(page);
  await expect(page.getByRole('region', { name: 'Price chart', exact: true })).toBeVisible();
  await expect(page.locator('.history-toolbar > span').first()).toHaveAttribute(
    'title',
    /Recording began at tick 37/,
  );
  await update(page, { world: { tick: 56 } });
  await expect(page.getByLabel('Current order book')).toContainText('Now t56');
  expect(requests).toHaveLength(1);
  await update(page, { world: { tick: 57 } });
  await expect.poll(() => requests.length).toBe(2);
  await page.getByLabel('Price sample cursor').focus();
  await expect(page.getByRole('tooltip')).toContainText('Tick 77');
  await expect(page.getByRole('tooltip')).toContainText('Bid: — gold / unit');
  await page.getByLabel('Price sample cursor').press('ArrowLeft');
  await expect(page.getByRole('tooltip')).toContainText('Tick 57');
  await expect(page.getByRole('tooltip')).toContainText('Bid: 5 gold / unit');
  await page.getByLabel('Price sample cursor').blur();
  await page
    .getByRole('region', { name: 'Price chart', exact: true })
    .locator('svg > rect')
    .first()
    .hover();
  await expect(page.getByRole('tooltip')).toContainText('Tick 37');
  await expect(page.getByRole('tooltip')).toContainText('No recorded execution');
  await page.getByText('Exact samples', { exact: true }).click();
  await page.getByLabel('Exact sample series').selectOption('Price/lastPrice');
  await expect(page.getByRole('row', { name: '37 —', exact: true })).toBeVisible();
  await page.getByText('Exact samples', { exact: true }).click();
  await page.getByLabel('History commodity').selectOption('building:archived-station');
  await expect(page.getByLabel('History commodity')).toHaveValue('building:archived-station');
  await expect
    .poll(() =>
      page
        .locator('.history-charts')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await page.screenshot({ path: join(visuals, 'global-1100.png') });
  // A 240px dock leaves 191px after its tab strip and parent padding.
  await page.locator('#fixture').evaluate((element) => {
    element.style.height = '191px';
    element.style.overflow = 'auto';
  });
  await page.mouse.move(0, 0);
  for (const metric of ['Price', 'Trade windows', 'Order book', 'Stock', 'Bid / ask comparison']) {
    await page.getByLabel('History metric').selectOption(metric);
    await expect(page.locator('.history-plot')).toHaveCount(1);
    await expect(page.getByRole('region', { name: `${metric} chart`, exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('#fixture')
          .evaluate((element) => element.scrollHeight <= element.clientHeight),
      )
      .toBe(true);
    expect(
      await page
        .locator('.history-legend, .history-units, .history-scrubber, .history-axis-label')
        .evaluateAll((elements) =>
          elements.every((element) => parseFloat(getComputedStyle(element).fontSize) >= 11),
        ),
    ).toBe(true);
    const pane = await page.locator('#fixture').boundingBox();
    for (const selector of [
      '.history-toolbar',
      '.history-book',
      'svg',
      '.history-scrubber',
      '.history-table summary',
    ]) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(pane!.y);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(pane!.y + pane!.height + 1);
    }
  }
  await page.screenshot({ path: join(visuals, 'comparison-short-dock.png') });
  await page.getByLabel('History metric').selectOption('Stock');
  await page.screenshot({ path: join(visuals, 'global-short-dock.png') });
  await page.setViewportSize({ width: 390, height: 760 });
  await expect
    .poll(() =>
      page
        .locator('.history-charts')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await page.locator('#fixture').evaluate((element) => {
    element.style.height = 'auto';
  });
  expect(
    await page
      .locator('.history-charts')
      .evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe('visible');
  await page.getByText('Exact samples', { exact: true }).click();
  await expect(page.getByLabel('Exact sample series')).toBeVisible();
  expect(
    await page.locator('.history-charts').evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(380);
  expect(
    await page
      .locator('.history-charts')
      .evaluate((element) => element.scrollHeight <= element.clientHeight),
  ).toBe(true);
  await page.screenshot({ path: join(visuals, 'global-mobile.png') });
  console.log(`HISTORY_VISUALS ${visuals}`);
});

test('bid/ask comparison toggles commodities, preserves gaps and exposes exact selected series', async ({
  page,
}) => {
  const comparison = structuredClone(global);
  comparison.frames.forEach((frame, index) => {
    if (index !== 1) frame.markets['wood:2'] = { ...row, bid: 10 + index, ask: 14 + index };
  });
  let calls = 0;
  await page.route('**/api/**', (route) => {
    calls++;
    return route.fulfill({ json: comparison });
  });
  await mount(page);
  await page.getByLabel('History metric').selectOption('Bid / ask comparison');
  const plot = page.getByRole('region', { name: 'Bid / ask comparison chart', exact: true });
  await expect(plot).toBeVisible();
  await expect(plot.locator('g[data-series]')).toHaveCount(6);
  await expect(page.getByLabel('History commodity')).toHaveCount(0);
  await page.getByText('Commodities · 3 selected', { exact: true }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(plot).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Select at least one commodity');
  await page.getByRole('checkbox', { name: 'food:1', exact: true }).focus();
  await page.getByRole('checkbox', { name: 'food:1', exact: true }).press('Space');
  await page.getByRole('checkbox', { name: 'wood:2', exact: true }).check();
  await expect(plot.locator('g[data-series]')).toHaveCount(4);
  await expect(plot.locator('g[data-series="wood:2/ask"] path').first()).toHaveAttribute(
    'stroke-dasharray',
    '5 3',
  );
  await expect(plot.locator('g[data-series="wood:2/bid"] path')).toHaveCount(2);
  const color = await plot.locator('g[data-series="wood:2/bid"]').getAttribute('stroke');
  await page.getByRole('checkbox', { name: 'food:1', exact: true }).uncheck();
  await expect(plot.locator('g[data-series="food:1/bid"]')).toHaveCount(0);
  await expect(plot.locator('g[data-series="wood:2/bid"]')).toHaveAttribute('stroke', color!);
  await page.getByLabel('Bid / ask comparison sample cursor').focus();
  await expect(page.getByRole('tooltip')).toContainText('wood:2 bid: 12 gold / unit');
  await page.getByLabel('Bid / ask comparison sample cursor').press('ArrowLeft');
  await expect(page.getByRole('tooltip')).toContainText('wood:2 ask: — gold / unit');
  await page.getByLabel('Bid / ask comparison sample cursor').blur();
  await page.getByText('Exact samples', { exact: true }).click();
  await page.getByLabel('Exact sample series').selectOption('Bid / ask comparison/wood:2/ask');
  await expect(page.getByRole('row', { name: '57 —', exact: true })).toBeVisible();
  await expect(page.getByLabel('Exact sample series').locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'building:archived-station', exact: true }),
  ).toBeChecked();
  await expect(page.getByRole('checkbox', { checked: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await page.getByRole('checkbox', { name: 'sword:1', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('No bid / ask quotes recorded');
  await page.getByRole('checkbox', { name: 'food:1', exact: true }).check();
  await page.getByRole('checkbox', { name: 'wood:2', exact: true }).check();
  await page.getByText('Commodities · 3 selected', { exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(calls).toBe(1);
  await page.screenshot({ path: join(visuals, 'comparison-wide.png') });
  await page.setViewportSize({ width: 390, height: 760 });
  await page.getByText('Commodities · 3 selected', { exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.history-charts')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await page.screenshot({ path: join(visuals, 'comparison-mobile-picker.png') });
  await page.getByLabel('History metric').selectOption('Price');
  await expect(page.getByLabel('History commodity')).toBeVisible();
  await page.getByLabel('History metric').selectOption('Bid / ask comparison');
  await page.getByText('Commodities · 3 selected', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'wood:2', exact: true })).toBeChecked();
});

test('all commodities remain interactive with a full retained quote history', async ({ page }) => {
  const items = ['food', 'wood', 'fibre', 'axe', 'scythe', 'knife', 'sword'].flatMap((item) =>
    TIERS.map((tier) => `${item}:${tier}`),
  );
  const dense: GlobalHistory = {
    ...global,
    frames: Array.from({ length: global.limit }, (_, index) => ({
      tick: global.startedTick + index * global.cadence,
      population: 2,
      meanHealth: 100,
      meanFullness: 80,
      markets: Object.fromEntries(
        items.map((item, itemIndex) => [item, { ...row, bid: itemIndex + 1, ask: itemIndex + 3 }]),
      ),
    })),
  };
  await page.route('**/api/**', (route) => route.fulfill({ json: dense }));
  await mount(page);
  await page.getByLabel('History metric').selectOption('Bid / ask comparison');
  await page.getByText('Commodities · 3 selected', { exact: true }).click();
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  const plot = page.getByRole('region', { name: 'Bid / ask comparison chart', exact: true });
  await expect(plot.locator('g[data-series]')).toHaveCount(items.length * 2);
  await page.getByText(`Commodities · ${items.length} selected`, { exact: true }).click();
  await page.getByLabel('Bid / ask comparison sample cursor').focus();
  await page.getByLabel('Bid / ask comparison sample cursor').press('ArrowLeft');
  await expect(page.getByRole('tooltip')).toContainText(
    `Tick ${global.startedTick + (global.limit - 2) * global.cadence}`,
  );
  await page.getByLabel('Bid / ask comparison sample cursor').blur();
  await page.getByText(`Commodities · ${items.length} selected`, { exact: true }).click();
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(plot).toHaveCount(0);
});

test('fetch only while displayed; citizen gold excludes inventory and leaves death gaps', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/**', (route) => {
    calls++;
    return route.fulfill({ json: citizen(ids[0]!) });
  });
  await mount(page, 'citizen', false);
  expect(calls).toBe(0);
  await update(page, { enabled: true });
  await expect(page.getByRole('region', { name: 'Gold holdings chart' })).toBeVisible();
  await page.getByLabel('Gold holdings sample cursor').focus();
  await expect(page.getByRole('tooltip')).toContainText('Cash + escrow: — gold');
  await page.getByLabel('Gold holdings sample cursor').press('ArrowLeft');
  await expect(page.getByRole('tooltip')).toContainText('Cash + escrow: 60 gold');
  await page.locator('#fixture').evaluate((element) => {
    element.style.width = '320px';
  });
  await expect
    .poll(() =>
      page
        .locator('.history-charts')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    )
    .toBe(true);
  await page.screenshot({ path: join(visuals, 'citizen-tooltip.png') });
  await page.getByLabel('History metric').selectOption('Vitals');
  await expect(page.getByRole('region', { name: 'Gold holdings chart' })).toHaveCount(0);
  await page.getByLabel('Vitals sample cursor').focus();
  await page.getByLabel('Vitals sample cursor').press('ArrowLeft');
  await expect(page.getByRole('tooltip')).toContainText('Health: 80 / 100');
  await page.getByText('Exact samples', { exact: true }).click();
  // Numeric fallback still discovers every series, not only the selected metric.
  await page.getByLabel('Exact sample series').selectOption('Gold holdings/cash');
  await expect(page.getByRole('row', { name: '37 50', exact: true })).toBeVisible();
  await page.screenshot({ path: join(visuals, 'citizen-vitals-mobile.png') });
  await update(page, { enabled: false, world: { tick: 97 } });
  await expect(page.getByRole('region', { name: 'Citizen history', exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
  await update(page, { enabled: true });
  await expect.poll(() => calls).toBe(2);
});

test('empty and HTTP failures are truthful and obsolete selections never replace current samples', async ({
  page,
}) => {
  let mode: 'empty' | 'error' | 'late' = 'empty';
  await page.route('**/api/**', async (route) => {
    if (mode === 'error') return route.fulfill({ status: 503, json: {} });
    if (mode === 'empty') return route.fulfill({ json: { ...citizen(ids[0]!), points: [] } });
    const id = new URL(route.request().url()).pathname.split('/')[3]!;
    if (id === ids[0]) await new Promise((resolve) => setTimeout(resolve, 300));
    await route
      .fulfill({
        json: {
          ...citizen(id),
          points: citizen(id).points.map((point) => ({ ...point, cash: id === ids[0] ? 999 : 20 })),
        },
      })
      .catch(() => {});
  });
  await mount(page, 'citizen');
  await expect(page.getByText(/No recorded samples yet/)).toBeVisible();
  await expect(page.locator('svg')).toHaveCount(0);
  mode = 'error';
  await update(page, { world: { tick: 57 } });
  await expect(page.getByRole('alert')).toContainText('HTTP 503');
  mode = 'late';
  await update(page, { world: { tick: 77 } });
  await update(page, { selectedId: ids[1] });
  await expect(page.getByRole('region', { name: 'Gold holdings chart' })).toBeVisible();
  await page.getByText('Exact samples', { exact: true }).click();
  await page.getByLabel('Exact sample series').selectOption('Gold holdings/cash');
  await expect(page.getByRole('row', { name: '37 20', exact: true })).toBeVisible();
  // Waiting for the old route to complete is intentional: it must not overwrite the selection.
  await page.waitForTimeout(350);
  await expect(page.getByRole('row', { name: '37 20', exact: true })).toBeVisible();
  await update(page, { world: { runId: 'different-run' } });
  await expect(page.getByRole('alert')).toContainText('another run or citizen');
  await expect(page.locator('svg')).toHaveCount(0);
});
