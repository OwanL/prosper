import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSnapshot,
  CitizenObservation,
  Control,
  PlannerMode,
  WorldEvent,
} from '../shared/types';
import { Scene } from './Scene';
import { WorkbenchTabs } from './EngineLayout';
import { HistoryCharts } from './HistoryCharts';
import { AnalyticsPanel } from './AnalyticsPanel';
import { Inspector } from './CitizenInspector';
import { BudgetPanel } from './BudgetSettings';
import { CitizenRoster, WorldActivity } from './WorldActivity';
import { projectObservation, projectWorld, presentationWorld, withoutControllerSummary } from './model';
import { CitizenMotivation } from './Spectator';
import './game-shell.css';

export { Inspector } from './CitizenInspector';
type Surface = 'citizens' | 'charts' | 'messages' | 'settings' | 'diagnostics';
const surfaceNames: Record<Surface, string> = {
  citizens: 'Citizens',
  charts: 'World charts',
  messages: 'Messages',
  settings: 'World settings',
  diagnostics: 'Diagnostics',
};
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
      /* Storage denial must not break the game view. */
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
function checkSnapshot(snapshot: AppSnapshot) {
  if (
    !snapshot?.world ||
    !snapshot.status ||
    !Number.isFinite(snapshot.world.tick) ||
    !Number.isInteger(snapshot.world.width) ||
    snapshot.world.width < 1 ||
    !Number.isInteger(snapshot.world.height) ||
    snapshot.world.height < 1
  )
    throw new Error('Snapshot is incomplete; retaining last world.');
  return snapshot;
}

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState('');
  const [surface, setSurface] = useState<Surface | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<'citizen' | 'policy' | 'history'>('citizen');
  const [selected, select] = usePreference('selected', '');
  const [knowledge, setKnowledge] = usePreference('knowledge', false);
  const [observer, setObserver] = useState('');
  const [follow, setFollow] = useState(false);
  const [labels, setLabels] = usePreference('labels', true);
  const [director, setDirector] = useState(false);
  const [territories, setTerritories] = usePreference('territories', true);
  const [resources, setResources] = usePreference('resources', false);
  const [speech, setSpeech] = usePreference('speech-bubbles', false);
  const [focusEvent, setFocusEvent] = useState<WorldEvent>();
  const [observation, setObservation] = useState<{
    id: string;
    run: string;
    data: CitizenObservation;
  } | null>(null);
  const [observationError, setObservationError] = useState('');
  const [scenario, setScenario] = useState('village');
  const [population, setPopulation] = useState('');
  const [receipt, setReceipt] = useState('');
  const openers = useRef<Partial<Record<Surface, HTMLButtonElement | null>>>({});
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController;
    const poll = async () => {
      request = new AbortController();
      try {
        const next = checkSnapshot(await api<AppSnapshot>('/api/state', undefined, request.signal));
        if (!stopped) {
          setSnapshot(next);
          setConnected(true);
          setError('');
        }
      } catch (failure) {
        if (!stopped) {
          setConnected(false);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      } finally {
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
  useEffect(() => {
    if (knowledge && !observer && selected) setObserver(selected);
  }, [knowledge, observer, selected]);
  const world = snapshot?.world;
  useEffect(() => {
    setFocusEvent(undefined);
  }, [world?.runId, knowledge]);
  useEffect(() => {
    setScenario(world?.scenario ?? 'village');
  }, [world?.runId]);
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
      .catch((failure) => {
        if (active && !abort.signal.aborted)
          setObservationError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [knowledge, observer, world?.runId, world?.tick, connected]);
  useEffect(() => {
    if (surface || inspectorOpen) closeButton.current?.focus({ preventScroll: true });
  }, [surface, inspectorOpen]);

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
  const roster = model?.citizens ?? [];
  const citizen = knowledge
    ? obs?.citizen.id === selected
      ? obs.citizen
      : undefined
    : world?.citizens[selected];
  const selectedView = roster.find((entry) => entry.value.id === selected);
  const events = knowledge ? (obs?.alerts ?? []) : (world?.events ?? []);
  const messages = knowledge ? (obs?.messages ?? []) : (world?.messages ?? []);
  const unavailable = !connected || busy || snapshot?.status.state !== 'ready';
  const living = roster.filter((entry) => entry.value.alive);
  const working = living.filter(
    (entry) => !entry.remembered && entry.value.activity !== 'idle',
  ).length;
  const attacking = living.filter(
    (entry) => !entry.remembered && entry.value.activity === 'attack',
  ).length;
  const hungry = living.filter(
    (entry) => !entry.remembered && entry.value.fullness != null && entry.value.fullness < 20,
  ).length;
  const turns = (snapshot?.turns ?? []).filter((turn) => !selected || turn.citizenId === selected);
  const status = !connected
    ? 'Reconnecting'
    : snapshot?.status.state === 'reloading'
      ? 'Reloading'
      : snapshot?.status.state === 'error'
        ? 'Runtime error'
        : busy
          ? 'Applying command'
          : snapshot?.status.running
            ? 'Running'
            : 'Paused';
  const names = knowledge
    ? Object.fromEntries(roster.map((entry) => [entry.value.id, { name: entry.value.name }]))
    : (world?.citizens ?? {});
  const name = (id: string) => (id === 'player' ? 'Player' : (names[id]?.name ?? id));
  const manualCamera = () => {
    setDirector(false);
    setFocusEvent(undefined);
  };
  const chooseCitizen = (id: string, shouldFollow = false) => {
    manualCamera();
    select(id);
    setReceipt('');
    setFollow(shouldFollow);
    setSurface(null);
    setInspectorOpen(true);
    setDetailTab('citizen');
  };
  const focusActivity = (event: WorldEvent) => {
    manualCamera();
    setFollow(false);
    if (!knowledge) setFocusEvent(event);
    if (event.citizenId && roster.some((entry) => entry.value.id === event.citizenId)) {
      select(event.citizenId);
      setInspectorOpen(true);
      setSurface(null);
      setDetailTab('citizen');
    }
  };
  const toggleSurface = (next: Surface) => {
    setSurface((current) => (current === next ? null : next));
    setInspectorOpen(false);
  };
  const closePanel = () => {
    const previous = surface;
    setSurface(null);
    setInspectorOpen(false);
    if (previous) openers.current[previous]?.focus({ preventScroll: true });
    else
      document
        .querySelector<SVGSVGElement>('[data-testid="world-scene"]')
        ?.focus({ preventScroll: true });
  };
  async function control(command: Control) {
    setBusy(true);
    setControlError('');
    try {
      setSnapshot(checkSnapshot(await api<AppSnapshot>('/api/control', command)));
      setConnected(true);
      if (command.type === 'reset' || command.type === 'scenario') {
        select('');
        setInspectorOpen(false);
        setFollow(false);
        setKnowledge(false);
        setObserver('');
        setObservation(null);
      }
    } catch (failure) {
      setControlError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }
  async function applyBudget(maxRequests: number, maxTokens: number) {
    setBusy(true);
    try {
      setSnapshot(checkSnapshot(await api<AppSnapshot>('/api/budget', { maxRequests, maxTokens })));
      setConnected(true);
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; message: string }>('/api/command', {
        citizenId: selected,
        command: { type: 'cancel' },
      });
      setReceipt(`${result.ok ? 'Accepted' : 'Rejected'}: ${result.message}`);
    } catch (failure) {
      setReceipt(String(failure));
    } finally {
      setBusy(false);
    }
  }
  const viewSwitch = (checked: boolean) => {
    setKnowledge(checked);
    setObserver(checked ? selected : '');
    setObservation(null);
    setReceipt('');
    setDirector(false);
    setFollow(false);
  };

  return (
    <main
      className="game-app"
      data-testid="prosper-app"
      data-app-state={!connected ? 'reconnecting' : (snapshot?.status.state ?? 'loading')}
      data-run-id={world?.runId ?? ''}
      data-tick={knowledge ? (obs?.tick ?? '') : (world?.tick ?? '')}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && (surface || inspectorOpen)) {
          event.preventDefault();
          closePanel();
        }
      }}
    >
      <header className="game-topbar">
        <div className="game-brand">
          <h1>
            Prosper<span>A living world</span>
          </h1>
        </div>
        <div className="game-play-controls" aria-label="Simulation controls">
          <button
            className="game-play primary"
            disabled={unavailable}
            onClick={() => void control({ type: snapshot?.status.running ? 'pause' : 'play' })}
          >
            {snapshot?.status.running ? 'Ⅱ Pause' : '▶ Play'}
          </button>
          <select
            aria-label="Simulation speed"
            value={snapshot?.status.speed ?? 1}
            disabled={unavailable}
            onChange={(event) => void control({ type: 'speed', speed: Number(event.target.value) })}
          >
            {[...new Set([1, 2, 4, 8, 16, 32, 64, snapshot?.status.speed ?? 1])]
              .sort((a, b) => a - b)
              .map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
          </select>
          <span
            className={`game-state ${unavailable ? 'is-unavailable' : ''}`}
            role="status"
            data-testid="connection-status"
          >
            {status}
          </span>
          <span className="game-tick">Tick {world?.tick.toLocaleString() ?? '—'}</span>
          <span
            className={`game-mode ${snapshot?.status.mode === 'live' ? 'is-live' : ''}`}
            data-testid="planner-mode"
          >
            {snapshot?.status.mode === 'live'
              ? 'Live AI · calls enabled'
              : snapshot?.status.mode === 'recorded'
                ? 'Recorded'
                : 'Local AI'}
          </span>
        </div>
        <nav className="game-navigation" aria-label="World panels">
          {(['citizens', 'charts', 'messages', 'settings'] as Surface[]).map((panel) => (
            <button
              key={panel}
              type="button"
              ref={(element) => {
                openers.current[panel] = element;
              }}
              aria-label={surfaceNames[panel]}
              aria-expanded={surface === panel}
              aria-controls="game-panel"
              onClick={() => toggleSurface(panel)}
            >
              {panel === 'charts'
                ? 'Charts'
                : panel === 'settings'
                  ? 'Settings'
                  : surfaceNames[panel]}
            </button>
          ))}
        </nav>
      </header>
      <div className="game-notices" aria-live="polite">
        {!connected && <p>Connection unavailable. The last received world is retained. {error}</p>}
        {snapshot?.status.state === 'reloading' && (
          <p>Backend reloading. The world is retained; controls are temporarily disabled.</p>
        )}
        {snapshot?.status.error && (
          <p role="alert">
            {snapshot.status.error} · Inspect diagnostics. Changing budget caps does not repair
            accounting errors.
          </p>
        )}
        {controlError && <p role="alert">Control failed: {controlError}</p>}
        {snapshot?.budget.blocked && (
          <p>
            Live reasoning has reached its{' '}
            {snapshot.budget.blocked.reason === 'tokens' ? 'token' : 'request'} cap. Open Settings
            to inspect budget limits. The simulation can continue.
          </p>
        )}
        {knowledge && observationError && (
          <p role="alert">
            Observation unavailable: {observationError}. Last observation retained.
          </p>
        )}
      </div>
      <div
        className={`game-stage${surface === 'charts' ? ' has-charts' : surface || inspectorOpen ? ' has-side' : ''}`}
      >
        <section className="game-playfield" aria-label="World workspace">
          <div className="game-world-summary">
            <span>
              {knowledge
                ? `Perspective · ${obs?.citizen.name ?? 'loading'}`
                : `${living.length} living citizens`}
            </span>
            <span>
              {working} {knowledge ? 'sighted citizens active' : 'working'}
            </span>
            {attacking > 0 && <span className="game-food-alert">{attacking} attacking</span>}
            {hungry > 0 && (
              <span className="game-food-alert">
                {hungry} {knowledge ? 'sighted citizens' : 'citizens'} need food
              </span>
            )}
            {!surface && selectedView && !inspectorOpen && (
              <button onClick={() => setInspectorOpen(true)}>
                Inspect {selectedView.value.name}
              </button>
            )}
          </div>
          {model ? (
            <Scene
              key={`${world?.runId}:${knowledge ? observer : 'spectator'}`}
              compact
              model={model}
              messages={speech ? messages : []}
              events={events}
              focusEvent={focusEvent}
              director={director}
              territories={territories}
              resources={resources}
              manualCamera={manualCamera}
              navigateCamera={() => {
                manualCamera();
                setFollow(false);
              }}
              focusCitizen={(id) => chooseCitizen(id, true)}
              selected={selected}
              select={(id) => chooseCitizen(id)}
              follow={follow}
              labels={labels}
              running={!unavailable && !!snapshot?.status.running && !knowledge}
              own={citizen ? withoutControllerSummary(citizen) : undefined}
            />
          ) : (
            <div className="game-empty">
              {knowledge ? 'Waiting for the observer’s sightings…' : 'Connecting to your world…'}
            </div>
          )}
        </section>
        {(surface || inspectorOpen) && (
          <aside
            id="game-panel"
            className={`game-panel ${surface === 'charts' ? 'game-charts-drawer' : 'game-side-panel'}`}
            role="region"
            aria-label={surface ? surfaceNames[surface] : 'Citizen details'}
          >
            <header className="game-panel-heading">
              <div>
                <span>
                  {surface === 'charts'
                    ? 'A clearer picture'
                    : inspectorOpen
                      ? 'Citizen'
                      : 'Explore'}
                </span>
                <h2>{surface ? surfaceNames[surface] : name(selected)}</h2>
              </div>
              <button
                type="button"
                ref={closeButton}
                className="game-close"
                aria-label="Back to world"
                onClick={closePanel}
              >
                × <span>Back to world</span>
              </button>
            </header>
            <div className="game-panel-content">
              {surface === 'citizens' && (
                <CitizenRoster
                  citizens={roster}
                  selectedId={selected}
                  onSelect={(id) => chooseCitizen(id)}
                  privateId={knowledge ? observer : undefined}
                />
              )}
              {surface === 'charts' &&
                (world ? (
                  <AnalyticsPanel world={presentationWorld(world)} knowledge={knowledge} />
                ) : (
                  <p className="game-empty">Waiting for recorded world data.</p>
                ))}
              {surface === 'messages' && (
                <section className="game-messages" aria-label="Communications">
                  <p className="game-explanation">
                    What citizens say, not proof of completed actions. Newest first.
                  </p>
                  {messages.length ? (
                    <ol>
                      {messages
                        .slice(-40)
                        .reverse()
                        .map((message) => (
                          <li key={message.id}>
                            <header>
                              <strong>{name(message.from)}</strong>
                              <span>
                                {message.to ? `To ${name(message.to)} · Private` : 'Public'} · tick{' '}
                                {message.tick}
                              </span>
                            </header>
                            <p>{message.text}</p>
                          </li>
                        ))}
                    </ol>
                  ) : (
                    <p className="game-empty">No messages in this view.</p>
                  )}
                </section>
              )}
              {surface === 'settings' && (
                <div className="game-settings">
                  <section>
                    <h3>Simulation</h3>
                    <p className="game-explanation">
                      Local AI runs the world without model calls. Live AI is optional.
                    </p>
                    <label className="game-field">
                      Reasoning mode
                      <select
                        aria-label="Planner mode"
                        disabled={unavailable}
                        value={snapshot?.status.mode ?? 'scripted'}
                        onChange={(event) => {
                          const mode = event.target.value as PlannerMode;
                          if (
                            mode !== 'live' ||
                            confirm('Enable live provider calls? This may incur usage costs.')
                          )
                            void control({ type: 'mode', mode });
                        }}
                      >
                        <option value="scripted">Local AI</option>
                        <option value="live">Live (opt-in)</option>
                        <option value="recorded">Recorded</option>
                      </select>
                    </label>
                    <button
                      disabled={unavailable || !!snapshot?.status.running}
                      onClick={() => void control({ type: 'step', ticks: 1 })}
                    >
                      Step one tick
                    </button>
                  </section>
                  <section>
                    <h3>Map display</h3>
                    {(
                      [
                        ['Citizen names', labels, setLabels],
                        ['Resource highlights', resources, setResources],
                        ['Territory borders', territories, setTerritories],
                        ['Speech bubbles', speech, setSpeech],
                      ] as const
                    ).map(([label, checked, change]) => (
                      <label className="game-check" key={label}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => change(event.target.checked)}
                        />
                        {label}
                      </label>
                    ))}
                    <label className="game-check">
                      <input
                        type="checkbox"
                        checked={follow}
                        disabled={!selectedView || selectedView.remembered}
                        onChange={(event) => {
                          manualCamera();
                          setFollow(event.target.checked);
                        }}
                      />
                      Follow selected citizen
                    </label>
                    {!knowledge && (
                      <label className="game-check">
                        <input
                          type="checkbox"
                          checked={director}
                          onChange={(event) => {
                            setDirector(event.target.checked);
                            setFocusEvent(undefined);
                            if (event.target.checked) setFollow(false);
                          }}
                        />
                        Automatically frame important events
                      </label>
                    )}
                    <label className="game-check">
                      <input
                        type="checkbox"
                        checked={knowledge}
                        disabled={!world || (!selected && !knowledge)}
                        onChange={(event) => viewSwitch(event.target.checked)}
                      />
                      Citizen knowledge
                    </label>
                    <p className="game-explanation">
                      Citizen knowledge shows the selected observer’s sightings and dated memories,
                      not spectator information.
                    </p>
                  </section>
                  <section>
                    <h3>Start a fresh world</h3>
                    <p className="game-explanation">
                      Reset archives this world first. Spending and budget limits are kept.
                    </p>
                    <label className="game-field">
                      Founding population
                      <input
                        aria-label="Founding population"
                        type="number"
                        min="1"
                        max="250"
                        placeholder="Keep current founders"
                        value={population}
                        disabled={unavailable}
                        onChange={(event) => setPopulation(event.target.value)}
                      />
                    </label>
                    <button
                      className="game-danger"
                      disabled={unavailable}
                      onClick={() => {
                        if (
                          confirm(
                            'Reset world? The current world will be saved first. Start the same scenario with a new seed, paused. Spending and budget limits are kept.',
                          )
                        )
                          void control({
                            type: 'reset',
                            ...(population ? { population: Number(population) } : {}),
                          });
                      }}
                    >
                      Reset world
                    </button>
                    <details>
                      <summary>Choose another scenario</summary>
                      <label className="game-field">
                        Scenario
                        <select
                          aria-label="Scenario name"
                          value={scenario}
                          onChange={(event) => setScenario(event.target.value)}
                        >
                          <option value="village">Village</option>
                          <option value="competition">Competition</option>
                          <option value="progression">Progression</option>
                        </select>
                      </label>
                      <button
                        disabled={unavailable}
                        onClick={() => {
                          if (confirm('Load this scenario and replace the displayed run?'))
                            void control({
                              type: 'scenario',
                              scenario,
                              ...(population ? { population: Number(population) } : {}),
                            });
                        }}
                      >
                        Load scenario
                      </button>
                    </details>
                  </section>
                  <section>
                    <h3>Advanced</h3>
                    <label>
                      <input type="checkbox" checked={snapshot?.status.decisionTreeDebug ?? false}
                        disabled={unavailable}
                        onChange={(event) => void control({ type: 'decision-tree-debug', enabled: event.target.checked })} />
                      Decision-tree diagnostics
                    </label>
                    <p className="game-explanation">Includes extra retained controller data and may increase transfer and rendering cost. Turning this off does not disable Local AI or the normal mind summary.</p>
                    {snapshot && (
                      <BudgetPanel
                        snapshot={snapshot}
                        unavailable={unavailable}
                        apply={applyBudget}
                      />
                    )}
                    <button onClick={() => setSurface('diagnostics')}>Open diagnostics</button>
                  </section>
                </div>
              )}
              {surface === 'diagnostics' && (
                <section className="game-diagnostics" aria-label="Reasoning and tool receipts">
                  <p className="game-explanation">
                    Diagnostic records are separate from citizen knowledge.{' '}
                    {selected ? `Filtered to ${name(selected)}.` : 'All citizens.'}
                  </p>
                  {knowledge ? (
                    <p>Diagnostics are hidden in citizen knowledge view.</p>
                  ) : turns.length ? (
                    turns
                      .slice(-30)
                      .reverse()
                      .map((turn) => (
                        <details key={turn.id}>
                          <summary>
                            {name(turn.citizenId)} · tick {turn.tick} · {turn.status}
                          </summary>
                          <p>
                            {turn.error || turn.stopReason || turn.reason || 'No final statement.'}
                          </p>
                          <p>
                            {turn.inputTokens ?? 'Unknown'} input / {turn.outputTokens ?? 'unknown'}{' '}
                            output tokens
                          </p>
                          {turn.response && (
                            <details>
                              <summary>Provider response</summary>
                              <pre>{turn.response}</pre>
                            </details>
                          )}
                          {turn.calls.map((call, index) => (
                            <details key={index}>
                              <summary>
                                {call.command.type} · {call.result.ok ? 'accepted' : 'rejected'}
                              </summary>
                              <p>{call.result.message}</p>
                              <pre>{JSON.stringify(call.command, null, 2)}</pre>
                            </details>
                          ))}
                          <details>
                            <summary>Exact observation / request</summary>
                            <pre>{turn.observation}</pre>
                          </details>
                        </details>
                      ))
                  ) : (
                    <p className="game-empty">No reasoning turns recorded.</p>
                  )}
                </section>
              )}
              {!surface && inspectorOpen && (
                <>
                  <div className="game-citizen-navigation">
                    <WorkbenchTabs
                      id="citizen"
                      tabs={[
                        { id: 'citizen', label: 'Now' },
                        { id: 'policy', label: 'Motivation' },
                        { id: 'history', label: 'History' },
                      ]}
                      active={detailTab}
                      change={setDetailTab}
                    />
                    <button
                      className="game-follow"
                      disabled={!selectedView || selectedView.remembered}
                      aria-pressed={follow}
                      onClick={() => {
                        manualCamera();
                        setFollow(!follow);
                      }}
                    >
                      {follow ? 'Stop following' : 'Follow on map'}
                    </button>
                  </div>
                  <div
                    role="tabpanel"
                    id="citizen-content"
                    aria-labelledby={`citizen-tab-${detailTab}`}
                    className="game-dossier"
                  >
                    {detailTab === 'citizen' &&
                      (citizen ? (
                        <Inspector
                          citizen={citizen}
                          territory={model?.citizens.find(c => c.value.id === citizen.id)?.value.territory}
                          decisionTreeDebug={!knowledge && !!snapshot?.status.decisionTreeDebug}
                          unavailable={unavailable || knowledge}
                          cancel={() => void cancel()}
                          result={receipt}
                        />
                      ) : (
                        <p className="game-empty">
                          {selectedView
                            ? `${selectedView.value.name} is ${selectedView.remembered ? 'a dated sighting' : 'visible'}. Private details are available only for the observer.`
                            : 'Select a citizen on the map or in Citizens.'}
                        </p>
                      ))}
                    {detailTab === 'policy' &&
                      (citizen ? (
                        <>
                          <CitizenMotivation citizen={withoutControllerSummary(citizen)} />
                          {citizen.autonomy && (
                            <>
                              <h3>Recent personal evidence</h3>
                              <ul className="game-evidence">
                                {citizen.autonomy.evidence
                                  .slice(-12)
                                  .reverse()
                                  .map((entry, index) => (
                                    <li key={index}>
                                      <small>Tick {entry.tick}</small>
                                      {entry.text}
                                    </li>
                                  ))}
                              </ul>
                              <details>
                                <summary>Full persistent policy</summary>
                                <pre>{JSON.stringify(citizen.autonomy.policy, null, 2)}</pre>
                              </details>
                            </>
                          )}
                        </>
                      ) : (
                        <p className="game-empty">
                          Private motivation is available only for the observer in knowledge view.
                        </p>
                      ))}
                    {detailTab === 'history' &&
                      (knowledge ? (
                        <p className="game-empty">
                          Private historical graphs are hidden in citizen knowledge view.
                        </p>
                      ) : world && selected ? (
                        <HistoryCharts world={presentationWorld(world)} selectedId={selected} scope="citizen" />
                      ) : (
                        <p>Select a citizen to see retained history.</p>
                      ))}
                  </div>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
      <footer className="game-activity-strip">
        {world && (
          <WorldActivity
            world={{
              tick: knowledge ? (obs?.tick ?? world.tick) : world.tick,
              events,
              significantEvents: knowledge ? undefined : world.significantEvents,
              citizens: names,
            }}
            events={knowledge ? events : undefined}
            onFocus={focusActivity}
          />
        )}
      </footer>
    </main>
  );
}
