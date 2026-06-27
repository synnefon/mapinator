import { Quat, Vec3 } from "../../common/3DMath";
import type { Language } from "../../common/language";
import { makeRNG, randomChoice } from "../../common/random";
import { refineSphereCurve } from "../../common/sphereCurve";
import { goldbergMesh } from "../Goldberg";
import type { NameGenerator } from "../NameGenerator";
import { buildAdjacency } from "./adjacency";

// === Rivers: a coarse flow-routed skeleton, branched + refined for detail-on-demand ===
//
// We DON'T route a fine global network (it combs into parallel lines on flat land, and a fine global
// mesh freezes). Instead, after Mogensen & Isenbecker's zoomable-rivers idea (arXiv:2504.08383):
//   1. route flow on a COARSE mesh → a sparse, terrain-grounded TRUNK skeleton (downhill, ends at real
//      coasts, denser where wet) — sparse enough that combing never shows;
//   2. grow rule-based TRIBUTARIES off the trunks (dendritic by construction, no erosion needed);
//   3. fractally refine every polyline (the shared sphereCurve primitive) for meander.
// Detail then reveals with ZOOM: the fractal wiggle is sub-pixel when zoomed out, and the draw layer
// hides low-flow tributaries until you zoom in (see renderer/rivers.ts). The mesh + neighbour graph are
// cached per level; only the field sample + flow + branch + refine re-run on a dial change.

/** The fields river routing reads, sampled at the routing-mesh sites (flat xyz, 3 per cell). */
export type RiverFieldSample = {
  elevation: Float32Array; // [0,1] — below seaLevel ⇒ ocean (a flow sink)
  reportElevation: Float32Array; // [0,1] — routing height: a coast→interior land rise the flat rendered elevation lacks
  moisture: Float32Array; // [0,1] — per-cell water yield (precipitation)
  ice: Float32Array; // [0,1] — polar ice mask; rivers aren't drawn over iced land (but ice still feeds them)
};

/** Samples the river field at the given cell sites. Null ⇒ unavailable here (e.g. no GPU float RT). */
export type RiverFieldSampler = (sites: Float32Array) => RiverFieldSample | null;

/** Drawable river network: a soup of polylines on the unit sphere. Polyline k spans vertices
 *  [offsets[k], offsets[k+1]); each vertex has a position (xyz) and a flow strength normalized to [0,1]
 *  (drives both stroke width AND the zoom reveal — small tributaries taper toward 0). */
/** A drawable river name — matches the renderer's LabelItem shape (drawn by drawFeatureLabels). */
export type RiverLabel = { name: string; anchor: Vec3; extent: number; minLevel: number; cellCount: number };

export type RiverData = {
  positions: Float32Array; // 3 per vertex (unit-sphere xyz)
  widths: Float32Array; // 1 per vertex, normalized flow strength in [0,1]
  offsets: Uint32Array; // polyline boundaries; length = polylineCount + 1
  labels: RiverLabel[]; // names for the major (zoom-0-visible) rivers; shown only when zoomed in close
};

export const EMPTY_RIVERS: RiverData = {
  positions: new Float32Array(0),
  widths: new Float32Array(0),
  offsets: new Uint32Array([0]),
  labels: [],
};

export type RiverOptions = {
  seaLevel: number; // elevation below which a cell is ocean (the flow terminus)
  minDrainage: number; // accumulated upstream yield needed to seed a trunk
  moistureWeight: number; // 0 = every cell yields the same, 1 = yield scales fully with moisture
  sourceMoisture: number; // a cell drier than this generates NO runoff → rivers only start in wet zones
  waterScaling: number; // [0,1] how strongly river size tracks the water body it drains into
  branching: number; // [0,1] tributary density (0 = bare trunks)
  meander: number; // fractal meander amplitude (sphereCurve)
  meanderDetail: number; // fractal meander levels (more = finer wiggle, revealed deeper in zoom)
  namer?: NameGenerator; // name the major rivers (omit to skip naming)
  mapSeed?: string; // seed for deterministic river names
  language?: Language; // map language for the river-name stems
};

/** A river polyline mid-build: sphere points + per-vertex flow strength. */
export type Line = { pts: Vec3[]; str: number[] };

type RoutingMesh = { sites: Float32Array; neighbors: number[][]; cellCount: number };
const meshCache = new Map<number, RoutingMesh>();

