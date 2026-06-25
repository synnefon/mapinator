import { Quat, type Vec3 } from "../common/3DMath";
import type { GlobeMap } from "../common/map";
import { LOD, MAP_DEFAULTS } from "../common/settings";
import { globePointCount } from "../mapgen/MapGenerator";
import { globeRadiusPx } from "./GlobeRenderer";

// Level-of-detail ladder + pipeline, lifted out of main.ts's closure so the math (ladder shape,
// view→rung, cap coverage, cache/queue) is testable without a DOM, a worker, or a canvas. main.ts
// wires the three side-effecting dependencies (worker generate, current view, re-render) and keeps
// the worker/render code; everything below is the same logic in a new home.

const {
  RECENTER_FRACTION,
  FINEST_PATCH_POINTS,
  COARSEST_PATCH_POINTS,
  DENSITY_STEP_RATIO,
  DETAIL_BIAS,
  PATCH_PRELOAD_MARGIN,
  GLOBE_OVERLAY_POINTS,
} = LOD;
// The global mesh is the curve's zoom-0 anchor (rung 0).
const GLOBAL_POINTS = globePointCount(MAP_DEFAULTS.resolution);

const LOD_CACHE_CAP = 18; // ~16 patch slots + the live globe(s); finest patches are large, LRU trims
// The overlay must cover the view; a rung is (re)queued once nothing covers this much MORE
// than the view, so a replacement is built before the current patch's margin runs out (>1).
const PATCH_COMFORT = 1.2;

export type LodLevel = {
  aboveZoom: number; // activate this rung once zoom ≥ this (0..1)
  points: number;
};

/** LOD ladder, coarsest → finest. Rung 0 is the whole globe; rungs ≥1 are detail caps sampled
 *  from the geometric density-vs-zoom curve. */
export function buildLodLevels(): LodLevel[] {
  const points: number[] = [];
  for (let p = FINEST_PATCH_POINTS; p >= COARSEST_PATCH_POINTS; p /= DENSITY_STEP_RATIO) {
    points.unshift(p);
  }
  // Geometric curve: global density at zoom 0 → FINEST_PATCH_POINTS at zoom 1. A rung of density p
  // sits at t = ln(p/global)/ln(max/global). We shift each trigger half a rung earlier so a
  // level is active around the zoom it best fits (and the finest gets a band, not just zoom 1).
  const span = Math.log(FINEST_PATCH_POINTS / GLOBAL_POINTS);
  const halfRung = (0.5 * Math.log(DENSITY_STEP_RATIO)) / span;
  const patches = points.map((p) => {
    const t = Math.log(p / GLOBAL_POINTS) / span; // 0..1 along the curve (1 at MAX)
    // DETAIL_BIAS > 1 pulls denser detail to lower zoom (earlier).
    const aboveZoom = Math.pow(Math.max(0, Math.min(1, t - halfRung)), DETAIL_BIAS);
    return {
      points: p,
      aboveZoom: parseFloat(aboveZoom.toFixed(4)),
    };
  });
  // Rung 0 = the whole globe: active from zoom 0. Its `points` here is just the curve anchor; rung
  // 0's REAL density follows the resolution slider live (see rungSpec).
  const globe: LodLevel = { aboveZoom: 0, points: GLOBAL_POINTS };
  return [globe, ...patches];
}

/** A worker generate request — one LOD rung. Built by the pipeline, posted by main.ts. */
export type GenRequest = {
  kind: "generate";
  center: Vec3;
  halfAngle: number; // ≥ π ⇒ the whole globe (rung 0); smaller ⇒ a detail cap
  points: number;
  geometryOnly?: boolean; // detail rungs only, GPU path: mesh without per-cell fields (GPU samples them)
};

/** The current view's LOD rung, derived from zoom + orientation. level 0 = whole globe. */
export type View = {
  level: number;
  center: Vec3;
  halfAngle: number;
  points: number;
};

/** Dynamic inputs the pipeline samples each operation. Plain data (no DOM) so it's testable:
 *  zoom + orientation drive the rung/centre, resolution sizes rung 0, width/height size the caps. */
export type LodView = {
  zoom: number;
  orientation: Quat;
  resolution: number;
  width: number;
  height: number;
};

