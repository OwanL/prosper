import { expect, test } from '@playwright/test';
import { spectatorFixture, type AuthoritativeFixture as AppSnapshot } from './fixture';
import type { MotionSnapshot } from '../../src/shared/motion-types';
import { createWorld } from '../../src/world/core';
import { observe } from '../../src/world/observation';

test('tick stream follows confirmed corners between unchanged state polls and closes in knowledge view', async ({
  page,
}) => {
  const world = createWorld({ seed: 19, runId: 'offline-continuous-motion', population: 1 });
  world.tick = 100;
  const citizen = Object.values(world.citizens)[0];
  citizen.x = 20;
  citizen.y = 20;
  citizen.action = null;
  const snapshot: AppSnapshot = {
    world,
    status: {
      decisionTreeDebug: false,
      state: 'ready',
      running: true,
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
  await page.addInitScript(() => {
    const sources: { onmessage: ((event: { data: string }) => void) | null; closed: boolean }[] =
      [];
    Object.assign(window, { prosperMotionSources: sources });
    class FakeEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror = null;
      closed = false;
      constructor() {
        sources.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    window.EventSource = FakeEventSource as unknown as typeof EventSource;
  });
  const unexpectedRequests: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/api/state')
      await route.fulfill({ json: spectatorFixture(snapshot) });
    else if (request.method() === 'GET' && path === `/api/citizens/${citizen.id}/observation`)
      await route.fulfill({ json: observe(world, citizen.id) });
    else if (request.method() === 'GET' && path === '/api/history/global')
      await route.fulfill({
        json: {
          runId: world.runId,
          tick: world.tick,
          startedTick: 0,
          cadence: 20,
          limit: 256,
          frames: [],
        },
      });
    else {
      unexpectedRequests.push(`${request.method()} ${request.url()}`);
      await route.fulfill({ status: 501, body: 'Offline fixture only' });
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-run-id', world.runId);
  const sprite = page.getByTestId(`citizen-${citizen.id}`);
  await expect(sprite).toBeVisible();
  const packet: MotionSnapshot = {
    runId: world.runId,
    streamId: 'server-a',
    tick: 102,
    running: true,
    tickMs: 400,
    frames: [
      { tick: 100, at: 1000, citizens: [{ id: citizen.id, x: 20, y: 20, alive: true }] },
      { tick: 101, at: 1400, citizens: [{ id: citizen.id, x: 21, y: 20, alive: true }] },
      { tick: 102, at: 1800, citizens: [{ id: citizen.id, x: 21, y: 21, alive: true }] },
    ],
  };
  const points = await sprite.evaluate(async (element, message) => {
    const sources = (
      window as unknown as {
        prosperMotionSources: { onmessage: (event: { data: string }) => void }[];
      }
    ).prosperMotionSources;
    sources.at(-1)!.onmessage({ data: JSON.stringify(message) });
    const result: { x: number; y: number }[] = [];
    for (let index = 0; index < 26; index++) {
      await new Promise(requestAnimationFrame);
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      result.push({ x: matrix.e, y: matrix.f });
    }
    return result;
  }, packet);
  expect(points.some((point) => point.x > 20.5 && point.x < 21.5)).toBe(true);
  expect(points.some((point) => point.y < world.height - 20.5)).toBe(true);
  for (const point of points) {
    // A chord from the old poll to the new poll would change both axes together.
    if (point.x < 21.499) expect(point.y).toBeCloseTo(world.height - 20.5, 2);
    expect(point.x).toBeLessThanOrEqual(21.5);
    expect(point.y).toBeGreaterThanOrEqual(world.height - 21.5);
  }
  await sprite.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'World settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Citizen knowledge', exact: true }).check();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sources = (window as unknown as { prosperMotionSources: { closed: boolean }[] })
          .prosperMotionSources;
        return sources.length > 0 && sources.every((source) => source.closed);
      }),
    )
    .toBe(true);
  expect(unexpectedRequests).toEqual([]);
});
