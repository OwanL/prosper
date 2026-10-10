import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnalyticsPanel, { analyticsSummary } from '../src/ui/AnalyticsPanel';
import HistoryCharts, {
  analyticsCharts,
  lineSegments,
  overviewCharts,
} from '../src/ui/HistoryCharts';
import type { GlobalHistory, MarketSample } from '../src/shared/telemetry-types';
import { createWorld } from '../src/world/core';

const sample: MarketSample = {
  bid: null,
  ask: 3,
  lastPrice: 99,
  lastTick: 1,
  supply: 4,
  demand: 6,
  carried: 8,
  held: 2,
  ground: 40,
  units: 0,
  turnover: 0,
  fills: 0,
};
const history: GlobalHistory = {
  runId: 'analytics',
  tick: 97,
  startedTick: 37,
  cadence: 20,
  limit: 256,
  frames: [
    { tick: 37, population: 2, meanHealth: 90, meanFullness: 70, markets: { 'food:1': sample } },
    { tick: 57, population: 0, meanHealth: 0, meanFullness: 0, markets: {} },
    {
      tick: 97,
      population: 3,
      meanHealth: 80,
      meanFullness: 60,
      markets: { 'food:1': { ...sample, bid: 0, units: 2, turnover: 6 } },
    },
  ],
};

describe('analytics drawer semantics', () => {
  it('uses retained population and separate health/fullness, without a fabricated wellbeing score', () => {
    const charts = overviewCharts(history);
    expect(charts.map((chart) => chart.title)).toEqual(['Population', 'Average wellbeing']);
    expect(charts[0]!.ticks).toEqual([37, 57, 97]);
    expect(charts[0]!.series[0]!.values).toEqual([2, 0, 3]);
    expect(charts[1]!.series.map((row) => row.values)).toEqual([
      [90, null, 80],
      [70, null, 60],
    ]);
    expect(
      overviewCharts({ ...history, frames: [] }).every(
        (chart) => chart.ticks.length === 0 && chart.series.every((row) => !row.values.length),
      ),
    ).toBe(true);
  });
  it('keeps malformed or absent aggregate values missing', () => {
    const invalid = {
      ...history,
      frames: [
        { ...history.frames[0]!, meanHealth: NaN, meanFullness: undefined as unknown as number },
      ],
    };
    expect(overviewCharts(invalid)[1]!.series.map((row) => row.values)).toEqual([[null], [null]]);
  });
  it('leaves skipped sampling windows as gaps rather than interpolating missing ticks', () => {
    expect(
      lineSegments(
        [37, 57, 97],
        [2, 0, 3],
        (tick) => tick,
        (value) => value,
        20,
      ),
    ).toEqual(['M37,2 L57,0', 'M97,3']);
  });
  it('defaults markets to combined bid/ask with separate simple trade metrics and no stale-price substitution', () => {
    const charts = analyticsCharts(history, 'food:1', ['food:1'], 'markets');
    expect(charts.map((chart) => chart.title)).toEqual([
      'Bid / ask comparison',
      'Price',
      'Trade volume',
      'Trade turnover',
    ]);
    expect(charts[0]!.series.map((row) => row.values)).toEqual([
      [null, null, 0],
      [3, null, 3],
    ]);
    expect(charts[0]!.series[0]!.dash).toBeUndefined();
    expect(charts[0]!.series[1]!.dash).toBe('5 3');
    expect(charts[2]!.series[0]!.values).toEqual([0, null, 2]);
    expect(charts[3]!.series[0]!.unit).toBe('gold / window');
  });
  it('resources expose stock and open orders, not invented missing stock', () => {
    const charts = analyticsCharts(history, 'food:1', [], 'resources');
    expect(charts.map((chart) => chart.title)).toEqual(['Stock', 'Open supply / demand']);
    expect(charts[0]!.series.map((row) => row.values)).toEqual([
      [8, null, 8],
      [2, null, 2],
      [40, null, 40],
    ]);
    expect(charts[1]!.series.map((row) => row.label)).toEqual([
      'Open sell offers',
      'Open buy demand',
    ]);
  });
  it('current summary counts living citizens only and makes no average for an empty population', () => {
    const world = createWorld({ runId: 'analytics' });
    Object.values(world.citizens).forEach((citizen, i) => {
      citizen.alive = i < 2;
      citizen.health = i === 0 ? 80 : 60;
      citizen.fullness = i === 0 ? 50 : 70;
    });
    expect(analyticsSummary(world)).toMatchObject({
      population: 2,
      meanHealth: 70,
      meanFullness: 60,
    });
    Object.values(world.citizens).forEach((citizen) => {
      citizen.alive = false;
    });
    expect(analyticsSummary(world)).toEqual({
      population: 0,
      meanHealth: null,
      meanFullness: null,
      working: 0,
    });
  });
  it('renders accessible sections, current cards, and loading rather than invented history', () => {
    const world = createWorld({ runId: 'analytics' });
    const markup = renderToStaticMarkup(createElement(AnalyticsPanel, { world }));
    expect(markup).toContain('role="tablist"');
    for (const title of ['Overview', 'Markets', 'Resources'])
      expect(markup).toContain(`>${title}</button>`);
    expect(markup).toContain('Current world summary');
    expect(markup).toContain('Loading recorded history');
    expect(markup).not.toContain('<svg');
    expect(markup).not.toContain('Current order book');
    const hidden = renderToStaticMarkup(createElement(AnalyticsPanel, { world, knowledge: true }));
    expect(hidden).toContain('hidden in citizen knowledge view');
    expect(hidden).not.toContain('history-charts');
    const citizen = renderToStaticMarkup(
      createElement(HistoryCharts, { world, scope: 'citizen', view: 'markets' }),
    );
    expect(citizen).not.toContain('history-analytics');
    expect(citizen).toContain('Select a citizen');
  });
});
