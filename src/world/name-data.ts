// Curated local name database. The original nine short names remain compatible
// with mechanics fixtures; later citizens receive first-name/surname combinations.
export const LEGACY_FIRST_NAMES = [
  'Ada',
  'Bram',
  'Cora',
  'Dara',
  'Eli',
  'Faye',
  'Galen',
  'Hana',
  'Ivo',
] as const;

export const FIRST_NAMES: readonly string[] = [
  ...LEGACY_FIRST_NAMES,
  ...`Aisha Alma Amara Anika Arlo Asher Audrey Avery Beatrice Ben Celia Clara
  Dalia Daniel Daphne Dorian Eden Elena Eliza Emmett Esme Ezra Felix Finn Flora
  Freya Gabriel Gemma Greta Hazel Hugo Idris Iris Isla Jasper Jonas Joseph Jude
  Julia Kai Kieran Lara Leila Leon Lila Lina Luca Lydia Mae Mara Maya Miles Mira
  Nadia Naomi Nell Nico Nina Noel Nora Oliver Omar Orla Oscar Owen Petra Quinn
  Rafael Remy Rhea Rosa Rowan Ruby Ruth Sasha Selma Silas Sofia Stella Suri Theo
  Tobias Vera Victor Viola Willa Yara Yasmin Zane Zara`.split(/\s+/),
];

export const SURNAMES: readonly string[] = `Ashford Baker Bell Bennett Birch Bowen
  Brooks Carter Clarke Cole Collins Cooper Dawson Ellis Evans Finch Fisher Flores
  Ford Foster Fox Garcia Gray Green Hale Harper Hart Hayes Hill Hollis Hope Hughes
  James Jordan Kim Lane Lang Lee Lewis Linden Liu Lopez Lowe Marsh Mason Miller
  Morgan Moss Nash Navarro North Oakley Ortiz Palmer Park Patel Perry Pierce Porter
  Price Reed Reyes Rivers Rose Ross Rowan Ruiz Sage Santos Shaw Singh Silva Smith
  Snow Stone Sutton Swift Taylor Thomas Vale Walker Ward Weaver West White Wilder
  Williams Wilson Wood Wright Young`.split(/\s+/);
