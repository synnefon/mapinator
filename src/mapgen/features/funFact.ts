import { randomChoice } from "../../common/random";
import { type CityCondition, matchesCondition } from "./cityCondition";
import type { BiomeName, CityContext } from "./cityStats";
import { Authority, Society, Structure, Trait } from "./government";

// Biome collections — named groups so fun-fact gates read by terrain character rather than raw ice/elevation
// thresholds (cold flavour keys off WINTRY_BIOMES, not minIce). A city's biome is exactly one of these values.
const WINTRY_BIOMES: BiomeName[] = ["tundra", "snowfields", "alpine", "barren peaks"];
const ARID_BIOMES: BiomeName[] = ["desert", "steppe", "badlands"];
const WOODED_BIOMES: BiomeName[] = ["forest", "woodland", "montane forest"];

// ===================== Fun facts =====================

enum GrammaticalNumber {
  Singular = "singular",
  Plural = "plural",
}

// Grammatical-fit categories for the optional predicate→qualifier match. Plain tags, not an enum: a
// qualifier declares the categories it IS (`fit`); a predicate the categories it ACCEPTS (`accepts`).
// Both default OPEN — a predicate with no `accepts` takes any qualifier; a qualifier with no `fit`
// follows any predicate. `accepts: []` is the explicit opt-out (predicate takes no qualifier).
//
// `condition` is a CIRCUMSTANTIAL condition (when the weather allows); `access` is an INSIDER one (if you
// know who to ask). They're split so insider clauses trail only access predicates ("keeps odd hours if you
// know who to ask"), never public/observable ones ("draws crowds … if you know who to ask" — nonsense).
//
// COVERAGE INVARIANT (keep this true so any city can reach any kind): every Fit below has at least one
// un-gated (`when`-less) qualifier, and every required slot has at least one un-gated option. Add freely
// — a new entry only widens coverage; just don't gate the LAST universal out of a category.
type Fit = "seasonal" | "eventTime" | "condition" | "access" | "concession";

// Semantic kind of a feature subject, for the predicate→subject match (the subject analogue of Fit). A
// subject declares the kind it IS (`kind`); a predicate the kinds it ATTACHES TO (`attachTo`). It stops a
// predicate that implies commerce / bustle / record-keeping from landing on the wrong feature ("its bell
// tower anchors the local economy", "its foundries draw crowds"). `attachTo` omitted ⇒ any kind, so
// stative/atmospheric predicates ("known throughout the region", "smells of salt and tar") still reach every
// subject — including landmarks. cityWide subjects (the whole settlement) bypass the check.
//   • market      — commerce / exchange, a crowd-drawing destination (markets, harbor, caravanserai, …)
//   • industry    — production / extraction, busy but not a destination (mines, foundries, orchards, mills, …)
//   • place       — public space people gather in or pass through (square, tavern, streets, baths, …)
//   • institution — governance / learning / worship / military (courts, libraries, temples, barracks, …)
//   • landmark    — civic sight or signal, admired not used (bell tower, lighthouse, clock tower, dawn bells)
//   • rampart     — defensive work, storied and martial (walls, hill forts)
type SubjectKind = "market" | "industry" | "place" | "institution" | "landmark" | "rampart";

type Conditional<T> = T & {
  when?: CityCondition;
};

type FactPart = Conditional<{
  text: string;
  number?: GrammaticalNumber; // subjects only: drives verb agreement in the following predicate/qualifier
  fit?: Fit[]; // qualifiers only: the grammatical categories this clause is
  accepts?: Fit[]; // predicates only: which qualifier categories may follow (omit ⇒ all; [] ⇒ none)
  kind?: SubjectKind; // feature subjects only: its semantic kind (cityWide subjects omit it and bypass)
  attachTo?: SubjectKind[]; // predicates only: which subject kinds may precede (omit ⇒ all kinds)
  cityWide?: boolean; // subject: stands for the whole settlement. predicate: describes the town as a whole,
  //                     so it needs a cityWide subject ("its orchards host more festivals" reads as nonsense).
}>;

type FunFactPattern = Conditional<{
  template: string;
  slots: Record<string, FactPart[]>;
}>;

// Third-person singular of a regular English verb — the {v:base} token's singular form.
function thirdPerson(base: string): string {
  if (/(s|x|z|ch|sh)$/.test(base)) return base + "es";
  if (/[^aeiou]y$/.test(base)) return base.slice(0, -1) + "ies";
  if (/o$/.test(base)) return base + "es";
  return base + "s";
}

// Expand verb-agreement tokens against the governing number: {cop}=is/are, {have}=has/have,
// {v:base}=third-person-singular/base. A string with no tokens is returned unchanged, so inflection is
// opt-in per entry — only subjects/predicates/qualifiers that need agreement carry tokens.
function inflect(text: string, number: GrammaticalNumber): string {
  const singular = number === GrammaticalNumber.Singular;
  return text
    .replace(/\{cop\}/g, singular ? "is" : "are")
    .replace(/\{have\}/g, singular ? "has" : "have")
    .replace(/\{v:([a-z]+)\}/g, (_, base: string) => (singular ? thirdPerson(base) : base));
}

function renderTemplate(template: string, slots: Record<string, string>, ctx: CityContext): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (key === "country") return ctx.countryName;
    return slots[key] ?? "";
  });
}

// Grammatical fit: may this qualifier follow this predicate? Default-open both ways; `accepts: []` opts out.
function acceptsQualifier(predicate: FactPart | undefined, qualifier: FactPart): boolean {
  const accepted = predicate?.accepts;
  if (accepted && accepted.length === 0) return false; // explicit opt-out
  if (!accepted) return true; // no list ⇒ accepts every qualifier
  const fit = qualifier.fit;
  if (!fit || fit.length === 0) return true; // unmarked qualifier ⇒ fits anywhere
  return fit.some((f) => accepted.includes(f));
}

// Semantic fit: may this predicate attach to this subject? `attachTo` omitted ⇒ every kind. cityWide
// subjects (the whole settlement encompasses every kind) bypass; otherwise the subject's kind must be listed.
function acceptsSubject(predicate: FactPart, subject: FactPart | undefined): boolean {
  if (!predicate.attachTo) return true; // no list ⇒ attaches to every kind
  if (subject?.cityWide) return true; // the whole town stands in for works/place/institution/monument alike
  return subject?.kind !== undefined && predicate.attachTo.includes(subject.kind);
}

