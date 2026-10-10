import type { GlobalHistory } from '../shared/telemetry-types';
import type { HistoryChart } from './HistoryCharts';

// Bright, separated hues remain legible against the chart's dark background.
const commodityPalette = [
  '#65d9cf',
  '#ecb967',
  '#ac9eff',
  '#ef8194',
  '#91bcf5',
  '#a8d878',
  '#f5a56c',
  '#e79fdb',
  '#73c5a1',
  '#d8d477',
  '#9ba9ef',
  '#e99aaf',
];

/** Hash the full item key (including its tier), never its selection position. */
export function commodityColor(item: string): string {
  let hash = 2166136261;
  for (let i = 0; i < item.length; i++) {
    hash = Math.imul(hash ^ item.charCodeAt(i), 16777619) >>> 0;
  }
  return commodityPalette[hash % commodityPalette.length]!;
}

/** Compare current quotes only; absent samples remain gaps, even after a trade. */
export function bidAskComparison(history: GlobalHistory, selectedItems: string[]): HistoryChart {
  return {
    title: 'Bid / ask comparison',
    ticks: history.frames.map((frame) => frame.tick),
    series: [...new Set(selectedItems)].flatMap((item) =>
      (['bid', 'ask'] as const).map((side) => ({
        key: `${item}/${side}`,
        label: `${item} ${side}`,
        unit: 'gold / unit',
        color: commodityColor(item),
        ...(side === 'ask' ? { dash: '5 3' } : {}),
        values: history.frames.map((frame) => frame.markets[item]?.[side] ?? null),
      })),
    ),
  };
}
