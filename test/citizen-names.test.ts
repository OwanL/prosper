import { describe, expect, it } from 'vitest';
import { createWorld, dispatch, tickWorld } from '../src/world/core.ts';
import { BALANCE } from '../src/world/config.ts';
import { FIRST_NAMES, LEGACY_FIRST_NAMES, SURNAMES } from '../src/world/name-data.ts';
import { allocateCitizenName, CITIZEN_NAME_CAPACITY } from '../src/world/names.ts';

describe('local citizen name database', () => {
  it('gives 250 founders distinct natural names, retaining the original nine', () => {
    const world = createWorld({ seed: 17, population: 250 });
    const names = Object.values(world.citizens).map((citizen) => citizen.name);
    expect(new Set(names).size).toBe(250);
    expect(names.slice(0, 9)).toEqual(LEGACY_FIRST_NAMES);
    expect(names.every((name) => !/\d/.test(name))).toBe(true);
    for (const name of names.slice(9)) {
      const [firstName, surname, extra] = name.split(' ');
      expect(FIRST_NAMES).toContain(firstName);
      expect(SURNAMES).toContain(surname);
      expect(extra).toBeUndefined();
    }
    expect(new Set(FIRST_NAMES).size).toBe(FIRST_NAMES.length);
    expect(new Set(SURNAMES).size).toBe(SURNAMES.length);
    expect(CITIZEN_NAME_CAPACITY).toBeGreaterThan(8000);
  });

  it('is seed-repeatable without mutating citizens or consuming world RNG', () => {
    const options = { seed: 71, population: 250, runId: 'names-repeatability' };
    const world = createWorld(options);
    expect(createWorld(options)).toEqual(world);
    const before = structuredClone(world);
    expect(allocateCitizenName(world.citizens)).toBe(allocateCitizenName(world.citizens));
    expect(world).toEqual(before);
  });

  it('uses the same allocator for births after restore, reserving dead and saved names', () => {
    const world = createWorld({ seed: 42, scenario: 'progression' });
    world.deposits = {};
    const [a, b, dead] = Object.values(world.citizens);
    a.name = 'Ada 2'; // Historical saved names are not renamed by the allocator.
    b.name = 'Bram 2';
    dead.name = 'Ada';
    dead.alive = false;
    for (const parent of [a, b]) {
      parent.x = 1;
      parent.y = 1;
      parent.fullness = 100;
      parent.inventory = { 'food:1': BALANCE.reproductionFood };
    }
    const expectedName = allocateCitizenName(world.citizens);
    const savedNames = Object.values(world.citizens).map((citizen) => citizen.name);
    expect(dispatch(world, a.id, { type: 'reproduce', partnerId: b.id }).ok).toBe(true);
    const restored = structuredClone(world);
    tickWorld(world, BALANCE.reproductionTicks);
    tickWorld(restored, BALANCE.reproductionTicks);
    expect(restored).toEqual(world);
    const citizens = Object.values(world.citizens);
    expect(citizens).toHaveLength(4);
    expect(citizens.slice(0, 3).map((citizen) => citizen.name)).toEqual(savedNames);
    expect(citizens[3].name).toBe(expectedName);
    expect(citizens[3].name).not.toMatch(/\d/);
    expect(new Set(citizens.map((citizen) => citizen.name)).size).toBe(4);
  });

  it('skips full-name collisions including harmless saved whitespace', () => {
    const citizens: Record<string, { name: string }> = Object.fromEntries(
      LEGACY_FIRST_NAMES.map((name) => [name, { name }]),
    );
    citizens.saved = { name: `  ${FIRST_NAMES[0]}   ${SURNAMES[0]}  ` };
    expect(allocateCitizenName(citizens)).toBe(`${FIRST_NAMES[1]} ${SURNAMES[0]}`);
    expect(citizens.saved.name).toBe(`  ${FIRST_NAMES[0]}   ${SURNAMES[0]}  `);
  });

  it('fails explicitly on database exhaustion rather than inventing numbered names', () => {
    const names = [
      ...LEGACY_FIRST_NAMES,
      ...SURNAMES.flatMap((surname) => FIRST_NAMES.map((firstName) => `${firstName} ${surname}`)),
    ];
    expect(new Set(names).size).toBe(CITIZEN_NAME_CAPACITY);
    const citizens = Object.fromEntries(names.map((name) => [name, { name }]));
    expect(() => allocateCitizenName(citizens)).toThrow('Citizen name database exhausted');
  });
});
