import type { AppState } from "../AppState";
import { Quat } from "../common/3DMath";
import type { GlobeMap } from "../common/map";
import { OCEANS } from "../common/settings";
import type { MapDerivations } from "../mapDerivations";
import type { MapFeatures } from "../mapgen/features";
import type { CityMarkers } from "../CityMarkers";
import { countryFontPx, type CountryLabels } from "../CountryLabels";
import type { InfoPopup } from "../InfoPopup";
import type { CompassNeedle } from "./compassNeedle";
import { drawCountries } from "./countryLayer";
import { drawFeatureLabels, featureFontPx, type LabelItem } from "./featureLabels";
import { layoutLabels, type Placement, type Rect, type TextLabel } from "./labelLayout";
import type { LodPipeline } from "./LodPipeline";
import { drawPlateArrows } from "./plateArrows";
import { makeProjector, type Projector } from "./projection";
import { drawRivers } from "./rivers";
import type { IGlobeRenderer } from "./WebGLGlobeRenderer";

// --- Label declutter tuning ---
// A greedy occupancy-bitmap pass (renderer/labelLayout.ts) keeps overlapping text labels off each other
// AND off the city dots. A label's priority is an integer type BAND (×10, so the fractional size tiebreak
// in [0,1) can never cross a band) plus its size, so within a band the bigger feature wins. Bands, high to
// low: countries, then oceans/seas, then everything else (other features + rivers).
const LABEL_BAND_COUNTRY = 3;
const LABEL_BAND_WATER = 2;
const LABEL_BAND_OTHER = 1;
const LABEL_GUTTER_PX = 3; // gap a label needs to APPEAR (collision-test inflation)
// Gap a label that's already shown needs to STAY — negative, so it tolerates a little overlap before
// dropping. LABEL_GUTTER_PX − this is the dead-band; kept wider than the 8px raster cell so a label near
// the threshold can't flicker in/out as the globe rotates or momentum settles.
const LABEL_STICKY_GUTTER_PX = -6;
const LABEL_HYSTERESIS = 4; // priority bump for a label shown last frame (< band spacing) — anti-flicker
// A country label may slide off its anchor to dodge a collision by up to this fraction of the country's
// inscribed radius (anchor→nearest-border distance). < 1 keeps the label's centre inside the country, so
// most of the name stays on home territory; raise toward 1 for more dodging room, lower to keep it centred.
const LABEL_MOVE_FRACTION = 0.75;

/** The five stacked canvases the scene draws: the globe plus its 2D annotation overlays. */
export type SceneCanvases = {
  map: HTMLCanvasElement;
  rivers: HTMLCanvasElement;
  arrows: HTMLCanvasElement;
  labels: HTMLCanvasElement;
  countries: HTMLCanvasElement;
};

export type GlobeSceneDeps = {
  canvases: SceneCanvases;
  renderer: IGlobeRenderer;
  pipeline: LodPipeline;
  derivations: MapDerivations;
  appState: AppState;
  cityMarkers: CityMarkers;
  countryLabels: CountryLabels;
  infoPopup: InfoPopup;
  needle: CompassNeedle | null;
  /** Ship the base partition to the workers so detail patches stamp per-cell country at generation. */
  broadcastCountrySeeds: (seeds: {
    sites: Float32Array;
    countryOf: Int32Array;
    seaLevel: number;
    baseChanged: boolean;
  }) => void;
};

/**
 * The frame owner: everything "draw the current view correctly" — the base globe + detail patch,
 * the annotation overlays (rivers, plate arrows, feature/river/country labels, city markers), the
 * one shared per-frame projection, the label-declutter assembly + its cross-frame state, and the
 * per-base-map side effects (GPU base-field fill, country-seed broadcast). main.ts decides WHEN a
 * frame happens (scheduleRender / animations); the scene decides WHAT a frame is.
 */
export type GlobeScene = {
  /** Draw one frame of everything at the current view. */
  render(): void;
  /** Resize the five stacked canvas bitmaps together; true if anything changed (⇒ redraw). */
  resize(width: number, height: number): boolean;
  /** The hover state driving the country highlight (set by the country-label DOM layer). */
  setHoveredCountry(index: number | null): void;
};

