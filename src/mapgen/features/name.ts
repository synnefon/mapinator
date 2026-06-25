import type { Language } from "../../common/language";
import { makeRNG, randomChoice } from "../../common/random";
import type { NameGenerator } from "../NameGenerator";
import type { FeatureKind } from "./classify";

// Descriptor templates per kind. The proper-noun {X} is generated in the MAP'S language, so labels
// match the title (per the design); the descriptor word stays English ("Sea of …", "Mount …") —
// the cartographic genre standard, and reliable across every invented language.
const TEMPLATES: Record<FeatureKind, readonly string[]> = {
  OCEAN: ["the {X} ocean"],
  SEA: ["{X} sea", "sea of {X}"],
  BAY: ["the bay of {X}", "{X} bay", "bay of {X}"],
  LAKE: ["lake {X}", "{X} lake"],
  ISLAND: ["{X} island", "isle of {X}", "{X} isle"],
  MOUNTAINS: ["the {X} mountains", "{X} mountains", "{X} range"],
  DESERT: ["the {X} desert", "{X} desert", "{X} wastes"],
  FOREST: ["the {X} forest", "{X} woods", "{X} forest"],
};

/**
 * Deterministic name for one feature: the same (mapSeed, kind, repCell) always yields the same
 * name, so labels are stable across regen, reload, and rotation. The stem is drawn in the map's
 * language; the descriptor template is picked from an independent seeded stream. Pass `unique` so the
 * namer re-rolls a colliding stem — the descriptor always wraps, so a unique stem means a unique label.
 */
export function nameFeature(
  kind: FeatureKind,
  mapSeed: string,
  repCell: number,
  language: Language,
  namer: NameGenerator,
  unique = false
): string {
  const featureSeed = `${mapSeed}|${kind}|${repCell}`;
  const stem = namer.generate({ seed: featureSeed, lang: language, unique });
  const template = randomChoice(TEMPLATES[kind] as string[], makeRNG(`${featureSeed}|tmpl`));
  return template.replace("{X}", stem).toLowerCase();
}
