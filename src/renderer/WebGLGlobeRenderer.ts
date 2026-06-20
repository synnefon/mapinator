import type { GlobeMap, Vec3 } from "../common/map";
import { hexToRgb } from "../common/colorUtils";
import type { Quat } from "../common/rotation";
import { LOD, type MapSettings } from "../common/settings";
import { computeCellColors } from "./BiomeColor";
import { GlobeRenderer, globeRadiusPx } from "./GlobeRenderer";

/** The spherical cap occluded by an overlaid patch (accepted for interface parity;
 * the WebGL path resolves overlap with the depth buffer instead — see `draw`). */
type SkipCap = { center: Vec3; cosKeep: number };

/** A renderer that draws a GlobeMap to a canvas. Canvas2D and WebGL both implement it. */
export interface IGlobeRenderer {
  draw(
    canvas: HTMLCanvasElement,
    map: GlobeMap,
    settings: MapSettings,
    orientation: Quat,
    clear?: boolean,
    skipCap?: SkipCap
  ): void;
}

// Limb-darkening floor; matches GlobeRenderer.AMBIENT (lower = sharper terminator).
const AMBIENT = 0.4;
// Depth range squash: keeps the projected z within the clip volume (-1..1) with
// headroom for the bias below, so front-hemisphere fragments are never near-clipped.
const Z_SQUASH = 0.9;
// A patch (drawn with clear=false) is nudged toward the camera by this much in clip
// z so it wins the depth test against the coincident, coarser base cells beneath it
// — the GPU equivalent of the Canvas2D occlusion cull, without per-cell bookkeeping.
const PATCH_DEPTH_BIAS = 0.002;
// Cap on cached per-map GPU buffer sets; comfortably above main.ts's map cache so the
// live base + patches stay resident. Oldest sets are deleted (freed) past this.
const GEOM_CACHE_CAP = 12;

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;    // unit-sphere position
layout(location = 1) in vec3 aColor;  // per-cell base colour (0..1)
uniform vec4 uQuat;      // world -> view rotation (x,y,z,w)
uniform vec2 uViewport;  // canvas size in device px
uniform float uRadius;   // apparent globe radius in px
uniform float uDepthBias;
uniform float uOffsetX;  // globe horizontal shift in NDC (room beside the menu)
out vec3 vColor;
out float vShade;        // view-space z → limb darkening

