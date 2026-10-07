// Broad preferences, not professions, executable goals or required outcomes.
// Stable sampling makes births reproducible without copying either parent's
// private aspirations, holdings or task queue into the child's character.
const temperaments = [
  'Warm and reciprocal; offers trust but expects it returned',
  'Reserved and pragmatic; allegiance is earned through actions',
  'Assertive and competitive; seeks advantages and resists being pushed aside',
  'Cautious and deliberate; bargains hard rather than accepting dependence',
  'Bold and self-interested; considers pressure or force when the stakes justify it, and partnerships when interests align',
];
const priorities = [
  ['prosperity', 'Build a prosperous life with room for ambition'],
  ['autonomy', "Decide my own future without depending on another's goodwill"],
  ['security', 'Build lasting security for myself and those I choose to protect'],
  ['belonging', 'Earn dependable relationships and a place in the community'],
  ['standing', 'Become someone whose interests and boundaries carry weight'],
  ['comfort', 'Make everyday life comfortable and worthwhile'],
  ['mastery', 'Become capable and useful in ways I value'],
];

export function citizenProfile(id) {
  if (typeof id !== 'string' || !id) throw new Error('A citizen ID is required for a stable profile.');
  let state = 2166136261;
  for (const character of id) state = Math.imul(state ^ character.codePointAt(0), 16777619) >>> 0;
  const pick = size => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % size;
  };
  const temperament = temperaments[pick(temperaments.length)];
  const first = pick(priorities.length), secondSample = pick(priorities.length - 1);
  const second = secondSample >= first ? secondSample + 1 : secondSample;
  return { personality: `${temperament}. Values ${priorities[first][0]} and ${priorities[second][0]}.`,
    aspirations: [priorities[first][1], priorities[second][1]] };
}
