import type { Citizen } from '../shared/types.ts';
import { FIRST_NAMES, LEGACY_FIRST_NAMES, SURNAMES } from './name-data.ts';

// Normalize/deduplicate database entries so an accidental repeated first name
// cannot reduce capacity or create duplicate full-name candidates.
const unique = (names: readonly string[]) => [
  ...new Set(names.map((name) => name.trim()).filter(Boolean)),
];
const firstNames = unique(FIRST_NAMES);
const surnames = unique(SURNAMES);
const legacyNames = unique(LEGACY_FIRST_NAMES);
export const CITIZEN_NAME_CAPACITY = legacyNames.length + firstNames.length * surnames.length;

/** First unused database name, including names held by dead citizens.
 * No RNG draws or persisted allocator state: restored names remain untouched.
 */
export function allocateCitizenName(
  citizens: Readonly<Record<string, Pick<Citizen, 'name'>>>,
): string {
  const used = new Set(
    Object.values(citizens).map((citizen) => citizen.name.trim().replace(/\s+/g, ' ')),
  );
  for (const name of legacyNames) if (!used.has(name)) return name;
  for (const surname of surnames) {
    for (const firstName of firstNames) {
      const name = `${firstName} ${surname}`;
      if (!used.has(name)) return name;
    }
  }
  throw new Error(`Citizen name database exhausted (${CITIZEN_NAME_CAPACITY} unique names).`);
}
