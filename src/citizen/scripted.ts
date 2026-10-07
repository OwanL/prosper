import type { CitizenObservation, Command, EquipmentKind, Resource } from '../shared/types.ts';
const recipes: { item: EquipmentKind; ingredients: Resource[] }[] = [
  { item: 'knife', ingredients: ['wood', 'fibre'] },
  { item: 'axe', ingredients: ['food', 'fibre'] },
  { item: 'scythe', ingredients: ['wood', 'food'] },
];
const matching = { food: 'knife', wood: 'axe', fibre: 'scythe' } as const;
/** Mechanical demonstration only. No personality/emergence evaluation. */
export function scriptedCommands(observation: CitizenObservation): Command[] {
  const citizen = observation.citizen;
  if (citizen.action || citizen.queue.length) return []; // never reset unfinished physical work
  const amount = (kind: string, tier: number) => citizen.inventory[`${kind}:${tier}`] ?? 0;
  for (const { item } of recipes) {
    for (const tier of [3, 2, 1]) {
      if (amount(item, tier) && Number(citizen.equipment[item]?.split(':')[1] ?? 0) < tier)
        return [{ type: 'equip', item: `${item}:${tier}` }];
    }
  }
  let wantedTier = 1;
  let wanted: Resource[] = citizen.fullness < 60 && !amount('food', 1) ? ['food'] : [];
  if (!wanted.length) {
    for (const tier of [1, 2, 3] as const) {
      const missing = recipes.find((recipe) => !amount(recipe.item, tier));
      if (!missing) continue;
      wantedTier = tier;
      wanted = missing.ingredients.filter((resource) => amount(resource, tier) < 3);
      if (!wanted.length) return [{ type: 'craft', item: missing.item, tier }];
      break;
    }
  }
  if (!wanted.length) wanted = ['food', 'wood', 'fibre'];
  const known = [...observation.visible, ...observation.remembered];
  const deposits = known
    .flatMap((tile) => tile.deposits)
    .filter((deposit) => {
      const toolTier = Number(citizen.equipment[matching[deposit.resource]]?.split(':')[1] ?? 0);
      return (
        wanted.includes(deposit.resource) &&
        deposit.stock > 0 &&
        deposit.tier === wantedTier &&
        deposit.tier <= Math.min(3, toolTier + 1)
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