// Subjects carry `number` (drives verb agreement) and `kind` (the predicate→subject match; see SubjectKind).
const subject: FactPart[] = [
  { text: "its harbor", kind: "market", number: GrammaticalNumber.Singular, when: { coastal: true } },
  { text: "its docks", kind: "market", number: GrammaticalNumber.Plural, when: { coastal: true } },
  {
    text: "its shipyards",
    kind: "industry",
    number: GrammaticalNumber.Plural,
    when: { coastal: true, anyTags: { society: [Society.Maritime] } },
  },
  { text: "its fish markets", kind: "market", number: GrammaticalNumber.Plural, when: { nearWater: true } },

  { text: "its grain markets", kind: "market", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "its orchards", kind: "industry", number: GrammaticalNumber.Plural, when: { bands: ["MID", "WET"], maxElevationMeters: 1400 } },
  { text: "its vineyards", kind: "industry", number: GrammaticalNumber.Plural, when: { bands: ["MID"], elevations: ["MEDIUM"], maxElevationMeters: 1200 } },

  { text: "its mines", kind: "industry", number: GrammaticalNumber.Plural, when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "its quarries", kind: "industry", number: GrammaticalNumber.Plural, when: { elevations: ["HIGH"], bands: ["DRY", "MID"] } },
  { text: "its mountain roads", kind: "place", number: GrammaticalNumber.Plural, when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "its steep streets", kind: "place", number: GrammaticalNumber.Plural, when: { minElevationMeters: 900 } },

  { text: "its temples", kind: "institution", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "its pilgrim roads", kind: "place", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "its dawn bells", kind: "landmark", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Religious] } } },

  { text: "its libraries", kind: "institution", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "its academies", kind: "institution", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "its public lectures", kind: "institution", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Scholastic] } } },

  { text: "its barracks", kind: "institution", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "its walls", kind: "rampart", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "its parade grounds", kind: "place", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Militaristic] } } },

  { text: "its courts", kind: "institution", number: GrammaticalNumber.Plural, when: { capital: true } },
  { text: "its ministry halls", kind: "institution", number: GrammaticalNumber.Plural, when: { capital: true, anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "its noble houses", kind: "place", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Elite] } } },

  { text: "its old market", kind: "market", number: GrammaticalNumber.Singular },
  { text: "its central square", kind: "place", number: GrammaticalNumber.Singular },
  { text: "its oldest tavern", kind: "place", number: GrammaticalNumber.Singular },
  { text: "its narrow streets", kind: "place", number: GrammaticalNumber.Plural },

  { text: "its foundries", kind: "industry", number: GrammaticalNumber.Plural, when: { industries: ["metalworking"] } },
  { text: "its workshops", kind: "industry", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Technical] } } },
  { text: "its assembly hall", kind: "institution", number: GrammaticalNumber.Singular, when: { anyTags: { authority: [Authority.Civic] } } },
  { text: "its caravanserai", kind: "market", number: GrammaticalNumber.Singular, when: { biomes: ["desert", "steppe"] } },
  { text: "its terraced fields", kind: "industry", number: GrammaticalNumber.Plural, when: { elevations: ["HIGH"], anyTags: { society: [Society.Agrarian] } } },
  { text: "its governor's palace", kind: "institution", number: GrammaticalNumber.Singular, when: { anyTags: { structure: [Structure.Dependent], authority: [Authority.Imperial] } } },
  { text: "its toll bridge", kind: "market", number: GrammaticalNumber.Singular, when: { nearWater: true, anyTags: { authority: [Authority.Commercial] } } },
  { text: "its bell tower", kind: "landmark", number: GrammaticalNumber.Singular },
  { text: "its bathhouses", kind: "place", number: GrammaticalNumber.Plural, when: { tiers: ["medium", "big"] } },

  { text: "its riverfront", kind: "place", number: GrammaticalNumber.Singular, when: { nearWater: true, coastal: false } },
  { text: "its granaries", kind: "industry", number: GrammaticalNumber.Plural, when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "its counting houses", kind: "market", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "its winter markets", kind: "market", number: GrammaticalNumber.Plural, when: { biomes: WINTRY_BIOMES } },
  { text: "its festival grounds", kind: "place", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Religious], trait: [Trait.Traditional] } } },
  { text: "its back alleys", kind: "place", number: GrammaticalNumber.Plural },

  { text: "its night market", kind: "market", number: GrammaticalNumber.Singular, when: { tiers: ["medium", "big"] } },
  { text: "its lighthouse", kind: "landmark", number: GrammaticalNumber.Singular, when: { coastal: true } },
  { text: "its clock tower", kind: "landmark", number: GrammaticalNumber.Singular },
  { text: "its wool markets", kind: "market", number: GrammaticalNumber.Plural, when: { elevations: ["MEDIUM", "HIGH"] } },
  { text: "its riverside mills", kind: "industry", number: GrammaticalNumber.Plural, when: { nearWater: true, coastal: false } },
  { text: "its hill forts", kind: "rampart", number: GrammaticalNumber.Plural, when: { elevations: ["HIGH", "VERY_HIGH"], anyTags: { authority: [Authority.Militaristic] } } },
  { text: "its garden terraces", kind: "place", number: GrammaticalNumber.Plural, when: { anyTags: { authority: [Authority.Elite] } } },
  { text: "its glassworks", kind: "industry", number: GrammaticalNumber.Plural, when: { industries: ["glassblowing"] } },

  // City-wide subjects: stand for the whole settlement, so `cityWide` predicates (lodging, festivals,
  // mazes…) attach here instead of to a lone feature. They also accept ordinary predicates.
  { text: "the town", number: GrammaticalNumber.Singular, cityWide: true },
  { text: "the old town", number: GrammaticalNumber.Singular, cityWide: true },
  { text: "the whole place", number: GrammaticalNumber.Singular, cityWide: true },
];

