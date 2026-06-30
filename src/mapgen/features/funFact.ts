import { randomChoice } from "../../common/random";
import { type CityCondition, matchesCondition } from "./cityCondition";
import type { BiomeName, CityContext } from "./cityStats";
import { Authority, Society, Structure, Trait } from "./government";
import { applySettlementNoun } from "./settlement";

// ===================== Fun facts: the oddity engine =====================
// One register only: a fun fact is a concrete, surprising, SPECIFIC claim — something that sounds TRUE of
// one particular place. The bar every line must clear is that it adds something NON-OBVIOUS beyond the
// popup's stat rows (population / industries / elevation): "smells of fish" in a fishing town fails (you
// already knew it); "more of the dead lie in the hill beyond the walls than the living within them" passes.
//
// Shapes are borrowed from real-world city trivia and recast for a pre-modern world: superlatives scoped to
// {country}, concrete counts, etymology twists, hidden/abandoned works, quirky laws, engineering oddities.
// Most facts are whole authored one-liners (cityOddities). A handful use SLOTS — food, landmarks, signature
// crafts — so one oddity-grade template yields many concrete facts and a country never runs dry of variety.
// Every entry is gated (`when`) so the line FITS the city, but written so it never merely restates its type.

// Biome groups — so gates read by terrain character rather than raw thresholds. A city's biome is one value.
const WINTRY_BIOMES: BiomeName[] = ["tundra", "snowfields", "alpine", "barren peaks"];
const ARID_BIOMES: BiomeName[] = ["desert", "steppe", "badlands"];
const WOODED_BIOMES: BiomeName[] = ["forest", "woodland", "montane forest"];

type Conditional<T> = T & { when?: CityCondition };

// A slot option (cityOddities entry, or a noun in a food/landmark/craft pool). `when` gates it to the city.
type FactPart = Conditional<{ text: string }>;

// A fun-fact pattern: a template ("{landmark} is stamped on the town seal"), its slots, and an optional
// city gate. Slotless patterns (slots: {}) are whole authored oddities; slotted ones fill from the pools.
type FunFactPattern = Conditional<{
  template: string;
  slots: Record<string, FactPart[]>;
}>;

// {country} → the country name; {slot} → the rendered slot value. No tokens ⇒ returned unchanged.
function renderTemplate(template: string, slots: Record<string, string>, ctx: CityContext): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (key === "country" ? ctx.countryName : slots[key] ?? ""));
}

