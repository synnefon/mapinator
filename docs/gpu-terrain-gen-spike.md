# Handoff: GPU + choropleth-fidelity follow-ups

| | |
| :---- | :---- |
| Author | Claude (paired with Connor) |
| Status | Work item 1 (GPU spike): **COMPLETE**. Full per-cell field (elevation+mountains, moisture, ice, shade) now ported to GLSL + seeded to MATCH the CPU (validated, RMS ~1e-6); see "Findings". Remaining: render-path integration (no-readback patch shader + LOD wiring). Work item 2 (choropleth re-grow): NOT STARTED — next. |
| Scope | Two independent follow-ups: (1) a spike on moving terrain generation to the GPU; (2) sharpening the country choropleth as you zoom, via border re-grow. |

Two independent work items — do them in either order.

---

# Work item 1: GPU terrain-generation spike

**A spike, not a full port** — de-risk moving terrain field generation from the CPU worker to the GPU.

## Why

Per-frame *rendering* is already on the GPU (the globe cells, hillshade, palette, and now the country
choropleth — a baked equirect texture sampled in the fragment shader). The remaining heavyweight CPU
cost is **map generation**: the per-cell fbm/simplex noise sampled in the worker when building the globe
and every LOD detail patch. At the finest LOD a patch is up to **11M cells**, each running multi-octave
3D noise — this is what makes generation/LOD slow. Moving that field sampling to the GPU is the biggest
remaining performance lever.

**This is a SPIKE.** The goal is a yes/no feasibility verdict + a measured prototype of ONE field on the
GPU — not a finished rewrite. There is a real chance the answer is "no" (see Risks).

## Findings & verdict (SPIKE COMPLETE)

A working prototype computes the **base continental elevation** field on the GPU for an arbitrary set
of cell sites (not a grid), and a benchmark harness measures it against the CPU. Everything below is
measured on real hardware (Apple M5 Pro, Metal via ANGLE, Chrome) unless noted.

**Run it yourself:** `npm run dev`, open **`/gpu-spike`** (e.g. `http://localhost:5173/mapinator/gpu-spike`).
It runs all three probes (worker WebGL2, CPU↔GPU shape match, CPU-vs-GPU speed) and prints this verdict.
`?max=<n>` caps the largest benchmarked cell count for a quick pass.

### 1. Determinism — the gating question

- **Single-device: deterministic.** Same seed + same GPU/driver → **bit-identical** field across runs
  (verified: re-running the GPU on identical inputs gives max diff `0`). highp float reports `2^-23`
  (full IEEE single) on the M5 Pro and on SwiftShader.
- **Cross-device: NOT guaranteed — and this is structural, not tunable.** The simplex noise leans on
  `floor()`/`mod()` of multiply-add expressions to pick lattice cells. GLSL ES lets a compiler **fuse
  or split `a*b+c` (FMA contraction)** and only bounds `/` and friends to a **ULP tolerance** (highp is
  ≥ `2^-16` relative, not strict IEEE), so the same expression rounds *differently on different
  GPUs/drivers*. A sub-ULP wobble that nudges a value across an integer boundary flips the chosen
  lattice cell → a **different gradient → different terrain** for the same seed. So a pure GPU path
  **breaks reproducible/shareable saves** (`src/common/mapFile.ts`) and the "same seed, same map"
  contract across machines. **The CPU must stay the canonical path for anything persisted.**

### 2. Worker WebGL2 — yes

`OffscreenCanvas.getContext("webgl2")` **and** `EXT_color_buffer_float` (needed for float render
targets) are both available **inside the worker** — and the prototype's field shader was compiled and
run there, off the main thread (the probe is end-to-end, not just a context check). Works on the real
GPU and on the SwiftShader software fallback, so a no-GPU/CI environment still functions (slowly).

### 3. Speed — 10–15× for base elevation, but readback dominates

Base continental elevation, GPU vs the real CPU code path (`ElevationCalculator`, mountains off):

| field        | cells | CPU base | GPU upload | GPU render | GPU readback | GPU total | speedup |
| :----------- | ----: | -------: | ---------: | ---------: | -----------: | --------: | ------: |
| globe        | 100 k | 50.7 ms  | 0.5 ms     | ~0 ms      | 4.5 ms       | 5.0 ms    | **10.1×** |
| mid patch    | 1 M   | 465 ms   | 3.2 ms     | ~0 ms      | 32.1 ms      | 35.4 ms   | **13.1×** |
| finest patch | 11 M  | 5011 ms  | 31.7 ms    | ~0 ms      | 301.2 ms     | 332.9 ms  | **15.1×** |