/** The skeleton routes on a COARSE mesh — FIXED, not a dial: detail comes from branching + meander, not
 *  mesh resolution, and finer just costs more and risks the global-mesh freeze. L7 ≈ 164K cells. */
const SKELETON_LEVEL = 7;

/** Cells more than half-iced don't draw a river ("no rivers over ice"); ice still feeds water downstream. */
const ICE_MAX = 0.5;

// --- river naming (the major systems; names shown only when zoomed in close) ---
const NAME_MIN_STRENGTH = 0.12; // only name rivers at least this prominent (≈ visible at the zoomed-out view)
const RIVER_LABEL_EXTENT = 0.02; // angular size feeding the label font (clamped in the renderer)
const RIVER_LABEL_MIN_LEVEL = 3; // LOD level a river name needs before it shows → names appear only when zoomed in
const RIVER_TEMPLATES = ["{X} river", "river {X}", "the {X}"];

/** Deterministic river name: stem in the map's language + an English descriptor (mirrors nameFeature). */
function nameRiver(mapSeed: string, repCell: number, language: Language, namer: NameGenerator): string {
  const seed = `${mapSeed}|RIVER|${repCell}`;
  const stem = namer.generate({ seed, lang: language, unique: true });
  return randomChoice(RIVER_TEMPLATES, makeRNG(`${seed}|tmpl`)).replace("{X}", stem).toLowerCase();
}

// --- tributary growth (rule-based dendritic branching off the trunks) ---
const BRANCH_ANGLE = 1.0; // radians a tributary forks off its parent's upstream direction (~57°)
const CHILD_FRACTION = 0.6; // a tributary's flow strength as a fraction of its junction's
const MIN_BRANCH_STRENGTH = 0.05; // don't spawn/continue branches weaker than this
const WANDER = 0.22; // radians of deterministic per-step heading jitter (pre-meander wiggle)
const SUB_SPACING = 4; // steps between a tributary's own sub-tributaries
const LENGTH_STEPS = 18; // steps a full-strength tributary walks (∝ strength)

/** Deterministic pseudo-random in [-1, 1] from a point + salt — stable across recomputes. */
function hash(v: Vec3, salt: number): number {
  const s = Math.sin(v.x * 127.1 + v.y * 311.7 + v.z * 74.7 + salt * 13.3) * 43758.5453;
  return 2 * (s - Math.floor(s)) - 1;
}

/** Project v into the tangent plane at unit normal n, normalized (a surface direction). */
function tangent(v: Vec3, n: Vec3): Vec3 {
  return Vec3.normalize(Vec3.sub(v, Vec3.scale(n, Vec3.dot(v, n))));
}

/** Build (cached) the routing mesh + neighbour graph at a level. Deterministic + seed-independent, so
 *  one build serves every seed/dial change — only the field sample + flow re-run. */
function getRoutingMesh(level: number): RoutingMesh {
  const cached = meshCache.get(level);
  if (cached) return cached;

  const cells = goldbergMesh(level);
  const n = cells.length;
  const sites = new Float32Array(n * 3);
  let totalVerts = 0;
  for (let i = 0; i < n; i++) totalVerts += cells[i].ring.length;
  const ringOffsets = new Uint32Array(n + 1);
  const ringVerts = new Float32Array(totalVerts * 3);
  let vo = 0;
  for (let i = 0; i < n; i++) {
    const { site, ring } = cells[i];
    sites[3 * i] = site.x;
    sites[3 * i + 1] = site.y;
    sites[3 * i + 2] = site.z;
    ringOffsets[i] = vo;
    for (const v of ring) {
      ringVerts[3 * vo] = v.x;
      ringVerts[3 * vo + 1] = v.y;
      ringVerts[3 * vo + 2] = v.z;
      vo++;
    }
  }
  ringOffsets[n] = vo;

  const neighbors = buildAdjacency({ cellCount: n, ringOffsets, ringVerts });
  const mesh: RoutingMesh = { sites, neighbors, cellCount: n };
  meshCache.set(level, mesh);
  return mesh;
}

/** Route rivers and return the drawable network. EMPTY_RIVERS if the sampler is unavailable or no trunk
 *  clears the drainage threshold. */