// ===================== The oddity corpus =====================
// Whole authored fun facts, grouped by the axis they're gated to. Universal entries (no `when`) fit any
// town and are always eligible, so every city — however plain — still leads with a concrete oddity.
// Write "town"/"city" freely as the generic place-noun: generateFunFact rewrites it to the size-appropriate
// word (hamlet/village/town/city/metropolis) by population on the way out. Plurals ("cities") stay generic.
const cityOddities: FactPart[] = [
  // — universal: civic oddities that fit any town —
  { text: "no two clock towers in town agree on the time, and the council long ago gave up trying to fix it" },
  { text: "the oldest tavern has burned down at least twice and reopened on the same spot both times" },
  { text: "locals can't agree on where the city's name even came from, and three stories are told with equal certainty" },
  { text: "the town clock has run five minutes fast for as long as anyone can remember, and no one will be the one to correct it" },
  { text: "two streets share the exact same name, and neither district will be the one to rename" },
  { text: "the city keeps a holiday whose origin everyone has forgotten, observed by closing every red door in town" },
  { text: "the shortest street in {country} runs here, and two families have feuded over its paving for generations" },
  { text: "every door in the old town is numbered by the year it was hung, so the lowest numbers mark the oldest houses" },
  { text: "the founding charter survives with its first line torn away, and scholars have argued for two centuries over what it said" },
  { text: "there are more statues of the founder in the squares than the founder lived years" },
  { text: "the central well is older than the city; the first house was raised to be near it, not the other way around" },
  { text: "the council still meets in the hall of a guild that dissolved before anyone now living was born" },
  { text: "the tallest tower was built a storey too high and has leaned a little further every century since" },
  { text: "a sealed door in the council hall has no known key, and no record survives of what was shut behind it" },
  { text: "an older, smaller town lies bricked into the cellars beneath the market square" },
  { text: "the city's name means something faintly rude in the neighboring tongue, and the neighbors have never let it go" },
  { text: "the town crier's post is hereditary, and one family has held it for eleven generations" },
  { text: "the oldest house in town is legally a public road, and carts still claim the right to pass through its great hall" },
  { text: "the city keeps two calendars, one for taxes and one for festivals, and they have drifted a full week apart" },
  { text: "a law no one has bothered to repeal still fixes the price of bread at a coin the mint stopped striking long ago" },
  { text: "more of the city's dead lie in the hill beyond the walls than there are living souls within them" },
  { text: "the main square is named for a market that was moved across town three reigns ago" },
  { text: "every neighborhood swears it is the true heart of the city, and each has a monument to prove it", when: { tiers: ["medium", "big"] } },
  { text: "big enough that the far quarter speaks with an accent the near quarter can barely follow", when: { tiers: ["big"] } },

  // — capital —
  { text: "by old protocol no roof in the capital may rise above the throne room's, so the city spreads where it cannot climb", when: { capital: true } },
  { text: "every distance in {country} is measured from a single brass stud set into the palace floor", when: { capital: true } },
  { text: "the capital is reckoned its own province and owes taxes to itself, a debt it has never once paid", when: { capital: true } },
  { text: "it has been {country}'s capital three times over, twice losing the honor to a rival and twice winning it back", when: { capital: true } },
  { text: "every province keeps a house here, and each insists, loudly, that its own is the true heart of {country}", when: { capital: true } },
  { text: "half of {country}'s letters pass through here on their way to somewhere else entirely", when: { capital: true } },

  // — coastal —
  { text: "the lighthouse has burned so long that {country}'s oldest charts are dated by the keeper who tended its lamp", when: { coastal: true } },
  { text: "at the lowest tide of the year a paved road surfaces on the seabed, leading to an island otherwise unreachable", when: { coastal: true } },
  { text: "the great breakwater is built from the ballast of a thousand foreign ships and holds stone from coasts no local has seen", when: { coastal: true } },
  { text: "by ancient right the first ship to make harbor each new year pays no toll at all", when: { coastal: true } },
  { text: "not one street runs straight to the water; every one was bent to break the sea wind before it reaches the houses", when: { coastal: true } },
  { text: "more of the town's men lie buried at sea than in its churchyard", when: { coastal: true } },
  { text: "fishermen here swear the tide runs backwards once a year, and a fair is held to watch it", when: { coastal: true } },
  { text: "the church keeps a ledger of every ship lost off the point, and the names are read aloud once a year", when: { coastal: true } },
  { text: "the noon cannon on the headland sets every clock in town, weather permitting", when: { coastal: true } },

  // — river —
  { text: "the river is crossed by more bridges than the town has gates, and each bridge keeps its own little market", when: { water: ["river"] } },
  { text: "the town stands on both banks and has never agreed which side is the real city; each keeps its own mayor", when: { water: ["river"] } },
  { text: "a tunnel runs beneath the riverbed to the far shore, dug during a siege and sealed ever since", when: { water: ["river"] } },
  { text: "the river changed course in a single night within memory, leaving the old harbor stranded half a mile inland", when: { water: ["river"] } },
  { text: "spring floods are recorded as notches on the cathedral door, the highest of them well above a tall man's reach", when: { water: ["river"] } },
  { text: "a merchant's standing here is read straight off the position of his wharf on the waterfront", when: { water: ["river"] } },
  { text: "the river is technically illegal to swim in, and everyone does", when: { water: ["river"] } },
  { text: "set so low the bridges are built high against the floods, and still the cellars drown each spring", when: { water: ["river"], maxElevationMeters: 40 } },
  { text: "the great bridge has been rebuilt seven times and is still called the new bridge", when: { water: ["river"] } },
  { text: "a stone set in the riverbed marks the lowest the water has ever fallen, and its showing is taken for a bad omen", when: { water: ["river"] } },

  // — lake —
  { text: "on a windless dawn the lake mirrors the town so exactly that travelers have ridden into the water mistaking it for the road", when: { water: ["lake"] } },
  { text: "the town draws its drinking water from one shore and floats its dead from the other, and the two are never confused", when: { water: ["lake"] } },
  { text: "an island holds the town's oldest shrine, reached by a causeway that vanishes under the lake at every full moon", when: { water: ["lake"] } },
  { text: "locals swear the lake has no bottom, and no one has ever volunteered to settle the question", when: { water: ["lake"] } },
  { text: "the lake freezes thick enough to bear a loaded cart, and the first crossing each winter is half a holiday", when: { water: ["lake"], biomes: WINTRY_BIOMES } },
  { text: "a drowned village is said to lie beneath the water, and on still nights some swear they hear its bell", when: { water: ["lake"] } },

  // — desert / scarcity —
  { text: "it has not rained here within living memory, and the year of the last rain is still spoken of as a kind of miracle", when: { biomes: ["desert"] } },
  { text: "the main streets are roofed over, so one may cross the whole city without once standing in the sun", when: { biomes: ["desert", "badlands"] } },
  { text: "every house is built around its own cistern, and a family's standing is judged by how long its water could outlast a siege", when: { biomes: ["desert", "badlands"] } },
  { text: "water is sold by the cup in the market, and a brimming cistern is worth more than a brimming strongbox", when: { biomes: ["desert"] } },
  { text: "a single old tree grows in the main square, watered by hand from the temple cistern, and it is older than the temple", when: { biomes: ["desert"] } },
  { text: "every door and window in town faces the same way by law, turning the whole place against the wind", when: { biomes: ["desert", "badlands"] } },

  // — mountain / high elevation —
  { text: "the town stands higher than the clouds that water it, so its people watch storms break on the valley far below", when: { minElevationMeters: 1800 } },
  { text: "one of the highest towns in {country}, where newcomers spend their first day catching their breath", when: { minElevationMeters: 2000 } },
  { text: "the only road in freezes shut for half the year, and the town spends each winter on what it laid by each summer", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "the upper and lower towns keep their clocks an hour apart, the upper quarter insisting the sun reaches it first", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "every stone of the place was carried up by mule, and the masons' guild forbids the wheel on the steepest streets", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "snow is packed into deep stone pits through summer and sold down to the lowlands at a profit", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "the two halves of town face each other across a gorge, joined by one bridge that charges a toll between neighbors", when: { elevations: ["HIGH", "VERY_HIGH"] } },

  // — mining —
  { text: "the hills beneath the town are more hollow than solid, and whole streets stand closed where old shafts gave way", when: { industries: ["mining"] } },
  { text: "the mine runs deeper below the town than the highest tower stands above it", when: { industries: ["mining"] } },
  { text: "the shift bell, not the temple bell, divides the day here, and it rings at hours that suit no prayer", when: { industries: ["mining"] } },
  { text: "locals joke the mountain gets a little smaller every year, and they are not entirely wrong", when: { industries: ["mining"] } },
  { text: "so much silver once left along this road that the brigands gave it up, sure the next cart could be no richer than the last", when: { industries: ["mining"] } },

  // — religious —
  { text: "there are more shrines in the old town than houses, and several streets hold nothing else", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "the great cathedral has been under construction for two hundred years and is forbidden by vow ever to be called finished", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "in the holy season pilgrims outnumber residents three to one, and the townsfolk let their own houses and leave for the month", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "the temple flame has not gone out within memory, kept burning in shifts by families who hold the duty their highest honor", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "no wedding and no funeral may fall on the same day, and a priest is kept whose sole task is to keep them apart", when: { anyTags: { authority: [Authority.Religious] } } },

  // — military —
  { text: "the walls have been breached only once, and the breach was left unrepaired as a monument to what taking them cost", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the gates are still shut each dusk to a horn older than the masonry, in a call unchanged for centuries", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the streets were laid as a maze to baffle invaders, and they baffle visitors and tax-collectors to this day", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the armory holds arms for ten times the town's strength, kept against an army expected a century ago that never came", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "every citizen holds a place on the wall by birth, and the muster roll is read aloud once a year so none forgets theirs", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "every map of the old town is drawn subtly wrong on purpose, a habit left over from a long-ago siege", when: { anyTags: { authority: [Authority.Militaristic] } } },

  // — scholastic —
  { text: "the great library is forbidden to lend a single book, so the scholars come to the books instead, and some never leave", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "in term the students outnumber the townsfolk, and the place falls half-empty the day they go home", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "a clock in the great hall has kept perfect time for three centuries, wound by a post handed down like an inheritance", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "the oldest lecture is still given on the same day each year, from notes copied so often no one knows who first set them down", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "the astronomers keep the town's official time, and have twice corrected the calendar by a whole day", when: { anyTags: { society: [Society.Scholastic] } } },

  // — commercial —
  { text: "a letter of credit drawn here is honored in cities the clerks who wrote it could not find on a map", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "the merchants' guild mints its own token, good across the whole market and worthless one step beyond the gates", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "the great market is said never to have closed; no hour in a century has passed without a sale somewhere within it", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "the richest street is the narrowest, where the counting-houses bought out their neighbors and built upward instead", when: { anyTags: { authority: [Authority.Commercial] } } },

  // — bureaucratic —
  { text: "the town keeps a register of its registers, and a clerk is assigned each year to hunt down the ones gone missing", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "the archive is larger than the palace, and a petition filed a lifetime ago may still be working toward its answer", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "every cat in the city is recorded by name, color, and the household it permits to feed it; dogs go uncounted", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "the seal of office has been recut so often that no two centuries' documents bear quite the same mark", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "nothing here is official until three separate clerks have disagreed about it in writing", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "the town seal has carried the same spelling mistake for so long that correcting it is now considered forgery", when: { anyTags: { authority: [Authority.Bureaucratic, Authority.Civic] } } },

  // — agrarian —
  { text: "by law the granary stands tallest in town, and the temple was built a hand shorter on purpose", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "the year is counted from the first sheaf, so the new year falls in late summer, long after the rest of {country} has turned the page", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "the whole town turns out for the harvest, and the courts and markets shut until the last field is in", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "every household holds a key to the common granary, and the locks are changed the day anyone loses theirs", when: { anyTags: { society: [Society.Agrarian] } } },

  // — cold / wintry —
  { text: "the snow cuts the town off for so much of the year that its calendar marks only two seasons: the open road and the closed", when: { biomes: WINTRY_BIOMES } },
  { text: "the dead are kept in a stone house all winter and buried only when the spring thaw softens the ground", when: { biomes: WINTRY_BIOMES } },
  { text: "a house here is judged by how little smoke escapes its eaves, the warmth kept in by doubled windows packed with moss", when: { biomes: WINTRY_BIOMES } },
  { text: "for the depth of winter the sun never clears the ridge, and the town lights its lamps at noon", when: { biomes: WINTRY_BIOMES } },
  { text: "summer lasts barely six weeks up here, and the town crams a year's worth of festivals into it", when: { biomes: ["alpine"] } },
  { text: "in winter the town finds its way by tall painted poles, once the snow has swallowed every landmark", when: { biomes: ["snowfields"] } },
  { text: "the ground never fully thaws, so the dead are sealed away in cairns of stacked stone", when: { biomes: ["tundra"] } },
  { text: "nothing grows this high, and every basket of soil in the terrace gardens was carried up on someone's back", when: { biomes: ["barren peaks"] } },

  // — forest / woodland —
  { text: "the oldest quarter is built up in the canopy, and its eldest streets are bridges strung between the great trees", when: { biomes: ["forest"] } },
  { text: "by guild law every tree felled must be answered with three planted, and the forester who fails is forbidden the axe for a year", when: { biomes: WOODED_BIOMES } },
  { text: "the town holds that it belongs to the forest as much as the forest to it, and no outsider may take so much as a fallen branch", when: { biomes: WOODED_BIOMES } },
  { text: "the tallest tree in the wood is named, has its own keeper, and felling it is a hanging matter", when: { biomes: WOODED_BIOMES } },
  { text: "cloud fills the valley most mornings, and the upper town looks out over a sea of white", when: { biomes: ["montane forest"] } },

  // — grassland / steppe / wetland / badlands —
  { text: "the horizon is so wide the town raised a watch-tower against no enemy but the weather, to spot the storms a day out", when: { biomes: ["grassland"] } },
  { text: "the town keeps no walls, only distance, and reckons its safety by how far a rider must come to reach it", when: { biomes: ["steppe"] } },
  { text: "the safe paths through the marsh are taught to children before the street names, and a stranger who strays from them is seldom found", when: { biomes: ["wetland"] } },
  { text: "the whole town stands on pilings driven into the mud, and rises a finger's width each year as more are sunk beneath it", when: { biomes: ["wetland"] } },
  { text: "nothing grows for a day's ride in any direction, and every green thing in town is watered by hand and watched like treasure", when: { biomes: ["badlands"] } },
  { text: "the town doubles in size each summer when the herders bring their beasts to market, and empties again by autumn", when: { biomes: ["grassland", "steppe"] } },
  { text: "grass fires are watched for from a tower, and the whole town can be behind stone within the hour", when: { biomes: ["grassland", "steppe"] } },
  { text: "the cliffs are banded in color, and the houses are striped to match the rock they were cut from", when: { biomes: ["badlands"] } },
  { text: "the dead are laid in raised tombs, since any grave dug here fills with water before the coffin is in", when: { biomes: ["wetland"] } },

  // — government: structure & trait & authority (the enums the gates above don't reach) —
  { text: "the town stands only half the year; in the other half its people and their very roofs move on, and the squares are left to the wind", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "it has changed hands so often that the old families keep a flag of every ruler, ready to raise whichever is winning", when: { anyTags: { trait: [Trait.Fragmented] } } },
  { text: "the town has rewritten its own founding story twice within living memory, and the official account is kept carefully vague", when: { anyTags: { trait: [Trait.Revolutionary] } } },
  { text: "the old regime's statues still stand at the crossroads, kept only so the new one has something to throw stones at", when: { anyTags: { trait: [Trait.Revolutionary] } } },
  { text: "half the street names honor battles fought somewhere else entirely", when: { anyTags: { trait: [Trait.Expansionist] } } },
  { text: "the same families have held the same offices so long the titles have begun to feel hereditary", when: { anyTags: { trait: [Trait.Stable] } } },
  { text: "old imperial standards still hang in halls no emperor has entered in living memory", when: { anyTags: { authority: [Authority.Imperial] } } },
  { text: "the old imperial road runs through town dead straight, as though a ruler had been laid across the map", when: { anyTags: { authority: [Authority.Imperial] } } },
  { text: "everyone in town can name the monarch, and far fewer can name the mayor", when: { anyTags: { authority: [Authority.Monarchic] } } },
  { text: "the crown's portrait hangs in every tavern, watching over the unpaid tabs", when: { anyTags: { authority: [Authority.Monarchic] } } },
  { text: "a handful of family names are carved on nearly every gate, plaque, and unpaid debt in town", when: { anyTags: { authority: [Authority.Elite] } } },
  { text: "the local aristocracy change fashions so fast that last season's finery is already on the servants", when: { anyTags: { authority: [Authority.Elite] } } },
  { text: "any decision here can be reopened by anyone willing to shout long enough in the square", when: { anyTags: { authority: [Authority.Civic] } } },
  { text: "broken things are mended here so quickly that strangers find it faintly unnerving", when: { anyTags: { authority: [Authority.Technical] } } },
  { text: "two flags fly over the town, and the argument over which should fly higher never quite ends", when: { anyTags: { structure: [Structure.Dependent] } } },
  { text: "every tax is paid to the capital reluctantly, and every complaint about it for free", when: { anyTags: { structure: [Structure.Federal] } } },

  // — industry-specific (salvaged gems + new); each fires only when the city actually has the trade —
  { text: "now and then a strange creature is found whole inside the local amber", when: { industries: ["amber trade"] } },
  { text: "the richest folk in town spend their lives holding their breath", when: { industries: ["pearling"] } },
  { text: "more than one local fortune was staked on the cracking of a single mussel", when: { industries: ["freshwater pearling"] } },
  { text: "a rice wine is brewed here the locals swear will never give a man a hangover", when: { industries: ["rice farming"] } },
  { text: "some of the olive trees here were already old when the kingdom was young", when: { industries: ["olive farming"] } },
  { text: "poets have written odes to the smell of the town when the dates come in", when: { industries: ["date farming"] } },
  { text: "people come for the hot springs and leave knowing everyone else's secrets", when: { industries: ["hot springs"] } },
  { text: "every clockmaker in town swears that all the others run fast", when: { industries: ["clockmaking"] } },
  { text: "the whole town knows when a ship comes home heavy, long before it docks, by the smell on the wind", when: { industries: ["whaling"] } },
  { text: "every respectable warehouse on the waterfront keeps one thoroughly disreputable back door", when: { industries: ["smuggling"] } },
  { text: "the maps drawn here are out of date before the ink is dry, and sell briskly all the same", when: { industries: ["cartography"] } },
  { text: "one lane has not a single straight wall left, and the alchemists are still blamed for it", when: { industries: ["alchemy"] } },
  { text: "fortunes here are still reckoned in barrels of salt rather than coin", when: { industries: ["salt trade"] } },
  { text: "the market air alone is said to be worth the journey, for the smell of it", when: { industries: ["spice trade"] } },
  { text: "a single pamphlet printed here once unseated a governor, and the press is kept like a relic", when: { industries: ["printing"] } },
  { text: "each spring the river all but vanishes beneath the rafts of floating logs", when: { industries: ["timber rafting"] } },
  { text: "the bargemen swear the river shifts its channel on purpose, just to spite a newcomer", when: { industries: ["river trade"] } },
];

// ===================== Slotted oddities: one template, many concrete facts =====================
// A few oddity-grade templates fill a noun from a gated pool, so a town's food, landmark, craft, festival,
// founder, or signature beast supplies the specifics. matchesCondition keeps only options the city actually
// has; if a pattern's slot has no eligible option for this city, the pattern simply doesn't fire (returns
// null) and the flat oddities cover it. The tag-gated pools (festival / founder + the landmark/craft tag
// entries) are how the government dimensions get combinatorial variety without one flat line per tag.

// Food. Drinks live here too, so templates avoid "a plate of" — they read for wine and stew alike.
const dish: FactPart[] = [
  { text: "salt cod", when: { coastal: true } },
  { text: "smoked herring", when: { coastal: true } },
  { text: "oyster stew", when: { coastal: true } },
  { text: "river eel", when: { water: ["river"] } },
  { text: "fried trout", when: { water: ["river"] } },
  { text: "lake perch", when: { water: ["lake"] } },
  { text: "stewed carp", when: { water: ["lake"] } },
  { text: "crayfish", when: { water: ["river", "lake"] } },
  { text: "seal blubber", when: { biomes: WINTRY_BIOMES } },
  { text: "potato stew", when: { biomes: WINTRY_BIOMES } },
  { text: "blood pudding", when: { biomes: WINTRY_BIOMES } },
  { text: "spiced winter wine", when: { biomes: WINTRY_BIOMES } },
  { text: "spiced flatbread", when: { biomes: ["desert", "steppe"] } },
  { text: "stewed lamb", when: { biomes: ["desert", "steppe"] } },
  { text: "spiced lentils", when: { biomes: ARID_BIOMES } },
  { text: "mare's milk", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "lamb stew", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "goat cheese", when: { biomes: ["montane forest"] } },
  { text: "mountain cheese", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "peppered sausage", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "roast chestnuts", when: { biomes: WOODED_BIOMES } },
  { text: "wild boar", when: { biomes: WOODED_BIOMES } },
  { text: "honey cakes", when: { bands: ["MID", "WET"] } },
  { text: "stuffed grape leaves", when: { bands: ["MID"], elevations: ["MEDIUM"] } },
];

// Landmarks (the X form, so templates read cleanly). Templates are kept generic enough to fit any of them.
const landmark: FactPart[] = [
  { text: "the old bell tower" },
  { text: "the clock tower" },
  { text: "the market cross" },
  { text: "the old gate" },
  { text: "the lighthouse", when: { coastal: true } },
  { text: "the great cathedral", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "the high granary", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "the watchtower", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the guildhall", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "the palace gate", when: { anyTags: { authority: [Authority.Monarchic] } } },
  { text: "the assembly hall", when: { anyTags: { authority: [Authority.Civic] } } },
  { text: "the old observatory", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "the imperial milestone", when: { anyTags: { authority: [Authority.Imperial] } } },
  { text: "the records house", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "the great waterwheel", when: { water: ["river"] } },
  { text: "the leaning spire" },
  { text: "the plague column" },
  { text: "the old mint" },
  { text: "the triumphal arch", when: { anyTags: { authority: [Authority.Militaristic, Authority.Imperial] } } },
  { text: "the great sundial", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "the hilltop beacon", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "the great bathhouse", when: { tiers: ["medium", "big"] } },
];

// Signature crafts (the city's renowned product), gated to the trade that makes them.
const craft: FactPart[] = [
  { text: "blue glass", when: { industries: ["glassblowing"] } },
  { text: "watered steel", when: { industries: ["metalworking"] } },
  { text: "figured silk", when: { industries: ["silk weaving"] } },
  { text: "dyed cloth", when: { industries: ["textiles"] } },
  { text: "fired porcelain", when: { industries: ["pottery"] } },
  { text: "gilt leather", when: { industries: ["leatherworking"] } },
  { text: "cut crystal", when: { industries: ["gemcutting"] } },
  { text: "aged brandy", when: { industries: ["distilling"] } },
  { text: "marbled paper", when: { industries: ["papermaking"] } },
  { text: "carved amber", when: { industries: ["amber trade"] } },
  { text: "estate wine", when: { industries: ["viticulture"] } },
  { text: "blue-veined cheese", when: { industries: ["cheesemaking"] } },
  { text: "smoked tea", when: { industries: ["tea"] } },
  { text: "temple incense", when: { industries: ["incense trade"] } },
  { text: "white furs", when: { industries: ["fur trapping"] } },
  { text: "carved scrimshaw", when: { industries: ["whaling"] } },
  { text: "pearl jewelry", when: { industries: ["pearling"] } },
  { text: "spring-driven clocks", when: { industries: ["clockmaking"] } },
  { text: "wheat beer", when: { industries: ["brewing"] } },
  { text: "fine broadcloth", when: { industries: ["wool"] } },
  { text: "bleached linen", when: { industries: ["linen"] } },
];

// Festivals — the town's defining yearly event, gated across many tags so each kind of place gets its own.
const festival: FactPart[] = [
  { text: "founders' day" },
  { text: "the midsummer fair" },
  { text: "the lantern vigil", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "the day of the old kings", when: { anyTags: { authority: [Authority.Monarchic] } } },
  { text: "the great audit", when: { anyTags: { authority: [Authority.Bureaucratic] } } },
  { text: "the masters' disputation", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "the harvest feast", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "the victory march", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "the guilds' parade", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "the boat-blessing", when: { coastal: true } },
  { text: "the river fair", when: { water: ["river"] } },
  { text: "the midwinter burning", when: { biomes: WINTRY_BIOMES } },
  { text: "the running of the herds", when: { biomes: ["grassland", "steppe"] } },
];

// Founders — always a person or band (the statue template needs it), the figure the town credits its start to.
const figure: FactPart[] = [
  { text: "a pair of feuding brothers" },
  { text: "a peddler who stopped to mend a wheel and never left" },
  { text: "a wandering holy man", when: { anyTags: { authority: [Authority.Religious] } } },
  { text: "a retired general", when: { anyTags: { authority: [Authority.Militaristic] } } },
  { text: "a runaway prince", when: { anyTags: { authority: [Authority.Monarchic] } } },
  { text: "a shrewd merchant", when: { anyTags: { authority: [Authority.Commercial] } } },
  { text: "a disgraced scholar", when: { anyTags: { society: [Society.Scholastic] } } },
  { text: "an imperial surveyor", when: { anyTags: { authority: [Authority.Imperial] } } },
  { text: "a company of engineers", when: { anyTags: { authority: [Authority.Technical] } } },
  { text: "a band of exiles", when: { anyTags: { trait: [Trait.Revolutionary, Trait.Fragmented] } } },
  { text: "a wandering clan that stopped to winter", when: { anyTags: { structure: [Structure.Nomadic] } } },
  { text: "a shipwrecked crew", when: { coastal: true } },
];

// Signature beasts — plural nouns (templates read with the plural), gated by terrain and trade.
const beast: FactPart[] = [
  { text: "camels", when: { biomes: ["desert", "steppe"] } },
  { text: "reindeer", when: { biomes: WINTRY_BIOMES } },
  { text: "horses", when: { biomes: ["grassland", "steppe"] } },
  { text: "goats", when: { biomes: ["montane forest", "highlands"] } },
  { text: "mules", when: { elevations: ["HIGH", "VERY_HIGH"] } },
  { text: "hunting hounds", when: { biomes: WOODED_BIOMES } },
  { text: "oxen", when: { anyTags: { society: [Society.Agrarian] } } },
  { text: "falcons", when: { biomes: ["desert", "steppe"] } },
];

const slottedOddityPatterns: FunFactPattern[] = [
  // food
  { template: "the recipe for the town's {dish} is a guild secret, and a cook was once run out of town for selling it", slots: { dish } },
  { template: "by old custom no bargain is struck here until both sides have shared the local {dish}", slots: { dish } },
  { template: "the autumn fair crowns whoever can put away the most {dish}, and past champions are remembered by name", slots: { dish } },
  { template: "a stranger isn't counted a local until they can praise the {dish} and mean it", slots: { dish } },
  { template: "exiles are said to weep at the smell of the town's {dish} cooking somewhere far from home", slots: { dish } },
  { template: "an inn that serves poor {dish} does not stay open long, and its failures are remembered for years", slots: { dish } },
  // landmarks
  { template: "every road for miles is measured from {landmark}, down to the last worn milestone", slots: { landmark } },
  { template: "{landmark} is stamped on the town seal, and on every coin the town has minted since", slots: { landmark } },
  { template: "{landmark} has its own keeper, a post handed down in one family for longer than the records run", slots: { landmark } },
  { template: "no building in town may rise higher than {landmark}, by a law older than the tallest of them", slots: { landmark } },
  { template: "{landmark} turns up in every traveler's account of the town, its height always exaggerated", slots: { landmark } },
  // crafts
  { template: "the secret of the town's {craft} is held by a single family and has never once left it", slots: { craft } },
  { template: "envoys send home for the town's {craft} and wait years for their turn", slots: { craft } },
  { template: "a dozen cities have tried to copy the town's {craft}, and every copy falls short", slots: { craft } },
  { template: "the town's {craft} once settled a royal debt, or so the story is told", slots: { craft } },
  { template: "the crown taxes the town's {craft} at a rate set for nothing else in {country}", slots: { craft } },
  // festivals
  { template: "all work stops for three days each year for {festival}, and the town never quite agrees it was worth it", slots: { festival } },
  { template: "{festival} festival is older than the town's charter and defended twice as fiercely", slots: { festival } },
  { template: "strangers are warned not to pass through during {festival} unless they mean to join in", slots: { festival } },
  { template: "the year here is reckoned in the weeks before and after {festival}", slots: { festival } },
  // founders
  { template: "the town traces its founding to {figure}, though no two tellings of the story agree", slots: { figure } },
  { template: "a weathered statue of {figure} stands in the square, and locals still argue whether the likeness is fair", slots: { figure } },
  { template: "{figure} is said to have founded the town on a bet, a story it has never quite lived down", slots: { figure } },
  // beasts
  { template: "{beast} turn more heads here than any carriage, and everyone keeps an opinion on which is finest", slots: { beast } },
  { template: "the town counts its wealth in {beast}, and a poor year in the same", slots: { beast } },
  { template: "by old law no {beast} may be struck within the walls, and the fine would ruin most men", slots: { beast } },
  { template: "children here can judge {beast} long before they can read", slots: { beast } },
];

// The whole engine: every flat oddity as its own pattern (so the per-country `used` set dedupes and EXHAUSTS
// them line by line), plus the slotted patterns (each yields many concrete facts as its slot varies).
const flatOddityPatterns: FunFactPattern[] = cityOddities.map((o) => ({ when: o.when, template: o.text, slots: {} }));
const FUN_FACT_PATTERNS: FunFactPattern[] = [...flatOddityPatterns, ...slottedOddityPatterns];

// Pick one option a city satisfies, at random; null if it has none (the slot — and so the pattern — can't fire).
function chooseSlotOption(options: FactPart[], ctx: CityContext): FactPart | null {
  const candidates = options.filter((o) => matchesCondition(ctx, o.when));
  return candidates.length === 0 ? null : randomChoice(candidates, ctx.rng);
}

// Render one pattern for a city, or null if its gate fails or a slot has no eligible option.
function generateFromPattern(pattern: FunFactPattern, ctx: CityContext): string | null {
  if (!matchesCondition(ctx, pattern.when)) return null;
  const resolved: Record<string, string> = {};
  for (const [slotName, options] of Object.entries(pattern.slots)) {
    const chosen = chooseSlotOption(options, ctx);
    if (!chosen) return null;
    resolved[slotName] = renderTemplate(chosen.text, resolved, ctx);
  }
  return renderTemplate(pattern.template, resolved, ctx);
}

export function generateFunFact(ctx: CityContext, used?: Set<string>): string {
  // Collect every oddity this city can show (one rendering per pattern), then prefer one the COUNTRY hasn't
  // used yet — so a country's cities each get a distinct fact, falling back to a repeat only once it has
  // genuinely spent its eligible oddities. Universal entries always match, so the stub is unreachable.
  const candidates: string[] = [];
  for (const pattern of FUN_FACT_PATTERNS) {
    const text = generateFromPattern(pattern, ctx);
    if (text !== null) candidates.push(text);
  }
  if (candidates.length === 0) return `set deep in ${ctx.countryName}'s ${ctx.biome}`;

  const fresh = used ? candidates.filter((c) => !used.has(c)) : candidates;
  const pool = fresh.length > 0 ? fresh : candidates;
  const chosen = randomChoice(pool, ctx.rng);
  used?.add(chosen); // dedupe on the CANONICAL text — the per-population noun is applied only on the way out
  return applySettlementNoun(chosen, ctx.population);
}

// Exposed for the offline combo audit (funFactAudit.ts / .test.ts) — NOT part of the app's generation path.
// The audit re-uses the real patterns + rendering so its enumeration matches what ships exactly.
export { FUN_FACT_PATTERNS, renderTemplate };
export type { FactPart, FunFactPattern };