**The headline finding is the shape of the GPU cost, not the multiplier:** the GPU computes 11M cells
of multi-octave noise in **sub-millisecond** time — **~90% of the GPU total is `readPixels`** (moving
176 MB back to the CPU). Upload is ~10%; compute is free. (`render` reads ~0 because ANGLE/Metal defers
the work into the readback sync, so trust the *total* and the *upload*, not the render/readback split.)

Two consequences:
- A naive port — *"compute the field on the GPU, read it back into the existing typed-array pipeline"* —
  is **readback-bound** and caps out around the 15× above.
- The **real** prize is bigger. The full per-cell pipeline (`sampleCell`: elevation + hillshade's two
  extra relief samples + moisture + ice + plate, mountains on) costs **≈1.10 µs/cell** on this CPU →
  **~12.1 s for an 11M patch** (this is what makes LOD slow). All five fields fit in one RGBA32F target
  (one readback for everything), and the GPU compute for them is still ~free — so vs the *full* CPU
  pipeline the win is **~36× even with readback**, and effectively unbounded if the field never leaves
  the GPU.

### 4. Shape match → EXACT match (consistency blocker found, then solved)

The first prototype used a stand-in GLSL simplex (Ashima/McEwan). It produced the *right kind* of
terrain but a different realization — CPU land **52.4%** vs GPU **66.5%** at the same dials. That's a
**blocker for the accelerator path**, not just a cosmetic reroll: a GPU-generated detail patch would
show *different continents* than the CPU-generated globe it nests inside → a visible coastline jump on
zoom. So the throwaway noise was replaced with an **exact GLSL port of `simplex-noise` v4**, seeded by
the **same permutation table** the CPU uses (`buildPermutationTable(makeRNG(seed))` uploaded as `uPerm`).

Result (same seed, M5 Pro): CPU land **52.4%** vs GPU **52.4%** — **Δ 0.00 points**, **RMS 7.7e-6**, max
per-cell diff **3.2e-3**. The GPU reproduces the CPU field up to **float32 rounding** (the CPU runs
float64; a handful of cells within float-epsilon of a simplex-cell boundary flip — sub-pixel, invisible).
A JS twin of the exact algorithm is unit-tested **bit-identical** to the library (`permTable.test.ts`),
so the GLSL port is correct by construction. **A GPU patch now lines up with the CPU globe — no re-tune.**

**Update — the FULL field is now ported, not just base elevation.** Mountains (the Tectonics plate
scan + ridged peaks), moisture, ice, and hillshade are all in GLSL (`terrainShader.ts`), seeded by the
same plate set as the CPU (`plateData.ts`, unit-tested vs `Tectonics`). Measured agreement vs the real
`sampleCell` (M5 Pro): elevation RMS **7.9e-6**, moisture **7.0e-6**, ice **1.4e-6**, shade **2.2e-6**
(all max diffs ≤ 3e-3, land Δ 0.00). Full-field speed: **15× (100k), 23× (1M)** — still readback-bound.
The entire generation pipeline now runs on the GPU and reproduces the CPU.

### 5. Recommended path

**GPU as an opt-in accelerator, CPU as the canonical deterministic path** — *and* architect it to avoid
the readback round-trip:

