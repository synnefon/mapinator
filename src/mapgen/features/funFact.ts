import { randomChoice } from "../../common/random";
import { type CityCondition, matchesCondition } from "./cityCondition";
import type { CityContext } from "./cityStats";
import { Authority, Society, Structure, Trait } from "./government";

// ===================== Fun facts =====================

enum GrammaticalNumber {
  Singular = "singular",
  Plural = "plural",
}

enum QualifierKind {
  EventTime = "eventTime",
  Season = "season",
  Concession = "concession",
  Condition = "condition",
}

type Conditional<T> = T & {
  when?: CityCondition;
};

type FactPart = Conditional<{
  text: string;
  number?: GrammaticalNumber;
  qualifierKinds?: QualifierKind[];
}>;

type FunFactPattern = Conditional<{
  template: string;
  slots: Record<string, FactPart[]>;
}>;

function renderTemplate(template: string, slots: Record<string, string>, ctx: CityContext): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key === "country") return ctx.countryName;
    return slots[key] ?? "";
  });
}

function compatibleNumber(subject?: FactPart, predicate?: FactPart): boolean {
  if (!subject?.number || !predicate?.number) return true;
  return subject.number === predicate.number;
}

function compatibleQualifier(predicate?: FactPart, qualifier?: FactPart): boolean {
  if (!qualifier) return true;
  const predicateKinds = predicate?.qualifierKinds;
  if (!predicateKinds || predicateKinds.length === 0) return false;
  const qualifierKinds = qualifier.qualifierKinds;
  if (!qualifierKinds || qualifierKinds.length === 0) return true;
  return qualifierKinds.some((kind) => predicateKinds.includes(kind));
}

const subject: FactPart[] = [
  { text: "its harbor", number: GrammaticalNumber.Singular, when: { coastal: true } },
  { text: "its docks", number: GrammaticalNumber.Plural, when: { coastal: true } },
  {
    text: "its shipyards",
    number: GrammaticalNumber.Plural,
    when: { coastal: true, anyTags: { society: [Society.Maritime] } },
  },
  { text: "its fish markets", number: GrammaticalNumber.Plural, when: { nearWater: true } },

  { text: "its grain markets", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "its orchards", number: GrammaticalNumber.Plural, when: { bands: ["MID", "WET"], maxElevationMeters: 1400 } },
  { text: "its vineyards", number: GrammaticalNumber.Plural, when: { bands: ["MID"], families: ["MEDIUM"], maxElevationMeters: 1200 } },

  { text: "its mines", number: GrammaticalNumber.Plural, when: { families: ["HIGH", "VERY_HIGH"] } },
  { text: "its quarries", number: GrammaticalNumber.Plural, when: { families: ["HIGH"], bands: ["DRY", "MID"] } },
  { text: "its mountain roads", number: GrammaticalNumber.Plural, when: { families: ["HIGH", "VERY_HIGH"] } },
  { text: "its steep streets", number: GrammaticalNumber.Plural, when: { minElevationMeters: 900 } },

  { text: "its temples", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "its pilgrim roads", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "its dawn bells", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Religious] } } },

  { text: "its libraries", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "its academies", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "its public lectures", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Scholastic] } } },

  { text: "its barracks", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "its walls", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "its parade grounds", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Militaristic] } } },

  { text: "its courts", number: GrammaticalNumber.Plural, when: { capital: true } },
  { text: "its ministry halls", number: GrammaticalNumber.Plural, when: { capital: true, anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "its society houses", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Elite] } } },

  { text: "its old market", number: GrammaticalNumber.Singular },
  { text: "its central square", number: GrammaticalNumber.Singular },
  { text: "its oldest tavern", number: GrammaticalNumber.Singular },
  { text: "its narrow streets", number: GrammaticalNumber.Plural },

  { text: "its foundries", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Industrial] } } },
  { text: "its workshops", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Technical] } } },
  { text: "its assembly hall", number: GrammaticalNumber.Singular, when: { anyTags: { authority: [Authority.Civic] } } },
  { text: "its caravanserai", number: GrammaticalNumber.Singular, when: { biomes: ["desert", "steppe"] } },
  { text: "its terraced fields", number: GrammaticalNumber.Plural, when: { families: ["HIGH"], anyTags: { society: [Society.Agrarian] } } },
  { text: "its governor's palace", number: GrammaticalNumber.Singular, when: { anyTags: { structure: [Structure.Dependent], authority: [Authority.Imperial] } } },
  { text: "its toll bridge", number: GrammaticalNumber.Singular, when: { nearWater: true, anyTags: { authority: [Authority.Commercial] } } },
  { text: "its bell tower", number: GrammaticalNumber.Singular },
  { text: "its bathhouses", number: GrammaticalNumber.Plural, when: { tiers: ["medium", "big"] } },
];

