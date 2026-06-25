import { describe, expect, it } from "vitest";
import { Quat } from "../common/3DMath";
import type { GlobeMap } from "../common/map";
import { LOD, MAP_DEFAULTS } from "../common/settings";
import { globePointCount } from "../mapgen/MapGenerator";
import {
  buildLodLevels,
  createLodPipeline,
  type GenRequest,
  type LodView,
} from "./LodPipeline";

const BASE_VIEW: Omit<LodView, "zoom"> = {
  orientation: Quat.identity,
  resolution: 0.5,
  width: 800,
  height: 600,
};

// Drives a pipeline with a fake worker: postGenerate records each request and returns a promise we
// resolve by hand (so we can observe "one job at a time" and test the staleness discard). Detail
// rungs come back with a cap centred on the request that comfortably covers the view; the globe
// (halfAngle ≥ π) has no cap. Only `.cap` is read by the pipeline, so the rest is a stub.
function harness(view: LodView, opts?: { detailGeometryOnly?: boolean }) {
  const requests: GenRequest[] = [];
  const resolvers: Array<() => void> = [];
  let renders = 0;
  const postGenerate = (req: GenRequest): Promise<GlobeMap> => {
    requests.push({ ...req });
    return new Promise<GlobeMap>((res) => {
      const cap =
        req.halfAngle >= Math.PI
          ? undefined
          : { center: req.center, cosKeep: Math.cos(req.halfAngle) };
      resolvers.push(() => res({ cap } as unknown as GlobeMap));
    });
  };
  const pipeline = createLodPipeline({
    postGenerate,
    getView: () => view,
    onReady: () => {
      renders++;
    },
    detailGeometryOnly: opts?.detailGeometryOnly,
  });
  const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // flush the .then microtask chain
  const drainOne = async () => {
    resolvers.shift()?.();
    await tick();
  };
  const drain = async () => {
    while (resolvers.length) await drainOne();
  };
  return { pipeline, requests, drain, drainOne, renders: () => renders };
}

describe("buildLodLevels", () => {
  it("rung 0 is the whole globe; patches ascend in density and activation zoom", () => {
    const levels = buildLodLevels();
    expect(levels.length).toBeGreaterThan(1);
    expect(levels[0]).toStrictEqual({
      aboveZoom: 0,
      points: globePointCount(MAP_DEFAULTS.resolution),
    });
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].points).toBeGreaterThan(levels[i - 1].points); // denser
      expect(levels[i].aboveZoom).toBeGreaterThanOrEqual(levels[i - 1].aboveZoom); // later
    }
  });
});

describe("LodPipeline.view", () => {
  it("is the whole globe at zoom 0 — full sphere, resolution density", () => {
    const { pipeline } = harness({ ...BASE_VIEW, zoom: 0 });
    const v = pipeline.view();
    expect(v.level).toBe(0);
    expect(v.halfAngle).toBe(Math.PI);
    expect(v.points).toBe(globePointCount(BASE_VIEW.resolution));
  });

  it("reaches the finest rung at zoom 1", () => {
    const finest = buildLodLevels().length - 1;
    const { pipeline } = harness({ ...BASE_VIEW, zoom: 1 });
    expect(pipeline.view().level).toBe(finest);
  });
});

describe("LodPipeline.sync", () => {
  it("queues rungs coarse→fine, ONE worker job at a time (globe first)", async () => {
    const h = harness({ ...BASE_VIEW, zoom: 1 });
    h.pipeline.sync();
    // one at a time: only the coarsest (globe) job is in flight after sync
    expect(h.requests.length).toBe(1);
    expect(h.requests[0].halfAngle).toBe(Math.PI);

    await h.drain();
    // every rung from the globe up to the current level got built, in ascending density
    expect(h.requests.length).toBe(buildLodLevels().length);
    const pts = h.requests.map((r) => r.points);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeGreaterThan(pts[i - 1]);
    expect(h.pipeline.base()).not.toBe(null); // globe became the sticky base
    expect(h.pipeline.overlay()).not.toBe(null); // a covering detail patch is shown
  });

  it("re-syncing an unchanged view regenerates nothing (stable keys + coverage)", async () => {
    const h = harness({ ...BASE_VIEW, zoom: 1 });
    h.pipeline.sync();
    await h.drain();
    const built = h.requests.length;
    h.pipeline.sync();
    await h.drain();
    expect(h.requests.length).toBe(built); // all rungs already cover the view → no new jobs
  });
});

describe("LodPipeline cache", () => {
  it("evicts at the cap (keeping the live globe)", async () => {
    const view: LodView = { ...BASE_VIEW, zoom: 0, resolution: 0 };
    const h = harness(view);
    // 25 distinct resolutions → 25 distinct globe (rung-0) keys, each cached then trimmed by LRU.
    for (let i = 1; i <= 25; i++) {
      view.resolution = i / 26;
      h.pipeline.sync();
      await h.drain();
    }
    expect(h.pipeline.cachedKeys().length).toBeLessThanOrEqual(18); // LOD_CACHE_CAP
    expect(h.pipeline.cachedKeys().length).toBeGreaterThan(0);
  });
});

describe("LodPipeline fine whole-globe overlay (GPU path)", () => {
  it("at zoom 0, builds a mesh-only fine whole-globe overlay and shows it", async () => {
    const h = harness({ ...BASE_VIEW, zoom: 0 }, { detailGeometryOnly: true });
    expect(h.pipeline.overlay()).toBe(null); // nothing built yet

    h.pipeline.sync();
    // Requested out-of-band of the rung queue: a whole-globe (halfAngle ≥ π), MESH-ONLY rung at the
    // overlay density — distinct from the coarse base, which is whole-globe but fully sampled.
    const fine = h.requests.find((r) => r.halfAngle >= Math.PI && r.geometryOnly === true);
    expect(fine).toBeDefined();
    expect(fine?.points).toBe(LOD.GLOBE_OVERLAY_POINTS);

    await h.drain();
    expect(h.pipeline.overlay()).not.toBe(null); // shown at the zoomed-OUT view
  });

  it("is NOT built when the GPU path is off — the coarse base shows, as before", async () => {
    const h = harness({ ...BASE_VIEW, zoom: 0 }); // detailGeometryOnly defaults off
    h.pipeline.sync();
    await h.drain();
    expect(h.requests.some((r) => r.geometryOnly === true)).toBe(false);
    expect(h.pipeline.overlay()).toBe(null);
  });
});

describe("LodPipeline.reset", () => {
  it("discards an in-flight result generated before the reset (stale epoch)", async () => {
    const h = harness({ ...BASE_VIEW, zoom: 0 });
    h.pipeline.sync(); // requests the globe (deferred — not resolved yet)
    expect(h.requests.length).toBe(1);
    expect(h.pipeline.base()).toBe(null);

    h.pipeline.reset(); // bumps the staleness epoch
    await h.drainOne(); // the pre-reset globe finally lands…
    expect(h.pipeline.base()).toBe(null); // …and is dropped, not adopted as the base
  });
});
