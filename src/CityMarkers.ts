import type { InfoPopup, PopupRow } from "./InfoPopup";
import type { Settlement } from "./mapgen/features";
import { settlementClass } from "./mapgen/features/settlements";
import type { Projector } from "./renderer/projection";

// Settlement markers are interactive DOM dots layered over the globe (so hover/click come for free),
// reprojected each frame with the same projection as the canvas overlays. Two sets share the layer: the
// STATIC global big cities (placed once with the map) and the DYNAMIC patch-local small towns (the
// 1400-density tail, swapped in as you zoom/pan over a region — see RegionTownLayer). Both size dots by
// population, gate by minLevel, and open the shared popup; the limb cull + projection are the Projector's.

// Dot diameter encodes population: dot AREA ∝ population ⇒ diameter ∝ √population, clamped to a legible
// range. Calibrated so a small hamlet reads as the floor dot and a ≳250k city hits the ceiling.
const MIN_DOT_PX = 5;
const MAX_DOT_PX = 20;
const DOT_POP_SCALE = 0.03; // px per √person
const dotDiameter = (population: number): number =>
  Math.max(MIN_DOT_PX, Math.min(MAX_DOT_PX, MIN_DOT_PX + DOT_POP_SCALE * Math.sqrt(population)));

/**
 * Manages the interactive city-marker layer. `setCities` holds the static global set (rebuilt when the map
 * result changes); `setRegionTowns` holds the dynamic patch-local tail (rebuilt as the live region changes).
 * `update` reprojects + zoom-gates both each frame and opens the shared info popup on click.
 */
export class CityMarkers {
  private readonly frame: HTMLElement;
  private readonly popup: InfoPopup;
  private cities: Settlement[] = []; // global big cities (static)
  private towns: Settlement[] = []; // patch-local small towns (dynamic)
  private cityDots: HTMLDivElement[] = [];
  private townDots: HTMLDivElement[] = [];
  private cityRadii: number[] = []; // dot radius px per city (dotDiameter/2), cached so project() skips a per-frame sqrt
  private townRadii: number[] = [];
  private visible = false;
  // The dots shown after the last update() (centre + radius, screen px) — the declutter pass reserves
  // these so feature/country labels never cover a city marker. Empty when the layer is off.
  readonly visibleDots: { x: number; y: number; r: number }[] = [];

  constructor(frame: HTMLElement, popup: InfoPopup) {
    this.frame = frame;
    this.popup = popup;
  }

  /** Set the static global big-city set (called when the cached map result changes). */
  setCities(cities: Settlement[]): void {
    this.cities = cities;
    this.cityDots = this.rebuild(this.cityDots, cities);
    this.cityRadii = cities.map((c) => dotDiameter(c.population) / 2);
  }

  /** Set the dynamic patch-local town set (called when the live region's grow lands). */
  setRegionTowns(towns: Settlement[]): void {
    this.towns = towns;
    this.townDots = this.rebuild(this.townDots, towns);
    this.townRadii = towns.map((c) => dotDiameter(c.population) / 2);
  }

  private rebuild(dots: HTMLDivElement[], cities: Settlement[]): HTMLDivElement[] {
    for (const d of dots) d.remove();
    return cities.map((city) => this.makeDot(city));
  }

  private makeDot(city: Settlement): HTMLDivElement {
    const dot = document.createElement("div");
    dot.className = `city-marker ${city.tier}${city.isCapital ? " capital" : ""}`;
    // Size by population (overrides the tier's CSS size); the tier class still drives the capital ring.
    dot.style.width = dot.style.height = `${dotDiameter(city.population)}px`;
    dot.style.display = "none";
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      this.popup.open({
        source: "city",
        anchor: city.anchor,
        title: city.name,
        subtitle: `(${city.isCapital ? "capital" : settlementClass(city.population)} of ${city.countryName})`,
        rows: this.rowsFor(city),
        footer: city.funFact || undefined,
        minLevel: city.minLevel, // popup closes if you zoom out past the marker's tier
        at: { x: e.clientX, y: e.clientY },
      });
    });
    this.frame.append(dot);
    return dot;
  }

  // Population always; industries / elevation only when present (region towns carry neither → a lean popup).
  private rowsFor(city: Settlement): PopupRow[] {
    const rows: PopupRow[] = [["population", this.formatPopulation(city.population)]];
    if (city.industries.length > 0) rows.push(["industries", city.industries.join(", ")]);
    if (city.elevationMeters > 0) rows.push(["elevation", this.formatElevation(city.elevationMeters)]);
    return rows;
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.visibleDots.length = 0; // layer off → no dots to reserve against
      for (const d of this.cityDots) d.style.display = "none";
      for (const d of this.townDots) d.style.display = "none";
    }
  }

  /** Reproject + reposition every marker (both sets). A marker shows only if its tier's reveal level is
   *  reached, it faces the camera, and the layer is visible — big cities first, the small-town tail deeper. */
  update(proj: Projector, level: number): void {
    this.visibleDots.length = 0;
    if (!this.visible) return;
    this.project(this.cityDots, this.cities, this.cityRadii, proj, level);
    this.project(this.townDots, this.towns, this.townRadii, proj, level);
  }

  private project(dots: HTMLDivElement[], cities: Settlement[], radii: number[], proj: Projector, level: number): void {
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      const city = cities[i];
      const r = proj.project(city.anchor);
      if (city.minLevel > level || !r.front) {
        dot.style.display = "none";
        continue;
      }
      dot.style.left = `${r.x}px`;
      dot.style.top = `${r.y}px`;
      dot.style.display = "block";
      this.visibleDots.push({ x: r.x, y: r.y, r: radii[i] });
    }
  }

  private formatPopulation(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} million`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)} thousand`;
    return n.toLocaleString();
  }

  private formatElevation(meters: number): string {
    const feet = Math.round((meters * 3.28084) / 100) * 100;
    return `${feet.toLocaleString()} ft`;
  }
}