// Single-form: the verb agrees with the chosen subject via {cop}/{have}/{v:base}.
//  • `accepts` lists the qualifier categories that read well after this predicate. STATIVE predicates
//    (timeless qualities) set `accepts: []` so no temporal clause trails them ("has stood for generations
//    on market days" is nonsense). Dynamic/event-bearing ones list the categories that fit.
//  • `cityWide: true` marks predicates that describe the whole settlement; they only attach to a cityWide
//    subject (see the subject pool), never to a lone feature.
const predicate: FactPart[] = [
  // — dynamic / event-bearing: a temporal qualifier reads naturally. `attachTo` keeps the bustle/commerce
  //   ones off inert monuments; `draw travelers` / `louder` stay open (a landmark is a sight, and can be loud) —
  { text: "{v:draw} travelers from across {country}", accepts: ["seasonal", "condition", "concession"] },
  { text: "{cop} louder than visitors expect", accepts: ["eventTime", "seasonal", "condition"] },
  { text: "{v:draw} crowds from every village within a week's walk", attachTo: ["market", "place", "institution"], accepts: ["seasonal", "eventTime", "condition"] },
  { text: "{cop} busier than its size has any right to be", attachTo: ["market", "industry", "place", "institution"], accepts: ["eventTime", "seasonal", "condition", "concession"] },
  { text: "{v:fill} up with strangers", attachTo: ["market", "place"], accepts: ["seasonal", "eventTime", "condition"] },
  { text: "{v:keep} odd hours", attachTo: ["market", "industry", "place", "institution"], accepts: ["eventTime", "condition", "access"] },
  { text: "{v:trade} in everything and {v:apologize} for nothing", when: { anyTags: { authority: [Authority.Commercial] } }, attachTo: ["market", "place"], accepts: ["eventTime", "condition", "access"] },

  // — stative qualities (incl. self-contained climate): timeless, so no trailing qualifier (`accepts: []`) —
  { text: "{cop} known throughout the region", accepts: [] },
  { text: "{cop} the pride of the locals", accepts: [] },
  { text: "{v:support} much of the surrounding countryside", when: { anyTags: { authority: [Authority.Commercial], society: [Society.Agrarian] } }, attachTo: ["market", "industry"], accepts: [] },
  { text: "{have} stood for generations", accepts: [] },
  { text: "{cop} older than the current government", when: { anyTags: { trait: [Trait.Traditional, Trait.Revolutionary] } }, accepts: [] },
  { text: "{v:appear} in half the songs locals sing", when: { anyTags: { trait: [Trait.Traditional] } }, accepts: [] },
  { text: "{v:keep} the city richer than it looks", when: { anyTags: { authority: [Authority.Commercial] } }, attachTo: ["market", "industry"], accepts: [] },
  { text: "{v:anchor} the local economy", when: { anyTags: { authority: [Authority.Commercial] } }, attachTo: ["market", "industry"], accepts: [] },
  { text: "{have} outlived three governments and counting", when: { anyTags: { trait: [Trait.Revolutionary, Trait.Fragmented] } }, accepts: [] },
  { text: "{cop} older than the road that reaches it", accepts: [] },
  { text: "{v:smell} of woodsmoke and wet stone", when: { bands: ["WET"] }, accepts: [] },
  { text: "{v:smell} of salt and tar", when: { coastal: true }, accepts: [] },
  { text: "{cop} half ruin and half rebuilding", when: { anyTags: { trait: [Trait.Revolutionary, Trait.Fragmented] } }, accepts: [] },
  { text: "{cop} proud of a victory no one else remembers", when: { anyTags: { authority: [Authority.Militaristic] } }, accepts: [] },
  { text: "{v:keep} better records than the capital", when: { anyTags: { authority: [Authority.Bureaucratic] } }, attachTo: ["institution"], accepts: [] },
  { text: "{cop} colder than the maps admit", when: { biomes: WINTRY_BIOMES }, accepts: [] },
  { text: "{cop} freezing for half the year", when: { biomes: WINTRY_BIOMES }, accepts: [] },
  { text: "{cop} cooler than the lowlands all summer", when: { minElevationMeters: 1200 }, accepts: [] },

  // — kind-specific statives: gated to a single subject kind via `attachTo` —
  { text: "{have} never once been taken", attachTo: ["rampart"], accepts: [] },
  { text: "{v:show} the scars of three different sieges", attachTo: ["rampart"], accepts: [] },
  { text: "{v:keep} weights and measures older than the crown's", attachTo: ["market"], accepts: [] },
  { text: "{v:appear} on every map and half the coins", attachTo: ["landmark"], accepts: [] },

  // — city-wide: describe the whole settlement, so they need a cityWide subject —
  { text: "{cop} impossible to find lodging in", cityWide: true, accepts: ["seasonal", "condition"] },
  { text: "never really {v:close}", cityWide: true, accepts: ["seasonal", "concession"] },
  { text: "{cop} where {country}'s arguments go to get louder", cityWide: true, accepts: ["eventTime", "seasonal"] },
  { text: "{v:host} more festivals than working days", when: { anyTags: { authority: [Authority.Religious], trait: [Trait.Traditional] } }, cityWide: true, accepts: [] },
  { text: "{v:throw} the best festivals in {country}", when: { anyTags: { trait: [Trait.Traditional] } }, cityWide: true, accepts: ["seasonal"] },
  { text: "{v:welcome} more pilgrims than residents", when: { anyTags: { authority: [Authority.Religious] } }, cityWide: true, accepts: ["seasonal"] },
  { text: "{v:hum} with looms from dawn to dusk", when: { industries: ["textiles", "silk weaving", "wool", "linen", "cotton"] }, cityWide: true, accepts: [] },
  { text: "{v:guard} the only pass for a hundred miles", when: { elevations: ["HIGH", "VERY_HIGH"] }, cityWide: true, accepts: [] },
  { text: "{v:wake} early and {v:gossip} late", cityWide: true, accepts: [] },
  { text: "{cop} a maze even to its own children", cityWide: true, accepts: [] },
  { text: "{v:run} on rumor as much as coin", cityWide: true, accepts: [] },
  { text: "{cop} loud, crowded, and proud of both", cityWide: true, accepts: [] },
  { text: "{cop} richer in stories than in coin", cityWide: true, accepts: [] },
  { text: "{cop} stitched together from a dozen older villages", when: { tiers: ["big"] }, cityWide: true, accepts: [] },
  { text: "{v:owe} its whole fortune to one good harbor", when: { coastal: true }, cityWide: true, accepts: [] },
  { text: "{v:measure} wealth in granaries, not coin", when: { anyTags: { society: [Society.Agrarian] } }, cityWide: true, accepts: [] },
  { text: "{v:guard} its old privileges jealously", when: { anyTags: { structure: [Structure.Local], authority: [Authority.Civic] } }, cityWide: true, accepts: [] },
  { text: "{v:change} hands more often than its rulers would like", when: { anyTags: { trait: [Trait.Fragmented, Trait.Revolutionary] } }, cityWide: true, accepts: [] },
  { text: "{cop} the last honest stop before the wild country", when: { anyTags: { structure: [Structure.Dependent, Structure.Minor] } }, cityWide: true, accepts: [] },
];

// Optional trailing clauses. `fit` tags pick which predicates they read well after; `when` gates on the
// city. At least one per Fit category is un-gated (see COVERAGE INVARIANT above).
const qualifier: FactPart[] = [
  // seasonal
  { text: "during the spring fair", fit: ["seasonal"] },
  { text: "at midsummer", fit: ["seasonal"] },
  { text: "after the harvest", fit: ["seasonal"], when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "during holy festivals", fit: ["seasonal"], when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "through the long winter", fit: ["seasonal", "concession"], when: { biomes: WINTRY_BIOMES } },
  { text: "when the snow finally melts", fit: ["seasonal", "condition"], when: { biomes: WINTRY_BIOMES } },
  // eventTime
  { text: "on market days", fit: ["eventTime"] },
  { text: "on festival nights", fit: ["eventTime"] },
  { text: "long after the capital has gone to bed", fit: ["eventTime"], when: { tiers: ["big"], capital: false } },
  { text: "between the temple bells", fit: ["eventTime"], when: { anyTags: { authority: [Authority.Religious] } } },
  // condition
  { text: "when the weather allows", fit: ["condition"] },
  { text: "if you know who to ask", fit: ["access"] }, // insider access, not a circumstantial condition
  { text: "whenever trade is good", fit: ["condition"] },
  { text: "when the roads are passable", fit: ["condition"], when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "whenever the fleet comes in", fit: ["condition"], when: { coastal: true } },
  { text: "as soon as the caravans arrive", fit: ["condition"], when: { biomes: ["desert", "steppe"] } },
  // concession
  { text: "in fat years and lean", fit: ["concession"] },
  { text: "whatever the season", fit: ["concession"] },
  { text: "even when times are hard", fit: ["concession"] },
  { text: "even in the dry season", fit: ["concession"], when: { bands: ["DRY"] } },
  { text: "despite the harsh winters", fit: ["concession"], when: { biomes: WINTRY_BIOMES } },
  // — more —
  { text: "as the leaves turn", fit: ["seasonal"] },
  { text: "in the lambing season", fit: ["seasonal"], when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "on the rest day", fit: ["eventTime"] },
  { text: "at the changing of the guard", fit: ["eventTime"], when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "when the river runs high", fit: ["condition"], when: { nearWater: true } },
  { text: "the moment a ship is sighted", fit: ["condition"], when: { coastal: true } },
  { text: "once the mountain passes open", fit: ["condition", "seasonal"], when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "no matter who is in charge", fit: ["concession"] },
  { text: "good harvest or bad", fit: ["concession"], when: { anyTags: { society: [Society.Agrarian] } } },
];

