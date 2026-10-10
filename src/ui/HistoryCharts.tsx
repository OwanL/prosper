import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { TIERS, type World } from '../shared/types';
import {
  HISTORY_CADENCE,
  type CitizenHistory,
  type GlobalHistory,
  type HistoryMeta,
} from '../shared/telemetry-types';
import { marketQuotes } from './story';
import { bidAskComparison, commodityColor } from './price-comparison';
import './history.css';

export interface HistoryChartsProps {
  world: World;
  selectedId?: string;
  scope: 'global' | 'citizen';
  enabled?: boolean;
  /** Drawer-specific metric choices; omitted preserves the compact dock. */
  view?: 'overview' | 'markets' | 'resources';
}
export interface ChartSeries {
  key: string;
  label: string;
  unit: string;
  color: string;
  values: (number | null)[];
  bars?: boolean;
  dash?: string;
}
export interface HistoryChart {
  title: string;
  ticks: number[];
  series: ChartSeries[];
  notes?: string[];
}
const colors = ['#65d9cf', '#ecb967', '#ac9eff', '#ef8194', '#91bcf5'];
const number = (value: number | null | undefined) => (value == null ? '—' : String(value));
const valid = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function sampleWindow(tick: number, meta?: Pick<HistoryMeta, 'startedTick' | 'cadence'>) {
  return Math.floor((tick - (meta?.startedTick ?? 0)) / (meta?.cadence ?? HISTORY_CADENCE));
}
export function historyItems(history?: GlobalHistory, world?: World) {
  return [
    ...new Set([
      ...['food', 'wood', 'fibre', 'axe', 'scythe', 'knife', 'sword'].flatMap((item) =>
        TIERS.map((tier) => `${item}:${tier}`),
      ),
      ...Object.values(world?.orders ?? {}).map((order) => order.item),
      ...(history?.frames.flatMap((frame) => Object.keys(frame.markets)) ?? []),
    ]),
  ];
}
/** Null and missing samples split paths; dead citizens do not get a fabricated zero balance. */
export function lineSegments(
  ticks: number[],
  values: (number | null)[],
  x: (tick: number) => number,
  y: (value: number) => number,
  cadence?: number,
) {
  const segments: string[] = [];
  let current = '';
  ticks.forEach((tick, i) => {
    const value = values[i];
    if (!valid(value)) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    if (cadence && i > 0 && tick - ticks[i - 1]! > cadence) {
      if (current) segments.push(current);
      current = '';
    }
    current += `${current ? ' L' : 'M'}${x(tick)},${y(value)}`;
  });
  if (current) segments.push(current);
  return segments;
}
export function globalCharts(history: GlobalHistory, item: string): HistoryChart[] {
  const ticks = history.frames.map((frame) => frame.tick);
  const market = (keys: string[], labels: string[], unit: string, bars = false): ChartSeries[] =>
    keys.map((key, i) => ({
      key,
      label: labels[i]!,
      unit,
      color: colors[i]!,
      bars: bars && i === 0,
      values: history.frames.map((frame) => {
        const row = frame.markets[item];
        return row ? (row[key as keyof typeof row] ?? null) : null;
      }),
    }));
  return [
    {
      title: 'Price',
      ticks,
      series: market(['bid', 'ask', 'lastPrice'], ['Bid', 'Ask', 'Last execution'], 'gold / unit'),
      notes: history.frames.map((frame) => {
        const tick = frame.markets[item]?.lastTick;
        return tick == null
          ? 'No recorded execution'
          : `Last execution at tick ${tick} (not a current quote)`;
      }),
    },
    {
      title: 'Trade windows',
      ticks,
      series: [
        market(['units'], ['Traded units'], 'units / window', true)[0]!,
        { ...market(['turnover'], ['Turnover'], 'gold / window')[0]!, color: colors[1]! },
      ],
    },
    {
      title: 'Stock',
      ticks,
      series: market(['carried', 'held', 'ground'], ['Carried', 'Held', 'Ground'], 'units'),
    },
    {
      title: 'Order book',
      ticks,
      series: market(['supply', 'demand'], ['Offered', 'Wanted'], 'units'),
    },
  ];
}
export function overviewCharts(history: GlobalHistory): HistoryChart[] {
  const ticks = history.frames.map((frame) => frame.tick);
  const series = (
    key: 'population' | 'meanHealth' | 'meanFullness',
    label: string,
    unit: string,
    color: string,
  ): ChartSeries => ({
    key,
    label,
    unit,
    color,
    values: history.frames.map((frame) =>
      key !== 'population' && !(frame.population > 0)
        ? null
        : valid(frame[key])
          ? frame[key]
          : null,
    ),
  });
  return [
    {
      title: 'Population',
      ticks,
      series: [series('population', 'Living citizens', 'citizens', colors[0]!)],
    },
    {
      title: 'Average wellbeing',
      ticks,
      series: [
        series('meanHealth', 'Average health', '/ 100', colors[0]!),
        series('meanFullness', 'Average fullness', '/ 100', colors[1]!),
      ],
    },
  ];
}

