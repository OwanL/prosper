// Short remnants leave openings and detours; the center stays open.
// These are ordinary destructible walls with no living owner, not a new faction.
export const RUIN_WALL_TILES = [
  [4, 1], [4, 2], [4, 3], [5, 3], [6, 3],
  [14, 2], [15, 2], [16, 2], [18, 4], [18, 5],
  [3, 8], [3, 9], [4, 13], [5, 13], [6, 13],
  [15, 11], [16, 11], [16, 12], [17, 12], [17, 13],
];
export const ROCK_TILES = [[8, 2], [9, 2], [11, 13], [12, 13]];
export const createRuins = () => RUIN_WALL_TILES.map(([x, y], i) => ({
  id: `wall-${i + 1}`, kind: 'wall', x, y, ownerId: null, ruin: true,
  health: 60, maxHealth: 120, woodCost: 15, destroyed: false, createdAt: 0,
}));