const localHabit: FactPart[] = [
  { text: "argue about which tavern is oldest" },
  { text: "insist their bread is better than the capital's" },
  { text: "give directions by landmarks that no longer exist" },
  { text: "treat market gossip as a civic institution" },
  { text: "name their streets after arguments, not heroes" },
  { text: "start the day before sunrise", when: { bands: ["DRY"] } },
  { text: "watch the sea before making plans", when: { coastal: true } },
  { text: "know three different words for fog", when: { bands: ["WET"] } },
  { text: "measure distance by how steep the walk is", when: { minElevationMeters: 800 } },
  { text: "debate in public like it is a sport", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "lower their voices near the temples", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "keep old military songs alive", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "trust a handshake more than a contract", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "settle arguments at the same café table they always have" },
  { text: "blame the neighboring town for any run of bad luck" },
  { text: "still ring the old bell for reasons no one remembers" },
  { text: "keep two clocks: the real time and the official time", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "refuse to admit the weather is ever truly bad" },
  { text: "hold grudges longer than leases" },
  { text: "bargain even when the price is already fair", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "leave a lamp burning for late travelers", when: { biomes: WINTRY_BIOMES } },
  { text: "rate the whole year by the quality of the wine", when: { bands: ["MID"], elevations: ["MEDIUM"] } },
  { text: "queue for everything and complain about all of it", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
];

const reputation: FactPart[] = [
  { text: "hard to conquer", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "impossible to govern quietly", when: { anyTags: { trait: [Trait.Revolutionary] } } },
  { text: "devout even by {country}'s standards", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "smarter than is polite", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "wealthier than it first appears", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "older than anyone can prove", when: { anyTags: { trait: [Trait.Traditional] } } },
  { text: "louder than it is large", when: { tiers: ["small", "medium"] } },
  { text: "impossible to bribe and impossible to please", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "ungovernable except by its own consent", when: { anyTags: { authority: [Authority.Civic] } } },
  { text: "always one bad winter from rebellion", when: { biomes: WINTRY_BIOMES } },
  { text: "more loyal to itself than to {country}", when: { anyTags: { structure: [Structure.Local] } } },
  { text: "the place that takes its festivals too seriously", when: { anyTags: { trait: [Trait.Traditional] } } },
  { text: "a town where every family claims an ancient title", when: { anyTags: { authority: [Authority.Elite] } } },
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
  { text: "swamplands", when: { biomes: ["wetland"] } },
  // steppe
  { text: "steppe", when: { biomes: ["steppe"] } },
  { text: "endless grass", when: { biomes: ["steppe"] } },
  // woodland
  { text: "scattered woodland", when: { biomes: ["woodland"] } },
  { text: "oak and thornscrub", when: { biomes: ["woodland"] } },
  // forest
  { text: "deep forest", when: { biomes: ["forest"] } },
  { text: "verdant woods", when: { biomes: ["forest"] } },
  // badlands
  { text: "badlands", when: { biomes: ["badlands"] } },
  { text: "eroded gullies", when: { biomes: ["badlands"] } },
  { text: "banded clay hills", when: { biomes: ["badlands"] } },
  // highlands
  { text: "highland slopes", when: { biomes: ["highlands"] } },
  { text: "windy uplands", when: { biomes: ["highlands"] } },
  { text: "rocky slopes", when: { biomes: ["highlands"] } },
  // montane forest
  { text: "misty pinewood", when: { biomes: ["montane forest"] } },
  { text: "cloud-wrapped slopes", when: { biomes: ["montane forest"] } },
  // barren peaks
  { text: "barren peaks", when: { biomes: ["barren peaks"] } },
  { text: "bare ridgelines", when: { biomes: ["barren peaks"] } },
  { text: "scoured stone heights", when: { biomes: ["barren peaks"] } },
  // alpine
  { text: "alpine meadows", when: { biomes: ["alpine"] } },
  { text: "snow-covered slopes", when: { biomes: ["alpine"] } },
  // snowfields
  { text: "snowfields", when: { biomes: ["snowfields"] } },
  { text: "snowy plains", when: { biomes: ["snowfields"] } },
  // tundra
  { text: "frozen tundra", when: { biomes: ["tundra"] } },
  { text: "ice fields", when: { biomes: ["tundra"] } },
];

const weirdDetail: FactPart[] = [
  { text: "no two clock towers agree on the time" },
  { text: "the oldest tavern has burned down at least twice" },
  { text: "locals disagree about the origin of the city's name" },
  { text: "the town clock has run five minutes fast for as long as anyone remembers" },
  { text: "every neighborhood claims to be the true heart of the city", when: { tiers: ["medium", "big"] } },
  { text: "sailors refuse to whistle near the harbor", when: { coastal: true } },
  { text: "children dare each other to touch the old siege stones", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "pilgrims leave ribbons tied to every roadside tree", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "students have carved jokes into half the old lecture benches", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "people claim the fog remembers faces", when: { bands: ["WET"] } },
  { text: "the wind is blamed for everything from bad crops to bad marriages", when: { bands: ["DRY"], elevations: ["LOW", "MEDIUM"] } },
  { text: "the city keeps a holiday whose origin everyone has forgotten" },
  { text: "every household keeps a spare key to the granary", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "the river is technically illegal to swim in, and everyone does", when: { nearWater: true } },
  { text: "every map of the old town is subtly wrong on purpose", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the tallest building is, by old law, the granary", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "two streets share the same name and no one will rename either" },
  { text: "the town seal has a spelling mistake no one will fix", when: { anyTags: { authority: [Authority.Bureaucratic, Authority.Civic] } } },
  { text: "cats are counted in the census and dogs are not", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "the oldest bridge is repaired only with stone from the original quarry", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "fishermen swear the tide runs backwards once a year", when: { coastal: true } },
  { text: "the festival always runs a day longer than the calendar allows", when: { anyTags: { trait: [Trait.Traditional], authority: [Authority.Religious] } } },
];

const origin: FactPart[] = [
  { text: "a fishing village", when: { coastal: true } },
  { text: "a river crossing", when: { nearWater: true, coastal: false } },
  { text: "a frontier fort", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "a roadside trading post", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "a monastery and the town that fed it", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "a mining camp", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "a seasonal clan gathering", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "a waystation that outgrew its inn", when: { biomes: ["desert", "steppe"] } },
  { text: "a winter camp no one ever quite left", when: { biomes: WINTRY_BIOMES } },
  { text: "a cluster of farms that never stopped growing" },
  { text: "two villages that grew until they touched" },
  { text: "a toll post on a road that no longer exists", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "a hot spring the sick once came to visit", when: { elevations: ["MEDIUM", "HIGH"] } },
  { text: "a shipwreck whose crew never left", when: { coastal: true } },
];

const nickname: FactPart[] = [
  { text: "the old town" },
  { text: "the waystation" },
  { text: "the gray city", when: { industries: ["mining", "metalworking", "manufacturing", "charcoal burning"] } },
  { text: "the iron city", when: { industries: ["metalworking", "mining"] } },
  { text: "the city of bells", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "the green city", when: { bands: ["WET"], elevations: ["LOW", "MEDIUM"] } },
  { text: "the stubborn city", when: { anyTags: { trait: [Trait.Revolutionary, Trait.Fragmented] } } },
  { text: "the high city", when: { minElevationMeters: 1500 } },
  { text: "the white city", when: { biomes: WINTRY_BIOMES } },
  { text: "the counting house of {country}", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "the crossroads" },
  { text: "the lantern of the coast", when: { coastal: true } },
  { text: "the granary of {country}", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "the quiet capital", when: { capital: true } },
  { text: "the last city", when: { anyTags: { structure: [Structure.Dependent, Structure.Minor] } } },
];

const dish: FactPart[] = [
  { text: "salt cod", when: { coastal: true } },
  { text: "river eel", when: { nearWater: true, coastal: false } },
  { text: "seal blubber", when: { biomes: WINTRY_BIOMES } },
  { text: "spiced flatbread", when: { biomes: ["desert", "steppe"] } },
  { text: "mare's milk", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "honey cakes", when: { bands: ["MID", "WET"] } },
  { text: "goat cheese", when: { biomes: ["montane forest"] } },
  { text: "peppered sausage", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "smoked herring", when: { coastal: true } },
  { text: "mountain cheese", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "potato stew", when: { biomes: WINTRY_BIOMES } },
  { text: "stuffed grape leaves", when: { bands: ["MID"], elevations: ["MEDIUM"] } },
  { text: "roast chestnuts", when: { biomes: WOODED_BIOMES } },
  { text: "fried trout", when: { nearWater: true, coastal: false } },
  { text: "lamb stew", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "spiced winter wine", when: { biomes: WINTRY_BIOMES } },
  { text: "stewed lamb", when: { biomes: ["desert", "steppe"] } },
  { text: "wild boar", when: { biomes: WOODED_BIOMES } },
  { text: "spiced lentils", when: { biomes: ARID_BIOMES } },
  { text: "blood pudding", when: { biomes: WINTRY_BIOMES } },
  { text: "oyster stew", when: { coastal: true } },
];

// Industry-specific flavour: 1+ one-liner per industry, fired ONLY when the city actually HAS that
// industry (CityContext.industries) — so the flavour line always agrees with the shown industries, instead
// of keying off the government's Society.Industrial tag (which let a silk-and-paper town claim "its furnaces
// have not gone cold"). Every industry in INDUSTRY_RULES must appear here; funFactAudit.test guards it.
const INDUSTRY_FLAVOR: Record<string, string[]> = {
  // water & coast
  fishing: ["the city smells of fish, but its people are well fed"],
  shipping: ["the docks know tomorrow's news before the rest of the town"],
  shipbuilding: ["half-finished hulls loom over the waterfront like sleeping giants"],
  "river trade": ["the bargemen swear the river changes course just to spite newcomers"],
  "salt trade": ["fortunes here are still measured in salt barrels"],
  whaling: ["the whole town quickly knows when a ship comes home heavy, reeking of whale"],
  pearling: ["the richest folk in town spend their lives holding their breath"],
  "amber trade": ["sometimes strange creatures can be found trapped in the local amber"],
  "spice trade": ["the air itself smells expensive"],
  "sugar refining": ["everything carries a faint scent of burnt sugar"],
  cartography: ["its maps are outdated almost as soon as they're finished"],
  smuggling: ["every respectable warehouse has at least one disreputable entrance"],
  privateering: ["the average life expectancy is lower here than in the rest of the country"],
  pottery: ["the local potters are known for their unique glazes and shapes"],
  "canal works": ["children here learn to pole a boat before they learn to walk"],

  // farming & herding
  herding: ["wealth grazes just beyond the walls"],
  forestry: ["despite repeated fires, locals stubbornly mostly build wood houses"],
  viticulture: ["for visitors who can afford it, the wine is as good as the locals say"],
  "date farming": ["poets have composed odes to the perfume of the city when dates are in season"],
  "rice farming": ["a unique rice wine is made here which locals swear won't give you a hangover"],
  "olive farming": ["some of the olive groves have stood here longer than entire kingdoms"],
  linen: ["on wash day, the riverbanks disappear beneath drying linen"],
  cheesemaking: ["the oldest cheese cellars are treated almost like shrines"],
  brewing: ["it's surprisingly difficult to find anyone here drinking plain water"],
  distilling: ["the best casks are already spoken for years before they're opened"],
  leatherworking: ["you can smell the tanneries long before you reach them"],
  wool: ["bits of loose wool drift through the streets on windy days"],
  tea: ["important conversations rarely begin before the tea is poured"],
  cotton: ["fine white fibers cling to almost everyone's clothes"],

  // climate-driven
  "fur trapping": ["locals greet a harsh winter with surprising optimism"],
  "ice harvesting": ["people here still cool their drinks with last winter's ice"],
  "reindeer herding": ["it's said the reindeer know when spring is coming before anyone else"],
  "caravan trade": ["the markets feel strangely empty the morning after a caravan departs"],
  "incense trade": ["each neighborhood seems to have its own distinctive scent"],
  "camel breeding": ["locals judge camels with the same scrutiny others reserve for horses"],
  falconry: ["it's common to see hunting birds perched where other towns keep pigeons"],
  "charcoal burning": ["a faint haze often hangs over the surrounding hills"],
  "horse breeding": ["visitors quickly learn not to compliment the wrong horse"],

  // mountain & mineral
  mining: [
    "the shift bell tells better time than the church bell",
    "coal dust has a way of finding every doorstep",
  ],
  quarrying: ["stone from these quarries can be found in cities far beyond the horizon"],
  metalworking: ["the sound of hammers carries across town from sunrise until dusk"],
  gemcutting: ["some of the plainest workshops handle the region's greatest fortunes"],
  glassblowing: ["the furnaces paint the night sky orange"],

  // craft & industry
  manufacturing: ["the factory whistles set the rhythm of daily life"],
  textiles: ["bright cloth hangs drying from nearly every street"],
  "silk weaving": ["the finest local silks hide patterns only another weaver would notice"],
  papermaking: ["the river leaves town carrying a faint grey tint"],
  clockmaking: ["every clockmaker insists everyone else's clocks run fast"],

  // leisure & travel
  "hot springs": ["people come for the hot springs and leave with everyone else's gossip"],
  "holy festivals": ["the streets are almost always being decorated for the next celebration"],
  tournaments: ["practice matches often draw bigger crowds than the real contests"],
  "gaming houses": ["small fortunes change hands here every night"],
  minstrelsy: ["every tavern claims to have launched at least one famous bard"],
  gambling: ["people discuss luck here the way farmers discuss the weather"],

  // trade, government & culture
  banking: ["a letter of credit from here is accepted almost anywhere"],
  scholarship: ["it's perfectly normal to overhear heated arguments about philosophy in taverns"],
  astronomy: ["the rooftops become busier than the streets after sunset"],
  alchemy: ["odd smells are usually blamed on the alchemists"],
  printing: ["yesterday's rumors often become today's broadsheets"],
  theater: ["the audience is often as entertaining as the performers"],
  pilgrimage: ["the streets are always full of strangers searching for something"],
  military: ["marching drills are as much a part of the soundscape as church bells"],
  administration: ["locals say finding the right clerk is harder than finding buried treasure"],
  diplomacy: ["more political deals are settled over dinner than in council chambers"],
  "mercenary trade": ["it's easier to hire a sellsword than a mason"],

  agriculture: ["the town's mood rises and falls with the harvest"],
  armory: ["the ringing of hammers on steel echoes through the streets all day"],
};

// One slotless `{ when: { industries: [name] }, template }` pattern per flavour line. (The audit's
// jointlySatisfiable ignores `industries`, so it over-approximates reachability for these — harmless.)
const industryPatterns: FunFactPattern[] = Object.entries(INDUSTRY_FLAVOR).flatMap(([industry, lines]) =>
  lines.map((template) => ({ when: { industries: [industry] }, template, slots: {} })),
);

// FUN_FACT_PATTERNS is composed at the bottom from these thematic groups + industryPatterns.
const corePatterns: FunFactPattern[] = [
  {
    template: "{subject} {predicate}",
    slots: { subject, predicate },
  },
  {
    template: "{subject} {predicate} {qualifier}",
    slots: { subject, predicate, qualifier },
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
    when: { minElevationMeters: 2000 },
    template: "one of the highest cities in {country}",
    slots: {},
  },
  {
    when: { biomes: WINTRY_BIOMES },
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
];

// — size & centrality one-liners —
const sizeCentralityPatterns: FunFactPattern[] = [
  {
    when: { tiers: ["big"] },
    template: "big enough that the far quarter keeps its own accent",
    slots: {},
  },
  {
    when: { capital: true },
    template: "half of {country}'s letters pass through on their way somewhere else",
    slots: {},
  },
];

// — climate / terrain one-liners —
const climatePatterns: FunFactPattern[] = [
  {
    when: { biomes: ["desert"] },
    template: "everyone knows where the shade will be an hour from now",
    slots: {},
  },
  {
    when: { elevations: ["VERY_HIGH"] },
    template: "visitors spend their first day catching their breath",
    slots: {},
  },
  {
    when: { maxElevationMeters: 30, nearWater: true, coastal: false },
    template: "the river reminds everyone each spring who owns the floodplain",
    slots: {},
  },
  {
    when: { bands: ["WET"], minElevationMeters: 600 },
    template: "people talk about the weeks when it *isn't* raining",
    slots: {},
  },
  {
    when: { anyTags: { society: [Society.Maritime] } },
    template: "half the calendar is set by the tides",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Elite] } },
    template: "family names carry farther than raised voices",
    slots: {},
  },
  {
    when: { coastal: true },
    template: "salt gets into the doors, the food, and the politics",
    slots: {},
  },
  {
    when: { nearWater: true, coastal: false },
    template: "the river is everyone's favorite landmark and least favorite neighbor",
    slots: {},
  },
  {
    when: { bands: ["DRY"] },
    template: "by midday the streets belong to the lizards",
    slots: {},
  },
  {
    when: { nearWater: true, bands: ["WET"] },
    template: "some mornings the opposite bank is only a rumor",
    slots: {},
  },
  {
    when: { biomes: WINTRY_BIOMES, nearWater: true },
    template: "once winter settles in, the river gains a main street",
    slots: {},
  },
];