1. **Keep CPU generation canonical** for the base globe and anything saved/shared (determinism + saves).
2. **Target the DETAIL PATCHES** (the re-derivable, never-persisted, up-to-11M LOD rungs that dominate
   cost and don't feed feature detection — that runs on the base mesh only, see `main.ts`). Per-device
   terrain variation is acceptable there because patches are transient, not saved.
3. **Don't read back.** The large win needs the patch field to *stay on the GPU* as a texture the patch
   fragment shader samples directly — which also means moving `BiomeColor`'s per-cell colour/shade into
   the shader (rendering is already on the GPU). That's the real follow-on; the spike proves the compute
   itself is essentially free, so the work is plumbing (mesh stays CPU) + a shader, not noise research.
4. A **full GPU-only port** (no CPU path) is viable *only* if cross-device per-seed terrain variation is
   acceptable — i.e. if shareable/reproducible saves are dropped or re-specified. (Single-device
   patch↔globe consistency is already solved by the exact-noise port; the open issue is only float32
   variation *across* GPUs, which is invisible while the CPU globe stays canonical.)

### Remaining work to ship the accelerator

Generation is DONE on the GPU and validated. What's left is the live render-path integration:

1. ~~Generate the detail patch's field on the GPU.~~ **DONE** — `GpuField` computes the full RGBA field.
2. Keep the field as a **GPU texture the patch shader samples** (no readback), moving `BiomeColor` into
   the shader via a baked colour LUT (contrasted-elevation × moisture → rgb). Touches `WebGLGlobeRenderer`.
3. Wire into `LodPipeline` with a **CPU fallback** (no WebGL2 / `EXT_color_buffer_float`), keeping the
   CPU canonical for the base globe + saves. Worker builds the patch mesh; main runs the GPU field pass.
4. ~~Port the MOUNTAIN/TECTONIC term to GLSL.~~ **DONE** — `plateData.ts` + the tectonic GLSL match `Tectonics`.

### Files (prototype + harness)

- `src/mapgen/gpu/exactSnoise.glsl.ts` — exact GLSL port of `simplex-noise` v4's `noise3D`, reading the
  seed's table from `uPerm` (reproduces the CPU noise → patches match the globe). Replaced the throwaway Ashima stand-in.
- `src/mapgen/gpu/permTable.ts` (+ `.test.ts`) — builds the seed's perm/gradient texture from the SAME
  `buildPermutationTable(makeRNG(seed))` the CPU uses; the test proves a JS twin is bit-identical to the library.
- `src/mapgen/gpu/terrainShader.ts` — the FULL field in GLSL (`fbm3`/`ridgedFbm3`/`continentalness`/
  `uplift`/`mountainRelief`/`elevationAt`/`moistureAt`/`iceAt`/`hillshadeAt`), mirroring the CPU
  line-for-line, + the sites-texture→render→RGBA(elevation,moisture,ice,shade) program.
- `src/mapgen/gpu/plateData.ts` (+ `.test.ts`) — builds the seed's plate seeds + Euler poles to match
  `Tectonics` (uploaded so the GPU's mountains land where the CPU's do); test pins it to `Tectonics.seeds()`.
- `src/mapgen/gpu/GpuField.ts` — the WebGL2 sampler (upload sites + perm + plates → render → readback the 4 fields).
- `src/mapgen/gpu/cpuField.ts` — the real `ElevationCalculator.sampleCell` computing the same fields (baseline).
- `src/mapgen/gpu/gpuProbeWorker.ts` — the worker WebGL2 probe (Step 1).
- `src/mapgen/gpu/gpuFieldLayout.ts` (+ `.test.ts`) — pure output-texture-dimensions helper (unit-tested).
- `src/gpu-spike.ts` + `gpu-spike.html` — the `/gpu-spike` harness (route added in `vite.config.js`).

> Everything above is self-contained: the live generation pipeline (worker pool, `MapGenerator`,
> `ElevationCalculator`) is still **unchanged** — the GPU field is validated off to the side in the
> harness. The render-path integration (Remaining work #2–#3) is what touches the live code.

## Current architecture (read these first)

Generation runs entirely on the CPU, off the main thread, in a worker:

- `src/mapgen/mapWorker.ts` — worker entry; receives `generate` messages, returns a `GlobeMap`.
- `src/mapgen/WorkerPool.ts` — spawns/round-robins the workers (main thread).
- `src/mapgen/MapGenerator.ts` — `generateMap(settings)`: builds the mesh, then in one pass copies
  geometry into typed arrays and samples every per-cell field via `ElevationCalculator.sampleCell`
  (see ~line 134–200). Holds the seeded `noise3D` (`createNoise3D` from `simplex-noise`).
- `src/mapgen/ElevationCalculator.ts` — **the hot path**: `sampleCell(site)` → `{ elevation, moisture,
  ice, shade, plate }` for a unit-sphere point, via multi-octave noise + the `CONTINENT/OCEAN/COAST/
  MOUNTAIN/MOISTURE/ICE` dials. This is what runs per cell, per map + per patch.
- `src/mapgen/fbm.ts` — the fbm octave stack over `noise3D`.
- `src/mapgen/Tectonics.ts` — plate boundaries + mountain belts (also noise-driven).
- `src/mapgen/Goldberg.ts` — the base hex/pentagon mesh; patches use a stereographic + delaunator mesher.
- `src/common/settings.ts` — the dials; generation reads a resolved `TerrainParams` snapshot (`snapshotParams()`), handed across the worker seam (NOT live dials).

Data flow: main thread resolves dials → `snapshotParams()` → worker `generate` → `MapGenerator` →
`GlobeMap` (typed arrays: `sites`, `ringVerts`, `elevation`, `moisture`, `ice`, `shade`, `plate`, …)
→ posted back → `WebGLGlobeRenderer` uploads to GPU buffers.

**Only the field SAMPLING is the target.** Mesh construction (Goldberg/patch) can stay on the CPU for
the spike — the win is in `sampleCell`'s noise.

## Spike plan (de-risk in this order — stop early if a step fails)

1. **WebGL in the worker.** Confirm `OffscreenCanvas.getContext("webgl2")` works inside the worker the
   pool spawns. If not available (or flaky across target browsers), the GPU path would have to run on
   the main thread (defeating the off-thread benefit) — note that and reconsider.
2. **One field, end to end.** Port the *base continental elevation* fbm only. Mechanism: the cells are
   NOT a grid (Goldberg/patch), so upload the cell `sites` (xyz) as a data texture (or buffer), render a
   quad covering N output texels (one texel per cell), the fragment reads its site + computes fbm +
   writes the elevation, then `readPixels` back into the `elevation` Float32Array. Validate it matches
   the CPU output's *shape* (not necessarily bit-for-bit — see determinism).
3. **Port the noise to GLSL.** `simplex-noise` (JS) has no identical GLSL twin; use a standard GLSL
   simplex/​value-noise and the same octave/lacunarity/gain dials. Accept that **terrain will change**
   (existing seeds + saved maps will look different — a one-time reroll). Confirm the result still looks
   good across a few seeds.
4. **Measure.** Generation time CPU vs GPU for the globe and a mid + finest patch; readback cost; highp
   precision. Produce a clear speedup number.

## Risks / gotchas (read before estimating)

- **Cross-device determinism — the big one.** The CPU path is deterministic on every machine (same seed
  → same map, shareable saves in `src/common/mapFile.ts`). GPU float precision varies by driver/GPU, so
  GLSL noise may yield **different terrain on different devices for the same seed**. That breaks
  reproducible/shareable maps. Options to weigh: (a) accept per-device variation; (b) keep CPU gen as
  the canonical/deterministic path and use the GPU only as an opt-in accelerator with a CPU fallback;
  (c) abandon if determinism is required. **The spike must reach a verdict on this.**
- **Terrain reroll.** Even single-device, GLSL noise ≠ JS simplex → all existing seeds/saved maps change
  appearance. Confirm that's acceptable with Connor before committing to a full port.
- **Readback stalls.** `readPixels` is synchronous; large fields (millions of cells) are heavy. It's in
  the worker (off main thread) so tolerable, but measure. Consider PBOs / async readback.
- **LOD coupling.** Generation feeds the LOD ladder (`src/renderer/LodPipeline.ts`); patches come at many
  resolutions + arbitrary cap centers. The GPU path must handle arbitrary cell counts/regions, not just
  the globe.
- **Mesh stays CPU.** Goldberg/patch meshing isn't the target; don't get pulled into porting it.

## Acceptance criteria (spike done when…) — ALL MET (see "Findings & verdict")

- ✓ A documented yes/no on (1) worker WebGL (**yes**) and (2) cross-device determinism (**no**).
- ✓ A working prototype of the base elevation field computed on the GPU, with a measured speedup vs CPU
  for the globe + one finest patch (**10.1× globe, 15.1× finest** base-elevation; readback-dominated).
- ✓ A short writeup: recommended path (**GPU-accelerator-with-CPU-fallback, no readback**), with the
  determinism verdict front and center.

---

# Work item 2: zoom-scaling choropleth fidelity (border re-grow)

Independent of work item 1. Sharpens the country choropleth (#3, already shipped) as you zoom.

## Problem

Country assignment is defined on the BASE mesh (~100k cells at resolution 1 → ~71 km borders;
`globePointCount(1)` in `src/mapgen/MapGenerator.ts`). The choropleth bakes "nearest base cell's country"
into an equirect texture (`src/renderer/countryTexture.ts`) which the globe + patch shaders sample. That
texture (~39 km/texel) already OVER-samples the 71 km borders, so raising texture resolution does
nothing — the blockiness you see at deep zoom IS the 71 km base-cell border, against sub-km patch terrain.
Genuinely sharper borders need a finer country DEFINITION where you're looking.

## Insight (Connor): only the EDGES need to re-grow

A country's interior is uniformly that country — no fidelity problem there. Only cells on a country's
EDGE need fine reclassification: a base cell touching either **another country** (a land border) **or
water** (the coastline). That's a thin band — a small fraction of cells — so refining just it is cheap.
No need to re-grow the whole (up to 11M-cell) patch. (The coastline matters as much as land borders: at
deep zoom the tint's edge against the dark sea is just as blocky as a country-vs-country boundary.)

## Approach

For an active detail patch (or any finer mesh in view):

1. **Find the edge band.** On the base mesh, mark every cell adjacent (in the cell graph) to a different
   country **or to water** — the country/coast frontier (both the choropleth's land-land borders AND its
   coastlines). The band = patch cells within a few base-cell-widths of that frontier; every other patch
   cell keeps its base country (cheap, unchanged — exactly today's texture). At the coast, use the
   PATCH's own (finer) elevation for land/water, so the tint's shoreline sharpens with the terrain.
2. **Seed from the base.** The base cells just OUTSIDE the band are fixed anchors carrying their
   countries (from the global assignment).
3. **Re-grow locally.** Run the SAME region-grow as `assignCountries` (multi-source Dijkstra over the
   patch cell graph, same `WATER_COST` + domain-warp step cost — see `src/mapgen/features/countries.ts`)
   but only through the band's fine patch cells, seeded by the surrounding base countries. Each band cell
   gets a country at PATCH resolution → a crisp border consistent with the coarse one outside the band.
4. **Feed the render.** The patch now has a fine `countryOf` in the band. Either (a) bake a LOCAL
   high-res country texture for the patch's cap (stereographic/gnomonic on the cap centre → no equirect
   seam) that the patch shader samples instead of the global equirect, or (b) tint the patch per-cell
   from its fine `countryOf`. Either sharpens the border as you zoom.

## Why it's tractable

The band is O(border length × band width), not O(patch cells). Borders are short relative to area, so
even an 11M-cell patch has a band of maybe tens of thousands of cells → a small, fast local Dijkstra.

## Risks / gotchas

- **Seam with the base.** Seed from the correct surrounding base countries and make the band wide enough
  that the re-grown border settles before the band edge, or the boundary will visibly jump where fine
  meets coarse.
- **Cost rule must match exactly.** Reuse `assignCountries`' step cost (`WATER_COST`, the warp) or the
  fine border won't track the coarse one.
- **Per-patch latency.** Runs per patch (on recenter/zoom). Keep it band-only and ideally in the worker
  (where patches are generated, off the main thread) — which means passing the country data into patch
  generation.
- **Determinism.** Same seed + view → same border (seeded, deterministic Dijkstra).
- **Reuse the kd-tree** in `countryTexture.ts` (direction → nearest base cell) to seed the band.

## Acceptance

Zooming into a country border shows the boundary sharpen with the terrain (not a fixed ~71 km stairstep),
consistent with the whole-globe borders, at no per-frame cost and bounded per-patch work.

---

## Not in scope (both work items)

- **#1 (hover highlight / country borders on the GPU)** was considered and **dropped**: the hover
  highlight is one country's cells only while hovering, borders are a bounded segment list — neither is
  slow, and moving hover to the GPU would force a palette recompute per hover (a hitch). Skip unless a
  real border-perf problem shows up.
- **#3 (choropleth) is DONE at base-cell resolution** — a baked equirect country texture
  (`src/renderer/countryTexture.ts`) sampled by world-direction in `WebGLGlobeRenderer`'s fragment shader
  tints the globe + detail patches at any zoom with zero per-frame cost. **Work item 2 above** is the
  follow-up that sharpens it on zoom.
