import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { enableAutonomy } from '../src/world/autonomy.ts';
import { BALANCE } from '../src/world/config.ts';
import { startingCharacter } from '../src/world/characters.ts';
import { validateCheckpoint, type Checkpoint } from '../src/server/checkpoint.ts';
import { observe } from '../src/world/observation.ts';
import { freshContext } from '../src/citizen/prompt.ts';

function checkpoint(world: ReturnType<typeof createWorld>): Checkpoint {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    world,
    runtime: { running: false, speed: 1, mode: 'live', commandSequence: 0, recorded: [] },
  };
}

describe('future-world character initialization', () => {
  it.each(['village', 'competition', 'progression'] as const)(
    'cycles the nine distinct founder profiles only when creating %s',
    (scenario) => {
      const world = createWorld({ scenario, seed: 123 });
      const citizens = Object.values(world.citizens);
      expect(citizens).toHaveLength(
        scenario === 'competition' ? 9 : scenario === 'progression' ? 3 : BALANCE.initialCitizens,
      );
      expect(new Set(citizens.map((c) => c.personality)).size).toBe(Math.min(9, citizens.length));
      citizens.forEach((c, index) => {
        expect(c.personality).toBe(startingCharacter(index % 9).personality);
        expect(c.goals).toEqual(startingCharacter(index % 9).goals);
        expect(c.memories).toEqual([]);
        expect(c.parents).toEqual([]);
        expect(c.consent).toEqual({});
        expect(c.gold).toBe(100);
        expect(c.inventory).toEqual({ 'food:1': 3 });
      });
      const another = createWorld({ scenario, seed: 123 });
      expect(another.rngState).toBe(world.rngState);
      expect(another.deposits).toEqual(world.deposits);
      expect(Object.values(another.citizens).map((c) => [c.x, c.y])).toEqual(
        citizens.map((c) => [c.x, c.y]),
      );
    },
  );

  it('gives newborns inherited trait variation rather than another founder template', () => {
    const world = createWorld({ seed: 123, population: 2 });
    const [a, b] = Object.values(world.citizens);
    for (const parent of [a, b]) {
      enableAutonomy(world, parent);
      parent.x = 1;
      parent.y = 1;
      parent.inventory[`food:${BALANCE.reproductionFoodTier}`] = BALANCE.reproductionFood;
    }
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).ok).toBe(true);
    tickWorld(world, BALANCE.reproductionTicks);
    const children = Object.values(world.citizens).filter((c) => c.parents.length > 0);
    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child.parents).toEqual([a.id, b.id]);
    expect(child.personality).toContain('Inherited disposition:');
    expect(child.personality).not.toBe(a.personality);
    expect(child.personality).not.toBe(b.personality);
    const traits = child.autonomy!.traits;
    expect(traits).not.toEqual(a.autonomy!.traits);
    expect(traits).not.toEqual(b.autonomy!.traits);
    for (const key of Object.keys(traits) as (keyof typeof traits)[]) {
      const midpoint = (a.autonomy!.traits[key] + b.autonomy!.traits[key]) / 2;
      expect(traits[key]).toBeGreaterThanOrEqual(Math.max(0, midpoint - 0.1));
      expect(traits[key]).toBeLessThanOrEqual(Math.min(1, midpoint + 0.1));
    }
    expect(child.gold).toBe(0);
  });

  it('preserves old and citizen-authored personalities, goals and memories across restore', () => {
    const world = createWorld({ seed: 123 });
    const citizen = Object.values(world.citizens)[0];
    citizen.personality = 'Practical and community-minded';
    citizen.goals = ['My existing intention'];
    citizen.memories = [{ tick: 0, text: 'My existing relationship notes.' }];
    const before = structuredClone(world);
    const restored = validateCheckpoint(JSON.parse(JSON.stringify(checkpoint(world))));
    expect(restored.world).toEqual(before);
    const context = JSON.parse(freshContext(observe(restored.world, citizen.id))[1].content!);
    expect(context.personalityMemoriesGoals.personality).toBe('Practical and community-minded');
    expect(context.personalityMemoriesGoals.goals).toEqual(['My existing intention']);
    expect(world).toEqual(before);
  });
});
