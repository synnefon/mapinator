import type { AppState } from "./AppState";
import {
  TUNING_SCHEMA,
  tuningDefault,
  type TuningField,
  type TuningGroup,
} from "./common/settings";
import { debounce } from "./common/util";

// Regeneration is heavy (full mesh rebuild off-thread), so coalesce slider drags:
// labels update live on every input, the regen fires this long after the last change.
const REGEN_DEBOUNCE_MS = 180;

type AdvancedHandle = {
  /** Re-read every slider from app state (used after the global reset clears overrides). */
  refresh: () => void;
};

// Decimal places to show for a slider value, derived from its step (0.01 → 2, 0.5 → 1, 1 → 0).
const decimalsFor = (step: number): number =>
  step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step)));

/**
 * Builds the generation-dial sections from TUNING_SCHEMA into #advancedPanel: one
 * collapsible per-group subheading (collapsed by default, appended after any sections
 * already in the panel — e.g. theme). Each subheading has its own reset button (top-right)
 * and holds a slider per dial — range dials show a min and a max thumb on one shared bar.
 * Slider input writes the override into app state and triggers a (debounced) regen; a
 * section reset clears just that section's overrides.
 */
export function setupAdvancedPanel(opts: {
  appState: AppState;
  onChange: () => void; // raw regen trigger; debounced here for slider drags
}): AdvancedHandle {
  const { appState, onChange } = opts;
  const panel = document.getElementById("advancedPanel");
  if (!panel) return { refresh: () => {} };

  const regen = debounce(onChange, REGEN_DEBOUNCE_MS);
  const valueOf = (path: string): number =>
    appState.tuningOverrides[path] ?? tuningDefault(path);

  // path → push the app-state value back into its slider + label (for refresh / reset).
  const syncers = new Map<string, () => void>();

  const makeRange = (min: number, max: number, step: number): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    return input;
  };

  // Scalar dial: "<label> <value>" above one slider.
  const addScalar = (
    parent: HTMLElement,
    f: Extract<TuningField, { kind: "scalar" }>
  ) => {
    const d = decimalsFor(f.step);
    const row = document.createElement("div");
    row.className = "adv-row";
    const label = document.createElement("label");
    label.className = "adv-sub";
    const val = document.createElement("span");
    val.className = "adv-val";
    label.append(`${f.label} `, val);

    const input = makeRange(f.min, f.max, f.step);
    const sync = () => {
      const v = valueOf(f.path);
      input.value = String(v);
      val.textContent = v.toFixed(d);
    };
    sync();
    input.addEventListener("input", () => {
      const v = Number(input.value);
      val.textContent = v.toFixed(d);
      appState.setTuning(f.path, v);
      regen();
    });
    row.append(label, input);
    parent.append(row);
    syncers.set(f.path, sync);
  };

  // Range dial: "<label> <min> – <max>" above two thumbs sharing ONE bar (min ≤ max).
  const addRange = (
    parent: HTMLElement,
    f: Extract<TuningField, { kind: "range" }>
  ) => {
    const d = decimalsFor(f.step);
    const p0 = `${f.path}.0`;
    const p1 = `${f.path}.1`;
    const row = document.createElement("div");
    row.className = "adv-row";
    const label = document.createElement("label");
    label.className = "adv-sub";
    const val = document.createElement("span");
    val.className = "adv-val";
    label.append(`${f.label} `, val);

    const bar = document.createElement("div");
    bar.className = "adv-range";
    const fill = document.createElement("div");
    fill.className = "adv-fill"; // visible selected span + handle for dragging both thumbs
    const lo = makeRange(f.min, f.max, f.step);
    const hi = makeRange(f.min, f.max, f.step);
    // fill first so the inputs (and their thumbs) paint on top of it
    bar.append(fill, lo, hi);

    const span = f.max - f.min;
    const pctOf = (v: number) => (span > 0 ? ((v - f.min) / span) * 100 : 0);
    // Snap to the dial's step (relative to min, like a native range input) and tidy float noise.
    const snap = (v: number) =>
      Number((f.min + Math.round((v - f.min) / f.step) * f.step).toFixed(6));
    // Keep the label and the fill bar in sync with the two thumbs.
    const update = () => {
      const a = Number(lo.value);
      const b = Number(hi.value);
      val.textContent = `${a.toFixed(d)} – ${b.toFixed(d)}`;
      fill.style.left = `${pctOf(a)}%`;
      fill.style.width = `${Math.max(0, pctOf(b) - pctOf(a))}%`;
    };

    lo.addEventListener("input", () => {
      let v = Number(lo.value);
      if (v > Number(hi.value)) {
        v = Number(hi.value); // keep min ≤ max
        lo.value = String(v);
      }
      appState.setTuning(p0, v);
      update();
      regen();
    });
    hi.addEventListener("input", () => {
      let v = Number(hi.value);
      if (v < Number(lo.value)) {
        v = Number(lo.value);
        hi.value = String(v);
      }
      appState.setTuning(p1, v);
      update();
      regen();
    });

    // Drag the fill to shift BOTH thumbs together — preserving the gap, clamped to bounds.
    let dragX: number | null = null;
    let startLo = 0;
    let startHi = 0;
    fill.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fill.setPointerCapture(e.pointerId);
      dragX = e.clientX;
      startLo = Number(lo.value);
      startHi = Number(hi.value);
    });
    fill.addEventListener("pointermove", (e) => {
      if (dragX === null) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width === 0) return;
      const gap = startHi - startLo;
      const dv = ((e.clientX - dragX) / rect.width) * span;
      let a = Math.max(f.min, Math.min(startLo + dv, f.max - gap));
      a = Math.max(f.min, Math.min(snap(a), f.max - gap)); // snap, then re-clamp
      const b = a + gap;
      lo.value = String(a);
      hi.value = String(b);
      appState.setTuning(p0, a);
      appState.setTuning(p1, b);
      update();
      regen();
    });
    const endDrag = (e: PointerEvent) => {
      if (dragX === null) return;
      dragX = null;
      try {
        fill.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    };
    fill.addEventListener("pointerup", endDrag);
    fill.addEventListener("pointercancel", endDrag);

    syncers.set(p0, () => {
      lo.value = String(valueOf(p0));
      update();
    });
    syncers.set(p1, () => {
      hi.value = String(valueOf(p1));
      update();
    });
    lo.value = String(valueOf(p0));
    hi.value = String(valueOf(p1));
    update();

    row.append(label, bar);
    parent.append(row);
  };

  const addField = (parent: HTMLElement, f: TuningField) =>
    f.kind === "scalar" ? addScalar(parent, f) : addRange(parent, f);

  // Every leaf path a group owns (range fields expand to `.0` / `.1`).
  const pathsOf = (g: TuningGroup): string[] =>
    g.fields.flatMap((f) =>
      f.kind === "range" ? [`${f.path}.0`, `${f.path}.1`] : [f.path]
    );

  for (const group of TUNING_SCHEMA) {
    const details = document.createElement("details");
    details.className = "adv-group";
    details.open = false; // collapsed by default

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.className = "adv-title";
    title.textContent = group.title;

    // Per-section reset (top-right): clears just this section's overrides, then regens.
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "adv-reset";
    resetBtn.textContent = "reset";
    resetBtn.title = `reset ${group.title}`;
    const paths = pathsOf(group);
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault(); // a click inside <summary> would otherwise toggle it
      e.stopPropagation();
      for (const p of paths) {
        appState.clearTuning(p);
        syncers.get(p)?.();
      }
      onChange(); // discrete action → regen now, not debounced
    });

    summary.append(title, resetBtn);
    details.append(summary);

    const fields = document.createElement("div");
    fields.className = "adv-fields";
    for (const f of group.fields) addField(fields, f);
    details.append(fields);
    panel.append(details);
  }

  const refresh = () => {
    for (const sync of syncers.values()) sync();
  };

  return { refresh };
}