export function computeRivers(sample: RiverFieldSampler, opts: RiverOptions): RiverData {
  const mesh = getRoutingMesh(SKELETON_LEVEL);
  const { sites, neighbors, cellCount: n } = mesh;
  const field = sample(sites);
  if (!field) return EMPTY_RIVERS;
  const { elevation, reportElevation, moisture, ice } = field;
  const { seaLevel, minDrainage, moistureWeight } = opts;

  // 1. Land vs ocean (ocean = flow sink, the river terminus).
  const isSea = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (elevation[i] < seaLevel) isSea[i] = 1;

  // 2. PRIORITY-FLOOD depression fill (Barnes 2014): seed the coastal sea, flood inland popping the
  //    lowest spill point first, raising each pit just above its spill so all land drains to the sea.
  const filled = new Float32Array(n);
  const done = new Uint8Array(n);
  const heap = new Int32Array(n + 1); // min-heap of cell indices keyed by filled[] (set before push, then frozen)
  let heapSize = 0;
  const swap = (a: number, b: number): void => {
    const t = heap[a];
    heap[a] = heap[b];
    heap[b] = t;
  };
  const push = (i: number): void => {
    heap[heapSize] = i;
    let c = heapSize++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (filled[heap[c]] < filled[heap[p]]) {
        swap(c, p);
        c = p;
      } else break;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    heap[0] = heap[--heapSize];
    let p = 0;
    for (;;) {
      const l = 2 * p + 1;
      const r = l + 1;
      let m = p;
      if (l < heapSize && filled[heap[l]] < filled[heap[m]]) m = l;
      if (r < heapSize && filled[heap[r]] < filled[heap[m]]) m = r;
      if (m === p) break;
      swap(p, m);
      p = m;
    }
    return top;
  };
  for (let i = 0; i < n; i++) {
    if (isSea[i]) {
      filled[i] = reportElevation[i];
      done[i] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!isSea[i]) continue;
    for (const nb of neighbors[i]) {
      if (!isSea[nb]) {
        push(i);
        break;
      }
    }
  }
  const EPS = 1e-6;
  while (heapSize > 0) {
    const c = pop();
    for (const nb of neighbors[c]) {
      if (done[nb]) continue;
      done[nb] = 1;
      filled[nb] = Math.max(reportElevation[nb], filled[c] + EPS);
      push(nb);
    }
  }

  // 3. Flow direction (steepest descent on the filled surface) + accumulation (high→low, summing yield).
  const downstream = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (isSea[i] || !done[i]) continue;
    let best = -1;
    let bestH = filled[i];
    for (const nb of neighbors[i]) {
      if (filled[nb] < bestH) {
        bestH = filled[nb];
        best = nb;
      }
    }
    downstream[i] = best;
  }
  const cellYield = (i: number): number => {
    if (moisture[i] < opts.sourceMoisture) return 0; // too dry to source a river (water still flows through it)
    return moistureWeight <= 0 ? 1 : 1 - moistureWeight + moistureWeight * moisture[i];
  };
  const accum = new Float32Array(n);
  const land: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isSea[i] && done[i]) {
      accum[i] = cellYield(i);
      land.push(i);
    }
  }
  land.sort((a, b) => filled[b] - filled[a]);
  for (const c of land) {
    const d = downstream[c];
    if (d >= 0 && !isSea[d]) accum[d] += accum[c];
  }

  // Water-body sizes (connected components of ocean cells), then each land cell's drainage-OUTLET body
  // size, propagated up the tree (sea-ward cells first). Lets a river's size track the water it drains
  // into: the world ocean → big rivers, a small enclosed lake → small ones.
  const bodyId = new Int32Array(n).fill(-1);
  const bodySize: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!isSea[i] || bodyId[i] >= 0) continue;
    const id = bodySize.length;
    let size = 0;
    const q = [i];
    bodyId[i] = id;
    for (let h = 0; h < q.length; h++) {
      size++;
      for (const nb of neighbors[q[h]]) {
        if (isSea[nb] && bodyId[nb] < 0) {
          bodyId[nb] = id;
          q.push(nb);
        }
      }
    }
    bodySize.push(size);
  }
  let maxBody = 1;
  for (const s of bodySize) if (s > maxBody) maxBody = s;
  const mouthBody = new Float32Array(n); // outlet water-body size per land cell (0 = drains nowhere)
  const mouthId = new Int32Array(n).fill(-1); // outlet sea-cell index per land cell → groups cells into river systems
  for (let k = land.length - 1; k >= 0; k--) {
    const c = land[k];
    const d = downstream[c];
    if (d < 0) continue;
    if (isSea[d]) {
      mouthBody[c] = bodySize[bodyId[d]];
      mouthId[c] = d;
    } else {
      mouthBody[c] = mouthBody[d];
      mouthId[c] = mouthId[d];
    }
  }

  // 4. Trace the trunk skeleton: cells over the drainage threshold, broken into polylines at confluences.
  const isRiver = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // ice cells are excluded so no river draws OVER the ice cap (ice still feeds water, so a river that
    // melts FROM the ice emerges below it — "from ice is ok").
    if (!isSea[i] && downstream[i] >= 0 && accum[i] >= minDrainage && ice[i] <= ICE_MAX) isRiver[i] = 1;
  }
  const inflow = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    if (!isRiver[i]) continue;
    const d = downstream[i];
    if (d >= 0 && isRiver[d]) inflow[d]++;
  }
  let maxAccum = minDrainage;
  for (let i = 0; i < n; i++) if (isRiver[i] && accum[i] > maxAccum) maxAccum = accum[i];
  // Flow strength = drainage (√accum) × how big the water it drains into is (per opts.waterScaling).
  const waterFactor = (i: number): number =>
    Math.max(0.15, 1 - opts.waterScaling * (1 - Math.sqrt(mouthBody[i] / maxBody)));
  const strengthOf = (i: number): number => Math.sqrt(accum[i] / maxAccum) * waterFactor(i);
  const siteVec = (i: number): Vec3 => ({ x: sites[3 * i], y: sites[3 * i + 1], z: sites[3 * i + 2] });

  const trunks: Line[] = [];
  for (let s = 0; s < n; s++) {
    if (!isRiver[s] || inflow[s] === 1) continue; // start at sources (0) + confluences (≥2)
    const pts: Vec3[] = [siteVec(s)];
    const str: number[] = [strengthOf(s)];
    let cur = s;
    for (;;) {
      const d = downstream[cur];
      if (d < 0) break;
      if (isSea[d]) {
        pts.push(siteVec(d));
        str.push(strengthOf(cur));
        break;
      }
      pts.push(siteVec(d));
      str.push(strengthOf(d));
      if (!isRiver[d] || inflow[d] >= 2) break;
      cur = d;
    }
    if (pts.length >= 2) trunks.push({ pts, str });
  }

  // 5. Grow tributaries off the trunks, clip every line to the coast, then refine for meander.
  const cellAngle = Math.sqrt((4 * Math.PI) / (10 * Math.pow(4, SKELETON_LEVEL)));
  const lines = trunks.concat(growTributaries(trunks, opts.branching, cellAngle));
  const clipped = clipLinesToCoast(lines, sample, seaLevel);
  const refined = clipped.map((l) =>
    refineSphereCurve(l.pts, l.str, { levels: opts.meanderDetail, amplitude: opts.meander })
  );

  // Name the major rivers — group cells by drainage mouth (one name per river system), anchor the name
  // on the system's strongest cell, and keep only systems prominent enough to read at the zoomed-out view.
  const labels: RiverLabel[] = [];
  if (opts.namer && opts.mapSeed && opts.language) {
    const systems = new Map<number, { cell: number; strength: number; count: number }>();
    for (let i = 0; i < n; i++) {
      if (!isRiver[i] || mouthId[i] < 0) continue;
      const s = strengthOf(i);
      const sys = systems.get(mouthId[i]);
      if (!sys) systems.set(mouthId[i], { cell: i, strength: s, count: 1 });
      else {
        sys.count++;
        if (s > sys.strength) {
          sys.strength = s;
          sys.cell = i;
        }
      }
    }
    for (const sys of systems.values()) {
      if (sys.strength < NAME_MIN_STRENGTH) continue;
      labels.push({
        name: nameRiver(opts.mapSeed, sys.cell, opts.language, opts.namer),
        anchor: siteVec(sys.cell),
        extent: RIVER_LABEL_EXTENT,
        minLevel: RIVER_LABEL_MIN_LEVEL,
        cellCount: sys.count,
      });
    }
  }

  return { ...pack(refined), labels };
}

