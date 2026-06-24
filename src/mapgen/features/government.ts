import { randomChoice, weightedRandomChoice, type RNG } from "../../common/random";

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

enum Character {
  Scholastic = "scholastic",
  Industrial = "industrial",
  Agrarian = "agrarian",
  Maritime = "maritime",
}

type Tags = {
  authority?: Authority[];
  structure?: Structure[];
  character?: Character[];
};

type Core = {
  word: string;
  density: number;
  tags: Tags;
};

type Modifier = {
  word: string;
  tags: Tags;
  exclude?: Tags;
};

const CORES: Core[] = [
  { word: "republic", density: 1.2, tags: { authority: [Authority.Civic] } },
  {
    word: "federation",
    density: 0.95,
    tags: { authority: [Authority.Civic], structure: [Structure.Federal] },
  },
  {
    word: "confederacy",
    density: 0.85,
    tags: { authority: [Authority.Civic], structure: [Structure.Federal, Structure.Local] },
  },
  {
    word: "union",
    density: 1.0,
    tags: { authority: [Authority.Civic], structure: [Structure.Federal] },
  },
  {
    word: "commonwealth",
    density: 1.1,
    tags: { authority: [Authority.Civic, Authority.Commercial] },
  },
  {
    word: "league",
    density: 0.9,
    tags: { authority: [Authority.Civic, Authority.Commercial], structure: [Structure.Federal] },
  },
  {
    word: "commune",
    density: 1.15,
    tags: { authority: [Authority.Civic], structure: [Structure.Local] },
  },
  {
    word: "city-state",
    density: 1.45,
    tags: { authority: [Authority.Civic], structure: [Structure.Local, Structure.Urban] },
  },

  {
    word: "empire",
    density: 0.95,
    tags: { authority: [Authority.Imperial, Authority.Monarchic, Authority.Militaristic] },
  },
  { word: "kingdom", density: 1.0, tags: { authority: [Authority.Monarchic] } },
  {
    word: "duchy",
    density: 0.9,
    tags: { authority: [Authority.Monarchic], structure: [Structure.Minor] },
  },
  {
    word: "principality",
    density: 0.9,
    tags: { authority: [Authority.Monarchic], structure: [Structure.Minor] },
  },
  {
    word: "sultanate",
    density: 0.8,
    tags: { authority: [Authority.Monarchic, Authority.Religious] },
  },
  {
    word: "khanate",
    density: 0.7,
    tags: {
      authority: [Authority.Monarchic, Authority.Militaristic],
      structure: [Structure.Nomadic],
    },
  },

  { word: "theocracy", density: 1.0, tags: { authority: [Authority.Religious] } },
  {
    word: "magisterium",
    density: 1.05,
    tags: {
      authority: [Authority.Religious, Authority.Bureaucratic],
      character: [Character.Scholastic],
    },
  },
  {
    word: "order",
    density: 0.95,
    tags: { authority: [Authority.Religious, Authority.Militaristic] },
  },

  {
    word: "technocracy",
    density: 1.25,
    tags: { authority: [Authority.Technical, Authority.Bureaucratic] },
  },
  {
    word: "directorate",
    density: 1.1,
    tags: { authority: [Authority.Bureaucratic, Authority.Elite] },
  },
  {
    word: "syndicate",
    density: 1.3,
    tags: { authority: [Authority.Commercial, Authority.Elite] },
  },
  {
    word: "consortium",
    density: 1.25,
    tags: { authority: [Authority.Commercial, Authority.Elite] },
  },
  {
    word: "oligarchy",
    density: 1.15,
    tags: { authority: [Authority.Elite, Authority.Bureaucratic] },
  },

  {
    word: "protectorate",
    density: 0.85,
    tags: { structure: [Structure.Dependent] },
  },
  {
    word: "dominion",
    density: 0.85,
    tags: { authority: [Authority.Imperial], structure: [Structure.Dependent] },
  },
  {
    word: "satrapy",
    density: 0.8,
    tags: {
      authority: [Authority.Imperial, Authority.Bureaucratic],
      structure: [Structure.Dependent],
    },
  },
];

