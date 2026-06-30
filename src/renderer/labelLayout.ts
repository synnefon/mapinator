// Occupancy-bitmap label declutter. A coarse per-frame raster of "claimed" screen space: text labels
// are placed in priority order, each shown only if its (gutter-inflated) box lands on free space, then
// it stamps its box as claimed so later, lower-priority labels avoid it. Settlement dots + UI chrome are
// pre-stamped as reserved obstacles, so labels never cover them. O(n) over the raster — light,
// position-dependent, per-frame work (same category as the per-frame dot reprojection), so it lives on
// the main thread with the other overlays rather than off-thread (cf. CLAUDE.md).
//
// Pure: no DOM, no projection, no Vec3 — callers hand it screen-space boxes and get back the set of ids
// that fit. The raster is module scratch (one globe, single-threaded), grown as the viewport grows.

export type Rect = { x: number; y: number; halfW: number; halfH: number }; // centre + half-extents, px

export type TextLabel = Rect & {
  id: string; // stable + globally unique across frames (the label's name) — sort tiebreak + returned key
  priority: number; // higher = placed first; an integer type-band + a fractional size, so type dominates
  moveBudgetPx?: number; // if > 0, the label may slide up to this far from (x,y) to dodge a collision (area
  // labels — countries); omitted / 0 pins it to (x,y) like a normal point label.
};

/** Where a label ended up: its offset from (x,y) and which candidate slot won (idx 0 = the anchor). The
 *  idx is replayed next frame (tried first) so a moved label stays put instead of hopping slot each frame. */
export type Placement = { dx: number; dy: number; idx: number };

export type LayoutOpts = {
  width: number; // viewport px — sizes the raster
  height: number;
  gutterPx: number; // separation a label needs to APPEAR: its box is inflated by this for the test (not the stamp)
  stickyGutterPx?: number; // separation a label that was shown last frame needs to STAY — ≤ gutterPx, may be
  // NEGATIVE (tolerate a little overlap before dropping). The gap gutterPx − stickyGutterPx is a dead-band:
  // make it wider than CELL_PX and a label near the threshold can't chatter in/out as the view jitters.
  reserved?: Rect[]; // pre-claimed space (city dots, UI chrome) that text must avoid
  prevPlaced?: ReadonlyMap<string, Placement>; // last frame's placements — biased to stay shown + put (anti-flicker)
  hysteresisBonus?: number; // priority bump for last-frame ids; keep < the type-band spacing so it can't cross types
};

// Raster resolution. Effective separation ≈ gutterPx + up to one cell, since boxes round outward to cells.
const CELL_PX = 8;
// A shrunk (sticky, negative-inflation) box keeps at least this half-size, so a label that's genuinely
// buried — its anchor covered — still trips and drops, rather than surviving on a zero-size box forever.
const MIN_HALF_PX = 2;

// Candidate positions for a movable label, as unit offsets (× moveBudgetPx), in preference order: the
// anchor first, then an inner ring (½ budget), then the outer ring (full budget) — so a label dodges with
// the SMALLEST displacement that clears. A fixed table means the winning slot index is stable to replay.
const MOVE_CANDIDATES: ReadonlyArray<{ ux: number; uy: number }> = [
  { ux: 0, uy: 0 },
  { ux: 0.5, uy: 0 }, { ux: -0.5, uy: 0 }, { ux: 0, uy: 0.5 }, { ux: 0, uy: -0.5 },
  { ux: 1, uy: 0 }, { ux: -1, uy: 0 }, { ux: 0, uy: 1 }, { ux: 0, uy: -1 },
  { ux: 0.7, uy: 0.7 }, { ux: -0.7, uy: 0.7 }, { ux: 0.7, uy: -0.7 }, { ux: -0.7, uy: -0.7 },
];

// Slots to try, in order: last frame's winning slot first (so a placed label stays put), then the table.
// A pinned label (budget ≤ 0) only ever uses the anchor slot. The orders are FIXED (the candidate table is),
// so precompute every variant once — the per-label layout loop reads a shared array and allocates nothing.
const N_CANDIDATES = MOVE_CANDIDATES.length;
const ORDER_PINNED: readonly number[] = [0];
const ORDER_NO_PREV: readonly number[] = Array.from({ length: N_CANDIDATES }, (_, i) => i);
const ORDERS_BY_PREV: ReadonlyArray<readonly number[]> = ORDER_NO_PREV.map((prev) => [
  prev,
  ...ORDER_NO_PREV.filter((i) => i !== prev),
]);

function candidateOrder(budget: number, prevIdx: number | undefined): readonly number[] {
  if (budget <= 0) return ORDER_PINNED;
  if (prevIdx !== undefined && prevIdx >= 0 && prevIdx < N_CANDIDATES) return ORDERS_BY_PREV[prevIdx];
  return ORDER_NO_PREV;
}