export function createGlobeScene(deps: GlobeSceneDeps): GlobeScene {
  const { renderer, pipeline, derivations, appState, cityMarkers, countryLabels, infoPopup, needle } = deps;
  const { map: canvas, rivers: riverCanvas, arrows: arrowCanvas, labels: labelCanvas, countries: countryCanvas } = deps.canvases;
  const gpuPatches = renderer.canDetail();

  // Replace the base globe's CPU-sampled noise fields with the GPU readback (the same field the renderer
  // draws), so feature placement lands on the rendered coast — once per base map, before features derive.
  // No-op without float-RT (CPU fields stand, the fallback). Plate stays CPU (not a noise field).
  const gpuFilledBases = new WeakSet<GlobeMap>();
  function fillBaseFieldsFromGpu(base: GlobeMap): void {
    if (!gpuPatches || gpuFilledBases.has(base)) return;
    gpuFilledBases.add(base); // mark first: a failed/again attempt shouldn't re-run the readback
    const f = renderer.baseField(canvas, base.sites);
    if (!f) return; // GPU path unavailable → keep the worker's CPU fields
    base.elevation.set(f.elevation);
    base.moisture.set(f.moisture);
    // ice stays the worker's CPU value — the GPU field now carries the KÖPPEN ZONE in that channel, not ice.
    base.koppenZone.set(f.koppenZone);
    base.shade.set(f.shade);
    base.reportElevation.set(f.reportElevation);
  }

  // Interactive-layer state: the hovered country (drives the territory highlight), the feature
  // result the DOM labels were last built from, and the epoch keying the GPU choropleth cache.
  let hoveredCountry: number | null = null;
  let labelResult: MapFeatures | null = null;
  let lastPoolBaseSites: Float32Array | null = null; // base sites last broadcast to workers (→ baseChanged flag)
  let featureEpoch = 0; // bumps when the feature result changes — keys the GPU choropleth colour cache

  // The view → screen projection for THIS frame — orientation + zoom + the active renderer's horizontal
  // offset — shared by every overlay so the projection + limb cull live in ONE place (renderer/projection.ts)
  // rather than being re-derived (and the renderer's offset re-fetched) in each.
  const currentProjector = (): Projector =>
    makeProjector(canvas.width, canvas.height, appState.orientation, appState.settings.zoom, renderer.horizontalOffsetFraction());

  // Label declutter carries two bits of per-frame state. The advance width of the (monospace) label font,
  // measured once so a label box's width is exact with no DOM reflow; and the set of labels shown last
  // frame, fed back so a label on the bubble stays put as the globe rotates (anti-flicker).
  let monoAdvance = 0.6; // Roboto Mono advance ≈ 0.6em/char — measured below for exactness
  let monoMeasured = false;
  const ensureMonoAdvance = (): void => {
    if (monoMeasured) return;
    const ctx = labelCanvas.getContext("2d");
    if (!ctx) return;
    ctx.font = "bold 100px 'Roboto Mono', ui-monospace, monospace";
    const w = ctx.measureText("MMMMMMMMMM").width;
    if (w > 0) {
      monoAdvance = w / (10 * 100);
      monoMeasured = true;
    }
  };
  // Re-measure once the web font actually loads (the first measure may hit the fallback monospace).
  if (document.fonts) void document.fonts.ready.then(() => { monoMeasured = false; });
  let prevPlacedLabels: ReadonlyMap<string, Placement> = new Map();
  // Per-frame declutter scratch, reused across frames (cleared + refilled) so the 60fps label path doesn't
  // reallocate these arrays — or the city-dot Rects — every frame.
  const featureItems: LabelItem[] = [];
  const textLabels: TextLabel[] = [];
  const reserved: Rect[] = [];

  // Country FILL + hover HIGHLIGHT use the patch's PER-CELL country, stamped AT GENERATION (each patch cell
  // takes the nearest base cell of the broadcast grown partition — see mapWorker + growCountriesOverWater)
  // and carried on the mesh as `overlay.countryOf`. So they colour correctly the instant the patch exists —
  // no async re-grow, no GPU-elevation readback; it's cached + preloaded with the mesh by the LOD pipeline.
  // The equirect choropleth (bakeCountryTexture) is now only the coarse FALLBACK: the base globe, the CPU
  // path, and any patch built while the country layer was off. BORDER LINES stay compute-once (refined
  // sphere polylines from the derivation — refineCountryBorders).

  function drawCountryOverlay(proj: Projector = currentProjector()): void {
    const baseMap = pipeline.base();
    const result = baseMap ? derivations.peekFeatures(baseMap) : null;
    if (!baseMap || !result || !(appState.settings.viewCountries ?? false)) {
      countryCanvas.getContext("2d")?.clearRect(0, 0, countryCanvas.width, countryCanvas.height);
      return;
    }
    // Borders: the refined coarse polylines from the derivation. Highlight: when the shown patch carries
    // per-cell country (stamped at gen), the GPU patch fills the hovered country per-pixel (drawDetail) —
    // skip the 2D fill; otherwise (no patch / equirect-fallback patch / CPU path) fall back to a 2D fill.
    const gpuHighlight = gpuPatches && pipeline.overlay()?.countryOf != null;
    const highlight =
      hoveredCountry !== null && !gpuHighlight ? { map: baseMap, countryOf: result.countryOf, index: hoveredCountry } : null;
    drawCountries(countryCanvas, result.borders, highlight, proj);
  }

  function render(): void {
    // Spin the 3D compass needle to point along north's direction in view space (x right,
    // y up, z toward camera) — a live compass that foreshortens as north tilts in/out and,
    // being a solid, never collapses to nothing when you face a pole.
    if (needle) {
      needle.update(Quat.rotate(appState.orientation, { x: 0, y: 1, z: 0 }));
    }
    const baseMap = pipeline.base();
    const overlay = pipeline.overlay();
    if (!baseMap) return;
    fillBaseFieldsFromGpu(baseMap); // GPU-canonical base fields (once per map) before features derive

    const viewLevel = pipeline.view().level;
    const showLabels = appState.settings.viewLabels ?? false;
    const showCountries = appState.settings.viewCountries ?? false;
    const showCities = appState.settings.viewCities ?? false;
    const showCountryColors = appState.settings.viewCountryColors ?? false;
    const showRivers = appState.settings.viewRivers ?? false;
    const clear = (c: HTMLCanvasElement) =>
      c.getContext("2d")?.clearRect(0, 0, c.width, c.height);

    // Labels, country borders, and cities share one feature set (countries drive naming). The derivations
    // module computes it RIVERS FIRST (cities snap to the final network) and derives the features
    // OFF-THREAD: this call returns the cached result when fresh, the previous (sticky) result while a
    // new derivation is in flight, or null before a new map's first result lands — the null guards
    // below simply leave those layers blank for that beat, and onFeaturesReady re-renders on landing.
    // Resolved BEFORE the globe draw so the choropleth can tint the globe's per-cell colours on the GPU.
    let result: MapFeatures | null = null;
    if (showLabels || showCountries || showCities || showCountryColors) {
      result = derivations.features(baseMap);
      // Rebuild the interactive labels/markers when the underlying result changes (new map / dials).
      if (result && result !== labelResult) {
        labelResult = result;
        featureEpoch++;
        hoveredCountry = null;
        countryLabels.setCountries(result.countries);
        cityMarkers.setCities(result.cities);
        // Broadcast the base partition to the workers so each detail patch stamps its per-cell country at
        // generation (nearest base cell → grown partition). Cloned to every worker; refreshed each result
        // change (which also refires on any dial that re-derives features).
        // sites change only when the base map regenerates — tell the workers so they can skip rebuilding
        // their base KD-tree on a feature-only re-derive (sea level / language / dial change).
        const baseChanged = baseMap.sites !== lastPoolBaseSites;
        lastPoolBaseSites = baseMap.sites;
        deps.broadcastCountrySeeds({
          sites: baseMap.sites,
          countryOf: result.grownCountryOf,
          seaLevel: OCEANS.SEA_LEVEL.value,
          baseChanged,
        });
      }
    }

    // Choropleth — the equirect texture is the FALLBACK: the base globe, the CPU path, and any detail patch
    // whose per-cell country wasn't stamped at generation (the country layer was off when it was built). When
    // the patch DOES carry per-cell country (the common case), the GPU patch prefers it (patchCountry) below.
    const choropleth =
      showCountryColors && result
        ? { map: baseMap, countryOf: result.countryOf, countryColors: result.countryColors, key: `${featureEpoch}` }
        : undefined;
    // Per-cell country for the GPU patch: the patch's OWN gen-stamped countryOf + colour classes + hovered
    // country. Present the instant the mesh exists (no async re-grow, no readback); absent ⇒ equirect tints.
    const patchCountry =
      overlay?.countryOf && result
        ? { countryOf: overlay.countryOf, colors: result.countryColors, hovered: hoveredCountry ?? -1 }
        : undefined;

    // The globe (rung 0) is the base; an overlaid detail patch (if any) sits on top. When a patch is
    // overlaid, the base skips the cells it hides (its cap), so a zoomed-in view doesn't redraw a full
    // globe under the patch.
    renderer.draw(canvas, baseMap, appState.settings, appState.orientation, true, overlay?.cap, choropleth);
    if (overlay) {
      // GPU path ON: the patch is mesh-only (no CPU fields), so the renderer MUST compute its field on
      // the GPU + sample it (no readback). The probe (canDetail) guarantees the shaders compile, so
      // this won't fail; if it ever does, drawDetail returns false and the patch is SKIPPED rather
      // than CPU-drawn as garbage. GPU path OFF: the patch carries CPU fields → the normal CPU draw.
      if (gpuPatches) {
        renderer.drawDetail(canvas, overlay, appState.settings, appState.orientation, patchCountry);
      } else {
        renderer.draw(canvas, overlay, appState.settings, appState.orientation, false, undefined, choropleth);
      }
    }
    // Every overlay below shares ONE projection for this frame (orientation + zoom + the renderer's
    // horizontal offset) — the project + limb cull live in renderer/projection.ts, not in each overlay.
    const proj = currentProjector();

    // Plate-motion arrows: a 2D overlay, drawn only with the plate view on (geometry is sampled in
    // the worker; here we just project it to match the globe). Otherwise wipe it.
    if ((appState.settings.viewPlates ?? false) && baseMap.arrowPositions.length) {
      drawPlateArrows(arrowCanvas, baseMap.arrowPositions, baseMap.arrowDirections, proj);
    } else {
      arrowCanvas.getContext("2d")?.clearRect(0, 0, arrowCanvas.width, arrowCanvas.height);
    }

    // Rivers: routed downhill, drawn under the annotation overlays. Generated WITH the map (rivers-first
    // in the derivations module), so this is a cached lookup — drawing them never moves cities.
    if (showRivers) {
      drawRivers(riverCanvas, derivations.rivers(baseMap), proj);
    } else {
      clear(riverCanvas);
    }

    // 2D / DOM overlays over the globe. Settlement markers update FIRST so their dot positions are known: the
    // declutter pass reserves them, then places the text labels (feature + river names on the canvas,
    // country names in the DOM) so nothing overlaps a dot or another label.
    if (result && showCities) {
      cityMarkers.setVisible(true);
      cityMarkers.update(proj, viewLevel);
    } else {
      cityMarkers.setVisible(false);
    }

    // Assemble every text label into ONE declutter pass. Each is zoom-gated + limb-culled + sized exactly
    // as it'll be drawn, then turned into a screen box; names are globally unique → the stable id. The pass
    // returns the set that fits (drop on collision, highest priority first). Feature + river names share
    // the label canvas, so they're collected together for the draw too.
    ensureMonoAdvance();
    featureItems.length = 0;
    if (showLabels && result) featureItems.push(...result.features);
    if (showRivers) featureItems.push(...derivations.rivers(baseMap).labels);

    textLabels.length = 0;
    const sizeFrac = (cellCount: number): number => Math.min(0.999, cellCount / Math.max(1, baseMap.cellCount));
    const pushCanvasLabel = (item: LabelItem, band: number): void => {
      if (item.minLevel > viewLevel) return;
      const r = proj.project(item.anchor);
      if (!r.front) return;
      const fontPx = featureFontPx(item.extent, proj);
      const halfW = 0.5 * item.name.length * monoAdvance * fontPx;
      textLabels.push({ id: item.name, priority: band * 10 + sizeFrac(item.cellCount), x: r.x, y: r.y, halfW, halfH: 0.5 * fontPx });
    };
    if (showLabels && result) {
      for (const f of result.features) pushCanvasLabel(f, f.kind === "OCEAN" || f.kind === "SEA" ? LABEL_BAND_WATER : LABEL_BAND_OTHER);
    }
    if (showRivers) {
      for (const rl of derivations.rivers(baseMap).labels) pushCanvasLabel(rl, LABEL_BAND_OTHER);
    }
    if (showCountries && result) {
      for (const info of result.countries) {
        const r = proj.project(info.anchor);
        if (!r.front) continue;
        const fontPx = countryFontPx(info.extent, proj);
        const halfW = 0.5 * info.name.length * monoAdvance * fontPx;
        const frac = Math.min(0.999, info.extent / Math.PI); // bigger country wins within the country band
        // A country label may slide off its anchor (the pole of inaccessibility) to dodge an overlap, up to
        // a fraction of its inscribed radius — far enough to dodge, near enough the name stays in-country.
        const moveBudgetPx = LABEL_MOVE_FRACTION * info.insRadius * proj.radius;
        textLabels.push({ id: info.name, priority: LABEL_BAND_COUNTRY * 10 + frac, x: r.x, y: r.y, halfW, halfH: 0.5 * fontPx, moveBudgetPx });
      }
    }

    const dots = cityMarkers.visibleDots;
    for (let i = 0; i < dots.length; i++) {
      const d = dots[i];
      const rect = reserved[i];
      if (rect) { rect.x = d.x; rect.y = d.y; rect.halfW = d.r; rect.halfH = d.r; }
      else reserved[i] = { x: d.x, y: d.y, halfW: d.r, halfH: d.r };
    }
    reserved.length = dots.length;
    const placed = layoutLabels(textLabels, {
      width: canvas.width,
      height: canvas.height,
      gutterPx: LABEL_GUTTER_PX,
      stickyGutterPx: LABEL_STICKY_GUTTER_PX,
      reserved,
      prevPlaced: prevPlacedLabels,
      hysteresisBonus: LABEL_HYSTERESIS,
    });
    prevPlacedLabels = placed;
    const shownLabels = new Set(placed.keys()); // visibility for the canvas labels (which don't move)

    if (featureItems.length) {
      drawFeatureLabels(labelCanvas, featureItems, proj, viewLevel, shownLabels);
    } else clear(labelCanvas);

    if (result && showCountries) {
      drawCountryOverlay(proj);
      countryLabels.setVisible(true);
      countryLabels.update(result.countries, proj, placed);
    } else {
      clear(countryCanvas);
      countryLabels.setVisible(false);
    }
    // The shared popup follows its anchor + closes itself when that anchor leaves view (behind the limb,
    // below its reveal level, or when its layer is off). Driven every frame so a layer toggle dismisses it.
    const popupSrc = infoPopup.source();
    if (popupSrc) {
      const layerVisible = popupSrc === "city" ? showCities : showCountries;
      infoPopup.update(proj, viewLevel, layerVisible);
    }
  }

  // Keep every overlay's bitmap matched to the map canvas, 1:1 — one loop, one truth.
  function resize(width: number, height: number): boolean {
    if (width <= 0 || height <= 0 || (canvas.width === width && canvas.height === height)) return false;
    for (const c of [canvas, arrowCanvas, labelCanvas, countryCanvas, riverCanvas]) {
      c.width = width;
      c.height = height;
    }
    return true;
  }

  return {
    render,
    resize,
    setHoveredCountry: (index) => {
      hoveredCountry = index;
    },
  };
}
