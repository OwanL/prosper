import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Economy, economySummary, retainedTradeBins } from '../src/ui/Economy';
import { TIERS, type WorldEvent } from '../src/shared/types';
import { createWorld, dispatch } from '../src/world/core';

const fill = (id: string, tick: number, text: string): WorldEvent => ({
  id,
  tick,
  text,
  kind: 'trade',
});
const markup = (world: ReturnType<typeof createWorld>) =>
  renderToStaticMarkup(createElement(Economy, { world }));

describe('chart-first economy', () => {
  it('bins exact receipts by simulation tick without inventing volume in retention gaps', () => {
    const receipts = [
      fill('a', 10, '3 food:2 sold for 4 gold each.'),
      fill('b', 10, '2 wood:1 sold for 7 gold each.'),
      fill('unknown', 14, 'historical trade text'),
      fill('c', 25, '1 food:2 sold for 9 gold each.'),
    ];
    const bins = retainedTradeBins(receipts);
    expect(bins).toHaveLength(8);
    expect(bins[0]).toEqual({ start: 10, end: 11, units: 5, gold: 26, fills: 2 });
    expect(bins[2]).toEqual({ start: 14, end: 15, units: 0, gold: 0, fills: 0 });
    expect(bins[7]).toEqual({ start: 24, end: 25, units: 1, gold: 9, fills: 1 });
    expect(bins.reduce((sum, b) => sum + b.units, 0)).toBe(6);
  });

  it('handles empty history and a single-tick receipt interval exactly', () => {
    expect(retainedTradeBins([])).toEqual([]);
    expect(retainedTradeBins([fill('one', 4, '2 fibre:1 sold for 0 gold each.')])).toEqual([
      { start: 4, end: 4, units: 2, gold: 0, fills: 1 },
    ]);
  });

  it('shows all configured tiers and accurate numeric stock labels, even at zero', () => {
    const world = createWorld({ population: 1 });
    world.deposits = {};
    const c = Object.values(world.citizens)[0]!;
    c.inventory = { 'wood:1': 8, 'axe:1': 1 };
    dispatch(world, c.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 3, price: 9 });
    world.deposits.wood = {
      id: 'wood',
      resource: 'wood',
      tier: 1,
      x: 1,
      y: 1,
      stock: 20,
      capacity: 20,
      regrowAt: 0,
    };
    const html = markup(world);
    expect(html).toContain('wood T1: 5 carried, 3 held, 20 ground');
    for (const tier of TIERS) expect(html).toContain(`food T${tier}: 0 carried, 0 held, 0 ground`);
    expect(economySummary(world).stock['axe:1']?.carried).toBe(1);
    expect(html).toContain('Stack lengths share a scale within each resource');
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).not.toContain('min-width:');
  });

  it('starts with stock charts and keeps definitions in a closed chart guide', () => {
    const html = markup(createWorld({ population: 1 }));
    const lead = html.slice(0, html.indexOf('aria-label="Resource stock chart"'));
    expect(lead).toContain('economy-metrics');
    expect(lead).not.toContain('eco-note');
    expect(html).toContain('<details class="eco-chart-guide"><summary>Chart guide</summary>');
    expect(html).toContain('Held = work inputs (including suspended work) + sell escrow.');
    expect(html).toContain('Carried tools counted once; loot excluded.');
    expect(html).toContain('Travel reservations count as station use.');
    expect(html).toContain('gaps may be omitted by retention');
    expect(html).toContain('eco-stock-total');
    expect(html).not.toContain('<details open');
  });

  it('pairs offered and wanted units while keeping absent quotes distinct from zero', () => {
    const world = createWorld({ population: 2 });
    const [a, b] = Object.values(world.citizens);
    a!.inventory = { 'wood:1': 5 };
    b!.gold = 100;
    dispatch(world, a!.id, { type: 'order', side: 'sell', item: 'wood:1', quantity: 4, price: 9 });
    dispatch(world, b!.id, { type: 'order', side: 'buy', item: 'food:1', quantity: 3, price: 2 });
    expect(economySummary(world).quotes).toEqual([
      { item: 'food:1', bid: 2, demand: 3, supply: 0 },
      { item: 'wood:1', ask: 9, demand: 0, supply: 4 },
    ]);
    const html = markup(world);
    expect(html).toContain('Market offered and wanted chart');
    expect(html).toContain('eco-offered');
    expect(html).toContain('eco-wanted');
    expect(html).toContain('<th>food:1</th><td>2</td><td>—</td>');
    expect(html).toContain('<th>wood:1</th><td>—</td><td>9</td>');
  });

  it('keeps charts visible and exact work phases collapsed, aggregating active commands', () => {
    const world = createWorld({ population: 2 });
    const [a, b] = Object.values(world.citizens);
    a!.action = {
      id: 'one',
      command: { type: 'craft', item: 'knife', tier: 1 },
      phase: 'work',
      startedTick: 0,
      elapsed: 1,
      duration: 5,
      reserved: {},
      path: [],
      target: { x: 1, y: 1 },
    };
    b!.action = { ...a!.action!, id: 'two', phase: 'travel' };
    expect(economySummary(world).activity.get('craft')).toBe(2);
    const html = markup(world);
    expect(html).toContain('<span>craft</span>');
    expect(html).toContain('craft knife T1 · work');
    expect(html).toContain('craft knife T1 · travel');
    expect(html).toContain('<details><summary>Work phases &amp; station details</summary>');
    expect(html).not.toContain('<details open');
  });

  it('bounds history, excludes future and unknown receipts, and separates executions from quotes', () => {
    const world = createWorld({ population: 1 });
    world.tick = 50;
    world.significantEvents = [
      fill('a', 12, '3 food:2 sold for 4 gold each.'),
      fill('unknown', 30, 'unknown wording'),
      fill('future', 51, '100 food:2 sold for 9 gold each.'),
    ];
    const html = markup(world);
    expect(html).toContain('3 decoded units · 2 retained trade fills');
    expect(html).toContain('Ticks 12–30.');
    expect(html).toContain('1 unrecognized records excluded');
    expect(html).toContain('execution prices, not current quotes');
    expect(html).toContain('not proof of no trading');
    expect(html).not.toContain('100 food:2 sold');
    expect(html).toContain('Snapshot · tick 50');
  });

  it('renders empty population, empty stock and empty market without fake marks', () => {
    const world = createWorld({ population: 1 });
    world.citizens = {};
    world.deposits = {};
    world.orders = {};
    world.events = [];
    world.significantEvents = [];
    const html = markup(world);
    expect(html).toContain('No living citizens.');
    expect(html).toContain('No public quotes available');
    expect(html).toContain('No retained trade receipts.');
    expect(html).toContain('width:0%');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