/** One retained history response powers all three drawer sections. */
export function analyticsCharts(
  history: GlobalHistory,
  item: string,
  comparedItems: string[],
  view: NonNullable<HistoryChartsProps['view']>,
): HistoryChart[] {
  if (view === 'overview') return overviewCharts(history);
  const charts = globalCharts(history, item);
  if (view === 'resources')
    return charts.slice(2).map((chart) =>
      chart.title === 'Order book'
        ? {
            ...chart,
            title: 'Open supply / demand',
            series: chart.series.map((row) => ({
              ...row,
              label: row.key === 'supply' ? 'Open sell offers' : 'Open buy demand',
            })),
          }
        : chart,
    );
  const trade = charts[1]!;
  return [
    bidAskComparison(history, comparedItems),
    charts[0]!,
    { ...trade, title: 'Trade volume', series: [trade.series[0]!] },
    { ...trade, title: 'Trade turnover', series: [{ ...trade.series[1]!, bars: true }] },
  ];
}

export function citizenCharts(history: CitizenHistory): HistoryChart[] {
  const ticks = history.points.map((point) => point.tick);
  const series = (
    keys: ('cash' | 'escrow' | 'holdings' | 'health' | 'fullness')[],
    labels: string[],
    unit: string,
  ) =>
    keys.map((key, i): ChartSeries => ({
      key,
      label: labels[i]!,
      color: colors[i]!,
      unit,
      values: history.points.map((point) =>
        !point.alive ? null : key === 'holdings' ? point.cash + point.escrow : point[key],
      ),
    }));
  return [
    {
      title: 'Gold holdings',
      ticks,
      series: series(
        ['holdings', 'cash', 'escrow'],
        ['Cash + escrow', 'Cash', 'Buy escrow'],
        'gold',
      ),
    },
    {
      title: 'Vitals',
      ticks,
      series: series(['health', 'fullness'], ['Health', 'Fullness'], '/ 100'),
    },
  ];
}

