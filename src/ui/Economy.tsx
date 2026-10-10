import { TIERS, type World, type WorldEvent } from '../shared/types';
import { marketQuotes } from './story';
import './economy.css';

// Only exact dispatcher receipts establish completed volume or execution prices.
export function tradeReceipt(event: WorldEvent) {
  const match = /^(\d+) (\S+) sold for (\d+) gold each\.$/.exec(event.text);
  if (!match) return null;
  const quantity = Number(match[1]);
  const price = Number(match[3]);
  if (
    !Number.isSafeInteger(quantity) ||
    !Number.isSafeInteger(price) ||
    !Number.isSafeInteger(quantity * price)
  )
    return null;
  return { quantity, item: match[2]!, price };
}

export function economySummary(world: World) {
  const living = Object.values(world.citizens).filter((c) => c.alive);
  const stock: Record<string, { carried: number; held: number; ground: number }> = {};
  const add = (item: string, field: 'carried' | 'held' | 'ground', quantity: number) => {
    const row = (stock[item] ??= { carried: 0, held: 0, ground: 0 });
    row[field] += quantity;
  };
  for (const c of living) {
    for (const [item, qty] of Object.entries(c.inventory)) add(item, 'carried', qty);
    for (const [item, qty] of Object.entries(c.action?.reserved ?? {})) add(item, 'held', qty);
    for (const [item, qty] of Object.entries(c.emergency?.suspendedAction?.reserved ?? {}))
      add(item, 'held', qty);
  }
  for (const order of Object.values(world.orders))
    for (const [item, qty] of Object.entries(order.escrowItems)) add(item, 'held', qty);
  for (const deposit of Object.values(world.deposits))
    add(`${deposit.resource}:${deposit.tier}`, 'ground', deposit.stock);
  const jobs = new Map<string, number>();
  const activity = new Map<string, number>();
  for (const c of living) {
    const command = c.action?.command;
    const detail =
      command?.type === 'refine'
        ? ` ${command.direction ?? 'up'} T${command.fromTier} → T${command.fromTier + (command.direction === 'down' ? -1 : 1)}`
        : command?.type === 'harvest' && world.deposits[command.depositId]
          ? ` ${world.deposits[command.depositId]!.resource} T${world.deposits[command.depositId]!.tier}`
          : command?.type === 'craft'
            ? ` ${command.item} T${command.tier}`
            : command?.type === 'build'
              ? ` ${command.kind} T${command.tier}`
              : '';
    const job = c.action ? `${c.action.command.type}${detail} · ${c.action.phase}` : 'idle';
    jobs.set(job, (jobs.get(job) ?? 0) + 1);
    const category = command?.type ?? 'idle';
    activity.set(category, (activity.get(category) ?? 0) + 1);
  }
  const stations = Object.values(world.buildings).filter((b) => b.kind !== 'wall' && b.health > 0);
  const operators = living.filter((c) => c.action?.command.type === 'refine');
  const used = new Set(
    operators.map((c) => (c.action?.command.type === 'refine' ? c.action.command.buildingId : '')),
  );
  const trades = (world.significantEvents ?? world.events).filter(
    (e) => e.kind === 'trade' && e.tick <= world.tick,
  );
  const volumes = new Map<
    string,
    { units: number; gold: number; lastPrice: number; tick: number }
  >();
  let unparsed = 0;
  for (const e of trades) {
    const receipt = tradeReceipt(e);
    if (!receipt) {
      unparsed++;
      continue;
    }
    const { quantity, item, price } = receipt;
    const row = volumes.get(item) ?? { units: 0, gold: 0, lastPrice: 0, tick: -1 };
    row.units += quantity;
    row.gold += quantity * price;
    if (e.tick >= row.tick) {
      row.lastPrice = price;
      row.tick = e.tick;
    }
    volumes.set(item, row);
  }
  return {
    living,
    stock,
    jobs,
    activity,
    stations,
    operators,
    used,
    trades,
    volumes,
    unparsed,
    quotes: marketQuotes(Object.values(world.orders)),
  };
}

/** Equal simulation-tick intervals within the retained receipt bounds, never wall time. */
export function retainedTradeBins(trades: WorldEvent[]) {
  if (!trades.length) return [];
  const start = Math.min(...trades.map((e) => e.tick));
  const end = Math.max(...trades.map((e) => e.tick));
  const width = Math.max(1, Math.ceil((end - start + 1) / 8));
  const bins = Array.from({ length: Math.ceil((end - start + 1) / width) }, (_, i) => ({
    start: start + i * width,
    end: Math.min(end, start + (i + 1) * width - 1),
    units: 0,
    gold: 0,
    fills: 0,
  }));
  for (const event of trades) {
    const receipt = tradeReceipt(event);
    if (!receipt) continue;
    const bin = bins[Math.floor((event.tick - start) / width)]!;
    bin.units += receipt.quantity;
    bin.gold += receipt.quantity * receipt.price;
    bin.fills++;
  }
  return bins;
}

