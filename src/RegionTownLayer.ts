import type { Vec3 } from "./common/3DMath";
import type { TownFieldData } from "./common/map";
import { makeRNG } from "./common/random";
import { CITIES, OCEANS, POPULATION } from "./common/settings";
import type { CountryInfo, Settlement } from "./mapgen/features";
import { buildSettlement } from "./mapgen/features/cityStats";
import { globalCityMinPop, type PlacedSite, SETTLEMENT_WATER_KINDS } from "./mapgen/features/settlements";
import type { NameGenerator } from "./mapgen/NameGenerator";
import type { WorkerPool } from "./mapgen/WorkerPool";

// Drives the patch-local settlement TAIL: when the view zooms in, it asks the worker pool to grow the in-view
// region's settlements through the ONE settlement engine (the same one the main thread ran for the big-city
// head — see mapgen/features/settlements) and assembles the returned field into Settlement markers the SAME
// way the head is assembled (cityStats.buildSettlement: name + tier + profile + water-snap). Only ONE region
// is live at a time — keyed by a quantised view bucket + the feature epoch — so the planet's full tail never
// exists at once; panning/zooming swaps the live set. Sticky: the previous region stays on screen until the
// next grow lands (no blank flash), mirroring the terrain LOD overlay.

const TOWN_MIN_LEVEL = 4; // below this the cap is too wide to hold 1400 density — globe shows big cities only
const PER_CAPITA = 600; // people per settlement — the RURAL village body (~90% of people lived in villages,
// ~1 per 500–700 people in 1400); this is the knob that sets how dense the on-zoom sprinkle feels.
const CAP_MARGIN = 1.3; // grow a little past the view so a small pan doesn't immediately need a re-grow
const RECENTER_FRACTION = 0.25; // re-grow once the view centre moves this fraction of the cap

// Per-level zoom LOD, paired so the candidate-grid scan stays bounded at every level: a wide (shallow) cap
// uses a COARSE grid and a HIGH floor (only the larger market towns); a deep cap uses a FINE grid and a low
// floor (down to the dialled MIN_TOWN_POP). `floor` is the deepest-zoom population floor (the dial);
// shallower levels scale it up so each level stays legible. Spacing tracks the tier (~10 km / ~5–6 km).
const minPopForLevel = (level: number, floor: number): number => floor * (level <= 4 ? 4 : level === 5 ? 2 : 1);
const gridAngleForLevel = (level: number): number => (level <= 4 ? 0.0016 : level === 5 ? 0.001 : 0.0006);

export class RegionTownLayer {
  private current: Settlement[] = [];
  private currentKey = "";
  private requestedKey: string | null = null;

  constructor(
    private readonly pool: WorkerPool,
    private readonly namer: NameGenerator,
    private readonly onReady: () => void
  ) {}

  /** Return the current region's settlement markers (sticky), requesting a fresh grow when the view bucket or
   *  the feature epoch changes. Call each frame; cheap on steady-state frames (a key compare). `rainfall` is
   *  the base map's per-seed scalar, threaded through so the tail's marker profiles match the head's. */
  sync(args: { level: number; center: Vec3; capAngle: number; countries: CountryInfo[]; epoch: number; rainfall: number }): Settlement[] {
    const { level, center, capAngle, countries, epoch, rainfall } = args;
    if (level < TOWN_MIN_LEVEL) {
      // Zoomed out past the town tier — drop the tail so only the global big cities remain.
      if (this.current.length) {
        this.current = [];
        this.currentKey = "";
        this.requestedKey = null;
      }
      return this.current;
    }
    const minTownPop = CITIES.MIN_TOWN_POP.value;
    const popDensityScale = POPULATION.GLOBAL_POPULATION_DENSITY.value;
    const key = this.regionKey(epoch, level, center, capAngle, minTownPop);
    if (key === this.currentKey || key === this.requestedKey) return this.current; // already showing / in flight
    this.requestedKey = key;
    this.pool
      .growTowns({
        center,
        capAngle: capAngle * CAP_MARGIN,
        gridAngle: gridAngleForLevel(level),
        minPop: minPopForLevel(level, minTownPop),
        ceilingPop: globalCityMinPop(popDensityScale), // hand off to the global head at the live density-scaled split
        perCapita: PER_CAPITA,
        // Live dials so the tail routes + biases identically to the head (the worker's settings copy is stale).
        popDensityScale,
        coastStrength: POPULATION.COAST_STRENGTH.value,
        coastFalloff: POPULATION.COAST_FALLOFF.value,
        desertAversion: CITIES.DESERT_AVERSION.value,
        iceAversion: CITIES.ICE_AVERSION.value,
        riverMinStrength: CITIES.RIVER_MIN_STRENGTH.value,
      })
      .then((field) => {
        if (this.requestedKey !== key) return; // a newer region superseded this request — ignore the stale result
        this.requestedKey = null;
        this.current = field ? this.buildSettlements(field, countries, rainfall) : [];
        this.currentKey = key;
        this.onReady();
      });
    return this.current; // sticky: keep the previous region until the new settlements land
  }

  // Quantise the view centre to a bucket sized to a fraction of the cap, so small pans reuse the same grow.
  private regionKey(epoch: number, level: number, center: Vec3, capAngle: number, minTownPop: number): string {
    const step = Math.max(1e-4, capAngle * RECENTER_FRACTION);
    const q = (v: number): number => Math.round(v / step);
    return `${epoch}|${level}|${minTownPop}|${q(center.x)}|${q(center.y)}|${q(center.z)}`;
  }

  // Turn the worker's flat settlement field into Settlement markers, assembled the SAME way as the big-city
  // head (cityStats.buildSettlement: name + tier + profile). A town keeps its name + fun fact across re-grows
  // because both are seeded deterministically by location. Towns whose country index is unknown (edge of a
  // partition) drop.
  private buildSettlements(field: TownFieldData, countries: CountryInfo[], rainfall: number): Settlement[] {
    const byIndex = new Map<number, CountryInfo>();
    for (const c of countries) byIndex.set(c.index, c);
    const seaLevel = OCEANS.SEA_LEVEL.value;
    const usedFunFacts = new Set<string>(); // dedupe fun facts across the region's tail
    const out: Settlement[] = [];
    for (let i = 0; i < field.populations.length; i++) {
      const country = byIndex.get(field.countries[i]);
      if (!country) continue;
      const anchor: Vec3 = { x: field.positions[3 * i], y: field.positions[3 * i + 1], z: field.positions[3 * i + 2] };
      const site: PlacedSite = {
        anchor,
        population: Math.round(field.populations[i]),
        countryIndex: field.countries[i],
        cell: -1, // tail towns aren't tied to a base cell (the worker doesn't ship one back)
        waterKind: SETTLEMENT_WATER_KINDS[field.waterKind[i]],
        rawElevation: field.rawElevation[i],
        reportElevation: field.reportElevation[i],
        moisture: field.moisture[i],
        ice: field.ice[i],
        coastDist: field.coastDist[i],
        seaDist: field.seaDist[i],
      };
      // Stable-by-location seed → the town keeps its name + profile as you pan (NOT unique like the head).
      const seed = `town|${anchor.x.toFixed(4)}|${anchor.y.toFixed(4)}|${anchor.z.toFixed(4)}`;
      out.push(
        buildSettlement(site, { index: country.index, name: country.name, govTags: country.govTags }, {
          name: this.namer.generate({ seed, lang: country.language }),
          isCapital: false,
          seaLevel,
          rainfall,
          statsRng: makeRNG(`town-stats|${seed}`),
          usedFunFacts,
        })
      );
    }
    return out;
  }
}
