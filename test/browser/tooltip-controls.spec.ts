import { test, expect } from '@playwright/test';

for (const width of [1440, 390, 320]) {
  test(`focused clock tooltips leave rapid Step/Play/Pause controls reachable at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await request.post('/api/control', { data: { type: 'pause' } });
    await page.goto('/');
    await expect(page.getByTestId('prosper-app')).toHaveAttribute('data-app-state', 'ready');
    for (let turn = 0; turn < 3; turn++) {
      for (const name of ['Step', '▶ Play', 'Ⅱ Pause']) {
        const button = page.getByRole('button', { name, exact: true });
        const response = page.waitForResponse(
          (r) => r.url().endsWith('/api/control') && r.request().method() === 'POST',
          { timeout: 10000 },
        );
        await button.click({ timeout: 5000 });
        const committed = await response;
        expect(committed.status()).toBe(200);
        expect(committed.request().postDataJSON().type).toBe(
          name === 'Step' ? 'step' : name === '▶ Play' ? 'play' : 'pause',
        );
        const current = page.getByRole('button', {
          name: name === '▶ Play' ? 'Ⅱ Pause' : name === 'Ⅱ Pause' ? '▶ Play' : 'Step',
          exact: true,
        });
        await expect(current).toBeEnabled();
        await current.focus();
        await expect(current).toBeFocused();
        await expect(page.locator('[role="tooltip"]:visible')).not.toHaveCount(0);
        // The same focused tooltip changes content when the runtime changes state.
        // No Escape, forced click or pointer detour may be needed to reach its neighbor.
        const neighbor = page.getByRole('button', {
          name: name === 'Step' ? '▶ Play' : name === '▶ Play' ? 'Ⅱ Pause' : 'Step',
          exact: true,
        });
        await expect(neighbor).toBeEnabled();
        await expect
          .poll(() =>
            neighbor.evaluate((element) => {
              const box = element.getBoundingClientRect();
              return element.contains(
                document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
              );
            }),
          )
          .toBe(true);
      }
    }
    await expect(page.getByTestId('connection-status')).toHaveText('World paused');
  });
}