const resources = ['food', 'wood', 'fibre'];
const stockFields = ['carried', 'held', 'ground'] as const;
const percent = (value: number, max: number) => `${max > 0 ? (value / max) * 100 : 0}%`;

function Bar({ value, max, kind }: { value: number; max: number; kind: string }) {
  return (
    <span className="eco-track" aria-hidden="true">
      <span className={`eco-fill eco-${kind}`} style={{ width: percent(value, max) }} />
    </span>
  );
}

export function Economy({ world }: { world: World }) {
  const data = economySummary(world);
  const hungry = data.living.filter((c) => c.fullness < 20).length;
  const noFood = data.living.filter(
    (c) => !Object.entries(c.inventory).some(([key, qty]) => key.startsWith('food:') && qty > 0),
  ).length;
  const bins = retainedTradeBins(data.trades);
  const maxTrade = Math.max(0, ...bins.map((b) => b.units));
  const maxMarket = Math.max(0, ...data.quotes.flatMap((q) => [q.supply, q.demand]));
  const maxWork = Math.max(0, ...data.activity.values());
  const totalUnits = [...data.volumes.values()].reduce((sum, row) => sum + row.units, 0);
  return (
    <section className="economy-view" aria-label="Economy overview" data-testid="economy-view">
      <header className="economy-heading">
        <h2>Economy</h2>
        <span className="eco-snapshot">Snapshot · tick {world.tick}</span>
      </header>
      <div className="economy-metrics">
        <span>
          <b>
            {data.living.filter((c) => c.action).length}/{data.living.length}
          </b>{' '}
          active
        </span>
        <span>
          <b>
            {data.used.size}/{data.stations.length}
          </b>{' '}
          stations in use
        </span>
        <span className={hungry ? 'danger' : ''}>
          <b>{hungry}</b> low fullness
        </span>
        <span>
          <b>{noFood}</b> without carried food
        </span>
      </div>
      <section className="eco-block" aria-label="Resource stock chart">
        <h3>
          Resource stock <small>units by tier</small>
        </h3>
        <div className="eco-legend">
          {stockFields.map((field) => (
            <span key={field}>
              <i className={`eco-${field}`} />
              {field}
            </span>
          ))}
        </div>
        <div className="eco-resources">
          {resources.map((resource) => {
            const rows = TIERS.map(
              (tier) => data.stock[`${resource}:${tier}`] ?? { carried: 0, held: 0, ground: 0 },
            );
            const max = Math.max(0, ...rows.map((row) => row.carried + row.held + row.ground));
            return (
              <div className="eco-resource" key={resource}>
                <h4>
                  {resource}
                  <small>scale 0–{max}</small>
                </h4>
                {TIERS.map((tier, i) => {
                  const row = rows[i]!;
                  return (
                    <div className="eco-stock-row" key={tier}>
                      <span>T{tier}</span>
                      <span className="eco-stack" aria-hidden="true">
                        {stockFields.map((field) => (
                          <span
                            key={field}
                            className={`eco-${field}`}
                            style={{ width: percent(row[field], max) }}
                          />
                        ))}
                      </span>
                      <span
                        className="eco-stock-values"
                        role="img"
                        aria-label={`${resource} T${tier}: ${row.carried} carried, ${row.held} held, ${row.ground} ground`}
                        title={`${row.carried} carried / ${row.held} held / ${row.ground} ground`}
                      >
                        <span className="eco-stock-breakdown">
                          {row.carried} / {row.held} / {row.ground}
                        </span>
                        <span className="eco-stock-total">{row.carried + row.held + row.ground}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className="eco-note">
          Scale per resource · wide-column counts are totals. Exact splits in labels & stock table.
        </p>
      </section>

      <section className="eco-block" aria-label="Current work chart">
        <h3>
          Current work <small>citizens by active command</small>
        </h3>
        {[...data.activity]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([job, count]) => (
            <div className="eco-bar-row" key={job}>
              <span>{job}</span>
              <Bar value={count} max={maxWork} kind="work" />
              <b>{count}</b>
            </div>
          ))}
        {!data.living.length && <p className="eco-note">No living citizens.</p>}
        <details>
          <summary>Work phases & station details</summary>
          <table>
            <caption>Exact active work</caption>
            <thead>
              <tr>
                <th>Command · phase</th>
                <th>Citizens</th>
              </tr>
            </thead>
            <tbody>
              {[...data.jobs].map(([job, count]) => (
                <tr key={job}>
                  <th>{job}</th>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>Stations · {data.operators.length} refining</caption>
            <thead>
              <tr>
                <th>Station</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.stations.map((b) => (
                <tr key={b.id}>
                  <th>
                    {b.kind} T{b.tier} · {b.id}
                  </th>
                  <td>{data.used.has(b.id) ? 'in use' : 'idle'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section className="eco-block" aria-label="Market offered and wanted chart">
        <h3>
          Market now <small>open order units</small>
        </h3>
        <div className="eco-legend">
          <span>
            <i className="eco-offered" />
            offered
          </span>
          <span>
            <i className="eco-wanted" />
            wanted
          </span>
        </div>
        {data.quotes.map((q) => (
          <div className="eco-market-item" key={q.item}>
            <h4>{q.item}</h4>
            <div className="eco-bar-row">
              <span>offered</span>
              <Bar value={q.supply} max={maxMarket} kind="offered" />
              <b>{q.supply}</b>
            </div>
            <div className="eco-bar-row">
              <span>wanted</span>
              <Bar value={q.demand} max={maxMarket} kind="wanted" />
              <b>{q.demand}</b>
            </div>
          </div>
        ))}
        {data.quotes.length ? (
          <table>
            <caption>Best quotes · gold per unit</caption>
            <thead>
              <tr>
                <th>Item</th>
                <th>Bid</th>
                <th>Ask</th>
              </tr>
            </thead>
            <tbody>
              {data.quotes.map((q) => (
                <tr key={q.item}>
                  <th>{q.item}</th>
                  <td>{q.bid ?? '—'}</td>
                  <td>{q.ask ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="eco-note">No public quotes available</p>
        )}
      </section>

      <section className="eco-block" aria-label="Retained trade activity chart">
        <h3>
          Retained trade activity{' '}
          <small>
            {totalUnits} decoded units · {data.trades.length} retained trade fills
          </small>
        </h3>
        <p className="eco-note">
          {bins.length ? `Ticks ${bins[0]!.start}–${bins[bins.length - 1]!.end}. ` : ''}Bounded
          event window, not lifetime volume; gaps may be omitted by retention. Only exact receipts
          contribute units; {data.unparsed} unrecognized records excluded.
        </p>
        {bins.length ? (
          <div className="eco-trade-chart">
            {bins.map((bin) => (
              <div className="eco-bar-row" key={bin.start}>
                <span className="eco-tick-label">
                  {bin.start === bin.end ? bin.start : `${bin.start}–${bin.end}`}
                </span>
                <Bar value={bin.units} max={maxTrade} kind="trade" />
                <b
                  role="img"
                  aria-label={`Ticks ${bin.start}–${bin.end}: ${bin.units} retained units, ${bin.fills} decoded fills, ${bin.gold} gold`}
                >
                  {bin.units}
                </b>
              </div>
            ))}
          </div>
        ) : (
          <p className="eco-note">No retained trade receipts.</p>
        )}
        <p className="eco-note">
          Equal simulation-tick bins · units, not prices. Zero = no decoded retained units, not
          proof of no trading.
        </p>
        <details>
          <summary>Retained executions & receipts</summary>
          <table>
            <caption>Retained item totals · execution prices, not current quotes</caption>
            <thead>
              <tr>
                <th>Item</th>
                <th>Units</th>
                <th>Gold</th>
                <th>Last price @ tick</th>
              </tr>
            </thead>
            <tbody>
              {[...data.volumes].map(([item, row]) => (
                <tr key={item}>
                  <th>{item}</th>
                  <td>{row.units}</td>
                  <td>{row.gold}</td>
                  <td>
                    {row.lastPrice} @ {row.tick}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <caption>Exact retained receipts · unrecognized text preserved</caption>
            <thead>
              <tr>
                <th>Tick</th>
                <th>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((event) => (
                <tr key={event.id}>
                  <td>{event.tick}</td>
                  <td>{event.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <details className="eco-chart-guide">
        <summary>Chart guide</summary>
        <p className="eco-note">
          Stock, work and quotes are current snapshots, not time history. Low fullness: under 20/100.
        </p>
        <p className="eco-note">
          Carried / held / ground. Held = work inputs (including suspended work) + sell escrow.
          Ground = unharvested. Carried tools counted once; loot excluded.
          Stack lengths share a scale within each resource, not across resources.
        </p>
        <p className="eco-note">
          Includes travel and other active phases, not completed output. Travel reservations count
          as station use.
        </p>
        <p className="eco-note">
          — means no open order, not a zero price. All market bars share one units scale.
        </p>
      </details>

      <details className="eco-exact-stock">
        <summary>Stock, production & market</summary>
        <div className="eco-table-scroll">
          <table>
            <caption>Exact resource units · carried / held / ground</caption>
            <thead>
              <tr>
                <th>Resource</th>
                {TIERS.map((tier) => (
                  <th key={tier}>T{tier}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource}>
                  <th>{resource}</th>
                  {TIERS.map((tier) => {
                    const row = data.stock[`${resource}:${tier}`];
                    return (
                      <td key={tier}>
                        {row ? `${row.carried} / ${row.held} / ${row.ground}` : '0 / 0 / 0'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <table>
          <caption>Other items · carried tools are used automatically</caption>
          <thead>
            <tr>
              <th>Item</th>
              <th>Carried</th>
              <th>Held</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.stock)
              .filter(([key]) => !/^(food|wood|fibre):/.test(key))
              .map(([key, row]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>{row.carried}</td>
                  <td>{row.held}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
