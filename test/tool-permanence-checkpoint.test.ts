import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCheckpoint, saveCheckpoint, validateCheckpoint } from '../src/server/checkpoint.ts';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { highestToolTier } from '../src/shared/tool-utils.ts';
import { event } from '../src/shared/utils.ts';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function legacyCheckpoint() {
  const world = createWorld({ seed: 7, scenario: 'progression', population: 2 });
  const citizen = Object.values(world.citizens)[0];
  citizen.inventory = { 'wood:1': 5, 'fibre:1': 6, 'food:1': 5, 'axe:2': 1, 'sword:2': 1 };
  expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 }).ok).toBe(true);
  expect(
    dispatch(world, citizen.id, { type: 'order', side: 'buy', item: 'wood:1', quantity: 1, price: 2 }).ok,
  ).toBe(true);
  tickWorld(world, 1);
  event(world, 'maintenance', 'Historical servicing event.', {
    citizenId: citizen.id,
    audience: [citizen.id],
  });
  const legacy = {
    version: 1 as const,
    savedAt: new Date(0).toISOString(),
    world: { ...structuredClone(world), maintenance: true },
    runtime: {
      running: false,
      speed: 1,
      mode: 'scripted' as const,
      commandSequence: 2,
      recorded: [],
    },
  };
  Object.assign(legacy.world.citizens[citizen.id], { maintenance: { axe: 64, sword: 320 } });
  return { legacy, citizenId: citizen.id };
}

describe('retired servicing checkpoint compatibility', () => {
  it('drops only retired fields, preserving tools, committed work, escrow and history', () => {
    const { legacy, citizenId } = legacyCheckpoint();
    const original = structuredClone(legacy);
    const expected = structuredClone(legacy);
    Reflect.deleteProperty(expected.world, 'maintenance');
    for (const citizen of Object.values(expected.world.citizens))
      Reflect.deleteProperty(citizen, 'maintenance');
    const restored = validateCheckpoint(legacy);
    expect(restored).toEqual(expected);
    expect(legacy).toEqual(original); // Validation does not rewrite its input.
    const citizen = restored.world.citizens[citizenId];
    expect(highestToolTier(citizen, 'axe')).toBe(2);
    expect(highestToolTier(citizen, 'sword')).toBe(2);
    expect(citizen.action?.reserved).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    tickWorld(restored.world, 7);
    expect(citizen.action).toBeNull();
    expect(citizen.inventory).toEqual({
      'wood:1': 2,
      'fibre:1': 3,
      'food:1': 5,
      'axe:2': 1,
      'sword:2': 1,
      'knife:1': 1,
    });
    expect(Object.values(restored.world.orders)).toHaveLength(1);
  });

  it('loads and resaves legacy files without servicing fields or loss of history', () => {
    const { legacy } = legacyCheckpoint();
    const directory = mkdtempSync(join(tmpdir(), 'prosper-tool-checkpoint-'));
    directories.push(directory);
    const file = join(directory, 'checkpoint.json');
    writeFileSync(file, JSON.stringify(legacy));
    const restored = loadCheckpoint(file);
    saveCheckpoint(file, restored);
    expect(loadCheckpoint(file)).toEqual(restored);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect('maintenance' in saved.world).toBe(false);
    expect(
      Object.values(saved.world.citizens).every(
        (citizen) => !('maintenance' in (citizen as object)),
      ),
    ).toBe(true);
    expect(saved.world.events).toEqual(legacy.world.events);
  });

  it('still rejects corrupt retired metadata rather than silently accepting malformed checkpoints', () => {
    const { legacy, citizenId } = legacyCheckpoint();
    Object.assign(legacy.world.citizens[citizenId], { maintenance: { axe: -1 } });
    expect(() => validateCheckpoint(legacy)).toThrow(/Invalid checkpoint shape\/version/);
  });
});