export type LodDeps = {
  /** Enqueue a worker generate job; resolves with the built map. (main.ts → worker pool) */
  postGenerate: (req: GenRequest) => Promise<GlobeMap>;
  /** The live view (zoom, orientation, resolution, canvas size). */
  getView: () => LodView;
  /** Called whenever the base/overlay maps change, so the caller re-renders. */
  onReady: () => void;
  /** Max generate jobs in flight at once — the worker-pool size. Defaults to 1 (serial). */
  maxInFlight?: number;
  /** GPU path: when true, detail rungs (level ≥1) are generated mesh-only (no CPU field sampling) and
   *  the renderer computes their fields on the GPU. The globe (rung 0) is always full. Default false. */
  detailGeometryOnly?: boolean;
};

export type LodPipeline = {
  /** The current view's rung (level 0 = whole globe). */
  view: () => View;
  /** The globe (rung 0) — always drawn underneath. */
  base: () => GlobeMap | null;
  /** The finest cached detail patch covering the view, or null at whole-globe. */
  overlay: () => GlobeMap | null;
  /** Keep the queue/overlay in sync with the current view and pump generation. */
  sync: () => void;
  /** Discard cached maps + in-flight results (seed/tuning change). Bumps the staleness epoch. */
  reset: () => void;
  /** Cached rung keys, oldest→newest (LRU order). Read-only introspection for debugging/tests. */
  cachedKeys: () => string[];
};

