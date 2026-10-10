import type { BuildingKind, Resource } from '../../../../src/shared/types.ts';
import type { DraftTree } from '../draft-types.ts';

export const resourceBuildings = {
  wood: 'lumbermill',
  fibre: 'spinning-wheel',
  food: 'butchery',
} as const satisfies Record<Resource, Exclude<BuildingKind, 'wall'>>;

// Draft-only materials readiness, not complete construction/site feasibility.
// requiredResource compares available inventory at the requested building tier
// with the corresponding cost from the public buildingRecipe definition.
export const canBuildResourceBuilding = {
  name: 'CanBuildResourceBuilding',
  kind: 'condition',
  document: 'trees/can-build-resource-building.md',
  entry: 'Start',
  nodes: {
    Start: {
      kind: 'step',
      operation: 'entry',
      label:
        'CanBuildResourceBuilding(resource, exactBuildingTier)<br/>Current available inventory only',
      next: 'Wood',
    },
    Wood: {
      kind: 'decision',
      requiredResource: 'wood',
      label: 'Available wood at exact building tier<br/>≥ wood cost in the station recipe?',
      yes: 'Fibre',
      no: 'False',
    },
    Fibre: {
      kind: 'decision',
      requiredResource: 'fibre',
      label: 'Available fibre at exact building tier<br/>≥ fibre cost in the station recipe?',
      yes: 'True',
      no: 'False',
    },
    True: { kind: 'boolean', value: true },
    False: { kind: 'boolean', value: false },
  },
} as const satisfies DraftTree;
