import type { Vec3 } from "../common/3DMath";
import type { TerrainParams } from "../common/settings";
import { MapGenerator } from "./MapGenerator";

// Requests from the main thread. `config` carries the seed and/or the resolved generation params
// (TerrainParams); it must precede the first generate (postMessage ordering guarantees it lands
// first), and is re-sent whenever the seed, the dials, or the feature switches change. The worker no
// longer replays applyTuning in its own realm — params arrive already resolved on the main thread.
// `generate` builds ONE LOD rung — the globe (halfAngle ≥ π) and every detail cap share it.
type WorkerRequest =
  | { id: number; kind: "config"; seed?: string; params?: TerrainParams }
  | {
      id: number;
      kind: "generate";
      center: Vec3;
      halfAngle: number;
      points: number;
      geometryOnly?: boolean; // mesh only (no per-cell field sampling) — the GPU computes fields
    };

// `self` is typed as Window under the DOM lib; cast to Worker for the dedicated-
// worker postMessage(message, transfer) overload used for the zero-copy hand-off.
const ctx = self as unknown as Worker;

let gen: MapGenerator | null = null;
let seed: string | null = null; // remembered so a params-only config can rebuild at the same seed
let params: TerrainParams | null = null; // remembered so a seed-only config keeps the current dials

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === "config") {
    if (req.seed !== undefined) seed = req.seed;
    if (req.params !== undefined) params = req.params;
    // Build (first time) or re-point the generator once both seed and params are known. The mesh
    // cache lives on the generator instance, so configure() keeps it across seed / param changes.
    if (seed !== null && params !== null) {
      if (gen) gen.configure(seed, params);
      else gen = new MapGenerator(seed, params);
    }
    return;
  }
  if (!gen) return; // a generate arrived before any config — shouldn't happen

  const map = gen.generate(req.center, req.halfAngle, req.points, undefined, req.geometryOnly);

  // The typed arrays are freshly built per call, so transfer their buffers
  // zero-copy — the worker keeps no reference once posted.
  const transfer = [
    map.sites.buffer,
    map.ringOffsets.buffer,
    map.ringVerts.buffer,
    map.elevation.buffer,
    map.reportElevation.buffer,
    map.moisture.buffer,
    map.ice.buffer,
    map.shade.buffer,
    map.plate.buffer,
    // arrowPositions/arrowDirections are intentionally NOT transferred — they're memoized per seed
    // and shared across rungs, so they're structured-cloned (small) to keep the cache valid.
  ] as Transferable[];
  ctx.postMessage({ id: req.id, map }, transfer);
};