export function createLodPipeline(deps: LodDeps): LodPipeline {
  const { postGenerate, getView, onReady } = deps;
  const maxInFlight = Math.max(1, deps.maxInFlight ?? 1); // worker-pool size; 1 = serial (default)
  const detailGeometryOnly = deps.detailGeometryOnly ?? false;
  const LOD_LEVELS: LodLevel[] = buildLodLevels();

  // Bumped on every seed/tuning change; results tagged with a stale epoch are dropped so an
  // in-flight build from the previous seed can't repopulate the cache.
  let seedEpoch = 0;
  // `baseMap` is the globe (rung 0) — always drawn underneath, since it's the only rung that covers
  // the whole view (so a fast pan never blanks). It's STICKY: it swaps only when a fresh rung-0
  // lands. `overlay` is the finest CACHED detail rung whose cap still covers the view; also sticky.
  let baseMap: GlobeMap | null = null;
  let overlay: GlobeMap | null = null;
  let overlayLevel = 0; // level of the patch currently shown (0 = none; for switch hysteresis)
  // Fine WHOLE-GLOBE GPU overlay shown at the zoomed-OUT view (level 0): a finer-than-base hex mesh
  // over the whole sphere, generated mesh-only (the renderer computes its field on the GPU), so its
  // coastline matches the detail patches instead of the coarse base hexes ("connectivity reverses on
  // zoom"). Its geometry is seed- AND orientation-independent, so it's built ONCE and KEPT across
  // reset() — the renderer re-samples the current field at draw. Null until built, or whenever the
  // GPU path is off (then the coarse base shows, exactly as before).
  let fineGlobe: GlobeMap | null = null;
  let fineGlobeKey: string | null = null;
  let fineGlobeInFlight = false;
  const lodCache = new Map<string, GlobeMap>(); // "level|…" → rung map (LRU by insertion)
  let lodQueue: { key: string; level: number; center: Vec3 }[] = []; // missing rungs, coarse→fine
  const lodActive = new Set<string>(); // rung keys currently in flight (≤ maxInFlight at once)

  // Orthographic globe radius (px) at a zoom — globeRadiusPx only reads width/height, so a plain
  // {width,height} stands in for the canvas (keeps the pipeline DOM-free + testable).
  const radiusPx = (v: LodView, zoom: number): number =>
    globeRadiusPx({ width: v.width, height: v.height } as HTMLCanvasElement, zoom);

  // Generation spec for a rung at a centre. Rung 0 (the globe) is the ONE place its "globe-ness"
  // lives: it spans the whole sphere (halfAngle π → full mesh in the worker) and takes its density
  // from the resolution slider. Detail rungs read the ladder.
  function rungSpec(v: LodView, level: number, center: Vec3): View {
    if (level === 0) {
      return {
        level,
        center,
        halfAngle: Math.PI,
        points: globePointCount(v.resolution),
      };
    }
    const lv = LOD_LEVELS[level];
    return { level, center, halfAngle: levelCap(v, level), points: lv.points };
  }

  function currentView(v: LodView): View {
    let level = 0; // whole globe until a finer rung's activation zoom is reached
    for (let i = 0; i < LOD_LEVELS.length; i++) {
      if (v.zoom >= LOD_LEVELS[i].aboveZoom) level = i;
    }
    return rungSpec(v, level, Quat.viewCenter(v.orientation));
  }

  // Cap (angular radius, radians) covering the view at a rung's activation zoom, + preload margin.
  function levelCap(v: LodView, level: number): number {
    const r = radiusPx(v, LOD_LEVELS[level].aboveZoom);
    return Math.asin(Math.min(1, (0.5 * Math.hypot(v.width, v.height)) / r)) * PATCH_PRELOAD_MARGIN;
  }

  // Rung 0 (the globe) is center-INDEPENDENT, so it's keyed only by its resolution density:
  // generated once per resolution and reused at every orientation.
  const rung0Key = (v: LodView): string => `0|${globePointCount(v.resolution)}`;

  // Cache key for a rung's map at a centre. Detail rungs bucket by the rung's own cap so small pans
  // reuse the same patch; coarse rungs get bigger buckets (more pan-stable), fine rungs finer ones.
  function bucketKey(v: LodView, level: number, center: Vec3): string {
    if (level === 0) return rung0Key(v);
    const step = levelCap(v, level) * RECENTER_FRACTION;
    const q = (n: number) => Math.round(n / step);
    return `${level}|${q(center.x)}|${q(center.y)}|${q(center.z)}`;
  }

  function cacheLod(v: LodView, key: string, map: GlobeMap): void {
    lodCache.set(key, map);
    const keep = rung0Key(v); // never evict the globe we're currently using as the base
    while (lodCache.size > LOD_CACHE_CAP) {
      let victim: string | undefined;
      for (const k of lodCache.keys()) {
        if (k !== keep) {
          victim = k; // oldest non-base entry (insertion order = LRU)
          break;
        }
      }
      if (victim === undefined) break;
      lodCache.delete(victim);
    }
  }

  const levelOf = (key: string): number => Number(key.slice(0, key.indexOf("|")));

  // On-screen angular radius (radians) of the current view — no preload margin. A patch must cover
  // at least this much around the centre to be usable.
  function viewExtentRadius(v: LodView): number {
    const r = radiusPx(v, v.zoom);
    return Math.asin(Math.min(1, (0.5 * Math.hypot(v.width, v.height)) / r));
  }

  // Does a patch's cap fully contain the view disk (radius `vr`) around `center`?
  function capCovers(cap: { center: Vec3; cosKeep: number }, center: Vec3, vr: number): boolean {
    const d = cap.center.x * center.x + cap.center.y * center.y + cap.center.z * center.z;
    const dist = Math.acos(Math.max(-1, Math.min(1, d))); // angle centre→cap centre
    const capRadius = Math.acos(Math.max(-1, Math.min(1, cap.cosKeep)));
    return dist + vr <= capRadius;
  }

  // Build the fine whole-globe overlay once (GPU path only — it's GPU-rendered). Keyed by its own
  // density, so it rebuilds only if GLOBE_OVERLAY_POINTS changes; its geometry is seed/param-
  // independent, so it survives reset() (no "blink to coarse" on a dial tweak — the renderer just
  // samples the new field at draw). Dispatched out-of-band of the rung queue; the worker pool queues
  // it behind the rungs already in flight, so the coarse base still lands first.
  function ensureFineGlobe(): void {
    if (!detailGeometryOnly) return; // GPU path off → fall back to the coarse base (prior behaviour)
    const key = `fine|${GLOBE_OVERLAY_POINTS}`;
    if (fineGlobeKey === key || fineGlobeInFlight) return;
    fineGlobeInFlight = true;
    postGenerate({
      kind: "generate",
      center: { x: 0, y: 0, z: 1 }, // ignored — a whole-globe mesh has no centre
      halfAngle: Math.PI,
      points: GLOBE_OVERLAY_POINTS,
      geometryOnly: true,
    }).then((map) => {
      fineGlobeInFlight = false;
      fineGlobe = map;
      fineGlobeKey = key;
      refreshOverlay(getView()); // show it immediately if we're at the zoomed-out view
      onReady();
    });
  }

  // Sticky overlay: show the finest CACHED detail patch (level ≥1, ≤ target, ANY bucket) whose cap
  // still covers the view. If nothing covers yet, keep the previous patch rather than blanking.
  function refreshOverlay(v: LodView): void {
    const t = currentView(v);
    if (t.level === 0) {
      // Zoomed all the way out: draw the fine whole-globe overlay so the coastline matches the detail
      // patches. Null (GPU off / not built yet) falls back to the coarse base, the prior behaviour.
      overlay = fineGlobe;
      overlayLevel = 0;
      return;
    }
    const vr = viewExtentRadius(v);
    let best: GlobeMap | null = null;
    let bestKey = "";
    let bestLevel = 0;
    for (const [key, patch] of lodCache) {
      const level = levelOf(key);
      if (level < 1 || level > t.level || level <= bestLevel || !patch.cap) continue;
      if (capCovers(patch.cap, t.center, vr)) {
        best = patch;
        bestKey = key;
        bestLevel = level;
      }
    }
    // Hysteresis: if the patch we're already showing still covers and nothing STRICTLY finer is
    // available, keep it (else we'd swap between equally-good overlapping patches every frame).
    const currentCovers = !!overlay?.cap && capCovers(overlay.cap, t.center, vr);
    if (currentCovers && bestLevel <= overlayLevel) return;
    if (best) {
      overlay = best;
      overlayLevel = bestLevel;
      lodCache.delete(bestKey); // LRU touch: keep the shown patch from being evicted
      lodCache.set(bestKey, best);
    }
  }

  // Keep the generation queue in sync with the view: a rung needs (re)generating only when NO
  // cached map at that level still covers the view. Uncovered rungs are queued coarse→fine.
  function syncLod(v: LodView): void {
    const t = currentView(v);
    // Queue against a slightly LARGER disk than the view (PATCH_COMFORT), so a replacement starts
    // generating before the current patch's margin is exhausted. The display test (refreshOverlay)
    // uses the true view, so the current patch keeps showing.
    const queueRadius = viewExtentRadius(v) * PATCH_COMFORT;
    const covered = new Set<number>();
    // Rung 0 (the globe) is "covered" once its map for the current resolution exists.
    if (lodCache.has(rung0Key(v))) covered.add(0);
    for (const [key, patch] of lodCache) {
      const level = levelOf(key);
      if (level >= 1 && patch.cap && capCovers(patch.cap, t.center, queueRadius)) {
        covered.add(level);
      }
    }
    lodQueue = [];
    for (let l = 0; l <= t.level; l++) {
      const key = bucketKey(v, l, t.center);
      if (!covered.has(l) && !lodActive.has(key)) {
        lodQueue.push({ key, level: l, center: t.center });
      }
    }
    refreshOverlay(v);
    pumpLod();
  }

  // Generate queued rungs — up to maxInFlight worker jobs at once (the pool size) — caching +
  // rendering each as it lands, then pumping the next. Rung 0 becomes the sticky base; ≥1 upgrade the
  // overlay. Coarse→fine: on a fresh view the globe and first caps dispatch together, then refine.
  function pumpLod(): void {
    while (lodActive.size < maxInFlight) {
      const job = lodQueue.shift();
      if (!job) return; // queue drained
      if (lodCache.has(job.key)) continue; // cached in the meantime → skip to the next
      lodActive.add(job.key);
      const epoch = seedEpoch;
      const v = getView();
      const spec = rungSpec(v, job.level, job.center);
      postGenerate({
        kind: "generate",
        center: spec.center,
        halfAngle: spec.halfAngle,
        points: spec.points,
        geometryOnly: job.level >= 1 && detailGeometryOnly,
      }).then((map) => {
        lodActive.delete(job.key);
        if (epoch === seedEpoch) {
          cacheLod(getView(), job.key, map);
          if (job.level === 0) {
            baseMap = map; // sticky base: swaps only when a fresh globe lands → never blanks
          } else {
            refreshOverlay(getView()); // a new patch landed → upgrade the overlay if it's finest covering
          }
          onReady();
        }
        pumpLod(); // a worker freed → dispatch the next queued rung
      });
    }
  }

  return {
    view: () => currentView(getView()),
    base: () => baseMap,
    overlay: () => overlay,
    sync: () => {
      syncLod(getView());
      ensureFineGlobe(); // after syncLod so the coarse base (rung 0) takes worker priority
      onReady();
    },
    reset: () => {
      seedEpoch++; // discards any in-flight results from the previous seed/tuning
      lodCache.clear();
      baseMap = null;
      overlay = null;
      overlayLevel = 0;
      lodQueue = [];
      // Clear in-flight tracking so the new seed dispatches immediately; any pre-reset results still
      // land but are dropped by the seedEpoch bump above (and re-cached harmlessly if re-requested).
      lodActive.clear();
    },
    cachedKeys: () => [...lodCache.keys()],
  };
}
