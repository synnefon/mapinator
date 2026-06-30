import type { Vec3 } from "../common/3DMath";
import type { CountrySeeds, GlobeMap, PatchCountryData, TownFieldData } from "../common/map";
import type { TerrainParams } from "../common/settings";
import type { GenRequest } from "../renderer/LodPipeline";

// A config message broadcast to every worker (seed and/or resolved generation params and/or the base
// country seeds the off-thread re-grow needs).
type PoolConfig = { seed?: string; params?: TerrainParams; countrySeeds?: CountrySeeds };

// An off-thread country re-grow for one patch: the worker reproduces the patch MESH from these exact
// generation params (deterministic) and re-grows the partition against the configured base seeds, using
// `elevation` (read back from the GPU — the field the patch is rendered from) for land/water so the
// re-grown coast matches the drawn one. Omitted on the CPU-fallback path (worker samples it itself).
type CountryRequest = { kind: "countries"; center: Vec3; halfAngle: number; points: number; elevation?: Float32Array };

// An off-thread grow of one region's patch-local small towns (the 1400-density tail). The worker samples a
// deterministic town field over the cap, accepted ∝ local population density (see mapWorker `towns`).
type TownRequest = {
  kind: "towns";
  center: Vec3;
  capAngle: number;
  gridAngle: number;
  minPop: number;
  ceilingPop: number;
  perCapita: number;
  popDensityScale: number;
};

// One job posted to a worker — a rung generate, a country re-grow, or a town grow (each carries a `kind`).
type PoolJob = GenRequest | CountryRequest | TownRequest;
// Worker reply: a generate yields `map`; a country re-grow yields `country`; a town grow yields `towns`.
type WorkerResponse = { id: number; map?: GlobeMap; country?: PatchCountryData; towns?: TownFieldData };

// Per-worker peak memory while a fine-cap generate is in flight (its transient cap mesh + output
// typed arrays) plus that worker's small mesh cache — rough, used only to size the pool. Each extra
// worker costs about this much resident RAM, so the pool trades it against parallelism.
const PEAK_BYTES_PER_WORKER = 96 * 1024 * 1024;
// Total RAM we'll spend on concurrent generation. The pool runs at most floor(budget / per-worker)
// workers, so peak generation memory stays under this no matter how many rungs the pipeline asks for
// at once. Separate from the LOD cache + GPU budgets (those bound resident MAPS, not workers).
const GEN_MEM_BUDGET_BYTES = 512 * 1024 * 1024;
// Hard ceiling so a many-core machine doesn't spawn a wasteful number of workers — past a handful the
// returns diminish (the pipeline rarely has more than a few rungs uncovered at once).
const MAX_WORKERS = 8;

/** Worker-pool size: as many as fit the memory budget, capped by CPU cores (leave one for the UI /
 *  render thread) and a hard max. Always ≥ 1 so generation can always make progress. */
export function recommendedWorkerCount(): number {
  const byMem = Math.floor(GEN_MEM_BUDGET_BYTES / PEAK_BYTES_PER_WORKER);
  const byCpu = (navigator.hardwareConcurrency || 4) - 1;
  return Math.max(1, Math.min(MAX_WORKERS, byMem, byCpu));
}

/**
 * Pool of terrain-generation Web Workers. Generation is embarrassingly parallel ACROSS LOD rungs
 * (the globe + each detail cap are independent maps), so N workers build N at once. Concurrency is
 * the pool SIZE, which is the memory cap: every in-flight generate transiently holds a cap mesh +
 * output arrays and each worker keeps its own mesh cache, so peak RAM scales with the worker count
 * (see recommendedWorkerCount). Requests beyond N queue until a worker frees. The off-thread country
 * re-grow (computeCountries) shares the same pool — it queues behind generation like any other job.
 *
 * Every worker holds an identical MapGenerator, so `configure` (seed / params / feature / country-seed
 * changes) BROADCASTS to all of them and jobs go to whichever worker is free. postMessage is ordered
 * per worker, so a config sent before a job is applied first on that worker.
 */
export class WorkerPool {
  private readonly workers: Worker[];
  private readonly idle: Worker[] = [];
  private readonly pending = new Map<number, (res: WorkerResponse) => void>();
  private readonly waiting: { id: number; msg: PoolJob; transfer?: Transferable[] }[] = [];
  private nextId = 0;

  constructor(size: number) {
    this.workers = Array.from({ length: Math.max(1, size) }, () => this.spawn());
    this.idle.push(...this.workers);
  }

  /** How many workers — the pipeline uses this as its max in-flight job count. */
  get size(): number {
    return this.workers.length;
  }

  /** Broadcast a seed / params / country-seed change to EVERY worker (each holds its own generator). */
  configure(config: PoolConfig): void {
    for (const w of this.workers) {
      w.postMessage({ id: ++this.nextId, kind: "config", ...config });
    }
  }

  /** Generate one LOD rung on the next free worker (queued if all are busy). */
  generate(req: GenRequest): Promise<GlobeMap> {
    return new Promise((resolve) => {
      const id = ++this.nextId;
      this.pending.set(id, (res) => resolve(res.map!));
      this.waiting.push({ id, msg: req });
      this.dispatch();
    });
  }

  /** Re-grow one patch's country partition off the main thread. Resolves null if the worker couldn't
   *  run it (no base seeds configured yet) — the caller then keeps the coarse base borders. */
  computeCountries(center: Vec3, halfAngle: number, points: number, elevation?: Float32Array): Promise<PatchCountryData | null> {
    return new Promise((resolve) => {
      const id = ++this.nextId;
      this.pending.set(id, (res) => resolve(res.country ?? null));
      // Transfer the GPU-read elevation zero-copy — the main thread doesn't keep it after the re-grow.
      this.waiting.push({
        id,
        msg: { kind: "countries", center, halfAngle, points, elevation },
        transfer: elevation ? [elevation.buffer] : undefined,
      });
      this.dispatch();
    });
  }

  /** Grow one region's patch-local small towns off the main thread. Resolves null if the worker couldn't
   *  run it yet (no field / base seeds configured) — the caller then shows just the global big cities. */
  growTowns(spec: Omit<TownRequest, "kind">): Promise<TownFieldData | null> {
    return new Promise((resolve) => {
      const id = ++this.nextId;
      this.pending.set(id, (res) => resolve(res.towns ?? null));
      this.waiting.push({ id, msg: { kind: "towns", ...spec } });
      this.dispatch();
    });
  }

  private spawn(): Worker {
    const w = new Worker(new URL("./mapWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resolve = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      this.idle.push(w);
      resolve?.(e.data); // generate → .map; countries → .country (its .then runs as a microtask)
      this.dispatch(); // hand the freed worker the next queued job
    };
    w.onerror = (e) => console.error("map worker error:", e.message);
    return w;
  }

  // Post queued jobs to idle workers until one side runs out.
  private dispatch(): void {
    while (this.idle.length && this.waiting.length) {
      const w = this.idle.pop()!;
      const job = this.waiting.shift()!;
      w.postMessage({ id: job.id, ...job.msg }, job.transfer ?? []);
    }
  }
}
