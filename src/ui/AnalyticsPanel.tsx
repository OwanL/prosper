import { useId, useRef, useState } from 'react';
import type { World } from '../shared/types';
import HistoryCharts from './HistoryCharts';
import './analytics.css';

export interface AnalyticsPanelProps {
  world: World;
  knowledge?: boolean;
}

/** Current committed state, not an inferred trajectory or lifetime event count. */
export function analyticsSummary(world: World) {
  const living = Object.values(world.citizens).filter((citizen) => citizen.alive);
  const average = (key: 'health' | 'fullness') => {
    if (!living.length || living.some((citizen) => !Number.isFinite(citizen[key]))) return null;
    return living.reduce((sum, citizen) => sum + citizen[key], 0) / living.length;
  };
  return {
    population: living.length,
    meanHealth: average('health'),
    meanFullness: average('fullness'),
    working: living.filter((citizen) => citizen.action != null).length,
  };
}

const sections = ['overview', 'markets', 'resources'] as const;
const titles = { overview: 'Overview', markets: 'Markets', resources: 'Resources' };
const descriptions = {
  overview: 'The society now, with population and wellbeing over the retained recording.',
  markets:
    'Compare the best buy bids and sell asks. Then explore actual traded volume and gold turnover.',
  resources:
    'Explore commodity stock and open orders by tier. Available stock and market supply are different measures.',
};
const format = (value: number | null) =>
  value == null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 1 });

export function AnalyticsPanel({ world, knowledge = false }: AnalyticsPanelProps) {
  const [view, setView] = useState<(typeof sections)[number]>('overview');
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const summary = analyticsSummary(world);
  if (knowledge)
    return (
      <section className="analytics-panel" aria-label="Analytics">
        <h2>Analytics</h2>
        <p>
          Global analytics are hidden in citizen knowledge view. Switch to spectator view to explore
          recorded world history.
        </p>
      </section>
    );
  return (
    <section className="analytics-panel" aria-label="Analytics">
      <header className="analytics-heading">
        <div>
          <span className="analytics-eyebrow">World analytics</span>
          <h2>Understand the world</h2>
        </div>
        <span className="analytics-tick">Current tick {world.tick.toLocaleString()}</span>
      </header>
      <div className="analytics-tabs" role="tablist" aria-label="Analytics sections">
        {sections.map((section, index) => (
          <button
            key={section}
            type="button"
            role="tab"
            id={`${id}-${section}-tab`}
            aria-controls={`${id}-panel`}
            aria-selected={view === section}
            tabIndex={view === section ? 0 : -1}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            onClick={() => setView(section)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
              else if (event.key === 'ArrowLeft')
                next = (index + sections.length - 1) % sections.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = sections.length - 1;
              else return;
              event.preventDefault();
              setView(sections[next]!);
              tabs.current[next]?.focus();
            }}
          >
            {titles[section]}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        className="analytics-content"
        role="tabpanel"
        aria-labelledby={`${id}-${view}-tab`}
        tabIndex={0}
      >
        <div className="analytics-context">
          <p className="analytics-description">{descriptions[view]}</p>
          {view === 'overview' && (
            <dl className="analytics-cards" aria-label="Current world summary">
              {[
                ['Living citizens', summary.population, 'Current population'],
                ['Average health', summary.meanHealth, 'Living citizens · out of 100'],
                ['Average fullness', summary.meanFullness, 'Living citizens · out of 100'],
                ['Active actions', summary.working, 'Living citizens performing an action'],
              ].map(([label, value, detail]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{format(value as number | null)}</dd>
                  <small>{detail}</small>
                </div>
              ))}
            </dl>
          )}
        </div>
        {/* Keep one history component mounted across tabs: no duplicate global fetches. */}
        <HistoryCharts world={world} scope="global" view={view} />
      </div>
    </section>
  );
}

export default AnalyticsPanel;
