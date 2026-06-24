import { randomChoice, type RNG } from "../../common/random";

export type Government = { type: string; densityFactor: number };

enum Authority {
  Civic = "civic",
  Monarchic = "monarchic",
  Imperial = "imperial",
  Religious = "religious",
  Technical = "technical",
  Bureaucratic = "bureaucratic",
  Commercial = "commercial",
  Elite = "elite",
  Militaristic = "militaristic",
}

enum Structure {
  Federal = "federal",
  Local = "local",
  Urban = "urban",
  Dependent = "dependent",
  Nomadic = "nomadic",
  Minor = "minor",
}

enum Society {
  Scholastic = "scholastic",
  Industrial = "industrial",
  Agrarian = "agrarian",
  Maritime = "maritime",
}

enum Trait {
  Expansionist = "expansionist",
  Isolationist = "isolationist",
  Stable = "stable",
  Fragmented = "fragmented",
  Traditional = "traditional",
  Revolutionary = "revolutionary",
}

enum ModifierType {
  Constitutional = "constitutional",
  Ideological = "ideological",
  Cultural = "cultural",
  Economic = "economic",
  Religious = "religious",
  Military = "military",
  Prestige = "prestige",
  Status = "status",
}

type Tags = {
  authority?: Authority[];
  structure?: Structure[];
  society?: Society[];
  trait?: Trait[];
};

type Core = {
  word: string;
  tags: Tags;
};

type Modifier = {
  word: string;
  type: ModifierType;
  tags: Tags;
  exclude?: Tags;
};

const CORES: Core[] = [
  { word: "republic", tags: { authority: [Authority.Civic] } },
  { word: "federation", tags: { authority: [Authority.Civic], structure: [Structure.Federal] } },
  {
    word: "confederacy",
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal, Structure.Local],
      trait: [Trait.Fragmented],
    },
  },
  { word: "union", tags: { authority: [Authority.Civic], structure: [Structure.Federal] } },
  {
    word: "commonwealth",
    tags: { authority: [Authority.Civic, Authority.Commercial] },
  },
  {
    word: "league",
    tags: {
      authority: [Authority.Civic, Authority.Commercial],
      structure: [Structure.Federal],
    },
  },
  {
    word: "commune",
    tags: { authority: [Authority.Civic], structure: [Structure.Local] },
  },
  {
    word: "city-state",
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Local, Structure.Urban, Structure.Minor],
    },
  },
  {
    word: "assembly",
    tags: { authority: [Authority.Civic], structure: [Structure.Local] },
  },
  {
    word: "council",
    tags: { authority: [Authority.Civic, Authority.Elite], structure: [Structure.Local] },
  },
  {
    word: "compact",
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal, Structure.Local],
      trait: [Trait.Stable],
    },
  },
  {
    word: "freehold",
    tags: { authority: [Authority.Civic], structure: [Structure.Local, Structure.Minor] },
  },

  {
    word: "empire",
    tags: {
      authority: [Authority.Imperial, Authority.Monarchic, Authority.Militaristic],
      trait: [Trait.Expansionist],
    },
  },
  {
    word: "hegemony",
    tags: {
      authority: [Authority.Imperial, Authority.Elite],
      trait: [Trait.Expansionist],
    },
  },
  {
    word: "kingdom",
    tags: { authority: [Authority.Monarchic], trait: [Trait.Traditional] },
  },
  {
    word: "duchy",
    tags: { authority: [Authority.Monarchic], structure: [Structure.Minor] },
  },
  {
    word: "principality",
    tags: { authority: [Authority.Monarchic], structure: [Structure.Minor] },
  },
  {
    word: "archduchy",
    tags: { authority: [Authority.Monarchic], structure: [Structure.Minor] },
  },
  {
    word: "electorate",
    tags: { authority: [Authority.Monarchic, Authority.Elite], structure: [Structure.Minor] },
  },
  {
    word: "sultanate",
    tags: { authority: [Authority.Monarchic, Authority.Religious] },
  },
  {
    word: "emirate",
    tags: { authority: [Authority.Monarchic, Authority.Religious] },
  },
  {
    word: "khanate",
    tags: {
      authority: [Authority.Monarchic, Authority.Militaristic],
      structure: [Structure.Nomadic],
      trait: [Trait.Expansionist],
    },
  },
  {
    word: "horde",
    tags: {
      authority: [Authority.Militaristic],
      structure: [Structure.Nomadic],
      trait: [Trait.Expansionist],
    },
  },

  { word: "theocracy", tags: { authority: [Authority.Religious] } },
  {
    word: "magisterium",
    tags: {
      authority: [Authority.Religious, Authority.Bureaucratic],
      society: [Society.Scholastic],
    },
  },
  {
    word: "order",
    tags: { authority: [Authority.Religious, Authority.Militaristic] },
  },
  {
    word: "patriarchate",
    tags: { authority: [Authority.Religious, Authority.Monarchic] },
  },
  {
    word: "synod",
    tags: { authority: [Authority.Religious, Authority.Bureaucratic] },
  },
  {
    word: "covenant",
    tags: { authority: [Authority.Religious, Authority.Civic] },
  },

  {
    word: "technocracy",
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic],
      society: [Society.Industrial, Society.Scholastic],
      trait: [Trait.Stable],
    },
  },
  {
    word: "directorate",
    tags: { authority: [Authority.Bureaucratic, Authority.Elite] },
  },
  {
    word: "authority",
    tags: { authority: [Authority.Bureaucratic], structure: [Structure.Urban] },
  },
  {
    word: "administration",
    tags: { authority: [Authority.Bureaucratic], structure: [Structure.Dependent] },
  },
  {
    word: "collective",
    tags: {
      authority: [Authority.Civic, Authority.Technical],
      trait: [Trait.Revolutionary],
    },
  },

  {
    word: "syndicate",
    tags: { authority: [Authority.Commercial, Authority.Elite], structure: [Structure.Urban] },
  },
  {
    word: "consortium",
    tags: { authority: [Authority.Commercial, Authority.Elite], structure: [Structure.Urban] },
  },
  {
    word: "oligarchy",
    tags: { authority: [Authority.Elite, Authority.Bureaucratic] },
  },
  {
    word: "trade league",
    tags: {
      authority: [Authority.Commercial, Authority.Civic],
      structure: [Structure.Federal],
      society: [Society.Maritime],
    },
  },

  {
    word: "protectorate",
    tags: { structure: [Structure.Dependent] },
  },
  {
    word: "satrapy",
    tags: {
      authority: [Authority.Imperial, Authority.Bureaucratic],
      structure: [Structure.Dependent],
    },
  },
];