const predicate: FactPart[] = [
  {
    text: "draws travelers from across {country}",
    number: GrammaticalNumber.Singular,
    qualifierKinds: [QualifierKind.Season, QualifierKind.Condition, QualifierKind.Concession],
  },
  {
    text: "draw travelers from across {country}",
    number: GrammaticalNumber.Plural,
    qualifierKinds: [QualifierKind.Season, QualifierKind.Condition, QualifierKind.Concession],
  },

  { text: "is known throughout the region", number: GrammaticalNumber.Singular },
  { text: "are known throughout the region", number: GrammaticalNumber.Plural },

  { text: "is the pride of the locals", number: GrammaticalNumber.Singular },
  { text: "are the pride of the locals", number: GrammaticalNumber.Plural },

  {
    text: "supports much of the surrounding countryside",
    number: GrammaticalNumber.Singular,
    when: { anyTags: { authority: [Authority.Commercial], society: [Society.Agrarian] } },
  },
  {
    text: "support much of the surrounding countryside",
    number: GrammaticalNumber.Plural,
    when: { anyTags: { authority: [Authority.Commercial], society: [Society.Agrarian] } },
  },

  { text: "has stood for generations", number: GrammaticalNumber.Singular },
  { text: "have stood for generations", number: GrammaticalNumber.Plural },

  {
    text: "is older than the current government",
    number: GrammaticalNumber.Singular,
    when: { anyTags: { trait: [Trait.Traditional, Trait.Revolutionary] } },
  },
  {
    text: "are older than the current government",
    number: GrammaticalNumber.Plural,
    when: { anyTags: { trait: [Trait.Traditional, Trait.Revolutionary] } },
  },

  {
    text: "is louder than visitors expect",
    number: GrammaticalNumber.Singular,
    qualifierKinds: [QualifierKind.EventTime, QualifierKind.Season, QualifierKind.Condition],
  },
  {
    text: "are louder than visitors expect",
    number: GrammaticalNumber.Plural,
    qualifierKinds: [QualifierKind.EventTime, QualifierKind.Season, QualifierKind.Condition],
  },

  {
    text: "appears in half the songs locals sing",
    number: GrammaticalNumber.Singular,
    when: { anyTags: { trait: [Trait.Traditional] } },
  },
  {
    text: "appear in half the songs locals sing",
    number: GrammaticalNumber.Plural,
    when: { anyTags: { trait: [Trait.Traditional] } },
  },

  { text: "makes outsiders underestimate the city", number: GrammaticalNumber.Singular },
  { text: "make outsiders underestimate the city", number: GrammaticalNumber.Plural },

  {
    text: "keeps the city richer than it looks",
    number: GrammaticalNumber.Singular,
    when: { anyTags: { authority: [Authority.Commercial] } },
  },
  {
    text: "keep the city richer than it looks",
    number: GrammaticalNumber.Plural,
    when: { anyTags: { authority: [Authority.Commercial] } },
  },

  { text: "has survived fires, floods, and at least one bad ruler", number: GrammaticalNumber.Singular },
  { text: "have survived fires, floods, and at least one bad ruler", number: GrammaticalNumber.Plural },

  { text: "anchors the local economy", number: GrammaticalNumber.Singular, when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "anchor the local economy", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Commercial] } } },

  { text: "runs on rumor as much as coin", number: GrammaticalNumber.Singular },
  { text: "run on rumor as much as coin", number: GrammaticalNumber.Plural },

  {
    text: "never really closes",
    number: GrammaticalNumber.Singular,
    qualifierKinds: [QualifierKind.EventTime, QualifierKind.Season, QualifierKind.Concession],
  },
  {
    text: "never really close",
    number: GrammaticalNumber.Plural,
    qualifierKinds: [QualifierKind.EventTime, QualifierKind.Season, QualifierKind.Concession],
  },

  {
    text: "has outlived three governments and counting",
    number: GrammaticalNumber.Singular,
    when: { anyTags: { trait: [Trait.Revolutionary, Trait.Fragmented] } },
  },
  {
    text: "have outlived three governments and counting",
    number: GrammaticalNumber.Plural,
    when: { anyTags: { trait: [Trait.Revolutionary, Trait.Fragmented] } },
  },
];

