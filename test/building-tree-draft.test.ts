import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/shared/types.ts';
import { TIERS } from '../src/shared/tiers.ts';
import { itemKey } from '../src/shared/utils.ts';
import { buildingRecipe, RESOURCES } from '../src/world/config.ts';
import { createWorld, dispatch } from '../src/world/core.ts';
import type {
  DraftTree,
  ResourceBuildingRequest,
} from '../docs/research/decision-tree/draft-types.ts';
import {
  canBuildResourceBuilding,
  resourceBuildings,
} from '../docs/research/decision-tree/trees/can-build-resource-building.ts';
import {
  renderMermaid,
  updateDiagram,
  validateTree,
} from '../docs/research/decision-tree/render.ts';

// Test-only execution of the declared material checks. This is not a citizen
// controller or arbitrary branch-outcome mock: decisions use the supplied stock
// and the existing authoritative recipe.
function materialsReady(request: ResourceBuildingRequest, inventory: Readonly<Inventory>): boolean {
  const recipe = buildingRecipe(resourceBuildings[request.resource], request.tier);
  const tree: DraftTree = canBuildResourceBuilding;
  let id = tree.entry;
  for (let count = 0; count < Object.keys(tree.nodes).length; count++) {
    const node = tree.nodes[id];
    if (node.kind === 'boolean') return node.value;
    if (node.kind === 'step' && node.operation === 'entry') id = node.next;
    else if (node.kind === 'decision' && 'requiredResource' in node) {
      const key = itemKey(node.requiredResource, request.tier);
      id = (inventory[key] ?? 0) >= recipe[key] ? node.yes : node.no;
    } else throw new Error(`Unexpected operation in materials-only guard: ${id}`);
  }
  throw new Error('Materials guard did not terminate');
}

const request: ResourceBuildingRequest = { resource: 'wood', tier: 1 };

describe('inventory-only building condition draft', () => {
  it('validates and synchronizes the generated diagram with no action or site nodes', () => {
    expect(() => validateTree(canBuildResourceBuilding)).not.toThrow();
    const nodes = Object.values(canBuildResourceBuilding.nodes);
    expect(nodes.map((node) => node.kind)).toEqual([
      'step',
      'decision',
      'decision',
      'boolean',
      'boolean',
    ]);
    expect(canBuildResourceBuilding.nodes.Wood.requiredResource).toBe('wood');
    expect(canBuildResourceBuilding.nodes.Fibre.requiredResource).toBe('fibre');
    const text = readFileSync(
      new URL(
        '../docs/research/decision-tree/trees/can-build-resource-building.md',
        import.meta.url,
      ),
      'utf8',
    );
    expect(updateDiagram(text, canBuildResourceBuilding)).toBe(text);
    expect(text).toContain(`\`\`\`mermaid\n${renderMermaid(canBuildResourceBuilding)}\n\`\`\``);
  });

  it('accepts exact or excess recipe stock for every resource station and configured tier', () => {
    for (const resource of RESOURCES) {
      for (const tier of TIERS) {
        const current = { resource, tier };
        const recipe = buildingRecipe(resourceBuildings[resource], tier);
        expect(materialsReady(current, recipe), `${resource} T${tier} exact`).toBe(true);
        const excess = Object.fromEntries(
          Object.entries(recipe).map(([key, quantity]) => [key, quantity + 1]),
        );
        expect(materialsReady(current, excess), `${resource} T${tier} excess`).toBe(true);
        for (const key of Object.keys(recipe)) {
          expect(
            materialsReady(current, { ...recipe, [key]: recipe[key] - 1 }),
            `${resource} T${tier} ${key} short`,
          ).toBe(false);
        }
      }
    }
  });

  it('rejects empty, absent or wrong-tier ingredients, regardless of unrelated stock', () => {
    expect(materialsReady(request, {})).toBe(false);
    expect(materialsReady(request, { 'wood:1': 6 })).toBe(false);
    expect(materialsReady(request, { 'fibre:1': 4 })).toBe(false);
    expect(materialsReady(request, { 'wood:2': 100, 'fibre:2': 100, 'food:1': 100 })).toBe(false);
    expect(materialsReady({ resource: 'food', tier: 2 }, { 'wood:1': 100, 'fibre:1': 100 })).toBe(
      false,
    );
    expect(materialsReady(request, { 'wood:1': 6, 'fibre:2': 100 })).toBe(false);
    expect(materialsReady(request, { 'wood:1': 6, 'fibre:1': 4, 'food:1': 100 })).toBe(true);
  });

  it('reads sell escrow as unavailable and does not cancel it or mutate world state', () => {
    const world = createWorld({ scenario: 'progression', population: 1, seed: 7 });
    const citizen = Object.values(world.citizens)[0];
    citizen.inventory = { 'wood:1': 6, 'fibre:1': 4 };
    expect(
      dispatch(world, citizen.id, {
        type: 'order',
        side: 'sell',
        item: 'wood:1',
        quantity: 1,
        price: 8,
      }).ok,
    ).toBe(true);
    expect(citizen.inventory['wood:1']).toBe(5);
    const before = structuredClone(world);
    expect(materialsReady(request, citizen.inventory)).toBe(false);
    expect(world).toEqual(before);
    expect(Object.values(world.orders)).toHaveLength(1);
  });

  it('does not add work reservations back to available inventory', () => {
    const world = createWorld({ scenario: 'progression', population: 1, seed: 7 });
    const citizen = Object.values(world.citizens)[0];
    citizen.inventory = { 'wood:1': 6, 'fibre:1': 4 };
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 }).ok).toBe(true);
    expect(citizen.action?.reserved).toEqual({ 'wood:1': 3, 'fibre:1': 3 });
    const before = structuredClone(world);
    expect(materialsReady(request, citizen.inventory)).toBe(false);
    expect(world).toEqual(before);
  });

  it('reports materials ready even during unrelated work, without claiming placement feasibility', () => {
    const world = createWorld({ scenario: 'progression', population: 1, seed: 7 });
    const citizen = Object.values(world.citizens)[0];
    citizen.inventory = { 'wood:1': 9, 'fibre:1': 7 };
    expect(dispatch(world, citizen.id, { type: 'craft', item: 'knife', tier: 1 }).ok).toBe(true);
    expect(citizen.inventory).toEqual({ 'wood:1': 6, 'fibre:1': 4 });
    const before = structuredClone(world);
    expect(materialsReady(request, citizen.inventory)).toBe(true);
    expect(world).toEqual(before);
  });
});
