import { useEffect, useMemo, useState } from 'react';
import type {
  AppSnapshot,
  Citizen,
  CitizenObservation,
  Control,
  PlannerMode,
} from '../shared/types';
import { Scene } from './Scene';
import { projectObservation, projectWorld } from './model';

function usePreference<T>(key: string, initial: T) {
  const [value, set] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(`prosper.ui.${key}`);
      return saved ? (JSON.parse(saved) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`prosper.ui.${key}`, JSON.stringify(value));
    } catch {
      /* Private mode must remain usable. */
    }
  }, [key, value]);
  return [value, set] as const;
}
async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(10000);
  const response = await fetch(path, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
function checkSnapshot(s: AppSnapshot): AppSnapshot {
  if (
    !s?.world ||
    !s.status ||
    !Number.isFinite(s.world.tick) ||
    !Number.isInteger(s.world.width) ||
    s.world.width < 1 ||
    !Number.isInteger(s.world.height) ||
    s.world.height < 1
  )
    throw new Error('Snapshot is incomplete; retaining last world.');
  return s;
}
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <label className="meter-label">
      {label}
      <span>{Number.isFinite(value) ? Math.round(value * 10) / 10 : '—'} / 100</span>
      <meter min="0" max="100" value={value || 0} aria-label={label} />
    </label>
  );
}
function Inspector({
  citizen,
  unavailable,
  cancel,
  result,
}: {
  citizen?: Citizen;
  unavailable: boolean;
  cancel: () => void;
  result: string;
}) {
  if (!citizen)
    return (
      <div className="empty">
        Select a citizen to inspect their state. In knowledge view, only the observer’s private
        state is available.
      </div>
    );
  const a = citizen.action;
  return (
    <div data-testid="citizen-inspector" data-citizen-id={citizen.id}>
      <div className="identity">
        <span className="portrait" style={{ background: citizen.color }}>
          ♟
        </span>
        <div>
          <h2>{citizen.name}</h2>
          <p>
            ({citizen.x}, {citizen.y}) · {citizen.alive ? 'Living' : 'Dead'} · {citizen.gold} gold
          </p>
        </div>
      </div>
      <p className="personality">{citizen.personality}</p>
      <Meter label="Health" value={citizen.health} />
      <Meter label="Fullness" value={citizen.fullness} />
      <h3>Physical work</h3>
      <div className="work-card">
        <strong>
          {a
            ? `${a.phase === 'travel' ? 'Travelling → ' : ''}${a.command.type}`
            : citizen.alive
              ? 'Idle'
              : 'Stopped'}
        </strong>
        {a && (
          <>
            <p>
              Target ({a.target.x}, {a.target.y}) · {a.elapsed} / {a.duration} ticks
            </p>
            <progress value={a.elapsed} max={Math.max(1, a.duration)} aria-label="Work progress" />
            <p>
              Inputs reserved:{' '}
              {Object.entries(a.reserved ?? {})
                .map(([k, v]) => `${v} ${k}`)
                .join(', ') || 'none'}
            </p>
          </>
        )}
        <p>{citizen.queue?.length || 0} queued actions</p>
        <button disabled={unavailable || !a || !citizen.alive} onClick={cancel}>
          Cancel work
        </button>
      </div>
      <p className="outcome" role="status">
        {result || citizen.lastResult || 'No recent outcome'}
      </p>
      <h3>
        Carried inventory <small>Equipment is included</small>
      </h3>
      <ul className="inventory">
        {Object.entries(citizen.inventory ?? {})
          .filter(([, v]) => v > 0)
          .map(([k, v]) => (
            <li key={k}>
              <span>{k}</span>
              <b>×{v}</b>
            </li>
          ))}
      </ul>
      {!Object.values(citizen.inventory ?? {}).some((v) => v > 0) && <p className="muted">Empty</p>}
      <p className="muted">
        Equipped: {Object.values(citizen.equipment ?? {}).join(', ') || 'none'}
      </p>
      <h3>
        Goals <small>Intentions, not completed work</small>
      </h3>
      <ul>
        {citizen.goals?.length ? (
          citizen.goals.map((g, i) => <li key={i}>{g}</li>)
        ) : (
          <li className="muted">No goals recorded</li>
        )}
      </ul>
      <h3>Memory notebook</h3>
      <ul className="feed">
        {citizen.memories?.length ? (
          citizen.memories
            .slice(-12)
            .reverse()
            .map((m, i) => (
              <li key={i}>
                <small>Tick {m.tick}</small>
                {m.text}
              </li>
            ))
        ) : (
          <li className="muted">No memories recorded</li>
        )}
      </ul>
    </div>
  );
}
export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, select] = usePreference('selected', '');
  const [knowledge, setKnowledge] = usePreference('knowledge', false);
  const [observer, setObserver] = useState('');
  const [follow, setFollow] = usePreference('follow', false);
  const [labels, setLabels] = usePreference('labels', true);
  const [compact, setCompact] = usePreference('compact', false);
  const [observation, setObservation] = useState<{
    id: string;
    run: string;
    data: CitizenObservation;
  } | null>(null);
  const [observationError, setObservationError] = useState('');
  const [scenario, setScenario] = useState('');
  const [receipt, setReceipt] = useState('');
  const [controlError, setControlError] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController;
    const poll = async () => {
      request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const next = checkSnapshot(await api<AppSnapshot>('/api/state', undefined, request.signal));
        if (!stopped) {
          setSnapshot(next);
          setConnected(true);
          setError('');
        }
      } catch (e) {
        if (!stopped) {
          setConnected(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(poll, 700);
      }
    };
    void poll();
    return () => {
      stopped = true;
      request?.abort();
      clearTimeout(timer);
    };
  }, []);
  // A knowledge observer remains fixed when selecting another sighted person.
  useEffect(() => {
    if (knowledge && !observer && selected) setObserver(selected);
  }, [knowledge, observer, selected]);
  const world = snapshot?.world;
  useEffect(() => {
    if (!knowledge || !observer || !world) return;
    const abort = new AbortController();
    let active = true;
    void api<CitizenObservation>(
      `/api/citizens/${encodeURIComponent(observer)}/observation`,
      undefined,
      abort.signal,
    )
      .then((data) => {
        if (
          !data?.citizen ||
          data.citizen.id !== observer ||
          !Array.isArray(data.visible) ||
          !Number.isFinite(data.tick)
        )
          throw new Error('Incomplete citizen observation');
        if (active) {
          setObservation({ id: observer, run: world.runId, data });
          setObservationError('');
        }
      })
      .catch((e) => {
        if (active) setObservationError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [knowledge, observer, world?.runId, world?.tick, connected]);
  const obs =
    observation?.id === observer && observation.run === world?.runId ? observation.data : null;
  const model = useMemo(
    () =>
      world
        ? knowledge
          ? obs
            ? projectObservation(obs, world)
            : null
          : projectWorld(world, snapshot?.status.thinking ?? [])
        : null,
    [world, knowledge, obs, snapshot?.status.thinking],
  );
  const citizen = knowledge
    ? obs?.citizen.id === selected
      ? obs.citizen
      : undefined
    : world?.citizens?.[selected];
  const unavailable = !connected || busy || snapshot?.status.state !== 'ready';
  async function control(command: Control) {
    setBusy(true);
    setControlError('');
    try {
      setSnapshot(checkSnapshot(await api<AppSnapshot>('/api/control', command)));
      setConnected(true);
    } catch (e) {
      setControlError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; message: string }>('/api/command', {
        citizenId: selected,
        command: { type: 'cancel' },
      });
      setReceipt(`${r.ok ? 'Accepted' : 'Rejected'}: ${r.message}`);
    } catch (e) {
      setReceipt(String(e));
    } finally {
      setBusy(false);
    }
  }
  const events = knowledge ? (obs?.alerts ?? []) : (world?.events ?? []);
  const messages = knowledge ? (obs?.messages ?? []) : (world?.messages ?? []);
  const orders = knowledge ? (obs?.markets ?? []) : Object.values(world?.orders ?? {});
  const roster = model?.citizens ?? [];
  return (
    <main
      className={compact ? 'app compact' : 'app'}
      data-testid="prosper-app"
      data-app-state={!connected ? 'reconnecting' : snapshot?.status.state || 'loading'}
      data-run-id={world?.runId || ''}
      data-tick={knowledge ? (obs?.tick ?? '') : (world?.tick ?? '')}
    >
      <header className="masthead">
        <div>
          <div className="eyebrow">A small world, in motion</div>
          <h1>
            Prosper<span> / 02</span>
          </h1>
        </div>
        <div
          className={`mode-badge ${snapshot?.status.mode === 'live' ? 'live' : ''}`}
          data-testid="planner-mode"
        >
          {snapshot?.status.mode?.toUpperCase() || 'CONNECTING'}
          <small>
            {snapshot?.status.mode === 'live'
              ? 'Live provider · opt-in'
              : snapshot?.status.mode === 'recorded'
                ? 'Recorded responses'
                : 'Scripted reasoning · not emergence'}
          </small>
        </div>
        <div className="run-meta">
          <b>Tick {world?.tick ?? '—'}</b>
          <small>Run {world?.runId || 'not connected'}</small>
        </div>
      </header>
      <div
        className={`connection ${!unavailable ? 'ready' : ''}`}
        role="status"
        data-testid="connection-status"
      >
        {!connected
          ? 'Reconnecting / backend unavailable — last snapshot retained'
          : snapshot?.status.state === 'reloading'
            ? 'Backend reloading — world retained; controls disabled'
            : snapshot?.status.state === 'error'
              ? `Runtime error: ${snapshot.status.error || 'inspect server diagnostics'}`
              : busy
                ? 'Applying command…'
                : snapshot?.status.running
                  ? 'World running'
                  : 'World paused'}
        {error && <span className="error">{error}</span>}
        {controlError && (
          <span className="error">Control error (check refreshed state): {controlError}</span>
        )}
      </div>
      <nav className="controls" aria-label="Simulation controls">
        <button
          className="primary"
          disabled={unavailable}
          onClick={() => void control({ type: snapshot?.status.running ? 'pause' : 'play' })}
        >
          {snapshot?.status.running ? 'Ⅱ Pause' : '▶ Play'}
        </button>
        <button
          disabled={unavailable || snapshot?.status.running}
          onClick={() => void control({ type: 'step', ticks: 1 })}
        >
          Step 1 tick
        </button>
        <label>
          Speed
          <select
            aria-label="Simulation speed"
            value={snapshot?.status.speed ?? 1}
            disabled={unavailable}
            onChange={(e) => void control({ type: 'speed', speed: Number(e.target.value) })}
          >
            {[...new Set([1, 2, 4, 8, snapshot?.status.speed ?? 1])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
          </select>
        </label>
        <label>
          Reasoning
          <select
            aria-label="Planner mode"
            disabled={unavailable}
            value={snapshot?.status.mode ?? 'scripted'}
            onChange={(e) => {
              const mode = e.target.value as PlannerMode;
              if (
                mode !== 'live' ||
                confirm('Enable live provider calls? This may incur usage costs.')
              )
                void control({ type: 'mode', mode });
            }}
          >
            <option value="scripted">Scripted</option>
            <option value="live">Live (opt-in)</option>
            <option value="recorded">Recorded</option>
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (confirm('Load this scenario and replace the displayed run?'))
              void control({ type: 'scenario', scenario: scenario.trim() });
          }}
        >
          <input
            aria-label="Scenario name"
            placeholder="Named scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          />
          <button disabled={unavailable || !scenario.trim()}>Load</button>
        </form>
      </nav>
      <div className="workspace">
        <div className="world-column">
          <div className="view-controls">
            <label>
              <input
                type="checkbox"
                checked={knowledge}
                disabled={!world || (!selected && !knowledge)}
                onChange={(e) => {
                  setKnowledge(e.target.checked);
                  setObserver(e.target.checked ? selected : '');
                  setObservation(null);
                  setReceipt('');
                }}
              />
              Citizen knowledge
            </label>
            {knowledge && (
              <span>
                Observer: {obs?.citizen.name || observer || 'select a citizen'} · tick{' '}
                {obs?.tick ?? '—'}
              </span>
            )}
            <label>
              <input
                type="checkbox"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              Follow selected
            </label>
            <label>
              <input
                type="checkbox"
                checked={labels}
                onChange={(e) => setLabels(e.target.checked)}
              />
              Names
            </label>
            <label>
              <input
                type="checkbox"
                checked={compact}
                onChange={(e) => setCompact(e.target.checked)}
              />
              Compact panels
            </label>
          </div>
          {knowledge && (
            <p className="knowledge-notice">
              Only observations and dated memories. Unseen stock and movement never update here.{' '}
              {observationError && (
                <span className="error">
                  Observation unavailable: {observationError}. Last observation retained.
                </span>
              )}
            </p>
          )}
          {model ? (
            <Scene
              key={`${world?.runId}:${knowledge ? observer : 'spectator'}`}
              model={model}
              selected={selected}
              select={(id) => {
                select(id);
                setReceipt('');
              }}
              follow={follow}
              labels={labels}
              running={!unavailable && !!snapshot?.status.running && !knowledge}
              own={citizen}
            />
          ) : (
            <section className="map-placeholder">
              {knowledge
                ? 'Waiting for this citizen’s observation…'
                : 'Waiting for an authoritative world snapshot…'}
            </section>
          )}
          <section className="panel roster">
            <div className="panel-heading">
              <h2>{knowledge ? 'Known citizens' : 'Citizens'}</h2>
              <span>{roster.length} identities</span>
            </div>
            <div className="roster-items">
              {roster.map(({ value: c, remembered, seenTick }) => (
                <button
                  key={c.id}
                  data-testid={`roster-${c.id}`}
                  aria-pressed={selected === c.id}
                  onClick={() => {
                    select(c.id);
                    setReceipt('');
                  }}
                >
                  <span className="swatch" style={{ background: c.color }} />
                  <b>{c.name}</b>
                  <small>
                    {remembered ? `Seen tick ${seenTick}` : `${c.activity} · (${c.x}, ${c.y})`}
                  </small>
                </button>
              ))}
              {!roster.length && <p className="muted">No known citizens</p>}
            </div>
          </section>
        </div>
        <aside className="panel inspector">
          <div className="panel-heading">
            <h2>Citizen dossier</h2>
            <span>{knowledge ? 'Observer state only' : 'Authoritative state'}</span>
          </div>
          <Inspector
            citizen={citizen}
            unavailable={unavailable || knowledge}
            cancel={() => void cancel()}
            result={receipt}
          />
        </aside>
      </div>
      <div className="feed-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>{knowledge ? 'Owner alerts' : 'World events'}</h2>
            <span>Committed outcomes</span>
          </div>
          <ul className="feed">
            {events
              .slice(-20)
              .reverse()
              .map((e) => (
                <li key={e.id}>
                  <small>
                    Tick {e.tick} · {e.kind}
                  </small>
                  {e.text}
                </li>
              ))}
            {!events.length && <li className="muted">No recent events</li>}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Communications</h2>
            <span>Statements, not transactions</span>
          </div>
          <ul className="feed">
            {messages
              .slice(-20)
              .reverse()
              .map((m) => (
                <li key={m.id}>
                  <small>
                    Tick {m.tick} · {m.from} {m.to ? `→ ${m.to} (private)` : '· public'}
                  </small>
                  {m.text}
                </li>
              ))}
            {!messages.length && <li className="muted">No messages</li>}
          </ul>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Public market</h2>
            <span>Instant remote settlement</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Asset</th>
                  <th>Qty</th>
                  <th>Gold / unit</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td className={`order-${o.side}`}>{o.side}</td>
                    <td>{o.item}</td>
                    <td>{o.quantity}</td>
                    <td>{o.price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!orders.length && <p className="muted">No open orders</p>}
          </div>
        </section>
      </div>
      <section className="panel diagnostics">
        <div className="panel-heading">
          <h2>Reasoning & tool receipts</h2>
          <span>Diagnostic evidence · separate from citizen knowledge</span>
        </div>
        {knowledge ? (
          <p className="muted">Spectator diagnostics hidden in citizen knowledge view.</p>
        ) : (
          <>
            <p className="muted">
              {snapshot?.budget
                ? `${snapshot.budget.requests} requests · ${snapshot.budget.pending} pending · ${snapshot.budget.spent} / ${snapshot.budget.limit} ${snapshot.budget.unit}`
                : 'Usage not available'}
            </p>
            {(snapshot?.turns ?? [])
              .filter((t) => !selected || t.citizenId === selected)
              .slice(-10)
              .reverse()
              .map((t) => (
                <details key={t.id} data-turn-id={t.id}>
                  <summary>
                    <b>{t.status}</b> · {t.citizenId} · tick {t.tick} · {t.reason}
                    {t.error ? ` · ${t.error}` : ''}
                  </summary>
                  <p>{t.response || 'No response recorded'}</p>
                  {t.calls?.map((call, i) => (
                    <div className={`receipt ${call.result.ok ? '' : 'rejected'}`} key={i}>
                      <b>
                        {call.command.type} · {call.result.ok ? 'accepted' : 'rejected'} ·{' '}
                        {call.result.code}
                      </b>
                      <p>{call.result.message}</p>
                      <pre>{JSON.stringify(call.command, null, 2)}</pre>
                    </div>
                  ))}
                  <details>
                    <summary>Exact observation / request</summary>
                    <pre>{t.observation}</pre>
                  </details>
                </details>
              ))}
            {!snapshot?.turns?.length && <p className="muted">No reasoning turns recorded</p>}
          </>
        )}
      </section>
      <footer className="page-footer">
        Prosper · Spike 2 <span>Presentation never advances the simulation.</span>
      </footer>
    </main>
  );
}