/** Sub-cell samples taken ALONG a mouth segment to locate the fractal coast. The routing mesh is coarse
 *  (~0.5°/cell); the rendered coast is the field's sub-cell seaLevel contour, so one linear step between
 *  cell centres misses it — march the real field instead. The coast is fractal (noise at every scale), so
 *  more steps than this buy nothing: the crossing already lands within the coast's own roughness band. */
const COAST_SUBSTEPS = 8;

/** End every line on the coastline. Routing decides land/sea on the COARSE mesh, so two things miss the
 *  rendered coast: a trunk terminates at the first SEA cell's CENTRE (a cell past the shore), and a
 *  tributary (growBranch) walks great circles with NO land/sea test at all. We sample the field at every
 *  vertex, find each line's first in-sea vertex, then SUB-SAMPLE that mouth segment to cut exactly where
 *  the real field crosses seaLevel — not at a linear guess between two cell centres (a deep adjacent sea
 *  cell would drag that guess far inland → "stops short"; a shallow one pushes it past the shore). Done
 *  BEFORE refine so a meander dip into a coastal inlet can't truncate a river mid-course. A line that
 *  never reaches the sea is kept whole; one already starting in the sea is dropped. Falls back to the
 *  input unchanged if the field can't be sampled (the sampler is the same one routing already used). */
