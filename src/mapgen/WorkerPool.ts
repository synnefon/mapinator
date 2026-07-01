import type { CountrySeeds, GlobeMap } from "../common/map";
import type { TerrainParams } from "../common/settings";
import type { GenRequest } from "../renderer/LodPipeline";

// A config message broadcast to every worker (seed and/or resolved generation params and/or the base
// country seeds the per-cell country stamp reads).
type PoolConfig = { seed?: string; params?: TerrainParams; countrySeeds?: CountrySeeds };

// One job posted to a worker — a rung generate (carries a `kind`).
type PoolJob = GenRequest;
// Worker reply: a generate yields `map` (with per-cell country stamped on detail caps).
type WorkerResponse = { id: number; map?: GlobeMap };

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
 * (see recommendedWorkerCount). Requests beyond N queue until a worker frees.
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

  private spawn(): Worker {
    const w = new Worker(new URL("./mapWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const resolve = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      this.idle.push(w);
      resolve?.(e.data); // generate → .map (its .then runs as a microtask)
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
