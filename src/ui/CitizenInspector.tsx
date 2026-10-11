import type { Citizen, SpectatorCitizen } from '../shared/types';
import type { Directive } from '../shared/directive-types';
import { sequencingWarnings } from '../shared/directive-guidance';
import { CitizenMotivation } from './Spectator';
import { Tooltip } from './Tooltip';
import { unaffiliatedColor, withoutControllerSummary, type SceneCitizen } from './model';

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <label className="meter-label">
      {label}
      <span>{Number.isFinite(value) ? Math.round(value * 10) / 10 : '—'} / 100</span>
      <meter min="0" max="100" value={value || 0} aria-label={label} />
    </label>
  );
}
function directiveLabel(d: Directive): string {
  switch (d.type) {
    case 'gather':
      return `Gather ${d.resource} T${d.tier}`;
    case 'operate':
      return `Operate ${d.buildingId} · T${d.fromTier} → T${d.fromTier + 1}`;
    case 'craft':
      return `Craft ${d.item} T${d.tier}`;
    case 'build':
      return `Build ${d.kind} T${d.tier} at (${d.x}, ${d.y})`;
    case 'reproduce':
      return `Reproduce with ${d.partnerId}`;
    case 'explore':
      return 'Explore work areas';
    case 'move':
      return `Move to (${d.x}, ${d.y})`;
  }
}
export function Inspector({
  citizen,
  unavailable,
  cancel,
  result,
  decisionTreeDebug = false,
  territory,
}: {
  territory?: SceneCitizen['territory'];
  citizen?: Citizen | SpectatorCitizen;
  decisionTreeDebug?: boolean;
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
  const strategy = citizen.strategy;
  const directive = strategy?.directives[strategy.index];
  const emergency = citizen.emergency;
  const cancellable = !!(
    a ||
    citizen.plan ||
    emergency ||
    (strategy && ['active', 'blocked'].includes(strategy.status))
  );
  return (
    <div data-testid="citizen-inspector" data-citizen-id={citizen.id}>
      <div className="identity">
        <span className="portrait" style={{ background: territory?.color ?? unaffiliatedColor }}>
          ♟
        </span>
        <div>
          <div className="citizen-name-line">
            <h2>{citizen.name}</h2>
            <span className="citizen-gold" data-testid="citizen-gold">
              {citizen.gold.toLocaleString('en-US')} gold
            </span>
          </div>
          <p>
            ({citizen.x}, {citizen.y}) · {citizen.alive ? 'Living' : 'Dead'}
          </p>
          <p className="roster-membership" data-testid="inspector-membership">
            <span className="roster-swatch" style={{ background: territory?.color ?? unaffiliatedColor }} />
            {territory ? `${territory.label} · ${territory.role}` : 'Unaffiliated · neutral grey'}
          </p>
        </div>
      </div>
      <details>
        <summary>Personality & background</summary>
        <p className="personality">{citizen.personality}</p>
      </details>
      <Meter label="Health" value={citizen.health} />
      <Meter label="Fullness" value={citizen.fullness} />
      {citizen.rest && (
        <>
          <Meter label="Rest" value={citizen.rest.value} />
          {citizen.rest.sleepingHouseId && (
            <p className="muted" data-testid="rest-sleeping">
              Sleeping · resting in house {citizen.rest.sleepingHouseId}
            </p>
          )}
        </>
      )}
      <CitizenMotivation citizen={withoutControllerSummary(citizen)} />
      {citizen.mind && <MindDossier citizen={citizen} />}
      {decisionTreeDebug && 'treeDebug' in citizen && citizen.treeDebug && (
        <details data-testid="tree-diagnostics">
          <summary>Retained controller history</summary>
          <p className="muted">Bounded history retained by this citizen’s controller, not a log starting when diagnostics were enabled.</p>
          <details><summary>Tasks · {citizen.treeDebug.tasks.length}</summary>
            {citizen.treeDebug.tasks.map(task => <details key={task.id}><summary>{task.definitionId} · {task.status} · {task.phase}</summary><pre>{JSON.stringify(task, null, 2)}</pre></details>)}
          </details>
          <details><summary>Trace · {citizen.treeDebug.trace.length}</summary>
            <p>{citizen.treeDebug.traceOmitted} older trace entries evicted</p>
            <ol>{citizen.treeDebug.trace.map((entry, i) => <li key={i}>Tick {entry.tick} · {entry.definitionId} · {entry.transition}: {entry.reason}{entry.command && <details><summary>Proposed command</summary><pre>{JSON.stringify(entry.command, null, 2)}</pre></details>}</li>)}</ol>
          </details>
          <details><summary>Delivery receipts · {citizen.treeDebug.receipts.length}</summary>
            <ul>{citizen.treeDebug.receipts.map(receipt => <li key={receipt.id}>Tick {receipt.tick} · {receipt.quantity} {receipt.item} · {receipt.source} · {receipt.requestId ?? 'unallocated'}<details><summary>Receipt identity</summary><p>{receipt.id} · settlement {receipt.settlementId}</p></details></li>)}</ul>
          </details>
          <details><summary>All retained memories · {citizen.treeDebug.memories.length}</summary><ul>{citizen.treeDebug.memories.map(memory => <li key={memory.id}>Tick {memory.tick} · {memory.kind}: {memory.text}</li>)}</ul></details>
        </details>
      )}
      {citizen.autonomy && (
        <details className="social-dossier">
          <summary>Local policy & relationships</summary>
          <p>
            Livelihood: {citizen.autonomy.policy.livelihood} T{citizen.autonomy.policy.targetTier} ·{' '}
            {citizen.autonomy.policy.stance}
          </p>
          <p>
            Food reserve: {citizen.autonomy.policy.foodReserveTicks} ticks · reproduction:{' '}
            {citizen.autonomy.policy.reproduction}
          </p>
          <p>
            Allies: {citizen.autonomy.policy.allies.join(', ') || 'none'} · rivals:{' '}
            {citizen.autonomy.policy.rivals.join(', ') || 'none'}
          </p>
          <ul>
            {Object.entries(citizen.autonomy.relationships)
              .slice(0, 8)
              .map(([id, relationship]) => (
                <li key={id}>
                  {id}: trust {relationship.trust.toFixed(1)}, grievance{' '}
                  {relationship.grievance.toFixed(1)} · {relationship.trades} trades ·{' '}
                  {relationship.trespasses} trespasses
                </li>
              ))}
          </ul>
          <ul>
            {citizen.autonomy.evidence
              .slice(-5)
              .reverse()
              .map((evidence, index) => (
                <li key={index}>
                  Tick {evidence.tick} · {evidence.text}
                </li>
              ))}
          </ul>
        </details>
      )}
      <details
        open={!!emergency || !!(strategy && ['active', 'blocked'].includes(strategy.status))}
      >
        <summary>Current strategy</summary>
        <div className="work-card strategy-card" data-testid="directive-inspector">
          {strategy ? (
            <>
              <strong>
                {strategy.status} · {strategy.id}
              </strong>
              <p>
                Approved tick {strategy.approvedTick} · review tick {strategy.reviewTick}
              </p>
              <p>
                Directive {Math.min(strategy.index + 1, strategy.directives.length)} /{' '}
                {strategy.directives.length}
                {directive ? ` · ${directiveLabel(directive)}` : ''}
              </p>
              <p>
                Progress: {strategy.progress}
                {directive && 'quantity' in directive && directive.quantity !== undefined
                  ? ` / ${directive.quantity} units`
                  : ' units'}
                {strategy.startedTick !== undefined && ` · started tick ${strategy.startedTick}`}
                {directive &&
                  'maxTicks' in directive &&
                  directive.maxTicks !== undefined &&
                  ` · at most ${directive.maxTicks} ticks`}
              </p>
              {directive && 'stopWhen' in directive && directive.stopWhen && (
                <p>Stop when {directive.stopWhen.kind}</p>
              )}
              {strategy.pending && (
                <p>
                  Execution: {strategy.pending.purpose}
                  {strategy.pending.result && ` · ${strategy.pending.result.message}`}
                </p>
              )}
              {strategy.status === 'active' &&
                sequencingWarnings(strategy.directives, strategy.index).map((warning) => (
                  <p key={warning} className="muted" data-testid="directive-sequencing-warning">
                    {warning}
                  </p>
                ))}
              {strategy.wakeTick !== undefined && <p>Waiting until tick {strategy.wakeTick}</p>}
              {strategy.blockedReason && (
                <p className="directive-blocked">Blocked: {strategy.blockedReason}</p>
              )}
              {directive && 'areas' in directive && (
                <p>
                  Work areas:{' '}
                  {directive.areas
                    .map(([x0, y0, x1, y1], i) => `#${i + 1} (${x0}, ${y0})–(${x1}, ${y1})`)
                    .join('; ')}{' '}
                  · inclusive bounds, not ownership
                </p>
              )}
            </>
          ) : (
            <p>No current strategy</p>
          )}
          <details open={!!emergency}>
            <summary>Emergency feeding details</summary>
            <div
              className={emergency ? 'emergency-feeding active' : 'emergency-feeding'}
              data-testid="emergency-feeding"
            >
              <strong>Emergency feeding · {emergency ? 'active' : 'inactive'}</strong>
              {emergency && (
                <>
                  <p>
                    Starvation exception · started tick {emergency.startedTick} · food destination{' '}
                    {emergency.depositId}
                  </p>
                  <p>
                    {emergency.outsideAreas
                      ? 'Outside work areas: emergency exception only'
                      : 'Within work areas'}
                  </p>
                  <p>Paused directive: {directive ? directiveLabel(directive) : 'none'}</p>
                  <p>
                    Paused physical work:{' '}
                    {emergency.suspendedAction
                      ? `${emergency.suspendedAction.command.type} · ${emergency.suspendedAction.phase} · target (${emergency.suspendedAction.target.x}, ${emergency.suspendedAction.target.y}) · ${emergency.suspendedAction.elapsed} / ${emergency.suspendedAction.duration} ticks`
                      : 'none'}
                  </p>
                  {emergency.suspendedAction && (
                    <p>
                      Paused inputs held:{' '}
                      {Object.entries(emergency.suspendedAction.reserved ?? {})
                        .map(([item, quantity]) => `${quantity} ${item}`)
                        .join(', ') || 'none'}
                    </p>
                  )}
                  <p>Original work retained for resumption.</p>
                </>
              )}
            </div>
          </details>
          {!!citizen.directiveReceipts?.length && (
            <details>
              <summary>
                Recent directive results · last {Math.min(6, citizen.directiveReceipts.length)}
              </summary>
              <ul>
                {citizen.directiveReceipts
                  .slice(-6)
                  .reverse()
                  .map((r, i) => (
                    <li key={i}>
                      Tick {r.tick} · {r.strategyId} · directive {r.index + 1} · {r.outcome}:{' '}
                      {r.message}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      </details>
      <h3>Physical work</h3>
      <div className="work-card">
        <strong>
          {a
            ? `${a.phase === 'travel' ? 'Travelling → ' : ''}${a.command.type}`
            : citizen.alive
              ? emergency
                ? 'Emergency feeding'
                : strategy?.status === 'active'
                  ? 'Executing directive'
                  : citizen.plan
                    ? 'Executing plan'
                    : 'Idle'
              : 'Stopped'}
        </strong>
        {a && (
          <>
            <p>
              Target ({a.target.x}, {a.target.y}) · {a.elapsed} / {a.duration} ticks
            </p>
            {a.command.type === 'refine' && (
              <p>
                Refining{' '}
                {a.command.direction === 'down'
                  ? `down · 1 T${a.command.fromTier} → 2 T${a.command.fromTier - 1}`
                  : `up · 3 T${a.command.fromTier} → 1 T${a.command.fromTier + 1}`}{' '}
                · {a.command.buildingId}
              </p>
            )}
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
        {citizen.plan && (
          <details open>
            <summary>
              Approved plan · step {citizen.plan.stepIndex + 1} / {citizen.plan.steps.length}
            </summary>
            <ol>
              {citizen.plan.steps.map((step, index) => (
                <li
                  key={index}
                  aria-current={index === citizen.plan!.stepIndex ? 'step' : undefined}
                >
                  {index < citizen.plan!.stepIndex
                    ? '✓ '
                    : index === citizen.plan!.stepIndex
                      ? '▶ '
                      : ''}
                  {step.type === 'command'
                    ? step.command.type
                    : step.type === 'gather'
                      ? `Gather ${step.resource}:${step.tier}${step.targetQuantity === undefined ? '' : ` to ${step.targetQuantity} carried`}, at most ${step.maxTicks} ticks`
                      : `Wait ${step.ticks} ticks`}
                  {step.stopWhen && `; stop when ${step.stopWhen.kind}`}
                </li>
              ))}
            </ol>
          </details>
        )}
        {!!citizen.planReceipts?.length && (
          <details>
            <summary>Recent plan results</summary>
            <ul>
              {citizen.planReceipts.slice(-6).map((receipt, index) => (
                <li key={index}>
                  Tick {receipt.tick} · {receipt.outcome}: {receipt.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        <Tooltip
          content={`Cancel current work, queued actions, strategy and approved plan; return unused inputs and discard unfinished progress.${unavailable ? ' Disabled: controls unavailable or knowledge view is active.' : !citizen.alive ? ' Disabled: citizen is dead.' : !cancellable ? ' Disabled: no active work, strategy or plan.' : ''}`}
        >
          <button disabled={unavailable || !cancellable || !citizen.alive} onClick={cancel}>
            Cancel work
          </button>
        </Tooltip>
      </div>
      <p className="outcome" role="status">
        {result || citizen.lastResult || 'No recent outcome'}
      </p>
      <h3>
        Carried inventory <small>Highest-tier carried tools are used automatically</small>
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
      <details>
        <summary>
          Goals <small>Intentions, not completed work</small>
        </summary>
        <ul>
          {citizen.goals?.length ? (
            citizen.goals.map((g, i) => <li key={i}>{g}</li>)
          ) : (
            <li className="muted">No goals recorded</li>
          )}
        </ul>
      </details>
      <details>
        <summary>Memory notebook</summary>
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
      </details>
    </div>
  );
}

/** The ten provisional dispositions, fixed order so comparisons stay stable. */
const DISPOSITIONS = [
  'ambition',
  'morals',
  'generosity',
  'riskTolerance',
  'patience',
  'sociability',
  'vengefulness',
  'familyOrientation',
  'enterprise',
  'economicIndependence',
] as const;
const dispositionLabel = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

function MindDossier({ citizen }: { citizen: Citizen | SpectatorCitizen }) {
  const mind = citizen.mind!;
  const active = 'tasks' in mind
    ? mind.tasks.find((task) => task.id === mind.activeTaskId) ?? mind.tasks.find((task) => task.status === 'running')
    : mind.currentTask;
  return (
    <details className="mind-dossier" data-testid="mind-dossier">
      <summary>Mind · dispositions, current task & memories</summary>
      <div className="dispositions" data-testid="mind-dispositions">
        {DISPOSITIONS.map((key) => {
          const value = mind.dispositions[key];
          return (
            <label key={key} className="meter-label">
              {dispositionLabel(key)}
              <span>{Number.isFinite(value) ? Math.round(value * 100) : '—'} / 100</span>
              <meter
                min="0"
                max="100"
                value={(value || 0) * 100}
                aria-label={dispositionLabel(key)}
              />
            </label>
          );
        })}
      </div>
      <h4>Current task</h4>
      {active ? (
        <p data-testid="mind-current-task">
          {active.request.purpose || active.definitionId} · {active.status} · {active.phase} ·
          delivered {active.delivered} / {active.request.quantity} {active.request.resource} T
          {active.request.tier}
        </p>
      ) : (
        <p className="muted" data-testid="mind-current-task">
          No active task
        </p>
      )}
      <h4>Meaningful memories</h4>
      <ul className="feed mind-memories" data-testid="mind-memories">
        {mind.memories.length ? (
          mind.memories
            .slice(-12)
            .reverse()
            .map((memory) => (
              <li key={memory.id} data-kind={memory.kind}>
                <small>
                  Tick {memory.tick} · {memory.kind}
                  {memory.otherId ? ` · with ${memory.otherId}` : ''}
                </small>
                {memory.text}
              </li>
            ))
        ) : (
          <li className="muted">No mind memories recorded</li>
        )}
      </ul>
      {mind.memoriesOmitted > 0 && (
        <p className="muted">{mind.memoriesOmitted} older memories evicted from controller history</p>
      )}
      {'memoriesPayloadOmitted' in mind && mind.memoriesPayloadOmitted > 0 && (
        <p className="muted">{mind.memoriesPayloadOmitted} additional memories retained in the controller but omitted from this summary</p>
      )}
    </details>
  );
}