export function clipLinesToCoast(lines: Line[], sample: RiverFieldSampler, seaLevel: number): Line[] {
  if (lines.length === 0) return lines;

  // Pass 1 — sample every vertex; record each line's flat offset and its first vertex in the sea.
  let total = 0;
  for (const l of lines) total += l.pts.length;
  const sites = new Float32Array(total * 3);
  const starts = new Int32Array(lines.length);
  let v = 0;
  for (let k = 0; k < lines.length; k++) {
    starts[k] = v;
    for (const p of lines[k].pts) {
      sites[3 * v] = p.x;
      sites[3 * v + 1] = p.y;
      sites[3 * v + 2] = p.z;
      v++;
    }
  }
  const field = sample(sites);
  if (!field) return lines;
  const { elevation } = field;
  const seaIdx = new Int32Array(lines.length).fill(-1);
  for (let k = 0; k < lines.length; k++) {
    const s0 = starts[k];
    for (let i = 0; i < lines[k].pts.length; i++) {
      if (elevation[s0 + i] < seaLevel) {
        seaIdx[k] = i;
        break;
      }
    }
  }

  // Pass 2 — sub-sample each mouth segment [sea-1 → sea] (endpoints included) so the cut lands on the
  // fractal coast. Batched into ONE sample call across all crossing lines.
  const crossings: number[] = [];
  for (let k = 0; k < lines.length; k++) if (seaIdx[k] >= 1) crossings.push(k);
  const PTS = COAST_SUBSTEPS + 1; // t = 0, 1/STEP, …, 1 (inclusive)
  const probe = new Float32Array(crossings.length * PTS * 3);
  for (let c = 0; c < crossings.length; c++) {
    const k = crossings[c];
    const a = lines[k].pts[seaIdx[k] - 1];
    const b = lines[k].pts[seaIdx[k]];
    for (let s = 0; s < PTS; s++) {
      const p = Vec3.normalize(Vec3.add(a, Vec3.scale(Vec3.sub(b, a), s / COAST_SUBSTEPS)));
      const o = (c * PTS + s) * 3;
      probe[o] = p.x;
      probe[o + 1] = p.y;
      probe[o + 2] = p.z;
    }
  }
  const probeElev = crossings.length ? sample(probe)?.elevation : undefined;

  // Fraction along [sea-1 → sea] where the field first drops below seaLevel (the coast), from the dense
  // probe; falls back to the coarse linear estimate if the probe is unavailable.
  const mouthT = (k: number, ci: number): number => {
    const sea = seaIdx[k];
    if (probeElev && ci >= 0) {
      const base = ci * PTS;
      for (let s = 1; s < PTS; s++) {
        const e = probeElev[base + s];
        if (e < seaLevel) {
          const ePrev = probeElev[base + s - 1];
          return (s - 1 + (ePrev - seaLevel) / (ePrev - e)) / COAST_SUBSTEPS;
        }
      }
      return 1; // never dipped within the probe (shouldn't happen — b is sea) → end at b
    }
    const eA = elevation[starts[k] + sea - 1];
    const eB = elevation[starts[k] + sea];
    return (eA - seaLevel) / (eA - eB);
  };

  const out: Line[] = [];
  let c = 0;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const sea = seaIdx[k];
    if (sea < 0) {
      out.push(l); // never reaches the sea — keep whole
      continue;
    }
    if (sea === 0) continue; // starts in the sea — drop
    const ci = crossings[c] === k ? c++ : -1;
    const t = mouthT(k, ci);
    const a = sea - 1;
    const cross = Vec3.normalize(Vec3.add(l.pts[a], Vec3.scale(Vec3.sub(l.pts[sea], l.pts[a]), t)));
    const pts = l.pts.slice(0, sea);
    const str = l.str.slice(0, sea);
    pts.push(cross);
    str.push(l.str[a] + (l.str[sea] - l.str[a]) * t);
    if (pts.length >= 2) out.push({ pts, str });
  }
  return out;
}

