import { describe, expect, it } from 'vitest';
import type { CitizenObservation, World } from '../src/shared/types.ts';
import { createWorld, dispatch } from '../src/world/core.ts';
import { observe, updateKnowledge } from '../src/world/observation.ts';

const structured = ({ ascii: _ascii, entityIndex: _index, ...fields }: CitizenObservation) => JSON.stringify(fields);
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}
function fixture(): World {
  const world = createWorld({ seed: 123, runId: 'observation-performance-test', population: 100, controllerMode: 'composed' });
  updateKnowledge(world);
  return world;
}

describe('structured-only composed observation', () => {
  it.each(['idle', 'busy', 'remembered', 'dead'] as const)('preserves byte-exact structured fields and state for %s citizens', (scenario) => {
    const world = fixture();
    const citizen = Object.values(world.citizens)[0];
    if (scenario === 'busy') {
      expect(dispatch(world, citizen.id, { type: 'move', x: citizen.x === 0 ? 1 : citizen.x - 1, y: citizen.y }).ok).toBe(true);
      expect(citizen.action).not.toBeNull();
    }
    if (scenario === 'remembered') {
      citizen.x = citizen.x < world.width / 2 ? world.width - 1 : 0;
      citizen.y = citizen.y < world.height / 2 ? world.height - 1 : 0;
    }
    if (scenario === 'dead') citizen.alive = false;
    const before = JSON.stringify(world);
    freeze(world);
    const full = observe(world, citizen.id);
    const lean = observe(world, citizen.id, { includeText: false });
    expect(structured(lean)).toBe(structured(full));
    expect(lean.ascii).toBe('');
    expect(lean.entityIndex).toEqual([]);
    expect(observe(world, citizen.id, { includeText: true })).toEqual(full);
    expect(observe(world, citizen.id, {})).toEqual(full);
    expect(full.ascii.split('\n')).toHaveLength(world.height);
    expect(full.ascii.split('\n').every(row => row.length === world.width)).toBe(true);
    if (scenario === 'remembered') expect(full.remembered.length).toBeGreaterThan(0);
    expect(JSON.stringify(world)).toBe(before);
    // Projected notebooks and inventories remain independently owned clones.
    lean.citizen.inventory['food:1'] = 9999;
    if (lean.visible[0]) lean.visible[0].seenTick = -1;
    expect(JSON.stringify(world)).toBe(before);
    expect(structured(observe(world, citizen.id))).toBe(structured(full));
  });

  it('keeps the default ASCII legend and entity descriptions unchanged', () => {
    const world = fixture();
    const citizen = Object.values(world.citizens)[0];
    const full = observe(world, citizen.id);
    const tiles = new Map(full.visible.map(tile => [`${tile.x},${tile.y}`, tile]));
    const rows: string[] = [];
    for (let y = world.height - 1; y >= 0; y--) {
      let row = '';
      for (let x = 0; x < world.width; x++) {
        const tile = tiles.get(`${x},${y}`);
        row += !tile ? 'x' : tile.citizens.length ? '@' : tile.buildings.length ? tile.buildings[0].kind === 'wall' ? '#' : 'B' : tile.loot.length ? 'L' : tile.deposits.length ? { wood: 'W', food: 'F', fibre: 'V' }[tile.deposits[0].resource] : '.';
      }
      rows.push(row);
    }
    expect(full.ascii).toBe(rows.join('\n'));
    expect(full.entityIndex).toEqual(full.visible.filter(tile => tile.citizens.length || tile.deposits.length || tile.buildings.length || tile.loot.length).map(tile =>
      `(${tile.x},${tile.y}) seen tick ${tile.seenTick}: ${[
        ...tile.citizens.map(c => `citizen ${c.id} ${c.name}`),
        ...tile.deposits.map(d => `deposit ${d.id} ${d.resource} T${d.tier} stock ${d.stock}`),
        ...tile.buildings.map(b => `building ${b.id} ${b.kind} T${b.tier} owner ${b.ownerId ?? 'none'} health ${b.health}`),
        ...tile.loot.map(l => `loot ${l.id} ${l.citizenName}`),
      ].join('; ')}`));
  });
});