const MODIFIERS: Modifier[] = [
  {
    word: "sovereign",
    tags: {
      authority: [
        Authority.Civic,
        Authority.Monarchic,
        Authority.Imperial,
        Authority.Religious,
        Authority.Commercial,
      ],
      structure: [Structure.Federal, Structure.Local, Structure.Minor],
    },
    exclude: { structure: [Structure.Dependent] },
  },
  {
    word: "unified",
    tags: {
      authority: [Authority.Civic, Authority.Imperial, Authority.Monarchic, Authority.Bureaucratic],
      structure: [Structure.Federal],
    },
  },
  {
    word: "provisional",
    tags: {
      authority: [Authority.Civic, Authority.Militaristic],
      structure: [Structure.Federal, Structure.Local, Structure.Dependent],
    },
  },
  {
    word: "eternal",
    tags: {
      authority: [Authority.Imperial, Authority.Religious, Authority.Monarchic, Authority.Militaristic],
    },
    exclude: { authority: [Authority.Civic, Authority.Commercial] },
  },
  {
    word: "restored",
    tags: {
      authority: [Authority.Monarchic, Authority.Imperial, Authority.Religious, Authority.Civic],
    },
  },
  {
    word: "fallen",
    tags: {
      authority: [Authority.Monarchic, Authority.Imperial, Authority.Religious, Authority.Militaristic],
      structure: [Structure.Dependent],
    },
  },

  {
    word: "federal",
    tags: { structure: [Structure.Federal] },
  },
  {
    word: "democratic",
    tags: { authority: [Authority.Civic], structure: [Structure.Federal, Structure.Local] },
  },
  {
    word: "people's",
    tags: { authority: [Authority.Civic], structure: [Structure.Federal, Structure.Local] },
  },
  {
    word: "constitutional",
    tags: {
      authority: [Authority.Civic, Authority.Monarchic],
      structure: [Structure.Federal],
    },
  },
  {
    word: "free",
    tags: {
      authority: [Authority.Civic, Authority.Commercial],
      structure: [Structure.Local, Structure.Minor],
    },
  },

  {
    word: "grand",
    tags: { authority: [Authority.Monarchic, Authority.Imperial, Authority.Religious] },
  },
  {
    word: "imperial",
    tags: { authority: [Authority.Imperial, Authority.Monarchic], structure: [Structure.Dependent] },
    exclude: { authority: [Authority.Civic], structure: [Structure.Local] },
  },

  {
    word: "holy",
    tags: {
      authority: [Authority.Religious, Authority.Monarchic, Authority.Imperial, Authority.Militaristic],
    },
  },
  {
    word: "sacred",
    tags: {
      authority: [Authority.Religious, Authority.Monarchic],
      character: [Character.Scholastic],
    },
  },
  {
    word: "apostolic",
    tags: { authority: [Authority.Religious] },
  },
  {
    word: "theocratic",
    tags: { authority: [Authority.Religious] },
  },

  {
    word: "mercantile",
    tags: {
      authority: [Authority.Commercial, Authority.Civic],
      structure: [Structure.Urban],
      character: [Character.Maritime],
    },
  },
  {
    word: "industrial",
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic, Authority.Commercial],
      structure: [Structure.Urban],
      character: [Character.Industrial],
    },
  },
  {
    word: "agrarian",
    tags: {
      authority: [Authority.Civic, Authority.Monarchic],
      structure: [Structure.Local],
      character: [Character.Agrarian],
    },
  },
  // {
  //   word: "maritime",
  //   tags: {
  //     authority: [Authority.Commercial, Authority.Civic, Authority.Imperial],
  //     character: [Character.Maritime],
  //   },
  // },
  {
    word: "pastoral",
    tags: {
      structure: [Structure.Nomadic, Structure.Local, Structure.Minor],
      character: [Character.Agrarian],
    },
  },
  {
    word: "nomadic",
    tags: { structure: [Structure.Nomadic] },
  },

  {
    word: "technocratic",
    tags: {
      authority: [Authority.Technical, Authority.Bureaucratic],
      character: [Character.Scholastic],
    },
  },
  {
    word: "stratocratic",
    tags: { authority: [Authority.Militaristic, Authority.Bureaucratic] },
  },
  {
    word: "militant",
    tags: { authority: [Authority.Militaristic, Authority.Religious, Authority.Imperial] },
  },

  {
    word: "arcane",
    tags: {
      authority: [Authority.Religious, Authority.Technical],
      character: [Character.Scholastic],
    },
  },
  {
    word: "scholastic",
    tags: {
      authority: [Authority.Religious, Authority.Bureaucratic],
      character: [Character.Scholastic],
    },
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
    matchesAxis(core.character, modifier.character)
  );
}

function isExcluded(core: Tags, exclude: Tags | undefined): boolean {
  if (!exclude) return false;

  return (
    hasOverlap(core.authority, exclude.authority) ||
    hasOverlap(core.structure, exclude.structure) ||
    hasOverlap(core.character, exclude.character)
  );
}

function compatibleModifiers(core: Core): Modifier[] {
  return MODIFIERS.filter((modifier) => {
    if (isExcluded(core.tags, modifier.exclude)) {
      return false;
    }

    return matchesTags(core.tags, modifier.tags);
  });
}

function titleCase(words: string): string {
  return words.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Compose a government type from 2–3 parts.
 *
 * Examples:
 * - federal republic
 * - holy kingdom
 * - mercantile city-state
 * - sacred apostolic order
 *
 * The core form provides the main population-density signal. Modifiers apply
 * small multiplicative nudges.
 */
export function generateGovernment(rng: RNG): Government {
  const core = randomChoice(CORES, rng);
  const parts = 3;

  const pool = [...compatibleModifiers(core)];
  const modifiers: string[] = [];

  let densityFactor = core.density;

  for (let i = 0; i < parts - 1 && pool.length > 0; i++) {
    const picked = pool.splice(Math.floor(rng() * pool.length), 1)[0];

    modifiers.push(picked.word);
  }

  return {
    type: titleCase([...modifiers, core.word].join(" ")),
    densityFactor,
  };
}
