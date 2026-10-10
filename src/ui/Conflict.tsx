import { useState } from 'react';
import type { World, WorldEvent } from '../shared/types';
import type { Alliance, TerritorialClaim } from '../shared/autonomy-types';
import { humanizeEvent } from './story';

export function claimAlliance(claim: TerritorialClaim, alliances: Alliance[]) {
  return alliances.find((a) => a.members.includes(claim.ownerId));
}
export function contestedOverlaps(claims: TerritorialClaim[], alliances: Alliance[]) {
  return claims.flatMap((a, index) =>
    claims.slice(index + 1).flatMap((b) => {
      if (a.ownerId === b.ownerId || claimAlliance(a, alliances)?.members.includes(b.ownerId))
        return [];
      const [ax, ay, bx, by] = a.areas,
        [cx, cy, dx, dy] = b.areas;
      const area = [
        Math.max(ax, cx),
        Math.max(ay, cy),
        Math.min(bx, dx),
        Math.min(by, dy),
      ] as const;
      return area[0] <= area[2] && area[1] <= area[3] ? [{ a, b, area }] : [];
    }),
  );
}
export function Conflict({
  world,
  select,
  focus,
}: {
  world: World;
  select: (id: string) => void;
  focus: (event: WorldEvent) => void;
}) {
  const active = Object.values(world.citizens).filter(
    (c) => c.alive && c.action?.command.type === 'attack',
  );
  const [expanded, setExpanded] = useState(active.length > 0);
  const claims = Object.values(world.claims ?? {}).filter(
    (c) => c.expiresTick > world.tick && world.citizens[c.ownerId]?.alive,
  );
  const alliances = Object.values(world.alliances ?? {});
  const overlaps = contestedOverlaps(claims, alliances);
  const recent = (world.significantEvents ?? world.events)
    .filter((e) => e.kind === 'attack' && e.tick <= world.tick)
    .slice(-5)
    .reverse();
  return (
    <section className="conflict-view" aria-label="Combat and territory">
      <details open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>
          Combat & territory · {active.length} active attacks · {overlaps.length} rival overlaps
        </summary>
        <h3>Active attacks · current actions</h3>
        <ul>
          {active.map((c) => {
            const command = c.action!.command;
            if (command.type !== 'attack') return null;
            return (
              <li key={c.id}>
                <button onClick={() => select(c.id)}>
                  {c.name} → {world.citizens[command.targetId]?.name ?? command.targetId} ·{' '}
                  {c.action!.phase === 'travel' ? 'pursuing' : 'striking'} · focus attacker
                </button>
              </li>
            );
          })}
        </ul>
        {!active.length && <p>No active attacks</p>}
        <h3>Recent strikes · recorded, not active</h3>
        <ul>
          {recent.map((e) => (
            <li key={e.id}>
              <button onClick={() => focus(e)}>
                Tick {e.tick} · {humanizeEvent(e.text, world.citizens)}
              </button>
            </li>
          ))}
        </ul>
        {!recent.length && <p>No retained strikes</p>}
        <details>
          <summary>Claims & alliance members</summary>
          <p>
            Shared claims use one representative. Rival overlaps are competing demands, not
            confirmed fighting.
          </p>
          <ul>
            {claims.map((c) => {
              const a = claimAlliance(c, alliances);
              return (
                <li key={c.id}>
                  <button onClick={() => select(c.ownerId)}>
                    {a ? `Alliance ${a.name}` : (world.citizens[c.ownerId]?.name ?? c.ownerId)} ·{' '}
                    {c.resource} · {c.stance}
                  </button>
                  {a && (
                    <span>
                      {' '}
                      · members: {a.members.map((id) => world.citizens[id]?.name ?? id).join(', ')}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <ul>
            {overlaps.map(({ a, b, area }) => (
              <li key={`${a.id}-${b.id}`}>
                Contested: {claimAlliance(a, alliances)?.name ?? world.citizens[a.ownerId]?.name} ↔{' '}
                {claimAlliance(b, alliances)?.name ?? world.citizens[b.ownerId]?.name} · (
                {area.join(', ')})
              </li>
            ))}
          </ul>
        </details>
      </details>
    </section>
  );
}
