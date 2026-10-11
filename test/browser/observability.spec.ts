import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorld, tickWorld } from '../../src/world/core';
import { observe, updateKnowledge } from '../../src/world/observation';
import { spectatorFixture, type AuthoritativeFixture } from './fixture';

// Synthetic retained memories; backend replies use the actual spectator projector.
// This checks transport/UI behavior, not real runtime persistence.
test('server-authoritative diagnostics toggle preserves the normal private mind summary', async ({ page }) => {
  const world = createWorld({ seed: 17, population: 2, controllerMode: 'composed' });
  tickWorld(world, 2);
  updateKnowledge(world);
  const citizen = Object.values(world.citizens)[0];
  citizen.name = 'Ada Observability';
  const mind = citizen.mind!;
  mind.memories = Array.from({ length: 14 }, (_, i) => ({ id: `fixture-memory-${i}`, tick: i,
    kind: 'work' as const, text: `Retained fixture memory ${i}` }));
  mind.memoriesOmitted = 3;
  const snapshot: AuthoritativeFixture = { world, status: { decisionTreeDebug: false,
    state: 'ready', running: false, speed: 1, mode: 'scripted', generation: 1, thinking: [] },
    budget: { requests: 0, pending: 0, spent: 0, limit: 100, tokens: 0, maxTokens: 100000, unit: 'requests' }, turns: [] };
  let release: (() => void) | undefined;
  let holdEnable = true;
  let rejectControl = false;
  const posts: unknown[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/control') {
      const body = route.request().postDataJSON();
      posts.push(body);
      if (body.type !== 'decision-tree-debug') throw new Error('Unexpected mutation');
      if (rejectControl) {
        await route.fulfill({ status: 503, body: 'Fixture control rejected' });
        return;
      }
      if (body.enabled && holdEnable) {
        await new Promise<void>(resolve => { release = resolve; });
        holdEnable = false;
      }
      snapshot.status.decisionTreeDebug = body.enabled;
      await route.fulfill({ json: spectatorFixture(snapshot) });
    } else if (path === '/api/state') await route.fulfill({ json: spectatorFixture(snapshot) });
    else if (path === '/api/motion') await route.fulfill({ status: 204 });
    else if (path.endsWith('/observation')) await route.fulfill({ json: observe(world, citizen.id) });
    else await route.fulfill({ status: 404, json: { error: 'Fixture endpoint not available' } });
  });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'World panels' });
  const settings = () => nav.getByRole('button', { name: 'World settings', exact: true }).click();
  const inspect = async () => {
    await nav.getByRole('button', { name: 'Citizens', exact: true }).click();
    await page.locator('.roster-list').getByRole('button').filter({ hasText: citizen.name }).click();
    await page.getByTestId('mind-dossier').getByText('Mind · dispositions, current task & memories', { exact: true }).click();
    await expect(page.getByTestId('mind-dispositions')).toBeVisible();
    await expect(page.getByTestId('mind-current-task')).toBeVisible();
    await expect(page.getByTestId('mind-memories')).toContainText('Retained fixture memory 13');
  };
  await settings();
  const toggle = page.getByRole('checkbox', { name: 'Decision-tree diagnostics', exact: true });
  await expect(toggle).not.toBeChecked();
  await inspect();
  await expect(page.getByTestId('tree-diagnostics')).toHaveCount(0);
  await expect(page.getByText('3 older memories evicted from controller history')).toBeVisible();
  await expect(page.getByText('2 additional memories retained in the controller but omitted from this summary')).toBeVisible();
  await settings();
  await toggle.click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(toggle).not.toBeChecked();
  release!();
  await expect(toggle).toBeChecked();
  await inspect();
  await page.getByText('Retained controller history', { exact: true }).click();
  await expect(page.getByTestId('tree-diagnostics')).toContainText(`Tasks · ${mind.tasks.length}`);
  await expect(page.getByTestId('tree-diagnostics')).toContainText(`Trace · ${mind.trace.length}`);
  const directory = mkdtempSync(join(tmpdir(), 'prosper-observability-ui-'));
  await page.screenshot({ path: join(directory, 'retained-history-on.png') });
  console.log(`Observability screenshot: ${join(directory, 'retained-history-on.png')}`);
  await settings();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect.poll(() => snapshot.status.decisionTreeDebug).toBe(false);
  await inspect();
  await expect(page.getByTestId('tree-diagnostics')).toHaveCount(0);
  expect(posts).toEqual([{ type: 'decision-tree-debug', enabled: true }, { type: 'decision-tree-debug', enabled: false }]);
  await settings();
  rejectControl = true;
  await toggle.click();
  await expect(page.getByRole('alert')).toContainText('Fixture control rejected');
  await expect(toggle).not.toBeChecked();
  rejectControl = false;
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole('checkbox', { name: 'Citizen knowledge', exact: true }).check();
  await inspect();
  await expect(page.getByTestId('tree-diagnostics')).toHaveCount(0);
  const other = Object.values(world.citizens)[1];
  await nav.getByRole('button', { name: 'Citizens', exact: true }).click();
  await expect(page.locator('.roster-list').getByRole('button').filter({ hasText: other.name })).toHaveCount(0);
  await expect(page.getByTestId('mind-dossier')).toHaveCount(0);
  await expect(page.getByTestId('tree-diagnostics')).toHaveCount(0);
});