// Same optimized quaternion rotation as common/rotation.ts:qRotate.
vec3 qrot(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

void main() {
  vec3 r = qrot(uQuat, aPos);
  // Orthographic projection, matching GlobeRenderer's px math exactly:
  //   ndc = 2 * radius * r / viewport   (camera looks down +z).
  float ndcX = 2.0 * uRadius * r.x / uViewport.x + uOffsetX;
  float ndcY = 2.0 * uRadius * r.y / uViewport.y;
  // Front hemisphere (r.z = 1) maps nearest; squashed to stay inside the clip volume.
  float ndcZ = -r.z * ${Z_SQUASH.toFixed(3)} - uDepthBias;
  gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
  vColor = aColor;
  vShade = r.z;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 vColor;
in float vShade;
uniform float uAmbient;
out vec4 fragColor;
void main() {
  // Per-pixel limb darkening (smoother than the Canvas2D per-cell shade buckets).
  float shade = uAmbient + (1.0 - uAmbient) * clamp(vShade, 0.0, 1.0);
  fragColor = vec4(vColor * shade, 1.0);
}`;

type GeomEntry = {
  posBuf: WebGLBuffer;
  vertexCount: number;
  colorKey: string | null;
  colorBuf: WebGLBuffer | null;
};

type GLState = {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uQuat: WebGLUniformLocation;
  uViewport: WebGLUniformLocation;
  uRadius: WebGLUniformLocation;
  uDepthBias: WebGLUniformLocation;
  uOffsetX: WebGLUniformLocation;
  uAmbient: WebGLUniformLocation;
  // Per-map GPU buffers, LRU-evicted (insertion order) so GPU memory stays bounded.
  geom: Map<GlobeMap, GeomEntry>;
};

/**
 * WebGL2 globe renderer: the static cell mesh lives in GPU buffers; each frame is a
 * couple of draw calls with the orientation as a uniform, so rotate/zoom cost almost
 * nothing regardless of cell count. The rings share circumcenters exactly, so the
 * fan-triangulated mesh is watertight — no seam strokes, and depth testing both hides
 * the back hemisphere and lets an overlaid patch occlude the base it sits on.
 *
 * Drop-in for GlobeRenderer (same `draw` signature). `clear` distinguishes the base
 * pass (clears colour+depth) from a patch overlay (no clear, biased toward camera).
 */
export class WebGLGlobeRenderer implements IGlobeRenderer {
  private states = new WeakMap<HTMLCanvasElement, GLState>();

  /**
   * Whether WebGL2 is usable here. Probes a *throwaway* canvas and actually compiles
   * + links the program, since a canvas committed to a WebGL context can never fall
   * back to Canvas2D — so any driver-specific shader failure must be caught up front,
   * before the real canvas is touched.
   */
  static canRender(): boolean {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return false;
      gl.deleteProgram(linkProgram(gl, VERT_SRC, FRAG_SRC));
      return true;
    } catch {
      return false;
    }
  }

  public draw(
    canvas: HTMLCanvasElement,
    map: GlobeMap,
    settings: MapSettings,
    orientation: Quat,
    clear = true,
    _skipCap?: SkipCap
  ): void {
    const st = this.getState(canvas);
    const { gl } = st;

    gl.viewport(0, 0, canvas.width, canvas.height);
    if (clear) {
      gl.clearColor(0, 0, 0, 0); // transparent → page / export background shows through
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    const radius = globeRadiusPx(canvas, settings.zoom);
    const entry = this.getGeom(st, map, settings);
    if (entry.vertexCount === 0 || !entry.colorBuf) return;

    gl.useProgram(st.program);
    gl.uniform4f(st.uQuat, orientation.x, orientation.y, orientation.z, orientation.w);
    gl.uniform2f(st.uViewport, canvas.width, canvas.height);
    gl.uniform1f(st.uRadius, radius);
    gl.uniform1f(st.uDepthBias, clear ? 0 : PATCH_DEPTH_BIAS);
    // NDC spans 2 across the canvas, so a width-fraction offset is 2× in NDC.
    gl.uniform1f(st.uOffsetX, 2 * LOD.GLOBE_OFFSET_X);
    gl.uniform1f(st.uAmbient, AMBIENT);

    gl.bindBuffer(gl.ARRAY_BUFFER, entry.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.colorBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, entry.vertexCount);
  }

  /** Compile the program + cache GL state for a canvas (once per canvas). */
  private getState(canvas: HTMLCanvasElement): GLState {
    const existing = this.states.get(canvas);
    if (existing) return existing;

    // preserveDrawingBuffer so PNG export can read the rendered frame back via
    // drawImage/toDataURL; antialias for smooth cell edges (replaces seam strokes).
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      depth: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("webgl2 unavailable");

    const program = linkProgram(gl, VERT_SRC, FRAG_SRC);
    const uni = (name: string): WebGLUniformLocation => {
      const loc = gl.getUniformLocation(program, name);
      if (!loc) throw new Error(`missing uniform ${name}`);
      return loc;
    };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);

    const state: GLState = {
      gl,
      program,
      uQuat: uni("uQuat"),
      uViewport: uni("uViewport"),
      uRadius: uni("uRadius"),
      uDepthBias: uni("uDepthBias"),
      uOffsetX: uni("uOffsetX"),
      uAmbient: uni("uAmbient"),
      geom: new Map(),
    };
    this.states.set(canvas, state);
    return state;
  }

  /**
   * Geometry + colour buffers for a map. Positions are built once (the mesh never
   * changes); colours rebuild only when the theme / sea level changes. LRU-bounded.
   */
  private getGeom(st: GLState, map: GlobeMap, settings: MapSettings): GeomEntry {
    const { gl } = st;
    let entry = st.geom.get(map);
    if (entry) {
      st.geom.delete(map); // move to most-recently-used
      st.geom.set(map, entry);
    } else {
      const { positions, vertexCount } = buildPositions(map);
      entry = {
        posBuf: makeBuffer(gl, positions),
        vertexCount,
        colorKey: null,
        colorBuf: null,
      };
      st.geom.set(map, entry);
      while (st.geom.size > GEOM_CACHE_CAP) {
        const oldest = st.geom.keys().next().value;
        if (oldest === undefined) break;
        const e = st.geom.get(oldest)!;
        gl.deleteBuffer(e.posBuf);
        if (e.colorBuf) gl.deleteBuffer(e.colorBuf);
        st.geom.delete(oldest);
      }
    }

    const colorKey = `${settings.theme}|${settings.seaLevel}`;
    if (entry.colorKey !== colorKey) {
      const { palette, colorIdx } = computeCellColors(
        map,
        settings.theme,
        settings.seaLevel
      );
      const colors = buildColors(map, palette, colorIdx, entry.vertexCount);
      if (entry.colorBuf) gl.deleteBuffer(entry.colorBuf);
      entry.colorBuf = makeBuffer(gl, colors);
      entry.colorKey = colorKey;
    }
    return entry;
  }
}

/** Fan-triangulate every cell ring into a flat xyz vertex buffer (3 floats/vertex). */
function buildPositions(map: GlobeMap): {
  positions: Float32Array;
  vertexCount: number;
} {
  const { ringOffsets, ringVerts, cellCount } = map;
  let triCount = 0;
  for (let i = 0; i < cellCount; i++) {
    const m = ringOffsets[i + 1] - ringOffsets[i];
    if (m >= 3) triCount += m - 2;
  }
  const vertexCount = triCount * 3;
  const positions = new Float32Array(vertexCount * 3);

  let o = 0;
  for (let i = 0; i < cellCount; i++) {
    const s = ringOffsets[i];
    const m = ringOffsets[i + 1] - s;
    if (m < 3) continue;
    const b0 = 3 * s;
    const x0 = ringVerts[b0];
    const y0 = ringVerts[b0 + 1];
    const z0 = ringVerts[b0 + 2];
    // Convex Voronoi cell → simple fan from v0 (winding doesn't matter; depth-tested).
    for (let k = 1; k <= m - 2; k++) {
      const bk = 3 * (s + k);
      const bk1 = 3 * (s + k + 1);
      positions[o++] = x0;
      positions[o++] = y0;
      positions[o++] = z0;
      positions[o++] = ringVerts[bk];
      positions[o++] = ringVerts[bk + 1];
      positions[o++] = ringVerts[bk + 2];
      positions[o++] = ringVerts[bk1];
      positions[o++] = ringVerts[bk1 + 1];
      positions[o++] = ringVerts[bk1 + 2];
    }
  }
  return { positions, vertexCount };
}

/** Per-vertex RGB (0..1) matching buildPositions's vertex order; one colour per cell. */
function buildColors(
  map: GlobeMap,
  palette: string[],
  colorIdx: Int32Array,
  vertexCount: number
): Float32Array {
  // Resolve each distinct palette colour to RGB once.
  const pr = new Float32Array(palette.length);
  const pg = new Float32Array(palette.length);
  const pb = new Float32Array(palette.length);
  for (let p = 0; p < palette.length; p++) {
    const rgb = hexToRgb(palette[p]) ?? { r: 0, g: 0, b: 0 };
    pr[p] = rgb.r / 255;
    pg[p] = rgb.g / 255;
    pb[p] = rgb.b / 255;
  }

  const { ringOffsets, cellCount } = map;
  const colors = new Float32Array(vertexCount * 3);
  let o = 0;
  for (let i = 0; i < cellCount; i++) {
    const m = ringOffsets[i + 1] - ringOffsets[i];
    if (m < 3) continue;
    const p = colorIdx[i];
    const r = pr[p];
    const g = pg[p];
    const b = pb[p];
    const verts = (m - 2) * 3;
    for (let v = 0; v < verts; v++) {
      colors[o++] = r;
      colors[o++] = g;
      colors[o++] = b;
    }
  }
  return colors;
}

function makeBuffer(gl: WebGL2RenderingContext, data: Float32Array): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error("failed to create GL buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buf;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("failed to create shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("failed to create program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`program link failed: ${log}`);
  }
  return program;
}

/** WebGL2 when available (far faster orbit/zoom), else the Canvas2D renderer. */
export function createGlobeRenderer(): IGlobeRenderer {
  return WebGLGlobeRenderer.canRender()
    ? new WebGLGlobeRenderer()
    : new GlobeRenderer();
}
