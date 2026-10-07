import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppSnapshot } from '../../src/shared/types';

const visualDirectory = join(tmpdir(), 'prosper-browser-visual');
async function ready(page: Page) {
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-app-state', 'ready');
  await expect(page.getByTestId('planner-mode')).toContainText('SCRIPTED');
}
async function screenshot(page: Page, name: string) {
  mkdirSync(visualDirectory, { recursive: true });
  await page.screenshot({ path: join(visualDirectory, `${name}.png`), animations: 'disabled' });
}
async function clickControl(page: Page, name: string) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/control') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name, exact: true }).click();
  const r = await response;
  expect(r.status()).toBe(200);
  const snapshot = (await r.json()) as AppSnapshot;
  expect(snapshot.status.state).toBe('ready');
  expect(snapshot.status.mode).toBe('scripted');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute(
    'data-tick',
    String(snapshot.world.tick),
  );
  return snapshot;
}

test('scripted world: inspector, clock controls, knowledge, camera, refresh and coordinated reconnect', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await ready(page);
  await expect(page.getByTestId('connection-status')).toHaveText('World paused');
  const initial = (await (await request.get('/api/state')).json()) as AppSnapshot;
  expect(initial.status.running).toBe(false);
  const [citizen] = Object.values(initial.world.citizens);
  const app = page.getByTestId('prosper-app');
  await expect(app).toHaveAttribute('data-run-id', initial.world.runId);
  await screenshot(page, 'initial');

  await page.getByTestId(`citizen-${citizen.id}`).click();
  const inspector = page.getByTestId('citizen-inspector');
  await expect(inspector).toHaveAttribute('data-citizen-id', citizen.id);
  await expect(inspector.getByRole('heading', { name: citizen.name, exact: true })).toBeVisible();
  await expect(inspector.getByText('Physical work', { exact: true })).toBeVisible();
  // SVG focus outlines use world-space units: a 3px HTML outline obscures several tiles.
  await page.getByTestId(`citizen-${citizen.id}`).focus();
  expect(
    await page
      .getByTestId(`citizen-${citizen.id}`)
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe('none');
  await screenshot(page, 'selected');

  const stepped = await clickControl(page, 'Step 1 tick');
  expect(stepped.world.tick).toBe(initial.world.tick + 1);
  await expect(page.getByTestId('connection-status')).toHaveText('World paused');
  const played = await clickControl(page, '▶ Play');
  expect(played.status.running).toBe(true);
  await expect(page.getByRole('button', { name: 'Step 1 tick', exact: true })).toBeDisabled();
  await expect
    .poll(async () => Number(await app.getAttribute('data-tick')))
    .toBeGreaterThan(played.world.tick);
  const paused = await clickControl(page, 'Ⅱ Pause');
  expect(paused.status.running).toBe(false);
  await expect(page.getByTestId('connection-status')).toHaveText('World paused');
  await expect(inspector.locator('.meter-label').filter({ hasText: 'Fullness' })).not.toContainText(
    /\d\.\d{3}/,
  );
  await screenshot(page, 'activity');

  await page.getByRole('checkbox', { name: 'Citizen knowledge', exact: true }).check();
  await expect(
    page.getByText('Citizen knowledge · dated sightings', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Spectator diagnostics hidden in citizen knowledge view.'),
  ).toBeVisible();
  await expect(inspector).toHaveAttribute('data-citizen-id', citizen.id);
  await screenshot(page, 'knowledge');
  await page.getByRole('checkbox', { name: 'Citizen knowledge', exact: true }).uncheck();
  await expect(page.getByText('Spectator truth', { exact: false })).toBeVisible();

  const scene = page.getByTestId('world-scene');
  const fit = await scene.getAttribute('viewBox');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(scene).not.toHaveAttribute('viewBox', fit!);
  const zoomed = await scene.getAttribute('viewBox');
  const box = (await scene.boundingBox())!;
  // Drag from the SVG's empty letterbox, not an entity.
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(scene).not.toHaveAttribute('viewBox', zoomed!);
  await page.getByRole('button', { name: 'Reset map view', exact: true }).click();
  await expect(scene).toHaveAttribute('viewBox', fit!);
  const other = Object.values(initial.world.citizens)[1];
  await page.getByTestId(`roster-${other.id}`).click();
  await expect(inspector).toHaveAttribute('data-citizen-id', other.id);
  await page.getByRole('checkbox', { name: 'Follow selected', exact: true }).check();
  await expect(scene).not.toHaveAttribute('viewBox', fit!);
  await page.reload();
  await ready(page);
  await expect(inspector).toHaveAttribute('data-citizen-id', other.id);
  await expect(page.getByRole('checkbox', { name: 'Follow selected', exact: true })).toBeChecked();

  // Force a brief browser transport outage (no world/API payload mocking), then recover.
  await page.route('**/api/state', (route) => route.abort('connectionrefused'));
  await expect(app).toHaveAttribute('data-app-state', 'reconnecting');
  await expect(page.getByTestId('connection-status')).toContainText('last snapshot retained');
  await expect(page.getByRole('button', { name: 'Step 1 tick', exact: true })).toBeDisabled();
  await expect(inspector).toHaveAttribute('data-citizen-id', other.id);
  await page.unroute('**/api/state');
  await ready(page);
  const before = (await (await request.get('/api/state')).json()) as AppSnapshot;
  const restart = await request.post('/api/reload', { data: { action: 'restart' } });
  expect(restart.status()).toBe(202);
  expect(await restart.json()).toEqual({ state: 'reloading' });
  await expect
    .poll(async () => {
      const s = (await (await request.get('/api/state')).json()) as AppSnapshot;
      return s.status.state;
    })
    .toBe('ready');
  const restored = (await (await request.get('/api/state')).json()) as AppSnapshot;
  expect(restored.world).toEqual(before.world);
  expect(restored.status.running).toBe(false);
  await ready(page);
  await expect(app).toHaveAttribute('data-run-id', before.world.runId);
  await expect(app).toHaveAttribute('data-tick', String(before.world.tick));
  await expect(inspector).toHaveAttribute('data-citizen-id', other.id);
  await expect(page.getByTestId('connection-status')).toHaveText('World paused');
  await screenshot(page, 'restored');
  expect(errors).toEqual([]);
});