const qualifier: FactPart[] = [
  { text: "during the spring fair", qualifierKinds: [QualifierKind.Season] },
  { text: "when the roads are passable", qualifierKinds: [QualifierKind.Condition], when: { families: ["HIGH", "VERY_HIGH"] } },
  { text: "after the harvest", qualifierKinds: [QualifierKind.Season], when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "during holy festivals", qualifierKinds: [QualifierKind.Season], when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "whenever the fleet comes in", qualifierKinds: [QualifierKind.Condition], when: { coastal: true } },
  { text: "despite the harsh winters", qualifierKinds: [QualifierKind.Concession], when: { minIce: 0.25 } },
  { text: "even in the dry season", qualifierKinds: [QualifierKind.Concession], when: { bands: ["DRY"] } },
  { text: "on market days", qualifierKinds: [QualifierKind.EventTime] },
  { text: "before sunrise", qualifierKinds: [QualifierKind.EventTime], when: { bands: ["DRY"] } },
  { text: "long after sunset", qualifierKinds: [QualifierKind.EventTime], when: { tiers: ["medium", "big"] } },
  { text: "on festival nights", qualifierKinds: [QualifierKind.EventTime] },
  { text: "when the snow finally melts", qualifierKinds: [QualifierKind.Season, QualifierKind.Condition], when: { minIce: 0.2 } },
  { text: "as soon as the caravans arrive", qualifierKinds: [QualifierKind.Condition], when: { biomes: ["desert", "steppe"] } },
  { text: "long after the capital has gone to bed", qualifierKinds: [QualifierKind.EventTime], when: { tiers: ["big"] } },
  { text: "on festival days", qualifierKinds: [QualifierKind.Condition], when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "in fat years and lean", qualifierKinds: [QualifierKind.Concession] },
];