const MODIFIERS: Modifier[] = [
  {
    word: "sovereign",
    type: ModifierType.Status,
    tags: {
      authority: [Authority.Civic, Authority.Monarchic, Authority.Imperial, Authority.Religious],
    },
    exclude: { structure: [Structure.Dependent] },
  },
  {
    word: "independent",
    type: ModifierType.Status,
    tags: { authority: [Authority.Civic, Authority.Commercial], structure: [Structure.Local] },
    exclude: { structure: [Structure.Dependent] },
  },
  {
    word: "autonomous",
    type: ModifierType.Status,
    tags: { structure: [Structure.Local, Structure.Dependent, Structure.Minor] },
  },
  {
    word: "provisional",
    type: ModifierType.Status,
    tags: {
      authority: [Authority.Civic, Authority.Militaristic],
      structure: [Structure.Federal, Structure.Local, Structure.Dependent],
      trait: [Trait.Revolutionary],
    },
  },

  {
    word: "federal",
    type: ModifierType.Constitutional,
    tags: { structure: [Structure.Federal] },
  },
  {
    word: "unified",
    type: ModifierType.Constitutional,
    tags: { structure: [Structure.Federal], trait: [Trait.Stable] },
  },
  {
    word: "democratic",
    type: ModifierType.Constitutional,
    tags: { authority: [Authority.Civic], structure: [Structure.Federal, Structure.Local] },
  },
  {
    word: "egalitarian",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal, Structure.Local],
    },
    exclude: { authority: [Authority.Elite, Authority.Civic, Authority.Bureaucratic] },
  },
  {
    word: "people's",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal, Structure.Local],
      trait: [Trait.Revolutionary],
    },
  },
  {
    word: "constitutional",
    type: ModifierType.Constitutional,
    tags: { authority: [Authority.Civic, Authority.Monarchic] },
  },
  {
    word: "free",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Civic, Authority.Commercial],
      structure: [Structure.Local, Structure.Minor],
    },
    exclude: { structure: [Structure.Dependent] },
  },
  {
    word: "reformed",
    type: ModifierType.Ideological,
    tags: { authority: [Authority.Civic, Authority.Religious], trait: [Trait.Revolutionary] },
  },
  {
    word: "great",
    type: ModifierType.Prestige,
    tags: { authority: [Authority.Civic, Authority.Monarchic, Authority.Imperial] },
  },
  {
    word: "grand",
    type: ModifierType.Prestige,
    tags: { authority: [Authority.Monarchic, Authority.Imperial, Authority.Religious] },
  },
  {
    word: "high",
    type: ModifierType.Prestige,
    tags: { authority: [Authority.Monarchic, Authority.Religious, Authority.Elite] },
  },
  {
    word: "royal",
    type: ModifierType.Prestige,
    tags: { authority: [Authority.Monarchic] },
  },
  {
    word: "imperial",
    type: ModifierType.Prestige,
    tags: { authority: [Authority.Imperial, Authority.Monarchic] },
    exclude: { authority: [Authority.Civic], structure: [Structure.Local] },
  },
  {
    word: "serene",
    type: ModifierType.Prestige,
    tags: { authority: [Authority.Civic, Authority.Monarchic, Authority.Elite] },
  },
  {
    word: "holy",
    type: ModifierType.Religious,
    tags: {
      authority: [Authority.Religious, Authority.Monarchic, Authority.Imperial, Authority.Militaristic],
    },
  },
  {
    word: "sacred",
    type: ModifierType.Religious,
    tags: {
      authority: [Authority.Religious, Authority.Monarchic],
      society: [Society.Scholastic],
    },
  },
  {
    word: "orthodox",
    type: ModifierType.Religious,
    tags: { authority: [Authority.Religious], trait: [Trait.Traditional] },
  },

  {
    word: "mercantile",
    type: ModifierType.Economic,
    tags: {
      authority: [Authority.Commercial, Authority.Civic],
      structure: [Structure.Urban],
      society: [Society.Maritime],
    },
  },
  {
    word: "corporatist",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Commercial, Authority.Elite],
      structure: [Structure.Urban],
    },
  },
  {
    word: "industrial",
    type: ModifierType.Economic,
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic, Authority.Commercial],
      structure: [Structure.Urban],
      society: [Society.Industrial],
    },
  },
  {
    word: "agrarian",
    type: ModifierType.Economic,
    tags: {
      authority: [Authority.Civic, Authority.Monarchic],
      structure: [Structure.Local],
      society: [Society.Agrarian],
    },
  },
  {
    word: "pastoral",
    type: ModifierType.Cultural,
    tags: {
      structure: [Structure.Nomadic, Structure.Local, Structure.Minor],
      society: [Society.Agrarian],
    },
  },
  {
    word: "nomadic",
    type: ModifierType.Cultural,
    tags: { structure: [Structure.Nomadic] },
  },
  {
    word: "scholastic",
    type: ModifierType.Cultural,
    tags: {
      authority: [Authority.Religious, Authority.Bureaucratic, Authority.Technical],
      society: [Society.Scholastic],
    },
  },
  {
    word: "arcane",
    type: ModifierType.Cultural,
    tags: {
      authority: [Authority.Religious, Authority.Technical],
      society: [Society.Scholastic],
    },
  },
  {
    word: "enlightened",
    type: ModifierType.Cultural,
    tags: {
      authority: [Authority.Civic, Authority.Technical, Authority.Elite],
      society: [Society.Scholastic],
    },
  },

  {
    word: "technocratic",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic],
      society: [Society.Scholastic],
    },
  },
  {
    word: "rational",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic, Authority.Civic],
      society: [Society.Scholastic],
    },
  },
  {
    word: "stratocratic",
    type: ModifierType.Military,
    tags: { authority: [Authority.Militaristic, Authority.Bureaucratic] },
  },
  {
    word: "militant",
    type: ModifierType.Military,
    tags: { authority: [Authority.Militaristic, Authority.Religious, Authority.Imperial] },
  },
];

