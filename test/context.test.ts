import { describe, expect, it } from 'vitest';
import type { TileMemory, WorldEvent } from '../src/shared/types.ts';
import { providerContext } from '../src/citizen/context.ts';
import { freshContext } from '../src/citizen/prompt.ts';
import { createWorld } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';

function setup() {
  const world = createWorld();
  updateKnowledge(world);
  return observe(world, Object.keys(world.citizens)[0]);
}
function alert(index: number, kind = 'command', text = 'Completed harvest.'): WorldEvent {
  return { id: `event-${index}`, tick: index, kind, text, audience: ['test'] };
}
function tile(x: number, seenTick: number): TileMemory {
  return { x, y: 1, seenTick, citizens: [], deposits: [], buildings: [], loot: [] };
}

describe('provider-only context compaction', () => {
  it('keeps the latest eight routine outcomes and every error, trade and consequential/unknown alert', () => {
    const observation = setup();
    observation.alerts = Array.from({ length: 60 }, (_, i) => alert(i));
    const important = [
      alert(61, 'error', 'Required unreserved materials.'),
      alert(1, 'error', 'Old error still relevant.'),
      alert(2, 'attack', 'Attack on owned wall at (4,5).'),
      alert(3, 'trade', '1 wood:1 sold for 6 gold each.'),
      alert(4, 'command', 'Transferred 10 gold.'),
      alert(5, 'completion', 'Completed reproduce.'),
      alert(6, 'command', 'Started attack.'),
      alert(7, 'destruction', 'Destroyed building.'),
      alert(8, 'new-kind', 'Unrecognized feedback.'),
      alert(9, 'command', 'Order accepted; 3 remaining.'),
    ];
    observation.alerts.push(...important);
    const before = structuredClone(observation);
    const projected = providerContext(observation);
    expect(projected.alerts).toEqual([...observation.alerts.slice(52, 60), ...important]);
    expect(projected.alertHistoryOmitted?.omittedByKind).toEqual({ command: 52 });
    expect(observation).toEqual(before);
  });

  it('uses tick recency, not source order, and keeps the final routine command/completion feedback', () => {
    const observation = setup();
    observation.alerts = Array.from({ length: 12 }, (_, i) => alert(12 - i));
    observation.alerts.push(alert(50, 'meal', 'Ate T1 food.'));
    expect(providerContext(observation).alerts.map((a) => a.tick)).toEqual([
      12, 11, 10, 9, 8, 7, 6, 50,
    ]);
    observation.alerts = [alert(0, 'command', 'Goals replaced.')];
    expect(providerContext(observation).alertHistoryOmitted).toBeUndefined();
  });

  it('preserves dated empty knowledge and all occupied-tile entity details without empty arrays', () => {
    const observation = setup();
    const occupied = tile(4, 17);
    occupied.deposits.push({
      id: 'known',
      x: 4,
      y: 1,
      resource: 'food',
      tier: 1,
      stock: 0,
      capacity: 5,
      regrowAt: 80,
    });
    occupied.citizens.push({
      id: 'neighbor',
      name: 'Neighbor',
      color: 'red',
      x: 4,
      y: 1,
      alive: true,
      health: 70,
      activity: 'present',
    });
    occupied.buildings.push({
      id: 'wall',
      x: 4,
      y: 1,
      kind: 'wall',
      tier: 1,
      ownerId: 'neighbor',
      health: 40,
      maxHealth: 100,
      materials: { 'wood:1': 3 },
    });
    occupied.loot.push({ id: 'body', x: 4, y: 1, citizenName: 'Deceased' });
    const depositOnly = { ...tile(5, 20), deposits: occupied.deposits };
    observation.remembered = [tile(3, 10), occupied, depositOnly];
    const projected = providerContext(observation);
    expect(projected.rememberedEmpty).toEqual([[3, 1, 10]]);
    expect(projected.remembered[0]).toEqual(occupied);
    expect(projected.remembered[1]).toEqual({
      x: 5,
      y: 1,
      seenTick: 20,
      deposits: occupied.deposits,
    });
    expect(projected.rememberedFormat).toContain('not live facts');
  });

  it('losslessly omits empty arrays from current sightings without hiding observed walls or entities', () => {
    const observation = setup();
    observation.visible = [
      tile(1, observation.tick),
      {
        ...tile(2, observation.tick),
        buildings: [
          {
            id: 'wall',
            x: 2,
            y: 1,
            kind: 'wall',
            tier: 1,
            ownerId: 'neighbor',
            health: 40,
            maxHealth: 100,
            materials: {},
          },
        ],
      },
    ];
    const before = structuredClone(observation);
    const projected = providerContext(observation) as ReturnType<typeof providerContext> & {
      visible?: any[];
      visibleFormat?: string;
    };
    expect(projected.visible?.[0]).toEqual({ x: 1, y: 1, seenTick: observation.tick });
    expect(projected.visible?.[1].buildings).toEqual(observation.visible[1].buildings);
    expect(projected.visibleFormat).toContain('Missing entity arrays are empty');
    expect(observation).toEqual(before);
  });

  it('changes only provider history/map encoding, retaining goals, execution, sight and communications', () => {
    const observation = setup();
    observation.citizen.goals = ['Keep my unfinished intention'];
    observation.citizen.memories = [{ tick: 4, text: 'Relationship continuity' }];
    observation.citizen.queue = [{ type: 'move', x: 1, y: 2 }];
    observation.alerts = Array.from({ length: 100 }, (_, i) => alert(i));
    observation.remembered = Array.from({ length: 40 }, (_, i) => tile(i, 5));
    const before = structuredClone(observation);
    const user = JSON.parse(freshContext(observation)[1].content!);
    expect(user.personalityMemoriesGoals.goals).toEqual(observation.citizen.goals);
    expect(user.personalityMemoriesGoals.memories).toEqual(observation.citizen.memories);
    expect(user.execution.queue).toEqual(observation.citizen.queue);
    expect(user.execution.recentResult).toEqual(observation.citizen.lastResult);
    expect(
      user.currentWorld.visible.map((t: Partial<TileMemory>) => ({
        citizens: [],
        deposits: [],
        buildings: [],
        loot: [],
        ...t,
      })),
    ).toEqual(observation.visible);
    expect(user.currentWorld.entityIndex).toEqual(observation.entityIndex);
    expect(user.communications.messages).toEqual(observation.messages);
    expect(user.communications.markets).toEqual(observation.markets);
    expect(observation).toEqual(before);
    const oldComponents = JSON.stringify({
      alerts: observation.alerts,
      remembered: observation.remembered,
    });
    expect(JSON.stringify(providerContext(observation)).length).toBeLessThan(
      oldComponents.length / 2,
    );
  });
});