// — biome-specific terrain one-liners —
const biomePatterns: FunFactPattern[] = [
  {
    when: { biomes: ["forest"] },
    template: "the forest begins where the last fence loses confidence",
    slots: {},
  },
  {
    when: { biomes: ["woodland"] },
    template: "every winter starts with a bigger woodpile than the last",
    slots: {},
  },
  {
    when: { biomes: ["grassland"] },
    template: "you can watch tomorrow's weather coming all afternoon",
    slots: {},
  },
  {
    when: { biomes: ["steppe"] },
    template: "everyone points at things too distant for visitors to see",
    slots: {},
  },
  {
    when: { biomes: ["wetland"] },
    template: "the frogs are loud enough to interrupt conversations",
    slots: {},
  },
  {
    when: { biomes: ["badlands"] },
    template: "anything that grows here has earned the right",
    slots: {},
  },
  {
    when: { biomes: ["montane forest"] },
    template: "the fog sometimes arrives before breakfast and leaves after supper",
    slots: {},
  },
  {
    when: { biomes: ["alpine"] },
    template: "summer is celebrated with an almost suspicious urgency",
    slots: {},
  },
  {
    when: { biomes: ["tundra"] },
    template: "graveyards here are built of stone instead of earth",
    slots: {},
  },
  {
    when: { elevations: ["HIGH", "VERY_HIGH"] },
    template: "everyone keeps one eye on the mountain passes",
    slots: {},
  },
];

