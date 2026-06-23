import type { GlobeMap } from "./map";

// Memory profiling logs. The globe holds three distinct memory pools, and only the first shows up
// in a browser heap snapshot — so a useful profile has to report all three side by side:
//   • JS heap   — performance.memory (Chromium only); the LOD-cached typed arrays live here.
//   • LOD cache — CPU-side GlobeMap typed arrays, count + bytes (from the pipeline's cacheStats).
//   • GPU       — uploaded vertex/index/colour buffers (from the WebGL renderer; invisible to the heap).
// Event-driven: main.ts calls logMem() each time a generated map lands — the moment new memory is
// allocated. On in dev, silent in production builds (matches MenuBar's import.meta.env.DEV gate).
export const MEM_PROFILE = import.meta.env.DEV; // set `true` to also profile a production build

// Chrome's non-standard performance.memory. Absent in Firefox/Safari, so it's resolved at call time.
type ChromeMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

const MB = 1024 * 1024;
const mb = (bytes: number): string => (bytes / MB).toFixed(1) + "MB";

function chromeMemory(): ChromeMemory | null {
  return (performance as Performance & { memory?: ChromeMemory }).memory ?? null;
}

/** Total bytes of a GlobeMap's typed arrays — everything the worker transfers/clones back. */
export function mapBytes(map: GlobeMap): number {
  return (
    map.sites.byteLength +
    map.ringOffsets.byteLength +
    map.ringVerts.byteLength +
    map.elevation.byteLength +
    map.moisture.byteLength +
    map.ice.byteLength +
    map.shade.byteLength +
    map.plate.byteLength +
    map.arrowPositions.byteLength +
    map.arrowDirections.byteLength
  );
}

let peakHeap = 0;

/** Pools main.ts gathers from the pipeline + renderer; all optional so callers report what they have. */
export type MemPools = {
  lodCount?: number;
  lodBytes?: number;
  gpuBytes?: number;
};

/** One compact `[mem]` line: a label, the JS heap (used/limit + session peak), then the app pools. */
export function logMem(label: string, pools?: MemPools): void {
  if (!MEM_PROFILE) return;
  const parts = [`[mem] ${label}`];
  const mem = chromeMemory();
  if (mem) {
    peakHeap = Math.max(peakHeap, mem.usedJSHeapSize);
    parts.push(`heap ${mb(mem.usedJSHeapSize)}/${mb(mem.jsHeapSizeLimit)} (peak ${mb(peakHeap)})`);
  } else {
    parts.push("heap n/a"); // non-Chromium browser
  }
  if (pools?.lodBytes !== undefined) {
    parts.push(`lod ${pools.lodCount ?? "?"}×=${mb(pools.lodBytes)}`);
  }
  if (pools?.gpuBytes !== undefined) {
    parts.push(`gpu ${mb(pools.gpuBytes)}`);
  }
  console.log(parts.join("  ·  "));
}