const placeMemory: FactPart[] = [
  { text: "the first uprising began", when: { anyTags: { trait: [Trait.Revolutionary] } } },
  { text: "the old dynasty fell", when: { anyTags: { trait: [Trait.Revolutionary], authority: [Authority.Monarchic, Authority.Elite] } } },
  { text: "a famous siege broke", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the founding charter was signed", when: { capital: true } },
  { text: "the first temple was raised", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "the old trade road met the river", when: { nearWater: true } },
  { text: "the first winter market was held", when: { minIce: 0.2 } },
  { text: "the clans agreed to meet each year", when: { anyTags: { structure: [Structure.Nomadic] } } },
];

const localHabit: FactPart[] = [
  { text: "argue about which tavern is oldest" },
  { text: "insist their bread is better than the capital's" },
  { text: "give directions by landmarks that no longer exist" },
  { text: "treat market gossip as a civic institution" },
  { text: "start the day before sunrise", when: { bands: ["DRY"] } },
  { text: "watch the sea before making plans", when: { coastal: true } },
  { text: "know three different words for fog", when: { bands: ["WET"] } },
  { text: "measure distance by how steep the walk is", when: { minElevationMeters: 800 } },
  { text: "debate in public like it is a sport", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "lower their voices near the temples", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "keep old military songs alive", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "settle arguments at the same café table they always have" },
  { text: "blame the neighboring town for any run of bad luck" },
  { text: "still ring the old bell for reasons no one remembers" },
  { text: "keep two clocks: the real time and the official time", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
];

const reputation: FactPart[] = [
  { text: "hard to conquer", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "impossible to govern quietly", when: { anyTags: { trait: [Trait.Revolutionary] } } },
  { text: "devout even by {country}'s standards", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "smarter than is polite", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "wealthier than it first appears", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "older than anyone can prove", when: { anyTags: { trait: [Trait.Traditional] } } },
  { text: "proud, stubborn, and difficult to impress" },
  { text: "friendlier after the second drink" },
  { text: "a place where visitors accidentally stay for years" },
  { text: "impossible to bribe and impossible to please", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "ungovernable except by its own consent", when: { anyTags: { authority: [Authority.Civic] } } },
  { text: "always one bad winter from rebellion", when: { minIce: 0.3 } },
  { text: "the kind of place that survives its own rulers" },
];

const landscape: FactPart[] = [
  // desert
  { text: "desert flats", when: { biomes: ["desert"] } },
  { text: "windswept dunes", when: { biomes: ["desert"] } },
  { text: "sun-cracked hardpan", when: { biomes: ["desert"] } },
  // grassland
  { text: "open grassland", when: { biomes: ["grassland"] } },
  { text: "rolling plains", when: { biomes: ["grassland"] } },
  { text: "wind-combed prairie", when: { biomes: ["grassland"] } },
  // wetland (no coastal req → inland marshes are covered too)
  { text: "salt marshes", when: { coastal: true, biomes: ["wetland"] } },
  { text: "reed-choked fens", when: { biomes: ["wetland"] } },
  { text: "slow black water", when: { biomes: ["wetland"] } },
  // steppe
  { text: "dry steppe", when: { biomes: ["steppe"] } },
  { text: "open rangeland", when: { biomes: ["steppe"] } },
  { text: "endless grass", when: { biomes: ["steppe"] } },
  // woodland
  { text: "scattered woodland", when: { biomes: ["woodland"] } },
  { text: "oak and thornscrub", when: { biomes: ["woodland"] } },
  // forest
  { text: "deep forest", when: { biomes: ["forest"] } },
  { text: "shadowed timber", when: { biomes: ["forest"] } },
  // badlands
  { text: "badlands", when: { biomes: ["badlands"] } },
  { text: "eroded gullies", when: { biomes: ["badlands"] } },
  { text: "banded clay hills", when: { biomes: ["badlands"] } },
  // highlands
  { text: "highland slopes", when: { biomes: ["highlands"] } },
  { text: "windy uplands", when: { biomes: ["highlands"] } },
  { text: "heather and bare rock", when: { biomes: ["highlands"] } },
  // montane forest
  { text: "misty pinewood", when: { biomes: ["montane forest"] } },
  { text: "cloud-wrapped slopes", when: { biomes: ["montane forest"] } },
  // barren peaks
  { text: "barren peaks", when: { biomes: ["barren peaks"] } },
  { text: "bare ridgelines", when: { biomes: ["barren peaks"] } },
  { text: "scoured stone", when: { biomes: ["barren peaks"] } },
  // alpine
  { text: "alpine meadows", when: { biomes: ["alpine"] } },
  { text: "snow-streaked slopes", when: { biomes: ["alpine"] } },
  // snowfields
  { text: "snowfields", when: { biomes: ["snowfields"] } },
  { text: "endless white", when: { biomes: ["snowfields"] } },
  // tundra
  { text: "frozen tundra", when: { biomes: ["tundra"] } },
  { text: "lichen and permafrost", when: { biomes: ["tundra"] } },
];

const weirdDetail: FactPart[] = [
  { text: "no two clock towers agree on the time" },
  { text: "the oldest tavern has burned down at least twice" },
  { text: "locals disagree about the origin of the city's name" },
  { text: "every neighborhood claims to be the true heart of the city", when: { tiers: ["medium", "big"] } },
  { text: "sailors refuse to whistle near the harbor", when: { coastal: true } },
  { text: "children dare each other to touch the old siege stones", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "pilgrims leave ribbons tied to every roadside tree", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "students have carved jokes into half the old lecture benches", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "people claim the fog remembers faces", when: { bands: ["WET"] } },
  { text: "the wind is blamed for everything from bad crops to bad marriages", when: { bands: ["DRY"], families: ["LOW", "MEDIUM"] } },
  { text: "the city keeps a holiday whose origin everyone has forgotten" },
  { text: "the river is technically illegal to swim in, and everyone does", when: { nearWater: true } },
  { text: "every map of the old town is subtly wrong on purpose", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the tallest building is, by old law, the granary", when: { anyTags: { society: [Society.Agrarian] } } },
];

const origin: FactPart[] = [
  { text: "a fishing village", when: { coastal: true } },
  { text: "a river crossing", when: { nearWater: true, coastal: false } },
  { text: "a frontier fort", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "a roadside trading post", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "a monastery and the town that fed it", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "a mining camp", when: { families: ["HIGH", "VERY_HIGH"] } },
  { text: "a seasonal clan gathering", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "a cluster of farms that never stopped growing" },
];

const nickname: FactPart[] = [
  { text: "the gray city", when: { anyTags: { society: [Society.Industrial] } } },
  { text: "the city of bells", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "the stubborn city", when: { anyTags: { trait: [Trait.Revolutionary, Trait.Fragmented] } } },
  { text: "the high city", when: { minElevationMeters: 1500 } },
  { text: "the white city", when: { minIce: 0.3 } },
  { text: "the counting house of {country}", when: { anyTags: { authority: [Authority.Commercial] } } },
];

const dish: FactPart[] = [
  { text: "salt cod", when: { coastal: true } },
  { text: "river eel", when: { nearWater: true, coastal: false } },
  { text: "barley stew", when: { minIce: 0.2 } },
  { text: "spiced flatbread", when: { biomes: ["desert", "steppe"] } },
  { text: "smoked mutton", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "something fried that no one can quite name" },
];

const FUN_FACT_PATTERNS: FunFactPattern[] = [
  {
    template: "{subject} {predicate}",
    slots: { subject, predicate },
  },
  {
    template: "{subject} {predicate} {qualifier}",
    slots: { subject, predicate, qualifier },
  },
  {
    template: "locals still point to the place where {memory}",
    slots: { memory: placeMemory },
  },
  {
    template: "locals {habit}",
    slots: { habit: localHabit },
  },
  {
    template: "known across {country} as {reputation}",
    slots: { reputation },
  },
  {
    template: "set deep in {country}'s {landscape}",
    slots: { landscape },
  },
  {
    template: "{weirdDetail}",
    slots: { weirdDetail },
  },
  {
    when: { capital: true },
    template: "the seat of {country}'s government",
    slots: {},
  },
  {
    when: { coastal: true, maxElevationMeters: 20 },
    template: "built right at the water's edge",
    slots: {},
  },
  {
    when: { minElevationMeters: 2000 },
    template: "one of the highest cities in {country}",
    slots: {},
  },
  {
    when: { minIce: 0.35 },
    template: "winter shapes nearly every part of daily life",
    slots: {},
  },
  {
    when: { coastal: true, anyTags: { society: [Society.Maritime] } },
    template: "its docks handle much of {country}'s sea trade",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Religious] } },
    template: "pilgrims often outnumber merchants during holy festivals",
    slots: {},
  },
  {
    when: { anyTags: { society: [Society.Scholastic] } },
    template: "students arrive from across {country} to study here",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Militaristic] } },
    template: "grew up around an old frontier garrison",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Revolutionary] } },
    template: "birthplace of more than one uprising",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Traditional] } },
    template: "proud of customs older than {country} itself",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Nomadic] } },
    template: "a seasonal meeting place for the surrounding clans",
    slots: {},
  },
  {
    when: { nearWater: true, coastal: false },
    template: "river traffic keeps its markets busy year round",
    slots: {},
  },
  {
    template: "grew out of {origin}",
    slots: { origin },
  },
  {
    template: "locals call it {nickname}",
    slots: { nickname },
  },
  {
    template: "no visitor leaves without trying the {dish}",
    slots: { dish },
  },

  // — government-dimension one-liners (the enums the slot pools never reach) —
  {
    when: { anyTags: { authority: [Authority.Imperial] } },
    template: "an old imperial seat that never quite stopped acting like one",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Imperial] } },
    template: "the old imperial road still runs dead straight through its center",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Civic] } },
    template: "every decision of consequence still goes to a show of hands",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Civic] }, tiers: ["small", "medium"] },
    template: "small enough that the whole town fits in one assembly",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Technical] } },
    template: "here the engineers are consulted before the priests",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Bureaucratic] } },
    template: "nothing happens here without the right stamp on the right form",
    slots: {},
  },
  {
    when: { anyTags: { society: [Society.Industrial] } },
    template: "its furnaces have not gone cold in living memory",
    slots: {},
  },
  {
    when: { anyTags: { society: [Society.Industrial] } },
    template: "the whole valley smells faintly of coal smoke",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Dependent] } },
    template: "loyal on paper, stubbornly independent in practice",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Dependent] } },
    template: "still flies two flags, mostly out of habit",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Urban] } },
    template: "all streets and rooftops — open country is a day's ride off",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Local] } },
    template: "governs itself, and the next town's laws stop at the bridge",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Minor] } },
    template: "small, old, and entirely sure of itself",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Minor] } },
    template: "a quiet place with a long memory",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Federal] } },
    template: "sends more delegates to the capital than its size deserves",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Expansionist] } },
    template: "half its streets are named for battles fought far from here",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Stable] } },
    template: "nothing of importance has changed here in three generations",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Fragmented] } },
    template: "each quarter keeps its own holidays, and its own old grudges",
    slots: {},
  },
];