// — cross-dimension one-liners (requires at least two independent city dimensions; `tags` requires every named tag at once) —
const crossDimensionPatterns: FunFactPattern[] = [
  {
    when: { coastal: true, anyTags: { authority: [Authority.Militaristic] } },
    template: "its harbor still bristles with cannon no one expects to fire again",
    slots: {},
  },
  {
    when: { tags: { society: [Society.Scholastic], authority: [Authority.Religious] } },
    template: "its scholars and priests have argued so long they've started borrowing each other's arguments",
    slots: {},
  },
  {
    when: { biomes: ["desert"], anyTags: { authority: [Authority.Commercial] } },
    template: "water is sold with the seriousness of fine jewelry",
    slots: {},
  },
  {
    when: {
      nearWater: true,
      industries: [
        "leatherworking",
        "textiles",
        "metalworking",
        "sugar refining",
        "papermaking",
      ],
    },
    template: "the river advertises the day's work better than any signboard",
    slots: {},
  },

  // coast + commercial
  {
    when: {
      coastal: true,
      anyTags: { authority: [Authority.Commercial] },
    },
    template: "every arriving sail means someone's about to make or lose a fortune",
    slots: {},
  },

  // coast + religious
  {
    when: {
      coastal: true,
      anyTags: { authority: [Authority.Religious] },
    },
    template: "the temple bells and harbor bells rarely stop answering each other",
    slots: {},
  },

  // river + civic
  {
    when: {
      nearWater: true,
      anyTags: { authority: [Authority.Civic] },
    },
    template: "there's always another bridge being proposed",
    slots: {},
  },

  // mountains + militaristic
  {
    when: {
      elevations: ["HIGH", "VERY_HIGH"],
      anyTags: { authority: [Authority.Militaristic] },
    },
    template: "every mountain pass has a story about the army that failed to cross it",
    slots: {},
  },

  // mountains + mining
  {
    when: {
      elevations: ["HIGH", "VERY_HIGH"],
      industries: ["mining"],
    },
    template: "locals joke the mountain gets a little smaller every year",
    slots: {},
  },

  // forest + forestry
  {
    when: {
      biomes: ["forest"],
      industries: ["forestry"],
    },
    template: "stumps are counted almost as carefully as trees",
    slots: {},
  },

  // grassland + horse breeding
  {
    when: {
      biomes: ["grassland"],
      industries: ["horse breeding"],
    },
    template: "even the work horses walk with suspicious confidence",
    slots: {},
  },

  // wetland + fishing
  {
    when: {
      biomes: ["wetland"],
      industries: ["fishing"],
    },
    template: "the fishermen navigate by memory more than landmarks",
    slots: {},
  },

  // scholarly + printing
  {
    when: {
      industries: ["printing"],
      anyTags: { society: [Society.Scholastic] },
    },
    template: "yesterday's arguments become today's pamphlets",
    slots: {},
  },

  // bureaucracy + administration
  {
    when: {
      industries: ["administration"],
      anyTags: { authority: [Authority.Bureaucratic] },
    },
    template: "finding the right clerk is treated like a practical survival skill",
    slots: {},
  },

  // military + armory
  {
    when: {
      industries: ["armory"],
      anyTags: { authority: [Authority.Militaristic] },
    },
    template: "the sound of hammers is strangely reassuring",
    slots: {},
  },

  // religious + pilgrimage
  {
    when: {
      industries: ["pilgrimage"],
      anyTags: { authority: [Authority.Religious] },
    },
    template: "locals can spot a pilgrim before they ask for directions",
    slots: {},
  },

  // elite + banking
  {
    when: {
      industries: ["banking"],
      anyTags: { authority: [Authority.Elite] },
    },
    template: "fortunes here are inherited almost as often as they're earned",
    slots: {},
  },

  // revolutionary + printing
  {
    when: {
      industries: ["printing"],
      anyTags: { trait: [Trait.Revolutionary] },
    },
    template: "pamphlets appear overnight with nobody admitting to writing them",
    slots: {},
  },

  // traditional + brewing
  {
    when: {
      industries: ["brewing"],
      anyTags: { trait: [Trait.Traditional] },
    },
    template: "changing the local recipe is considered almost sacrilegious",
    slots: {},
  },

  // federal + capital
  {
    when: {
      capital: true,
      anyTags: { structure: [Structure.Federal] },
    },
    template: "every province claims a little ownership of the capital",
    slots: {},
  },

  // coast + shipbuilding
  {
    when: {
      coastal: true,
      industries: ["shipbuilding"],
    },
    template: "the waterfront is crowded with ships that aren't ships yet",
    slots: {},
  },

  // coast + privateering
  {
    when: {
      coastal: true,
      industries: ["privateering"],
    },
    template: "every tavern has a retired captain whose best story gets better every year",
    slots: {},
  },

  // coast + fishing
  {
    when: {
      coastal: true,
      industries: ["fishing"],
    },
    template: "tomorrow's weather is debated more fiercely than today's politics",
    slots: {},
  },

  // desert + caravan
  {
    when: {
      biomes: ["desert"],
      industries: ["caravan trade"],
    },
    template: "people measure the year by arriving caravans instead of seasons",
    slots: {},
  },

  // desert + camel breeding
  {
    when: {
      biomes: ["desert"],
      industries: ["camel breeding"],
    },
    template: "a fine camel turns more heads than a fine horse",
    slots: {},
  },

  // wet + forestry
  {
    when: {
      bands: ["WET"],
      industries: ["forestry"],
    },
    template: "the forest grows back faster than anyone can clear it",
    slots: {},
  },

  // wet + papermaking
  {
    when: {
      bands: ["WET"],
      industries: ["papermaking"],
    },
    template: "the river always carries a faint grey tint downstream",
    slots: {},
  },

  // alpine + quarrying
  {
    when: {
      biomes: ["alpine"],
      industries: ["quarrying"],
    },
    template: "half the mountain seems destined to become someone else's city",
    slots: {},
  },

  // high elevation + religious
  {
    when: {
      elevations: ["HIGH", "VERY_HIGH"],
      anyTags: { authority: [Authority.Religious] },
    },
    template: "the holiest shrines always seem to require another climb",
    slots: {},
  },

  // forest + military
  {
    when: {
      biomes: ["forest"],
      anyTags: { authority: [Authority.Militaristic] },
    },
    template: "the woods are patrolled as carefully as the city walls",
    slots: {},
  },

  // forest + revolutionary
  {
    when: {
      biomes: ["forest"],
      anyTags: { trait: [Trait.Revolutionary] },
    },
    template: "more than one rebellion has vanished into these woods",
    slots: {},
  },

  // grassland + militaristic
  {
    when: {
      biomes: ["grassland"],
      anyTags: { authority: [Authority.Militaristic] },
    },
    template: "you can spot an approaching army hours before it arrives",
    slots: {},
  },

  // steppe + nomadic
  {
    when: {
      biomes: ["steppe"],
      anyTags: { structure: [Structure.Nomadic] },
    },
    template: "the horizon feels more like an invitation than a boundary",
    slots: {},
  },

  // tundra + commercial
  {
    when: {
      biomes: ["tundra"],
      anyTags: { authority: [Authority.Commercial] },
    },
    template: "winter prices are negotiated even in midsummer",
    slots: {},
  },

  // river + shipping
  {
    when: {
      nearWater: true,
      industries: ["shipping"],
    },
    template: "every late shipment is blamed on the current",
    slots: {},
  },

  // river + brewing
  {
    when: {
      nearWater: true,
      industries: ["brewing"],
    },
    template: "everyone insists the river is the secret ingredient",
    slots: {},
  },

  // maritime + fishing
  {
    when: {
      anyTags: { society: [Society.Maritime] },
      industries: ["fishing"],
    },
    template: "children learn the tides before they learn to read",
    slots: {},
  },

  // maritime + military
  {
    when: {
      tags: {
        society: [Society.Maritime],
        authority: [Authority.Militaristic],
      },
    },
    template: "people still watch the horizon as though an enemy fleet might appear",
    slots: {},
  },

  // scholastic + astronomy
  {
    when: {
      anyTags: { society: [Society.Scholastic] },
      industries: ["astronomy"],
    },
    template: "the observatories stay busy long after everyone else has gone to bed",
    slots: {},
  },

  // scholastic + alchemy
  {
    when: {
      anyTags: { society: [Society.Scholastic] },
      industries: ["alchemy"],
    },
    template: "failed experiments become local legends",
    slots: {},
  },

  // technical + manufacturing
  {
    when: {
      anyTags: { authority: [Authority.Technical] },
      industries: ["manufacturing"],
    },
    template: "no machine here is ever considered truly finished",
    slots: {},
  },

  // bureaucracy + banking
  {
    when: {
      anyTags: { authority: [Authority.Bureaucratic] },
      industries: ["banking"],
    },
    template: "opening an account takes nearly as much paperwork as closing one",
    slots: {},
  },

  // commercial + gambling
  {
    when: {
      anyTags: { authority: [Authority.Commercial] },
      industries: ["gambling"],
    },
    template: "the locals negotiate wagers faster than they explain the rules",
    slots: {},
  },

  // elite + theater
  {
    when: {
      anyTags: { authority: [Authority.Elite] },
      industries: ["theater"],
    },
    template: "being seen at the theater is almost more important than the play",
    slots: {},
  },

  // religious + holy festivals
  {
    when: {
      anyTags: { authority: [Authority.Religious] },
      industries: ["holy festivals"],
    },
    template: "the streets always seem to be preparing for another procession",
    slots: {},
  },

  // stable + clockmaking
  {
    when: {
      anyTags: { trait: [Trait.Stable] },
      industries: ["clockmaking"],
    },
    template: "locals trust the clockmakers more than the sun",
    slots: {},
  },

  // fragmented + diplomacy
  {
    when: {
      anyTags: { trait: [Trait.Fragmented] },
      industries: ["diplomacy"],
    },
    template: "diplomats spend more time memorizing old grudges than drafting new treaties",
    slots: {},
  },
];