/** For each trunk, spawn tributaries growing UPSTREAM-and-outward at deterministic intervals, recursing
 *  into sub-tributaries. Returns the new lines only (trunks are kept by the caller). */
function growTributaries(trunks: Line[], branching: number, step: number): Line[] {
  if (branching <= 0) return [];
  const spacing = Math.max(2, Math.round(2 + (1 - branching) * 8)); // denser branching → tighter spacing
  const depth = Math.ceil(branching * 3); // [1..3] sub-tributary generations
  const out: Line[] = [];
  let side = 1;
  for (const trunk of trunks) {
    for (let i = 1; i < trunk.pts.length - 1; i += spacing) {
      const s = trunk.str[i] * CHILD_FRACTION;
      if (s < MIN_BRANCH_STRENGTH) continue;
      const p = trunk.pts[i];
      const downDir = tangent(Vec3.sub(trunk.pts[i + 1], trunk.pts[i]), p);
      const up = Vec3.scale(downDir, -1);
      const fork = Quat.fromAxisAngle(p.x, p.y, p.z, side * BRANCH_ANGLE);
      const heading = tangent(Quat.rotate(fork, up), p);
      side = -side;
      growBranch(p, heading, s, depth, step, i, out);
    }
  }
  return out;
}

/** Walk a tributary along great circles from `start`, tapering strength to 0, jittering its heading,
 *  and recursively forking sub-tributaries. Appends the line (and its descendants) to `out`. */
function growBranch(
  start: Vec3,
  heading: Vec3,
  strength: number,
  depth: number,
  step: number,
  salt: number,
  out: Line[]
): void {
  const pts: Vec3[] = [start];
  const str: number[] = [strength];
  let p = start;
  let d = heading;
  const steps = Math.max(2, Math.round(strength * LENGTH_STEPS));
  let side = 1;
  for (let i = 1; i <= steps; i++) {
    // deterministic heading jitter, then a great-circle step
    const turn = WANDER * hash(p, salt + i);
    d = tangent(Quat.rotate(Quat.fromAxisAngle(p.x, p.y, p.z, turn), d), p);
    const cos = Math.cos(step);
    const sin = Math.sin(step);
    const np = Vec3.normalize(Vec3.add(Vec3.scale(p, cos), Vec3.scale(d, sin)));
    d = tangent(Vec3.add(Vec3.scale(d, cos), Vec3.scale(p, -sin)), np);
    p = np;
    const s = strength * (1 - i / steps);
    pts.push(p);
    str.push(s);
    if (depth > 0 && s > MIN_BRANCH_STRENGTH && i % SUB_SPACING === 0) {
      const fork = Quat.fromAxisAngle(p.x, p.y, p.z, side * BRANCH_ANGLE);
      growBranch(p, tangent(Quat.rotate(fork, d), p), s * CHILD_FRACTION, depth - 1, step, salt * 7 + i, out);
      side = -side;
    }
  }
  if (pts.length >= 2) out.push({ pts, str });
}

/** Flatten refined lines into the typed-array RiverData the renderer consumes. */
function pack(lines: { points: Vec3[]; values: number[] }[]): Omit<RiverData, "labels"> {
  let total = 0;
  for (const l of lines) total += l.points.length;
  const positions = new Float32Array(total * 3);
  const widths = new Float32Array(total);
  const offsets = new Uint32Array(lines.length + 1);
  let v = 0;
  for (let k = 0; k < lines.length; k++) {
    offsets[k] = v;
    const { points, values } = lines[k];
    for (let i = 0; i < points.length; i++) {
      positions[3 * v] = points[i].x;
      positions[3 * v + 1] = points[i].y;
      positions[3 * v + 2] = points[i].z;
      widths[v] = values[i];
      v++;
    }
  }
  offsets[lines.length] = v;
  return { positions, widths, offsets };
}