function hasOverlap<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (!a || !b) return false;
  return b.some((value) => a.includes(value));
}

function matchesAxis<T>(coreValues: T[] | undefined, modifierValues: T[] | undefined): boolean {
  if (!modifierValues) return false;
  return hasOverlap(coreValues, modifierValues);
}

function matchesTags(core: Tags, modifier: Tags): boolean {
  return (
    matchesAxis(core.authority, modifier.authority) ||
    matchesAxis(core.structure, modifier.structure) ||
    matchesAxis(core.society, modifier.society) ||
    matchesAxis(core.trait, modifier.trait)
  );
}

function isExcluded(core: Tags, exclude: Tags | undefined): boolean {
  if (!exclude) return false;

  return (
    hasOverlap(core.authority, exclude.authority) ||
    hasOverlap(core.structure, exclude.structure) ||
    hasOverlap(core.society, exclude.society) ||
    hasOverlap(core.trait, exclude.trait)
  );
}

function hasTag<T>(values: T[] | undefined, value: T): boolean {
  return values?.includes(value) ?? false;
}

function compatibleModifiers(core: Core): Modifier[] {
  return MODIFIERS.filter((modifier) => {
    if (isExcluded(core.tags, modifier.exclude)) return false;
    return matchesTags(core.tags, modifier.tags);
  });
}

