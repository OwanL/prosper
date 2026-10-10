import type { AppSnapshot, Citizen, World, WorldEvent } from '../shared/types';
import { Tooltip } from './Tooltip';
import { eventPoint, humanizeEvent, recentStories, storyKinds } from './story';

export function WorldPulse({ world }: { world: World }) {
  const living = Object.values(world.citizens).filter((citizen) => citizen.alive);
  const working = living.filter((citizen) => citizen.action);
  const hungry = living.filter((citizen) => citizen.fullness < 20);
  const fights = living.filter((citizen) => citizen.action?.command.type === 'attack');
  const claims = Object.values(world.claims ?? {}).filter(
    (claim) => claim.expiresTick > world.tick && world.citizens[claim.ownerId]?.alive,
  );
  return (
    <div className="world-pulse" aria-label="World at a glance" data-testid="world-pulse">
      <span>
        <b>{living.length}</b> alive
      </span>
      <span>
        <b>{working.length}</b> working
      </span>
      <span className={hungry.length ? 'pressure' : ''}>
        <b>{hungry.length}</b> hungry
      </span>
      <span className={fights.length ? 'danger' : ''}>
        <b>{fights.length}</b> attacking
      </span>
      <span>
        <b>{claims.length}</b> claims
      </span>
      <span>
        <b>
          {
            Object.values(world.alliances ?? {}).filter(
              (alliance) => alliance.members.filter((id) => world.citizens[id]?.alive).length > 1,
            ).length
          }
        </b>{' '}
        alliances
      </span>
    </div>
  );
}

export function StoryRail({
  world,
  focus,
  focusedId,
}: {
  world: World;
  focus: (event: WorldEvent) => void;
  focusedId?: string;
}) {
  const grouped = new Map<string, { event: WorldEvent; count: number }>();
  for (const event of recentStories(world.events, world.tick, world.events.length)) {
    const key = `${event.kind}:${event.citizenId ?? ''}:${event.targetId ?? ''}`;
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else grouped.set(key, { event, count: 1 });
  }
  const stories = [...grouped.values()].slice(0, 4);
  return (
    <div className="story-rail" aria-label="Recent consequential events" data-testid="story-rail">
      {stories.map(({ event, count }) => {
        const style = storyKinds[event.kind]!;
        const spatial = !!eventPoint(event, world.width, world.height);
        const actor = event.citizenId && world.citizens[event.citizenId];
        const target = event.targetId && world.citizens[event.targetId];
        const caption = humanizeEvent(event.text, world.citizens);
        return (
          <Tooltip
            key={event.id}
            content={`${caption}${spatial ? ' Select to inspect the recorded event location.' : ' No physical location recorded; remote settlement is not movement.'}`}
          >
            <button
              className={`story-card story-${event.kind}`}
              data-testid={`story-${event.id}`}
              aria-pressed={focusedId === event.id}
              onClick={() => focus(event)}
            >
              <span className="story-icon" aria-hidden="true">
                {style.icon}
              </span>
              <span className="story-copy">
                <small>
                  {style.label} · tick {event.tick}
                  {count > 1 ? ` · ${count} recent` : ''}
                  {!spatial ? ' · remote' : ''}
                </small>
                <b>
                  {actor ? actor.name : style.label}
                  {target ? ` → ${target.name}` : ''}
                </b>
                <span>{caption}</span>
              </span>
            </button>
          </Tooltip>
        );
      })}
      {!stories.length && (
        <p className="story-quiet">
          The world is working. New conflicts, trades, claims and births appear here.
        </p>
      )}
    </div>
  );
}

export function CitizenMotivation({
  citizen,
  thinking = false,
}: {
  citizen: Citizen;
  thinking?: boolean;
}) {
  const autonomy = citizen.autonomy;
  return (
    <div className="motivation-card" data-testid="citizen-motivation">
      <div className="motivation-heading">
        <span style={{ background: citizen.color }} />
        <strong>{citizen.name}</strong>
        {autonomy && (
          <small>
            {autonomy.policy.stance} · {autonomy.policy.livelihood}
          </small>
        )}
      </div>
      <p>{autonomy?.intent || citizen.goals?.[0] || 'No intention recorded'}</p>
      <small>
        {citizen.action
          ? `${citizen.action.phase === 'travel' ? 'Travelling to' : 'Doing'} ${citizen.action.command.type}`
          : 'No physical action'}
        {thinking ? ' · strategy review in flight; local work continues' : ' · local execution'}
      </small>
      {autonomy && (
        <small className="policy-origin">
          Policy:{' '}
          {autonomy.source === 'live'
            ? 'live model'
            : autonomy.source === 'recorded'
              ? 'recorded model'
              : 'local scripted'}
          {autonomy.reviewedTick === undefined ? '' : ` · reviewed tick ${autonomy.reviewedTick}`}
        </small>
      )}
    </div>
  );
}

export function HarnessSummary({ snapshot }: { snapshot: AppSnapshot }) {
  const planner = snapshot.status.planner;
  if (!planner) return null;
  const measured = planner.totalRequests > 0;
  return (
    <div className="harness-summary" data-testid="harness-summary">
      <strong>
        {snapshot.status.mode === 'live'
          ? planner.model
          : snapshot.status.mode === 'recorded'
            ? 'Recorded strategy replay'
            : 'Scripted strategy reviews'}
      </strong>
      <p>
        {planner.maxRequestsPerTurn} request / review · {planner.maxConcurrent} concurrent ·{' '}
        {planner.maxOutputTokens.toLocaleString()} output cap
      </p>
      <p>
        {planner.maxRequestsPerHour} requests / hour cap · at least{' '}
        {Math.round(planner.minRequestIntervalMs / 1000)}s between dispatches
      </p>
      <Tooltip content="Current runner session only. Citizen ticks sum the living population across world ticks. Input/output are reported provider tokens, not reservations or dollars. The cumulative budget below remains authoritative across restarts.">
        <p>
          {planner.citizenTicks > 0 ? planner.requestsPer1000CitizenTicks.toFixed(2) : '—'} calls /
          1,000 citizen ticks
          {measured &&
            ` · average ${Math.round(planner.totalInputTokens / planner.totalRequests).toLocaleString()} in / ${Math.round(planner.totalOutputTokens / planner.totalRequests).toLocaleString()} out`}
        </p>
      </Tooltip>
      <small>
        {snapshot.status.thinking.length} reviewing · world work{' '}
        {snapshot.status.running ? 'continues asynchronously' : 'paused'}
      </small>
    </div>
  );
}
