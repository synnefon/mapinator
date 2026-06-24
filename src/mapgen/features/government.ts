import { randomChoice, type RNG } from "../../common/random";

export type Government = { type: string; densityFactor: number; govType: GovType };

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
  Stable = "stable",
  Fragmented = "fragmented",
  Traditional = "traditional",
  Revolutionary = "revolutionary",
}

enum ModifierType {
  Status = "status",
  Honorific = "honorific",
  Constitutional = "constitutional",
  Ideological = "ideological",
  Cultural = "cultural",
  Economic = "economic",
  Military = "military",
  Identity = "identity",
}

type Tags = {
  authority?: Authority[];
  structure?: Structure[];
  society?: Society[];
  trait?: Trait[];
};

export type GovType = {
  word: string;
  tags: Tags;
};

type Modifier = {
  word: string;
  type: ModifierType;
  tags: Tags;
  exclude?: Tags;
};

const GOV_TYPES: GovType[] = [
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

const QUALIFIER_MODIFIERS: Modifier[] = [
  {
    word: "federal",
    type: ModifierType.Constitutional,
    tags: { structure: [Structure.Federal] },
  },
  {
    word: "decentralized",
    type: ModifierType.Constitutional,
    tags: { structure: [Structure.Federal, Structure.Local] },
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
    word: "parliamentary",
    type: ModifierType.Constitutional,
    tags: { authority: [Authority.Civic], structure: [Structure.Federal, Structure.Local] },
  },
  {
    word: "constitutional",
    type: ModifierType.Constitutional,
    tags: { authority: [Authority.Civic, Authority.Monarchic] },
  },
  {
    word: "egalitarian",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal, Structure.Local],
    },
    exclude: { authority: [Authority.Elite, Authority.Bureaucratic] },
  },
  {
    word: "reformed",
    type: ModifierType.Ideological,
    tags: { authority: [Authority.Civic, Authority.Religious], trait: [Trait.Revolutionary] },
  },
  {
    word: "revolutionary",
    type: ModifierType.Ideological,
    tags: { authority: [Authority.Civic], trait: [Trait.Revolutionary] },
  },
  {
    word: "collectivist",
    type: ModifierType.Ideological,
    tags: {
      authority: [Authority.Civic, Authority.Technical],
      trait: [Trait.Revolutionary],
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
    word: "mercantile",
    type: ModifierType.Economic,
    tags: {
      authority: [Authority.Commercial, Authority.Civic],
      structure: [Structure.Urban],
      society: [Society.Maritime],
    },
  },
  {
    word: "guilded",
    type: ModifierType.Economic,
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

const IDENTITY_MODIFIERS: Modifier[] = [
  {
    word: "people's",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal, Structure.Local],
      trait: [Trait.Revolutionary],
    },
  },
  {
    word: "popular",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal, Structure.Local],
    },
  },
  {
    word: "citizen's",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Local, Structure.Federal],
    },
  },
  {
    word: "united",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic],
      structure: [Structure.Federal],
    },
  },
  {
    word: "national",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic, Authority.Monarchic],
    },
  },
  {
    word: "communal",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic],
      trait: [Trait.Revolutionary],
    },
  },

  {
    word: "civic",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic],
    },
  },
  {
    word: "public",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic, Authority.Bureaucratic],
    },
  },
  {
    word: "common",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic, Authority.Commercial],
    },
  },
  {
    word: "chartered",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Civic, Authority.Commercial, Authority.Bureaucratic],
      structure: [Structure.Local, Structure.Dependent, Structure.Minor],
    },
  },

  {
    word: "faithful",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Religious],
    },
  },
  {
    word: "ecclesiastical",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Religious, Authority.Bureaucratic],
    },
  },
  {
    word: "apostolic",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Religious, Authority.Monarchic],
    },
  },

  {
    word: "royal",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Monarchic],
    },
  },
  {
    word: "imperial",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Imperial, Authority.Monarchic],
    },
  },
  {
    word: "dynastic",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Monarchic],
      trait: [Trait.Traditional],
    },
  },

  {
    word: "merchant",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Commercial],
      structure: [Structure.Urban],
      society: [Society.Maritime],
    },
  },

  {
    word: "scholar's",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic, Authority.Religious],
      society: [Society.Scholastic],
    },
  },
  {
    word: "learned",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic, Authority.Elite],
      society: [Society.Scholastic],
    },
  },
  {
    word: "arcane",
    type: ModifierType.Identity,
    tags: {
      authority: [Authority.Technical, Authority.Religious],
      society: [Society.Scholastic],
    },
  },

  {
    word: "tribal",
    type: ModifierType.Identity,
    tags: {
      structure: [Structure.Nomadic, Structure.Local, Structure.Minor],
    },
  },
  {
    word: "clan",
    type: ModifierType.Identity,
    tags: {
      structure: [Structure.Nomadic, Structure.Local, Structure.Minor],
      authority: [Authority.Monarchic, Authority.Militaristic],
    },
  },

  {
    word: "provincial",
    type: ModifierType.Identity,
    tags: {
      structure: [Structure.Dependent, Structure.Local],
      authority: [Authority.Bureaucratic, Authority.Imperial],
    },
  },
  {
    word: "colonial",
    type: ModifierType.Identity,
    tags: {
      structure: [Structure.Dependent],
      authority: [Authority.Imperial, Authority.Commercial],
    },
  },
  {
    word: "frontier",
    type: ModifierType.Identity,
    tags: {
      structure: [Structure.Dependent, Structure.Local, Structure.Minor],
    },
  },
];

