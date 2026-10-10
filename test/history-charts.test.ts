import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import HistoryCharts, {
  citizenCharts,
  globalCharts,
  historyItems,
  lineSegments,
  sampleWindow,
} from '../src/ui/HistoryCharts';
import { TIERS } from '../src/shared/types';
import type { CitizenHistory, GlobalHistory, MarketSample } from '../src/shared/telemetry-types';
import { createWorld } from '../src/world/core';

const meta = { runId: 'fixture', tick: 77, startedTick: 37, cadence: 20, limit: 256 };
const market: MarketSample = {
  bid: null,
  ask: 4,
  lastPrice: null,
  lastTick: null,
  supply: 3,
  demand: 0,
  carried: 5,
  held: 2,
  ground: 90,
  units: 0,
  turnover: 0,
  fills: 0,
};
const history: GlobalHistory = {
  ...meta,
  frames: [37, 57, 77].map((tick, i): GlobalHistory['frames'][number] => ({
    tick,
    population: 2,
    meanHealth: 100,
    meanFullness: 80,
    markets: i === 1 ? {} : { 'food:1': market, 'building:custom-station': market },
  })),
};

describe('historical chart semantics', () => {
  it('samples relative to recording start rather than every poll or a tick-zero origin', () => {
    expect(sampleWindow(37, meta)).toBe(0);
    expect(sampleWindow(56, meta)).toBe(0);
    expect(sampleWindow(57, meta)).toBe(1);
    expect(sampleWindow(76, meta)).toBe(1);
  });
  it('uses dynamic tiers and retains arbitrary recorded commodities', () => {
    expect(historyItems(history)).toContain(`sword:${TIERS.at(-1)}`);
    expect(historyItems(history)).toContain('building:custom-station');
  });
  it('keeps absent quotes absent, distinguishes missing stock from zero, and uses real ticks', () => {
    const charts = globalCharts(history, 'food:1');
    expect(charts[0]!.ticks).toEqual([37, 57, 77]);
    expect(charts[0]!.series[0]!.values).toEqual([null, null, null]);
    expect(charts[0]!.series[2]!.values).toEqual([null, null, null]);
    expect(charts[1]!.series[0]!.values).toEqual([0, null, 0]);
    expect(charts[1]!.series[0]!.bars).toBe(true);
    expect(charts[1]!.series.map((row) => row.unit)).toEqual(['units / window', 'gold / window']);
    expect(charts[2]!.series[1]!.values).toEqual([2, null, 2]);
  });
  it('splits paths on null rather than interpolating gaps', () => {
    expect(
      lineSegments(
        [10, 30, 50, 70],
        [2, null, 0, 3],
        (tick) => tick,
        (value) => value,
      ),
    ).toEqual(['M10,2', 'M50,0 L70,3']);
  });
  it('gold holdings mean cash + buy escrow, and dead points create gaps', () => {
    const personal: CitizenHistory = {
      ...meta,
      citizenId: 'citizen',
      points: [
        { tick: 37, alive: true, cash: 11, escrow: 5, health: 90, fullness: 67 },
        { tick: 57, alive: false, cash: 0, escrow: 0, health: 0, fullness: 0 },
      ],
    };
    const charts = citizenCharts(personal);
    expect(charts[0]!.series.map((row) => row.values)).toEqual([
      [16, null],
      [11, null],
      [5, null],
    ]);
    expect(charts[1]!.series[0]!.values).toEqual([90, null]);
  });
  it('does not render or fetch disabled views; makes no invented history for old worlds', () => {
    const world = createWorld({ runId: 'fixture' });
    expect(
      renderToStaticMarkup(
        createElement(HistoryCharts, { world, scope: 'global', enabled: false }),
      ),
    ).toBe('');
    const html = renderToStaticMarkup(createElement(HistoryCharts, { world, scope: 'global' }));
    expect(html).toContain('Loading recorded history');
    expect(html).not.toContain('<svg');
    expect(html).toContain('bid — / ask — · mid —');
  });
});