let buf = new Uint8Array(0);
let cols = 0;
let rows = 0;

function reset(width: number, height: number): void {
  cols = Math.ceil(width / CELL_PX);
  rows = Math.ceil(height / CELL_PX);
  const need = cols * rows;
  if (buf.length < need) buf = new Uint8Array(need); // freshly zeroed
  else buf.fill(0, 0, need);
}

const clampCol = (c: number): number => (c < 0 ? 0 : c >= cols ? cols - 1 : c);
const clampRow = (r: number): number => (r < 0 ? 0 : r >= rows ? rows - 1 : r);

// Is any cell under this box already claimed? Rounds OUTWARD (so a partial overlap never reads as clear);
// a box fully off-screen counts as blocked (a label with no on-screen anchor isn't placed).
function hits(x: number, y: number, halfW: number, halfH: number): boolean {
  const c0 = Math.floor((x - halfW) / CELL_PX);
  const c1 = Math.floor((x + halfW) / CELL_PX);
  const r0 = Math.floor((y - halfH) / CELL_PX);
  const r1 = Math.floor((y + halfH) / CELL_PX);
  if (c1 < 0 || r1 < 0 || c0 >= cols || r0 >= rows) return true;
  for (let r = clampRow(r0); r <= clampRow(r1); r++) {
    const base = r * cols;
    for (let c = clampCol(c0); c <= clampCol(c1); c++) if (buf[base + c]) return true;
  }
  return false;
}

// Claim every cell under this box. Fully-off-screen boxes are skipped (clamping would smear an edge row).
function stamp(x: number, y: number, halfW: number, halfH: number): void {
  const c0 = Math.floor((x - halfW) / CELL_PX);
  const c1 = Math.floor((x + halfW) / CELL_PX);
  const r0 = Math.floor((y - halfH) / CELL_PX);
  const r1 = Math.floor((y + halfH) / CELL_PX);
  if (c1 < 0 || r1 < 0 || c0 >= cols || r0 >= rows) return;
  for (let r = clampRow(r0); r <= clampRow(r1); r++) {
    const base = r * cols;
    for (let c = clampCol(c0); c <= clampCol(c1); c++) buf[base + c] = 1;
  }
}

/**
 * Place text labels without overlapping each other or the reserved obstacles. Greedy by priority (highest
 * first, ties broken by id so the same frame always resolves identically — no flicker), with a hysteresis
 * bonus that keeps last frame's labels in place when they're on the bubble. A movable label (moveBudgetPx
 * > 0) tries its candidate slots — last frame's first — and takes the smallest displacement that clears.
 * Returns each shown label's placement (offset + slot). Stamp is tight, the gutter is virtual (test-only),
 * so a label's footprint stays truthful while still leaving a gap.
 */
export function layoutLabels(labels: TextLabel[], opts: LayoutOpts): Map<string, Placement> {
  reset(opts.width, opts.height);
  const placed = new Map<string, Placement>();

  if (opts.reserved) for (const m of opts.reserved) stamp(m.x, m.y, m.halfW, m.halfH);

  const bonus = opts.hysteresisBonus ?? 0;
  const prev = opts.prevPlaced;
  const eff = (l: TextLabel): number => l.priority + (bonus && prev?.has(l.id) ? bonus : 0);
  const order = labels
    .slice()
    .sort((a, b) => eff(b) - eff(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const g = opts.gutterPx;
  const sticky = opts.stickyGutterPx ?? g; // no dead-band unless asked for
  for (const l of order) {
    const budget = l.moveBudgetPx ?? 0;
    const prevP = prev?.get(l.id);
    let chosen: Placement | null = null;
    for (const idx of candidateOrder(budget, prevP?.idx)) {
      const cand = MOVE_CANDIDATES[idx];
      const dx = cand.ux * budget;
      const dy = cand.uy * budget;
      // The slot this label held last frame tests with the slacker (sticky) inflation, so it stays put
      // through a little overlap; any other slot must clear the full gutter to be worth moving into. The
      // gap between the two is the dead-band that stops near-threshold labels from flickering.
      const infl = prevP && idx === prevP.idx ? sticky : g;
      const hw = Math.max(MIN_HALF_PX, l.halfW + infl);
      const hh = Math.max(MIN_HALF_PX, l.halfH + infl);
      if (!hits(l.x + dx, l.y + dy, hw, hh)) {
        chosen = { dx, dy, idx };
        break;
      }
    }
    if (!chosen) continue; // no slot fits → dropped this frame
    stamp(l.x + chosen.dx, l.y + chosen.dy, l.halfW, l.halfH); // true footprint at the chosen spot
    placed.set(l.id, chosen);
  }
  return placed;
}