function chooseSlotOption(
  slotName: string,
  options: FactPart[],
  ctx: CityContext,
  chosen: Record<string, FactPart>,
): FactPart | null {
  let candidates = options.filter((option) => matchesCondition(ctx, option.when));

  if (slotName === "predicate") {
    candidates = candidates.filter((option) => compatibleNumber(chosen.subject, option));
  }

  if (slotName === "qualifier") {
    candidates = candidates.filter((option) => compatibleQualifier(chosen.predicate, option));
  }

  if (candidates.length === 0) return null;
  return randomChoice(candidates, ctx.rng);
}

function generateFromPattern(pattern: FunFactPattern, ctx: CityContext): string | null {
  if (!matchesCondition(ctx, pattern.when)) return null;

  const resolvedSlots: Record<string, string> = {};
  const chosenParts: Record<string, FactPart> = {};

  for (const [slotName, options] of Object.entries(pattern.slots)) {
    const chosen = chooseSlotOption(slotName, options, ctx, chosenParts);
    if (!chosen) return null;

    chosenParts[slotName] = chosen;
    resolvedSlots[slotName] = renderTemplate(chosen.text, resolvedSlots, ctx);
  }

  return renderTemplate(pattern.template, resolvedSlots, ctx);
}

export function generateFunFact(ctx: CityContext, used?: Set<string>): string {
  const candidates: string[] = [];
  for (const pattern of FUN_FACT_PATTERNS) {
    const text = generateFromPattern(pattern, ctx);
    if (text !== null) candidates.push(text);
  }

  if (candidates.length === 0) return `set deep in ${ctx.countryName}'s ${ctx.biome}`;

  // Prefer a fact this country hasn't used yet so two cities don't share a line; fall back to the full
  // set only if every candidate is already taken. The chosen fact is recorded in `used`.
  const fresh = used ? candidates.filter((c) => !used.has(c)) : candidates;
  const chosen = randomChoice(fresh.length > 0 ? fresh : candidates, ctx.rng);
  used?.add(chosen);
  return chosen;
}
