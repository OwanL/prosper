import { useId, useState } from 'react';
import type { Citizen, World, WorldEvent } from '../shared/types';
import { citizenColor, unaffiliatedColor, type SceneModel } from './model';
import { humanizeEvent, storyKinds } from './story';
import './activity.css';

/** A narrow input also allows callers to supply only perspective-known names. */
export type ActivityWorld = Pick<World, 'tick' | 'events' | 'significantEvents'> & {
  citizens: Record<string, Pick<Citizen, 'name'>>;
};
export interface WorldActivityProps {
  world: ActivityWorld;
  /** Explicitly supplied events (including []) replace spectator history, never merge it. */
  events?: WorldEvent[];
  onFocus: (event: WorldEvent) => void;
}

const activityLabels: Record<string, string> = {
  ...Object.fromEntries(Object.entries(storyKinds).map(([kind, story]) => [kind, story.label])),
  help: 'Gift',
  emergency: 'Emergency feeding',
};

/** Recent retained consequences, not a lifetime log or a claim of current action. */
export function selectActivityEvents(world: ActivityWorld, events?: WorldEvent[]): WorldEvent[] {
  const seenIds = new Set<string>();
  const repeated = new Set<string>();
  return [...(events ?? world.significantEvents ?? world.events)]
    .filter((event) => activityLabels[event.kind] && event.tick <= world.tick)
    .sort((a, b) => b.tick - a.tick)
    .filter((event) => {
      if (seenIds.has(event.id)) return false;
      seenIds.add(event.id);
      // Suppress identical routine consequences, but retain distinct combat/family outcomes.
      if (['trade', 'claim', 'trespass', 'help', 'emergency'].includes(event.kind)) {
        const key = JSON.stringify([event.kind, event.citizenId, event.targetId, event.text]);
        if (repeated.has(key)) return false;
        repeated.add(key);
      }
      return true;
    })
    .slice(0, 20);
}

export function WorldActivity({ world, events, onFocus }: WorldActivityProps) {
  const recent = selectActivityEvents(world, events);
  const row = (event: WorldEvent) => {
    const text = humanizeEvent(event.text, world.citizens);
    const actor = event.citizenId && world.citizens[event.citizenId]?.name;
    return (
      <li key={event.id}>
        <button className="activity-event" type="button" onClick={() => onFocus(event)}>
          <span className="activity-event-meta">
            <strong>{activityLabels[event.kind]}</strong>
            <span>Tick {event.tick}</span>
          </span>
          <span className="activity-event-text">
            {actor && !text.includes(actor) ? `${actor} · ` : ''}
            {text}
          </span>
        </button>
      </li>
    );
  };
  return (
    <section className="world-activity" aria-label="World activity">
      <details>
        <summary>
          Activity{' '}
          <span className="activity-summary-note">
            {recent.length ? 'Recent recorded events' : 'No retained activity'}
          </span>
        </summary>
        <div className="activity-expanded">
          <p className="activity-note">Recent retained consequences · newest first · up to 20</p>
          {recent.length ? (
            <ol className="activity-list">{recent.map(row)}</ol>
          ) : (
            <p className="activity-empty">No consequential events in this view.</p>
          )}
        </div>
      </details>
      <ol className="activity-preview" aria-label="Latest activity">
        {recent.slice(0, 3).map(row)}
      </ol>
    </section>
  );
}

export interface CitizenRosterProps {
  citizens: SceneModel['citizens'];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Perspective marker only; all data must already be projected by the caller. */
  privateId?: string;
}

export function filterRoster(
  citizens: SceneModel['citizens'],
  query: string,
): SceneModel['citizens'] {
  const term = query.trim().toLocaleLowerCase();
  return citizens.filter(({ value, remembered }) =>
    `${value.name} ${value.alive ? value.activity : 'dead'} ${remembered ? 'remembered' : ''}`
      .toLocaleLowerCase()
      .includes(term),
  );
}