function titleWordCount(core: Core, modifierCount: number): number {
  return modifierCount + core.word.split(/\s+/).length;
}

function pickModifiers(core: Core, rng: RNG, count: number): Modifier[] {
  const pool = compatibleModifiers(core);
  const picked: Modifier[] = [];
  const usedTypes = new Set<ModifierType>();

  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length);
    const modifier = pool.splice(index, 1)[0];

    if (usedTypes.has(modifier.type)) continue;

    usedTypes.add(modifier.type);
    picked.push(modifier);
  }

  return picked;
}

function deriveDensityFactor(tags: Tags): number {
  let density = 1;

  if (hasTag(tags.structure, Structure.Urban)) density += 0.35;
  if (hasTag(tags.structure, Structure.Local)) density += 0.1;
  if (hasTag(tags.structure, Structure.Federal)) density -= 0.05;
  if (hasTag(tags.structure, Structure.Dependent)) density -= 0.1;
  if (hasTag(tags.structure, Structure.Nomadic)) density -= 0.3;
  if (hasTag(tags.structure, Structure.Minor)) density -= 0.05;

  if (hasTag(tags.authority, Authority.Bureaucratic)) density += 0.1;
  if (hasTag(tags.authority, Authority.Commercial)) density += 0.15;
  if (hasTag(tags.authority, Authority.Technical)) density += 0.15;
  if (hasTag(tags.authority, Authority.Imperial)) density -= 0.05;

  if (hasTag(tags.society, Society.Industrial)) density += 0.2;
  if (hasTag(tags.society, Society.Maritime)) density += 0.1;
  if (hasTag(tags.society, Society.Agrarian)) density -= 0.1;

  if (hasTag(tags.trait, Trait.Fragmented)) density -= 0.05;
  if (hasTag(tags.trait, Trait.Expansionist)) density -= 0.05;

  return Math.max(0.6, Math.min(1.5, density));
}

function titleCase(words: string): string {
  return words.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Compose a 2- or 3-word government type from a core form plus compatible modifiers.
 *
 * Examples:
 * - Federal Republic
 * - Holy Kingdom
 * - Mercantile City-State
 * - Enlightened Technocracy
 *
 * Density is derived from the core's tags. The tags are the source of truth.
 */
export function generateGovernment(rng: RNG): Government {
  const targetWords = rng() < 0.5 ? 2 : 3;

  for (let attempt = 0; attempt < 50; attempt++) {
    const core = randomChoice(CORES, rng);
    const modifierCount = targetWords - core.word.split(/\s+/).length;
    if (modifierCount < 0 || modifierCount > 2) continue;

    const modifiers = pickModifiers(core, rng, modifierCount);
    if (titleWordCount(core, modifiers.length) !== targetWords) continue;

    return {
      type: titleCase([...modifiers.map((modifier) => modifier.word), core.word].join(" ")),
      densityFactor: deriveDensityFactor(core.tags),
    };
  }

  const core = CORES.find((entry) => entry.word.split(/\s+/).length === 1) ?? CORES[0];
  const modifiers = pickModifiers(core, rng, 1);

  return {
    type: titleCase([...modifiers.map((modifier) => modifier.word), core.word].join(" ")),
    densityFactor: deriveDensityFactor(core.tags),
  };
}