const PATTERNS = [
  [],
  ["qualifier"],
  ["identity"],
  ["qualifier", "identity"],
] as const;

function hasOverlap<T>(a: T[] | undefined, b: T[] | undefined): boolean {
  if (!a || !b) return false;
  return b.some((value) => a.includes(value));
}

function matchesAxis<T>(govTypeValues: T[] | undefined, modifierValues: T[] | undefined): boolean {
  if (!modifierValues) return false;
  return hasOverlap(govTypeValues, modifierValues);
}

function matchesTags(govType: Tags, modifier: Tags): boolean {
  return (
    matchesAxis(govType.authority, modifier.authority) ||
    matchesAxis(govType.structure, modifier.structure) ||
    matchesAxis(govType.society, modifier.society) ||
    matchesAxis(govType.trait, modifier.trait)
  );
}

function isExcluded(govType: Tags, exclude: Tags | undefined): boolean {
  if (!exclude) return false;

  return (
    hasOverlap(govType.authority, exclude.authority) ||
    hasOverlap(govType.structure, exclude.structure) ||
    hasOverlap(govType.society, exclude.society) ||
    hasOverlap(govType.trait, exclude.trait)
  );
}

function hasTag<T>(values: T[] | undefined, value: T): boolean {
  return values?.includes(value) ?? false;
}



function titleWordCount(govType: GovType, modifiers: Modifier[]): number {
  return modifiers.length + govType.word.split(/\s+/).length;
}


function compatibleModifiers(
  govType: GovType,
  modifiers: Modifier[],
): Modifier[] {
  return modifiers.filter((modifier) => {
    if (isExcluded(govType.tags, modifier.exclude)) return false;
    return matchesTags(govType.tags, modifier.tags);
  });
}

function pickModifiers(govType: GovType, rng: RNG, count: number): Modifier[] {
  if (count === 0) return [];

  const qualifiers = compatibleModifiers(
    govType,
    QUALIFIER_MODIFIERS,
  );

  const identities = compatibleModifiers(
    govType,
    IDENTITY_MODIFIERS,
  );

  const validPatterns = PATTERNS.filter(
    (pattern) =>
      pattern.length === count &&
      pattern.every((slot) => {
        if (slot === "qualifier") return qualifiers.length > 0;
        if (slot === "identity") return identities.length > 0;
        return true;
      }),
  );

  if (validPatterns.length === 0) return [];

  const pattern = randomChoice(validPatterns, rng);

  const modifiers: Modifier[] = [];

  for (const slot of pattern) {
    if (slot === "qualifier") {
      modifiers.push(randomChoice(qualifiers, rng));
    }

    if (slot === "identity") {
      modifiers.push(randomChoice(identities, rng));
    }
  }

  return modifiers;
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
 * Compose a 2- or 3-word government type from a govType form plus compatible semantic modifiers.
 *
 * Modifier pools are separated by grammatical slot:
 *
 * - Status: provisional, sovereign, autonomous
 * - Honorific: royal, holy, divine, most-serene
 * - Qualifier: federal, parliamentary, mercantile, collectivist
 * - Identity: people's, popular, free
 *
 * Valid modifier patterns are intentionally constrained. For example, status + qualifier is disallowed,
 * which prevents names like "Provisional Collectivist Horde".
 *
 * Examples:
 * - Federal Republic
 * - Most-Serene Republic
 * - Royal Constitutional Kingdom
 * - Democratic People's Republic
 * - Mercantile Trade League
 * - Autonomous City-State
 *
 * Density is derived from the govType's tags. The tags are the source of truth.
 */
export function generateGovernment(rng: RNG): Government {
  const targetWords = rng() < 0.5 ? 2 : 3;

  for (let attempt = 0; attempt < 50; attempt++) {
    const govType = randomChoice(GOV_TYPES, rng);
    const modifierCount = targetWords - govType.word.split(/\s+/).length;
    if (modifierCount < 0 || modifierCount > 2) continue;

    const modifiers = pickModifiers(govType, rng, modifierCount);
    if (titleWordCount(govType, modifiers) !== targetWords) continue;

    return {
      type: titleCase([...modifiers.map((modifier) => modifier.word), govType.word].join(" ")),
      densityFactor: deriveDensityFactor(govType.tags),
      govType,
    };
  }

  const govType = GOV_TYPES.find((entry) => entry.word.split(/\s+/).length === 1) ?? GOV_TYPES[0];
  const modifiers = pickModifiers(govType, rng, 1);

  return {
    type: titleCase([...modifiers.map((modifier) => modifier.word), govType.word].join(" ")),
    densityFactor: deriveDensityFactor(govType.tags),
    govType,
  };
}