import { describe, expect, it } from 'vitest';
import type { GlobalHistory, MarketSample } from '../src/shared/telemetry-types';
import { bidAskComparison, commodityColor } from '../src/ui/price-comparison';

function quote(bid: number | null, ask: number | null): MarketSample {
  return {
    bid,
    ask,
    lastPrice: 999,
    lastTick: 12,
    supply: 5,
    demand: 8,
    carried: 20,
    held: 3,
    ground: 50,
    units: 2,
    turnover: 1998,
    fills: 1,
  };
}

const marketFrames: Pick<GlobalHistory['frames'][number], 'tick' | 'markets'>[] = [
  { tick: 37, markets: { 'food:1': quote(2, 4), 'food:2': quote(7, 9), 'axe:3': quote(20, 25) } },
  { tick: 57, markets: { 'food:1': quote(null, 5), 'food:2': quote(8, null) } },
  { tick: 111, markets: { 'food:1': quote(0, 0), 'axe:3': quote(21, 30) } },
];

const history: GlobalHistory = {
  runId: 'comparison-fixture',
  tick: 111,
  startedTick: 37,
  cadence: 20,
  limit: 256,
  frames: marketFrames.map((frame) => ({
    ...frame,
    population: 2,
    meanHealth: 100,
    meanFullness: 80,
  })),
};

describe('bid / ask comparison', () => {
  it('keeps each item and tier separate with real retained ticks and quote units', () => {
    const chart = bidAskComparison(history, ['food:1', 'food:2', 'axe:3']);
    expect(chart.title).toBe('Bid / ask comparison');
    expect(chart.ticks).toEqual([37, 57, 111]);
    expect(chart.series.map(({ key, label, unit }) => ({ key, label, unit }))).toEqual(
      ['food:1', 'food:2', 'axe:3'].flatMap((item) =>
        ['bid', 'ask'].map((side) => ({
          key: `${item}/${side}`,
          label: `${item} ${side}`,
          unit: 'gold / unit',
        })),
      ),
    );
    expect(chart.series.map((row) => row.values)).toEqual([
      [2, null, 0],
      [4, 5, 0],
      [7, 8, null],
      [9, null, null],
      [20, null, 21],
      [25, null, 30],
    ]);
  });

  it('preserves null and missing samples, including entirely unrecorded items', () => {
    const chart = bidAskComparison(history, ['food:2', 'unrecorded:7']);
    expect(chart.series.map((row) => row.values)).toEqual([
      [7, 8, null],
      [9, null, null],
      [null, null, null],
      [null, null, null],
    ]);
    // Every fixture has a last execution; none substitutes for a missing quote.
    expect(chart.series.some((row) => row.values.includes(999))).toBe(false);
  });

  it('uses one color per commodity and dashes only the ask', () => {
    const chart = bidAskComparison(history, ['food:1', 'food:2', 'axe:3']);
    for (let i = 0; i < chart.series.length; i += 2) {
      const bid = chart.series[i]!;
      const ask = chart.series[i + 1]!;
      expect(bid.color).toBe(ask.color);
      expect(bid).not.toHaveProperty('dash');
      expect(ask).toHaveProperty('dash', '5 3');
    }
  });

  it('deduplicates selections in first-selected order without mutating inputs', () => {
    const selected = ['food:2', 'food:1', 'food:2', 'food:1'];
    const before = structuredClone(history);
    expect(bidAskComparison(history, selected).series.map((row) => row.key)).toEqual([
      'food:2/bid',
      'food:2/ask',
      'food:1/bid',
      'food:1/ask',
    ]);
    expect(selected).toEqual(['food:2', 'food:1', 'food:2', 'food:1']);
    expect(history).toEqual(before);
  });

  it('has no series without selections and invents no samples for empty history', () => {
    expect(bidAskComparison(history, [])).toEqual({
      title: 'Bid / ask comparison',
      ticks: [37, 57, 111],
      series: [],
    });
    const chart = bidAskComparison({ ...history, frames: [] }, ['food:1']);
    expect(chart.ticks).toEqual([]);
    expect(chart.series.map((row) => row.values)).toEqual([[], []]);
  });

  it('keeps deterministic commodity colors across reordered and subset selections', () => {
    const items = ['food:1', 'food:2', 'axe:3', 'building:custom-station'];
    const initial = bidAskComparison(history, items);
    const reordered = bidAskComparison(history, [...items].reverse());
    for (const item of items) {
      const color = commodityColor(item);
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(commodityColor(item)).toBe(color);
      for (const chart of [initial, reordered, bidAskComparison(history, [item])]) {
        expect(
          chart.series.filter((row) => row.key.startsWith(`${item}/`)).map((row) => row.color),
        ).toEqual([color, color]);
      }
    }
    expect(new Set(items.map(commodityColor)).size).toBeGreaterThan(1);
  });
});
