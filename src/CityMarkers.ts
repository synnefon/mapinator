import type { InfoPopup } from "./InfoPopup";
import type { City } from "./mapgen/features";
import type { Projector } from "./renderer/projection";

// City markers are interactive DOM dots layered over the globe (so hover/click come for free),
// reprojected each frame with the same projection as the canvas overlays. A dot's tier sets the zoom
// level it appears at and its population sets its size; clicking opens the shared InfoPopup. The limb
// cull + projection are the Projector's (renderer/projection.ts).

// Dot diameter encodes population: dot AREA ∝ population ⇒ diameter ∝ √population, clamped to a legible
// range. Calibrated so a ~5k town (MIN_CITY_POP) reads small and a ≳250k metropolis hits the ceiling.
const MIN_DOT_PX = 5;
const MAX_DOT_PX = 20;
const DOT_POP_SCALE = 0.03; // px per √person
const dotDiameter = (population: number): number =>
  Math.max(MIN_DOT_PX, Math.min(MAX_DOT_PX, MIN_DOT_PX + DOT_POP_SCALE * Math.sqrt(population)));

/**
 * Manages the interactive city-marker layer: a positioned dot `<div>` per city (population → dot size,
 * tier → reveal zoom; click → the shared info popup). Reprojected + zoom-gated each frame.
 */
export class CityMarkers {
  private readonly frame: HTMLElement;
  private readonly popup: InfoPopup;
  private readonly dots: HTMLDivElement[] = [];
  private visible = false;

  constructor(frame: HTMLElement, popup: InfoPopup) {
    this.frame = frame;
    this.popup = popup;
  }

  /** Rebuild the marker DOM for a new city set (called when the cached map result changes). */
  setCities(cities: City[]): void {
    for (const d of this.dots) d.remove();
    this.dots.length = 0;
    for (const city of cities) {
      const dot = document.createElement("div");
      dot.className = `city-marker ${city.tier}${city.isCapital ? " capital" : ""}`;
      // Size by population (overrides the tier's CSS size); the tier class still drives the capital ring.
      const d = dotDiameter(city.population);
      dot.style.width = dot.style.height = `${d}px`;
      dot.style.display = "none";
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        this.popup.open({
          source: "city",
          anchor: city.anchor,
          title: city.name,
          subtitle: `(${city.isCapital ? "capital" : "city"} of ${city.countryName})`,
          rows: [
            ["population", this.formatPopulation(city.population)],
            ["industries", city.industries.join(", ")],
            ["elevation", this.formatElevation(city.elevationMeters)],
          ],
          footer: city.funFact,
          minLevel: city.minLevel, // popup closes if you zoom out past the marker's tier
          at: { x: e.clientX, y: e.clientY },
        });
      });
      this.frame.append(dot);
      this.dots.push(dot);
    }
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) for (const d of this.dots) d.style.display = "none";
  }

  /** Reproject + reposition every marker. A marker shows only if its tier's reveal level is reached, it
   *  faces the camera, and the layer is visible — so big cities/capitals appear first, the rest deeper. */
  update(cities: City[], proj: Projector, level: number): void {
    if (!this.visible) return;
    for (let i = 0; i < this.dots.length; i++) {
      const dot = this.dots[i];
      const city = cities[i];
      const r = proj.project(city.anchor);
      if (city.minLevel > level || !r.front) {
        dot.style.display = "none";
        continue;
      }
      dot.style.left = `${r.x}px`;
      dot.style.top = `${r.y}px`;
      dot.style.display = "block";
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