// — government-dimension one-liners (the enums the slot pools never reach) —
const governmentPatterns: FunFactPattern[] = [
  {
    when: { anyTags: { authority: [Authority.Imperial] } },
    template: "old imperial standards still hang in halls that no emperor has visited in years",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Imperial] } },
    template: "the old imperial road still cuts through town like a ruler laid on a map",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Civic] } },
    template: "important decisions are still argued loudly enough for passersby to join in",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Civic] }, tiers: ["small", "medium"] },
    template: "town politics can still be settled by fitting everyone angry into one room",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Technical] } },
    template: "engineers are consulted before priests, poets, and sometimes doctors",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Bureaucratic] } },
    template: "nothing here is official until three clerks have disagreed about it",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Dependent] } },
    template: "the official flag flies high, though not always where locals can see it",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Dependent] } },
    template: "two flags fly over town, and arguments about their order never really end",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Urban] } },
    template: "the rooftops seem to continue long after the streets give up",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Local] } },
    template: "the next town's laws are treated as a mildly interesting foreign custom",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Minor] } },
    template: "small enough to be overlooked and old enough to resent it",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Minor] } },
    template: "old grudges are preserved here with better care than public records",
    slots: {},
  },
  {
    when: { capital: false, anyTags: { structure: [Structure.Federal, Structure.Dependent] } },
    template: "its delegates return from the capital with complaints already rehearsed",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Expansionist] } },
    template: "half the street names commemorate battles fought somewhere else",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Stable] } },
    template: "the same families have occupied the same offices for generations",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Fragmented] } },
    template: "each quarter keeps its own holidays, grudges, and version of the truth",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Monarchic] } },
    template: "everyone can name the monarch; far fewer can name the mayor",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Monarchic] } },
    template: "the crown's portrait hangs in every tavern, watching the unpaid tabs",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Commercial] } },
    template: "nearly every argument eventually turns into a negotiation",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Commercial] } },
    template: "fortunes change hands here before gossip has time to catch up",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Religious] } },
    template: "the bells decide the shape of the day whether or not anyone is grateful",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Militaristic] } },
    template: "the walls are older than the town's oldest family and twice as respected",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Elite] } },
    template: "a few family names appear on nearly every gate, plaque, and unpaid debt",
    slots: {},
  },
  {
    when: { anyTags: { society: [Society.Agrarian] } },
    template: "the harvest changes the town's mood before any proclamation can",
    slots: {},
  },
  {
    when: { anyTags: { society: [Society.Scholastic] } },
    template: "the libraries stay open later than the taverns and cause more arguments",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Federal] } },
    template: "taxes are paid reluctantly and complaints about the capital are free",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Revolutionary] } },
    template: "the old regime's statues are still used for target practice",
    slots: {},
  },
  {
    when: { anyTags: { trait: [Trait.Traditional] } },
    template: "new customs are inspected here as if they might be carrying disease",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Bureaucratic] } },
    template: "there is a register of registers, though nobody admits to keeping it",
    slots: {},
  },
  {
    when: { anyTags: { structure: [Structure.Nomadic] } },
    template: "borders matter less here than weather, grazing, and good horses",
    slots: {},
  },
  {
    when: { anyTags: { authority: [Authority.Technical] } },
    template: "broken things are repaired so quickly that people find it suspicious",
    slots: {},
  },
];

