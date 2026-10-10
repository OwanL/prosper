import type { CitizenObservation, Command, ToolKind, Resource } from '../shared/types.ts';
import { highestToolTier } from '../shared/tool-utils.ts';
import { MAX_TIER, TIERS } from '../shared/tiers.ts';
import { equipmentRecipe } from '../world/config.ts';
const recipes: { item: ToolKind; ingredients: Resource[] }[] = [
  { item: 'knife', ingredients: ['wood', 'fibre'] },
  { item: 'axe', ingredients: ['food', 'fibre'] },
  { item: 'scythe', ingredients: ['wood', 'food'] },
];
const matching = { food: 'knife', wood: 'axe', fibre: 'scythe' } as const;
/** Mechanical demonstration only. No personality/emergence evaluation. */
export function scriptedCommands(observation: CitizenObservation): Command[] {
  const citizen = observation.citizen;
  if (citizen.action || citizen.queue.length || citizen.plan) return []; // never reset approved work
  const amount = (kind: string, tier: number) => citizen.inventory[`${kind}:${tier}`] ?? 0;
  let wantedTier = 1;
  let wanted: Resource[] = citizen.fullness < 60 && !amount('food', 1) ? ['food'] : [];
  if (!wanted.length) {
    for (const tier of TIERS) {
      const missing = recipes.find((recipe) => !amount(recipe.item, tier));
      if (!missing) continue;
      wantedTier = tier;
      wanted = missing.ingredients.filter((resource) => amount(resource, tier) < equipmentRecipe(missing.item, tier)[`${resource}:${tier}`]);
      if (!wanted.length) return [{ type: 'craft', item: missing.item, tier }];
      break;
    }
  }
  if (!wanted.length) wanted = ['food', 'wood', 'fibre'];
  const known = [...observation.visible, ...observation.remembered];
  const deposits = known
    .flatMap((tile) => tile.deposits)
    .filter((deposit) => {
      const toolTier = highestToolTier(citizen, matching[deposit.resource]);
      return (
        wanted.includes(deposit.resource) &&
        deposit.stock > 0 &&
        deposit.tier === wantedTier &&
        deposit.tier <= Math.min(MAX_TIER, toolTier + 1)
      );
    })
    .sort(
      (a, b) =>
        b.tier - a.tier ||
        Math.abs(a.x - citizen.x) +
          Math.abs(a.y - citizen.y) -
          (Math.abs(b.x - citizen.x) + Math.abs(b.y - citizen.y)) ||
        a.id.localeCompare(b.id),
    );
  if (deposits[0]) {
    const deposit = deposits[0];
    return observation.visible.some((tile) =>
      tile.deposits.some((current) => current.id === deposit.id),
    )
      ? [{ type: 'harvest', depositId: deposit.id }]
      : [{ type: 'move', x: deposit.x, y: deposit.y }];
  }
  // Frontiers come only from our notebook and the map's public dimensions.
  // Revisiting corners with no unknown neighbours cannot expand knowledge.
  const rows = observation.ascii.split('\n');
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const notebook = new Map(
    Object.values(citizen.knowledge).map((tile) => [`${tile.x},${tile.y}`, tile]),
  );
  for (const tile of known) notebook.set(`${tile.x},${tile.y}`, tile);
  const unexplored = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && !notebook.has(`${x},${y}`);
  const frontier = (tile: { x: number; y: number }) =>
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].some(([dx, dy]) => unexplored(tile.x + dx, tile.y + dy));
  const target = [...notebook.values()]
    .filter(
      (tile) =>
        frontier(tile) &&
        !tile.buildings.some((building) => building.kind === 'wall') &&
        (tile.x !== citizen.x || tile.y !== citizen.y),
    )
    .sort(
      (a, b) =>
        Math.abs(a.x - citizen.x) +
          Math.abs(a.y - citizen.y) -
          (Math.abs(b.x - citizen.x) + Math.abs(b.y - citizen.y)) ||
        a.seenTick - b.seenTick ||
        a.y - b.y ||
        a.x - b.x,
    )[0];
  return target ? [{ type: 'move', x: target.x, y: target.y }] : [];
}
