import type { AppState } from "./AppState";
import {
  DIAL_DOCS,
  FEATURES,
  LAYERS,
  TUNING_SCHEMA,
  tuningDefault,
  type Layer,
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

// One shared hover tooltip for dial docs. The native `title` attribute lags ~1s and can't be
// styled; this shows the explainer instantly, follows the cursor, and flips left near the screen
// edge. pointer-events: none (in CSS) so it never eats slider input. Returns an `attach(el, doc)`.
function makeDialTooltip(): (el: HTMLElement, doc: string) => void {
  const tip = document.createElement("div");
  tip.className = "adv-tip";
  tip.setAttribute("role", "tooltip");
  document.body.append(tip);
  let active: HTMLElement | null = null;
  const place = (e: MouseEvent) => {
    const gap = 14;
    const x = e.clientX + gap;
    const flipped = x + tip.offsetWidth > window.innerWidth - 8;
    tip.style.left = `${Math.max(8, flipped ? e.clientX - gap - tip.offsetWidth : x)}px`;
    tip.style.top = `${e.clientY + gap}px`;
  };
  return (el, doc) => {
    el.addEventListener("mouseenter", (e) => {
      tip.textContent = doc;
      tip.classList.add("show");
      active = el;
      place(e);
    });
    el.addEventListener("mousemove", (e) => {
      if (active === el) place(e);
    });
    el.addEventListener("mouseleave", () => {
      if (active !== el) return;
      tip.classList.remove("show");
      active = null;
    });
  };
}

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
  onViewChange: () => void; // re-render only (no regen) — for view overlays like "view plates"
}): AdvancedHandle {
  const { appState, onChange, onViewChange } = opts;
  const panel = document.getElementById("advancedPanel");
  if (!panel) return { refresh: () => {} };

  const showDoc = makeDialTooltip();

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
    const doc = DIAL_DOCS.get(f.path);
    if (doc) showDoc(row, doc); // instant styled hover explainer, from the dial's comment
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

  // Range dial: "<label> <min> – <max>" above two thumbs sharing ONE bar (min ≤ max). The BAR
  // owns every pointer gesture — the native inputs are click-through, kept only for rendering +
  // keyboard + screen readers. Press/drag the track → the NEAREST thumb jumps there (so an equal
  // [x, x] range, or a thumb pinned at a bound, is always grabbable on mouse and touch alike, with
  // no z-index trickery); drag the highlighted span → move both, preserving the gap.
  const addRange = (
    parent: HTMLElement,
    f: Extract<TuningField, { kind: "range" }>
  ) => {
    const d = decimalsFor(f.step);
    const p0 = `${f.path}.0`;
    const p1 = `${f.path}.1`;
    const row = document.createElement("div");
    row.className = "adv-row";
    const doc = DIAL_DOCS.get(f.path);
    if (doc) showDoc(row, doc); // instant styled hover explainer, from the dial's comment
    const label = document.createElement("label");
    label.className = "adv-sub";
    const val = document.createElement("span");
    val.className = "adv-val";
    label.append(`${f.label} `, val);

    const bar = document.createElement("div");
    bar.className = "adv-range";
    const fill = document.createElement("div");
    fill.className = "adv-fill"; // visible selected span (decorative; the bar owns input)
    const lo = makeRange(f.min, f.max, f.step);
    const hi = makeRange(f.min, f.max, f.step);
    // Distinguish the two thumbs for screen readers (both are role=slider via the native input).
    lo.setAttribute("aria-label", `${f.label} minimum`);
    hi.setAttribute("aria-label", `${f.label} maximum`);
    // fill first so the inputs (and their thumbs) paint on top of it
    bar.append(fill, lo, hi);

    const span = f.max - f.min;
    const pctOf = (v: number) => (span > 0 ? ((v - f.min) / span) * 100 : 0);
    const clampToBounds = (v: number) => Math.max(f.min, Math.min(v, f.max));
    // Snap to the dial's step (relative to min, like a native range input) and tidy float noise.
    const snap = (v: number) =>
      Number((f.min + Math.round((v - f.min) / f.step) * f.step).toFixed(6));
    // Pointer x → snapped, clamped value on the bar.
    const valueAt = (clientX: number, rect: DOMRect) =>
      snap(clampToBounds(f.min + ((clientX - rect.left) / rect.width) * span));

    // Keep the label and the fill bar in sync with the two thumbs.
    const update = () => {
      const a = Number(lo.value);
      const b = Number(hi.value);
      val.textContent = `${a.toFixed(d)} – ${b.toFixed(d)}`;
      fill.style.left = `${pctOf(a)}%`;
      fill.style.width = `${Math.max(0, pctOf(b) - pctOf(a))}%`;
    };

    // Commit one or both thumbs: enforce min ≤ max (thumbs stop at each other, never cross),
    // push to app state, repaint, regen. Keyboard (arrows/Home/End on the focused native thumb)
    // and the pointer gestures below both route through these.
    const commitLo = () => {
      const v = Math.min(Number(lo.value), Number(hi.value));
      lo.value = String(v);
      appState.setTuning(p0, v);
      update();
      regen();
    };
    const commitHi = () => {
      const v = Math.max(Number(hi.value), Number(lo.value));
      hi.value = String(v);
      appState.setTuning(p1, v);
      update();
      regen();
    };
    const commitBoth = (a: number, b: number) => {
      lo.value = String(a);
      hi.value = String(b);
      appState.setTuning(p0, a);
      appState.setTuning(p1, b);
      update();
      regen();
    };
    lo.addEventListener("input", commitLo);
    hi.addEventListener("input", commitHi);

    // --- Pointer gestures on the bar ---
    // A press within THUMB_PX/2 of a thumb grabs THAT thumb (not "move both"), even when it sits
    // inside the highlighted span.
    const THUMB_PX = 18;
    let drag: null | "lo" | "hi" | "both" = null;
    let dragX = 0;
    let startLo = 0;
    let startHi = 0;

    bar.addEventListener("pointerdown", (e) => {
      const rect = bar.getBoundingClientRect();
      if (rect.width === 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      const a = Number(lo.value);
      const b = Number(hi.value);
      const pv = valueAt(e.clientX, rect);
      const endGrab = (THUMB_PX / 2 / rect.width) * span;
      if (pv > a + endGrab && pv < b - endGrab) {
        drag = "both"; // pressed the span interior → shift both, preserving the gap
        dragX = e.clientX;
        startLo = a;
        startHi = b;
        return;
      }
      // Otherwise grab the nearer thumb (ties — including an equal range — break to the side the
      // press is on) and jump it to the press, so click-to-position works like a single slider.
      drag = Math.abs(pv - a) < Math.abs(pv - b) || (a === b && pv < a) ? "lo" : "hi";
      if (drag === "lo") {
        lo.value = String(pv);
        lo.focus();
        commitLo();
      } else {
        hi.value = String(pv);
        hi.focus();
        commitHi();
      }
    });

    bar.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const rect = bar.getBoundingClientRect();
      if (rect.width === 0) return;
      if (drag === "both") {
        const gap = startHi - startLo;
        const dv = ((e.clientX - dragX) / rect.width) * span;
        const a = Math.max(f.min, Math.min(snap(startLo + dv), f.max - gap));
        commitBoth(a, a + gap);
      } else if (drag === "lo") {
        lo.value = String(valueAt(e.clientX, rect));
        commitLo();
      } else {
        hi.value = String(valueAt(e.clientX, rect));
        commitHi();
      }
    });

    const endDrag = (e: PointerEvent) => {
      if (!drag) return;
      drag = null;
      try {
        bar.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    };
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);

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

  // --- Layers: coarse on/off switches (e.g. "continents only") -------------------------------
  // Each toggle flips a FEATURES boolean the generator early-exits on, then regenerates. The
  // flags sync to the worker on the next `tune` message (see main.ts applyAdvancedTuning).
  {
    const details = document.createElement("details");
    details.className = "adv-group";
    details.open = false;

    const summary = document.createElement("summary");
    const title = document.createElement("span");
    title.className = "adv-title";
    title.textContent = "Layers";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "adv-reset";
    resetBtn.textContent = "reset";
    resetBtn.title = "turn all layers on";
    summary.append(title, resetBtn);
    details.append(summary);

    const fields = document.createElement("div");
    fields.className = "adv-fields";

    const layerIsOn = (layer: Layer): boolean => FEATURES[layer.key];

    // Flip a feature on/off. No regen here — the callers below batch one regen after the flip.
    const applyLayer = (layer: Layer, on: boolean): void => {
      FEATURES[layer.key] = on;
    };

    const rows = LAYERS.map((layer) => {
      const row = document.createElement("label");
      row.className = "adv-row adv-toggle";
      if (layer.doc) showDoc(row, layer.doc);
      const box = document.createElement("input");
      box.type = "checkbox";
      const sync = () => void (box.checked = layerIsOn(layer));
      sync();
      box.addEventListener("change", () => {
        applyLayer(layer, box.checked);
        onChange(); // discrete action → regen now, not debounced
      });
      row.append(box, document.createTextNode(` ${layer.label}`));
      fields.append(row);
      // Re-derived by refresh() after a section/global reset or a save restore.
      syncers.set(`__layer:${layer.key}`, sync);
      return { layer, box };
    });

    const setAll = (on: boolean): void => {
      for (const { layer, box } of rows) {
        box.checked = on;
        applyLayer(layer, on);
      }
      onChange();
    };

    resetBtn.addEventListener("click", (e) => {
      e.preventDefault(); // a click inside <summary> would otherwise toggle it
      e.stopPropagation();
      setAll(true);
    });

    // A VIEW toggle (not a generation feature): recolour cells by tectonic plate. Re-renders only
    // (no regen), so it writes the render setting directly and fires onViewChange.
    {
      const row = document.createElement("label");
      row.className = "adv-row adv-toggle";
      showDoc(
        row,
        "colour cells by tectonic plate instead of biome — a view overlay; doesn't change terrain"
      );
      const box = document.createElement("input");
      box.type = "checkbox";
      const sync = () => void (box.checked = appState.settings.viewPlates ?? false);
      sync();
      box.addEventListener("change", () => {
        appState.setSetting("viewPlates", box.checked);
        onViewChange();
      });
      row.append(box, document.createTextNode(" view plates"));
      fields.append(row);
      syncers.set("__view:plates", sync);
    }

    // "view labels": draw generated names for the map's features (seas, continents, …). A view
    // overlay like "view plates" — no regen, so it writes the render setting directly + redraws.
    {
      const row = document.createElement("label");
      row.className = "adv-row adv-toggle";
      showDoc(
        row,
        "draw generated names for the map's features (seas, continents, …) — a view overlay; doesn't change terrain"
      );
      const box = document.createElement("input");
      box.type = "checkbox";
      const sync = () => void (box.checked = appState.settings.viewLabels ?? false);
      sync();
      box.addEventListener("change", () => {
        appState.setSetting("viewLabels", box.checked);
        onViewChange();
      });
      row.append(box, document.createTextNode(" view labels"));
      fields.append(row);
      syncers.set("__view:labels", sync);
    }

    details.append(fields);
    panel.append(details);
  }

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
