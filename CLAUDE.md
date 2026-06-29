# Mapinator — agent instructions

## Heavy computation goes through the established async/offloaded patterns — never block the main thread

When a feature needs something **computationally expensive** (per-patch, per-zoom, or whole-map work
that takes more than a frame), handle it the same way the rest of the system already handles heavy
work. Do **not** reach for ad-hoc main-thread workarounds (debounced timers, "compute on rest",
synchronous per-frame recompute, lowering a quality cap to hide cost). Those are smells — replace them
with one of the real patterns:

- **Worker pool** — terrain generation runs off-thread in `mapWorker.ts` via `WorkerPool`, orchestrated
  by `renderer/LodPipeline.ts` (coarse→fine, cached, sticky overlay, epoch-invalidated). Per-patch /
  per-map heavy CPU work belongs here, delivered async and rendered when it lands (`onReady`). Mesh
  buffers move zero-copy via Transferables — push the work to where the data already is, don't ship big
  meshes back and forth.
- **GPU compute + readback** — the noise field is computed on the GPU (`mapgen/gpu/GpuField.ts`,
  `terrainShader.ts`). For the render hot path use the no-readback texture (`renderToTexture`); when the
  CPU needs the values, read them back once and cache (`compute`, `computeRiverField`,
  `computePatchElevation`). Prefer reusing the field the GPU already computed over re-sampling on the CPU.
- **Compute-once + refine-on-zoom for vector features** — rivers (and borders) compute a coarse network
  once, then fractally subdivide the sphere polylines at zoom via the shared `refineSphereCurve`
  primitive. Detail-on-demand without recomputing.
- **Cache + signature-invalidate** — derived results are cached and invalidated by a signature/epoch
  key, not by hand-written deletes (`mapDerivations.ts`: caches key on the base map + sea level +
  language + river network). Add new derivations the same way.

Rule of thumb: if the work is too heavy to run synchronously every frame, it goes off-thread (worker)
or on-GPU (readback) and is cached — matching the existing machinery — rather than being timed,
throttled, or capped on the main thread.