export type RosterSort = 'name' | 'status' | 'membership' | 'gold' | 'resources';
export function resourceTotal(resources: Record<string, number> | undefined): number | undefined {
  return resources === undefined ? undefined : Object.values(resources).reduce((sum, n) => sum + n, 0);
}
/** Carried quantities by resource identity, without hiding fractional units. */
export function resourceSummary(resources: Record<string, number>): [string, number][] {
  const totals = new Map<string, number>();
  for (const [item, quantity] of Object.entries(resources)) {
    const resource = item.split(':')[0];
    totals.set(resource, (totals.get(resource) ?? 0) + quantity);
  }
  return [...totals].filter(([, quantity]) => quantity !== 0)
    .sort(([a], [b]) => a.localeCompare(b));
}
export function sortRoster(citizens: SceneModel['citizens'], sort: RosterSort): SceneModel['citizens'] {
  return [...citizens].sort((a, b) => {
    const av = a.value, bv = b.value;
    if (sort === 'gold' || sort === 'resources') {
      const x = sort === 'gold' ? (av.resources === undefined ? undefined : av.gold) : resourceTotal(av.resources);
      const y = sort === 'gold' ? (bv.resources === undefined ? undefined : bv.gold) : resourceTotal(bv.resources);
      if (x === undefined && y !== undefined) return 1;
      if (y === undefined && x !== undefined) return -1;
      if (x !== undefined && y !== undefined && x !== y) return y - x;
    }
    const field = (c: typeof av) => sort === 'status' ? (c.alive ? c.activity : 'dead')
      : sort === 'membership' ? c.territory?.label ?? 'Unaffiliated' : c.name;
    return field(av).localeCompare(field(bv)) || av.name.localeCompare(bv.name) || av.id.localeCompare(bv.id);
  });
}
export function CitizenRoster({ citizens, selectedId, onSelect, privateId }: CitizenRosterProps) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const [sort, setSort] = useState<RosterSort>('name');
  const [territoryFilter, setTerritoryFilter] = useState<string | null>(null);
  const groups = [...new Map(citizens.flatMap(({ value }) => value.territory
    ? [[value.territory.id, value.territory] as const] : [])).values()]
    .sort((a, b) => a.label.localeCompare(b.label));
  const visible = sortRoster(filterRoster(citizens, query).filter(({ value }) =>
    territoryFilter === null || (value.territory?.id ?? '') === territoryFilter), sort);
  const vital = (label: string, value: number | undefined, remembered: boolean) =>
    typeof value === 'number' && Number.isFinite(value) ? (
      <span>
        {remembered ? 'Last known ' : ''}
        {label} {Math.round(value)}/100
      </span>
    ) : null;
  return (
    <section className="citizen-roster" aria-label="Citizen roster">
      <div className="roster-search">
        <label htmlFor={searchId}>Find citizens</label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or activity"
        />
        <label htmlFor={`${searchId}-sort`}>Sort by</label>
        <select id={`${searchId}-sort`} value={sort} onChange={(event) => setSort(event.target.value as RosterSort)}>
          <option value="name">Name</option><option value="status">Status</option>
          <option value="membership">Territory</option><option value="gold">Gold (high first)</option>
          <option value="resources">Carried units (high first)</option>
        </select>
        <p className="activity-note">
          {visible.length} of {citizens.length} in this view
        </p>
      </div>
      <details className="territory-overview" open>
        <summary>Territories in this view</summary>
        <p className="activity-note">Known members only · shirts share territory colors · unaffiliated neutral grey</p>
        <div className="territory-filter-list">
          <button type="button" aria-pressed={territoryFilter === null} onClick={() => setTerritoryFilter(null)}>All citizens</button>
          {groups.map(group => <button key={group.id} type="button"
            aria-pressed={territoryFilter === group.id} onClick={() => setTerritoryFilter(group.id)}>
            <span className="roster-swatch" style={{ background: group.color }} />{group.label}
            {' · '}{citizens.filter(({ value }) => value.territory?.id === group.id).length} members
          </button>)}
          <button type="button" aria-pressed={territoryFilter === ''} onClick={() => setTerritoryFilter('')}>
            <span className="roster-swatch" style={{ background: unaffiliatedColor }} />Unaffiliated
            {' · '}{citizens.filter(({ value }) => !value.territory).length} citizens
          </button>
        </div>
      </details>
      <ul className="roster-list">
        {visible.map(({ value: citizen, remembered, seenTick }) => (
          <li key={citizen.id}>
            <button
              type="button"
              className="roster-citizen"
              aria-pressed={selectedId === citizen.id}
              onClick={() => onSelect(citizen.id)}
            >
              <span className="roster-heading">
                <strong><span className="roster-swatch" style={{ background: citizenColor(citizen) }} />{citizen.name}</strong>
                <span className="roster-badges">
                  {citizen.id === privateId && <span className="roster-badge">Perspective</span>}
                  {!citizen.alive && <span className="roster-badge roster-dead">Dead</span>}
                  {remembered && <span className="roster-badge">Remembered</span>}
                </span>
              </span>
              <span className="roster-status">
                {remembered ? 'Last seen: ' : ''}
                {citizen.alive ? citizen.activity : 'Dead'}
                {remembered ? ` · tick ${seenTick}` : ''}
              </span>
              <span className="roster-membership">
                {citizen.territory ? `${citizen.territory.label} · ${citizen.territory.role}` : 'Unaffiliated'}
              </span>
              <span className="roster-economy">
                Gold {citizen.resources === undefined || citizen.gold === undefined ? 'unknown' : citizen.gold} · Carried {resourceTotal(citizen.resources) ?? 'unknown'}
                {citizen.resources !== undefined ? ' units' : ''}
              </span>
              <span className="roster-resource-summary" aria-label="Carried resources">
                {citizen.resources === undefined ? <span>Resources unknown</span>
                  : resourceSummary(citizen.resources).length ? resourceSummary(citizen.resources).map(([resource, quantity]) => (
                    <span className="roster-resource-chip" key={resource}>{resource} {quantity}</span>
                  )) : <span>Empty inventory · 0 resources</span>}
              </span>
              <span className="roster-vitals">
                {vital('Health', citizen.health, remembered)}
                {vital('Fullness', citizen.fullness, remembered)}
              </span>
            </button>
            {citizen.resources !== undefined && (
              <details className="roster-resources">
                <summary>Resources by tier</summary>
                <div>{Object.entries(citizen.resources).filter(([, n]) => n !== 0)
                  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
                  .map(([item, n]) => <span key={item}>{item.replace(':', ' T')}: {n}</span>)}
                  {!resourceTotal(citizen.resources) && <span>Empty inventory</span>}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
      {!visible.length && (
        <p className="activity-empty">
          {citizens.length ? 'No citizens match your search.' : 'No citizens known in this view.'}
        </p>
      )}
    </section>
  );
}