function Plot({
  chart,
  cadence,
  sampledGaps = false,
  groupQuotes = false,
}: {
  chart: HistoryChart;
  cadence: number;
  sampledGaps?: boolean;
  groupQuotes?: boolean;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const pointerFocus = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 450, height: 145 });
  useEffect(() => {
    if (!svg.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0)
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
    });
    observer.observe(svg.current);
    return () => observer.disconnect();
  }, []);
  const id = useId();
  const { ticks, series } = chart;
  const legend = groupQuotes
    ? series
        .filter((row) => row.key.endsWith('/bid'))
        .map((row) => ({ ...row, label: row.label.replace(/ bid$/, '') }))
    : series;
  // Mixed units use independent named axes, never put gold and units on one scale.
  const units = [...new Set(series.map((row) => row.unit))];
  const maxima = new Map(units.map((unit) => [unit, unit === '/ 100' ? 100 : 1]));
  for (const row of series)
    for (const value of row.values)
      if (valid(value)) maxima.set(row.unit, Math.max(maxima.get(row.unit)!, value));
  const max = (unit: string) => maxima.get(unit)!;
  const lo = ticks[0] ?? 0,
    hi = ticks.at(-1) ?? lo;
  const right = Math.max(43, size.width - 48);
  const bottom = size.height - 32;
  const x = (tick: number) =>
    hi === lo ? (42 + right) / 2 : 42 + ((tick - lo) / (hi - lo)) * (right - 42);
  const y = (value: number, unit: string) => bottom - (value / max(unit)) * (bottom - 23);
  const index = cursor == null ? null : Math.min(cursor, ticks.length - 1);
  return (
    <section
      className={`history-plot${chart.title === 'Bid / ask comparison' ? ' history-comparison-plot' : ''}`}
      aria-label={`${chart.title} chart`}
    >
      <h4>{chart.title}</h4>
      <div className="history-legend">
        {legend.map((row) => (
          <span key={row.key}>
            <i
              className={row.dash ? 'history-swatch-dashed' : undefined}
              style={row.dash ? { borderColor: row.color } : { background: row.color }}
            />
            {row.label}
          </span>
        ))}
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label={`${chart.title}, ticks ${lo} to ${hi}. Exact values in the sample cursor and table.`}
      >
        <path className="history-axis" d={`M42,23V${bottom}H${right}`} />
        {units.map((unit, i) => (
          <g key={unit} className="history-axis-label">
            <text x={i ? right + 4 : 3} y="20">
              {max(unit).toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </text>
            <text x={i ? right + 4 : 3} y={bottom + 1}>
              0
            </text>
          </g>
        ))}
        <text className="history-axis-label" x="42" y={size.height - 7}>
          t{lo}
        </text>
        <text className="history-axis-label" x={right} y={size.height - 7} textAnchor="end">
          t{hi}
        </text>
        {series.map((row) => (
          <g key={row.key} data-series={row.key} stroke={row.color} fill={row.color}>
            {row.bars ? (
              row.values.map(
                (value, i) =>
                  valid(value) && (
                    <rect
                      key={i}
                      x={x(ticks[i]!) - 2}
                      y={y(value, row.unit)}
                      width="4"
                      height={bottom - y(value, row.unit)}
                      stroke="none"
                      opacity=".7"
                    />
                  ),
              )
            ) : (
              <>
                {lineSegments(
                  ticks,
                  row.values,
                  x,
                  (value) => y(value, row.unit),
                  sampledGaps ? cadence : undefined,
                ).map((d, i) => (
                  <path key={i} d={d} fill="none" strokeWidth="1.5" strokeDasharray={row.dash} />
                ))}
                {row.values.map(
                  (value, i) =>
                    valid(value) && (
                      <circle
                        key={i}
                        cx={x(ticks[i]!)}
                        cy={y(value, row.unit)}
                        r="1.8"
                        stroke="none"
                      />
                    ),
                )}
              </>
            )}
          </g>
        ))}
        {index != null && (
          <path className="history-cursor" d={`M${x(ticks[index]!)},23V${bottom}`} />
        )}
        {ticks.map((tick, i) => (
          <rect
            key={tick}
            x={x(tick) - Math.max(3, (right - 42) / (2 * Math.max(1, ticks.length)))}
            y="23"
            width={Math.max(6, (right - 42) / Math.max(1, ticks.length))}
            height={bottom - 23}
            fill="transparent"
            onMouseEnter={() => setCursor(i)}
            onMouseLeave={() => setCursor(null)}
          />
        ))}
      </svg>
      <div className="history-units">
        {units.map((unit, i) => (
          <span key={unit}>
            {units.length > 1 ? `${i ? 'Right' : 'Left'}: ` : ''}
            {unit}
          </span>
        ))}
      </div>
      <label className="history-scrubber">
        Sample{' '}
        <input
          type="range"
          aria-label={`${chart.title} sample cursor`}
          aria-describedby={id}
          min="0"
          max={Math.max(0, ticks.length - 1)}
          value={index ?? Math.max(0, ticks.length - 1)}
          onPointerDown={() => {
            pointerFocus.current = true;
          }}
          onPointerUp={(event) => {
            pointerFocus.current = false;
            setCursor(Number(event.currentTarget.value));
          }}
          onPointerCancel={() => {
            pointerFocus.current = false;
          }}
          onFocus={(event) => {
            if (!pointerFocus.current) setCursor(Number(event.currentTarget.value));
          }}
          onBlur={() => {
            pointerFocus.current = false;
            setCursor(null);
          }}
          onChange={(event) => setCursor(Number(event.target.value))}
        />
      </label>
      <div
        id={id}
        className={`history-tooltip${index == null ? ' history-tooltip-idle' : ''}`}
        role={index == null ? undefined : 'tooltip'}
        aria-live="polite"
      >
        {index == null ? (
          <span>Hover / focus for exact samples</span>
        ) : (
          <>
            <strong>Tick {ticks[index]}</strong>
            {series.map((row) => (
              <span key={row.key}>
                {row.label}: <b>{number(row.values[index])}</b> {row.unit}
              </span>
            ))}
            {chart.notes?.[index] && <small>{chart.notes[index]}</small>}
            {series.some((row) => row.bars) && (
              <small>
                Window ending at t{ticks[index]} · cadence {cadence}
              </small>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ExactTable({ charts }: { charts: HistoryChart[] }) {
  const choices = charts.flatMap((chart) =>
    chart.series.map((row) => ({ ...row, ticks: chart.ticks, title: chart.title })),
  );
  const [key, setKey] = useState('');
  const selected = choices.find((row) => `${row.title}/${row.key}` === key) ?? choices[0];
  return (
    <details className="history-table">
      <summary>Exact samples</summary>
      <label>
        Series{' '}
        <select
          aria-label="Exact sample series"
          value={selected ? `${selected.title}/${selected.key}` : ''}
          onChange={(event) => setKey(event.target.value)}
        >
          {choices.map((row) => (
            <option key={`${row.title}/${row.key}`} value={`${row.title}/${row.key}`}>
              {row.title} · {row.label} ({row.unit})
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <table>
          <caption>
            {selected.label} · {selected.unit} · — = absent quote / unavailable / dead
          </caption>
          <thead>
            <tr>
              <th>Tick</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {selected.ticks.map((tick, i) => (
              <tr key={tick}>
                <th scope="row">{tick}</th>
                <td>{number(selected.values[i])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

function ComparisonPicker({
  items,
  selected,
  change,
}: {
  items: string[];
  selected: string[];
  change: (items: string[]) => void;
}) {
  const groups = [...new Set(items.map((value) => value.split(':')[0]!))];
  return (
    <details className="history-picker">
      <summary>Commodities · {selected.length} selected</summary>
      <div className="history-picker-actions">
        <button type="button" onClick={() => change(items)}>
          Select all
        </button>
        <button type="button" onClick={() => change([])}>
          Clear all
        </button>
        <span>Each checkbox shows both sides. Solid = bid; dashed = ask.</span>
      </div>
      <div className="history-commodity-groups">
        {groups.map((group) => (
          <fieldset key={group}>
            <legend>{group}</legend>
            {items
              .filter((value) => value.split(':')[0] === group)
              .map((value) => (
                <label
                  key={value}
                  style={{ '--commodity-color': commodityColor(value) } as CSSProperties}
                >
                  <input
                    type="checkbox"
                    aria-label={value}
                    checked={selected.includes(value)}
                    onChange={(event) =>
                      change(
                        event.target.checked
                          ? [...selected, value]
                          : selected.filter((item) => item !== value),
                      )
                    }
                  />
                  {/^[0-9]+$/.test(value.split(':')[1] ?? '')
                    ? `T${value.split(':')[1]}`
                    : value.slice(group.length + 1)}
                </label>
              ))}
          </fieldset>
        ))}
      </div>
    </details>
  );
}

export function HistoryCharts({
  world,
  selectedId,
  scope,
  enabled = true,
  view,
}: HistoryChartsProps) {
  const activeView = scope === 'global' ? view : undefined;
  const identity = `${world.runId}/${scope}/${scope === 'citizen' ? (selectedId ?? '') : ''}`;
  const [result, setResult] = useState<{
    identity: string;
    data?: GlobalHistory | CitizenHistory;
    error?: string;
    loading?: boolean;
  }>();
  const [item, setItem] = useState('food:1');
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const metric = metrics[activeView ?? scope] ?? '';
  const setMetric = (value: string) =>
    setMetrics((previous) => ({ ...previous, [activeView ?? scope]: value }));
  const [comparedItems, setComparedItems] = useState<string[]>(['food:1', 'wood:1', 'fibre:1']);
  const lastRequest = useRef<{ identity: string; tick: number } | null>(null);
  const data = result?.identity === identity ? result.data : undefined;
  const window = sampleWindow(world.tick, data);
  useEffect(() => {
    if (!enabled || (scope === 'citizen' && !selectedId)) {
      lastRequest.current = null;
      return;
    }
    const last = lastRequest.current;
    if (last?.identity === identity && sampleWindow(last.tick, data) === window) return;
    lastRequest.current = { identity, tick: world.tick };
    const controller = new AbortController();
    let obsolete = false;
    let settled = false;
    setResult((previous) => ({
      identity,
      data: previous?.identity === identity ? previous.data : undefined,
      loading: true,
    }));
    const url =
      scope === 'global'
        ? '/api/history/global'
        : `/api/citizens/${encodeURIComponent(selectedId!)}/history`;
    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`History unavailable (HTTP ${response.status})`);
        const incoming = (await response.json()) as GlobalHistory | CitizenHistory;
        if (
          incoming.runId !== world.runId ||
          (scope === 'citizen' && (!('citizenId' in incoming) || incoming.citizenId !== selectedId))
        )
          throw new Error('History belongs to another run or citizen');
        if (
          !Number.isFinite(incoming.startedTick) ||
          !(incoming.cadence > 0) ||
          !(incoming.limit > 0) ||
          (scope === 'global'
            ? !('frames' in incoming) || !Array.isArray(incoming.frames)
            : !('points' in incoming) || !Array.isArray(incoming.points))
        )
          throw new Error('Invalid history response');
        settled = true;
        if (!obsolete) setResult({ identity, data: incoming });
      })
      .catch((error: unknown) => {
        settled = true;
        if (!obsolete && !controller.signal.aborted)
          setResult((previous) => ({
            identity,
            data: previous?.identity === identity ? previous.data : undefined,
            error: error instanceof Error ? error.message : 'History unavailable',
          }));
      });
    return () => {
      obsolete = true;
      controller.abort();
      if (!settled) lastRequest.current = null;
    };
    // Tick updates are intentionally coalesced into actual sampling windows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, identity, window]);
  if (!enabled) return null;
  if (scope === 'citizen' && !selectedId)
    return (
      <section className="history-charts">
        <p>Select a citizen to view history.</p>
      </section>
    );
  const global = data && 'frames' in data ? data : undefined;
  const items = historyItems(global, world);
  const chosenItem = items.includes(item) ? item : items[0]!;
  const charts = data
    ? 'frames' in data
      ? activeView
        ? analyticsCharts(data, chosenItem, comparedItems, activeView)
        : [...globalCharts(data, chosenItem), bidAskComparison(data, comparedItems)]
      : citizenCharts(data)
    : [];
  const chart = charts.find((candidate) => candidate.title === metric) ?? charts[0];
  const comparing = scope === 'global' && chart?.title === 'Bid / ask comparison';
  const ticks = charts[0]?.ticks ?? [];
  const quote = marketQuotes(Object.values(world.orders)).find((row) => row.item === chosenItem);
  return (
    <section
      className={`history-charts history-${scope}${activeView ? ` history-analytics history-view-${activeView}` : ''}`}
      aria-label={scope === 'global' ? 'Global history' : 'Citizen history'}
    >
      <header className="history-toolbar">
        {scope === 'global' && activeView === 'overview' ? null : scope === 'global' ? (
          comparing ? (
            <ComparisonPicker items={items} selected={comparedItems} change={setComparedItems} />
          ) : activeView && /^\w+:\d+$/.test(chosenItem) ? (
            <div className="history-item-selectors">
              <label>
                Commodity{' '}
                <select
                  aria-label="History commodity"
                  value={chosenItem.split(':')[0]}
                  onChange={(event) =>
                    setItem(
                      items.find(
                        (value) => value === `${event.target.value}:${chosenItem.split(':')[1]}`,
                      ) ?? items.find((value) => value.split(':')[0] === event.target.value)!,
                    )
                  }
                >
                  {[...new Set(items.map((value) => value.split(':')[0]!))].map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </select>
              </label>
              <label>
                Tier{' '}
                <select
                  aria-label="History tier"
                  value={chosenItem.split(':')[1]}
                  onChange={(event) => setItem(`${chosenItem.split(':')[0]}:${event.target.value}`)}
                >
                  {items
                    .filter((value) => value.split(':')[0] === chosenItem.split(':')[0])
                    .map((value) => (
                      <option key={value} value={value.split(':')[1]}>
                        T{value.split(':')[1]}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          ) : (
            <label>
              Commodity{' '}
              <select
                aria-label="History commodity"
                value={chosenItem}
                onChange={(event) => setItem(event.target.value)}
              >
                {items.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          )
        ) : (
          <strong>{world.citizens[selectedId!]?.name ?? selectedId} · gold & vitals</strong>
        )}
        {!!charts.length && (
          <label>
            Metric{' '}
            <select
              aria-label="History metric"
              value={chart?.title ?? ''}
              onChange={(event) => setMetric(event.target.value)}
            >
              {charts.map((candidate) => (
                <option key={candidate.title}>{candidate.title}</option>
              ))}
            </select>
          </label>
        )}
        {data && (
          <span
            title={`Recording began at tick ${data.startedTick}. Every ${data.cadence} ticks; at most ${data.limit} samples retained. No reconstruction before recording. Gold holdings exclude inventory value. Trade units and turnover are per sample window, not lifetime totals. Last execution is the last known receipt, not a current quote.`}
          >
            t{ticks[0] ?? data.startedTick}–{ticks.at(-1) ?? data.startedTick} · every{' '}
            {data.cadence}t
            <span className="history-recording">
              {' '}
              · ≤{data.limit} samples · recording from t{data.startedTick}
            </span>
          </span>
        )}
        {result?.identity === identity && result.loading && <span role="status">Updating…</span>}
      </header>
      {result?.identity === identity && result.error && (
        <p role="alert">
          {result.error}
          {data ? ' · Retained samples below may be stale.' : ''}
        </p>
      )}
      {comparing && (
        <div className="history-book">
          Sampled best quotes · gold / unit · solid bid / dashed ask · missing quotes are gaps
        </div>
      )}
      {scope === 'global' && activeView !== 'overview' && !comparing && (
        <div className="history-book" aria-label="Current order book">
          Now t{world.tick} · bid {number(quote?.bid)} / ask {number(quote?.ask)} · mid{' '}
          {quote?.bid != null && quote.ask != null ? number((quote.bid + quote.ask) / 2) : '—'}{' '}
          gold/unit · offered {quote?.supply ?? 0} / wanted {quote?.demand ?? 0} units
        </div>
      )}
      {!data && !(result?.identity === identity && result.error) && (
        <p role="status">Loading recorded history…</p>
      )}
      {data && !ticks.length && (
        <p>
          No recorded samples yet. Recording starts at tick {data.startedTick}; older history is
          unavailable.
        </p>
      )}
      {comparing &&
        comparedItems.length > 0 &&
        ticks.length > 0 &&
        chart?.series.every((row) => row.values.every((value) => value == null)) && (
          <p role="status">No bid / ask quotes recorded for the selected commodities.</p>
        )}
      {!!ticks.length && (
        <>
          <div className="history-grid">
            {comparing && !comparedItems.length ? (
              <p role="status">Select at least one commodity to compare bid / ask history.</p>
            ) : (
              chart && (
                <Plot
                  key={`${identity}/${chosenItem}/${chart.title}`}
                  chart={chart}
                  cadence={data!.cadence}
                  sampledGaps={!!activeView}
                  groupQuotes={!!activeView && comparing}
                />
              )
            )}
          </div>
          {(!comparing || comparedItems.length > 0) && (
            <ExactTable
              charts={
                comparing
                  ? [chart!]
                  : charts.filter((candidate) => candidate.title !== 'Bid / ask comparison')
              }
            />
          )}
        </>
      )}
      {activeView && data && (
        <details className="history-retention">
          <summary>About these samples</summary>
          <p>
            Actual retained samples only · recording began at t{data.startedTick} · up to{' '}
            {data.limit} samples. Missing values and skipped sampling windows remain gaps; no
            earlier history is reconstructed.
            {activeView === 'markets' &&
              ' Trade volume and turnover count settlements per recorded window, not lifetime totals.'}
            {activeView === 'resources' &&
              ' Held stock is reserved for orders or work; ground stock is unharvested deposits, not immediately offered supply.'}
          </p>
        </details>
      )}
    </section>
  );
}

export default HistoryCharts;