// The shipped pool: every thematic group above, plus one flavour pattern per industry.
const FUN_FACT_PATTERNS: FunFactPattern[] = [
  ...corePatterns,
  ...sizeCentralityPatterns,
  ...climatePatterns,
  ...biomePatterns,
  ...crossDimensionPatterns,
  ...governmentPatterns,
  ...industryPatterns,
];

function chooseSlotOption(
  slotName: string,
  options: FactPart[],
  ctx: CityContext,
  chosen: Record<string, FactPart>,
): FactPart | null {
  let candidates = options.filter((option) => matchesCondition(ctx, option.when));

  // A predicate must fit the subject already chosen: a cityWide predicate needs a cityWide subject ("its
  // orchards host more festivals" is nonsense), and a kind-restricted one needs a subject of that kind
  // ("its bell tower anchors the local economy" is nonsense).
  if (slotName === "predicate") {
    candidates = candidates.filter(
      (option) =>
        (!option.cityWide || chosen.subject?.cityWide === true) && acceptsSubject(option, chosen.subject),
    );
  }

  // A qualifier must also grammatically fit the predicate already chosen for this pattern.
  if (slotName === "qualifier") {
    candidates = candidates.filter((option) => acceptsQualifier(chosen.predicate, option));
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
    // The subject (resolved first, since slots iterate in insertion order) fixes the number every later
    // verb agrees with; patterns without a subject default to singular and carry no verb tokens anyway.
    const number = chosenParts.subject?.number ?? GrammaticalNumber.Singular;
    resolvedSlots[slotName] = renderTemplate(inflect(chosen.text, number), resolvedSlots, ctx);
  }

  const number = chosenParts.subject?.number ?? GrammaticalNumber.Singular;
  return renderTemplate(inflect(pattern.template, number), resolvedSlots, ctx);
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

// Exposed for the offline combo audit (funFactAudit.ts / .test.ts) — NOT part of the app's generation
// path. The audit re-uses the real pools + rendering so its enumeration matches what ships exactly.
export { FUN_FACT_PATTERNS, GrammaticalNumber, INDUSTRY_FLAVOR, acceptsQualifier, acceptsSubject, inflect, renderTemplate };
export type { FactPart, Fit, FunFactPattern, SubjectKind };
