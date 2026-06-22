import type { Vec3 } from "../common/vec3";
import type { MapSettings } from "../common/settings";
import { MapGenerator } from "./MapGenerator";

// Requests from the main thread. `reSeed` must precede the first generate (and is
// re-sent on every seed change); postMessage ordering guarantees it lands first.
type WorkerRequest =
  | { id: number; kind: "reSeed"; seed: string }
  | { id: number; kind: "global"; settings: MapSettings }
  | {
      id: number;
      kind: "local";
      center: Vec3;
      halfAngle: number;
      points: number;
      extraOctaves: number;
    };

// `self` is typed as Window under the DOM lib; cast to Worker for the dedicated-
// worker postMessage(message, transfer) overload used for the zero-copy hand-off.
const ctx = self as unknown as Worker;

let gen: MapGenerator | null = null;

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.kind === "reSeed") {
    if (gen) {
      gen.reSeed(req.seed);
    } else {
      gen = new MapGenerator(req.seed);
    }
    return;
  }
  if (!gen) return; // a generate arrived before any reSeed — shouldn't happen

  const map =
    req.kind === "global"
      ? gen.generateMap(req.settings)
      : gen.generateLocalMap(
          req.center,
          req.halfAngle,
          req.points,
          req.extraOctaves
        );

  // The typed arrays are freshly built per call, so transfer their buffers
  // zero-copy — the worker keeps no reference once posted.
  const transfer = [
    map.sites.buffer,
    map.ringOffsets.buffer,
    map.ringVerts.buffer,
    map.elevation.buffer,
    map.moisture.buffer,
    map.ice.buffer,
  ] as Transferable[];
  ctx.postMessage({ id: req.id, map }, transfer);
};
