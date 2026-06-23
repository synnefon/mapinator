import { Quat, Vec3 } from "../common/3DMath";
import { hexToRgb } from "../common/colorUtils";
import type { GlobeMap } from "../common/map";
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
// GPU buffer-cache budget. Measured (16:9): the whole LOD ladder resident — global base +
// one patch per level — is ~105 MB of indexed buffers, and WIDE-cap coarse patches dominate
// (L0 ≈ 29 MB vs the finest ≈ 6 MB), so a flat count cap would swing wildly in bytes. 160 MB
// holds the ladder + slack so zoom in/out reuses buffers instead of re-uploading; the oldest
// sets are deleted (freed) once the total exceeds this.
const GEOM_CACHE_BUDGET_BYTES = 160 * 1024 * 1024;

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;      // unit-sphere position
layout(location = 1) in uint aColorIdx; // per-vertex palette index (one colour per cell)
layout(location = 2) in float aShade;   // per-cell baked relief hillshade [0,1]
uniform vec4 uQuat;      // world -> view rotation (x,y,z,w)
uniform vec2 uViewport;  // canvas size in device px
uniform float uRadius;   // apparent globe radius in px
uniform float uDepthBias;
uniform float uOffsetX;  // globe horizontal shift in NDC (room beside the menu)
uniform sampler2D uPalette; // 1×N RGBA8 palette; cell colour fetched by index
out vec3 vColor;
out float vShade;        // view-space z → limb darkening
out float vTerrain;      // baked relief hillshade

// Same optimized quaternion rotation as common/3DMath.ts:Quat.rotate.
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
  // One palette texel per deduped cell colour → no per-vertex RGB to upload.
  vColor = texelFetch(uPalette, ivec2(int(aColorIdx), 0), 0).rgb;
  vShade = r.z;
  vTerrain = aShade;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 vColor;
in float vShade;
in float vTerrain;
uniform float uAmbient;
out vec4 fragColor;
void main() {
  // Per-pixel limb darkening (smoother than the Canvas2D per-cell shade buckets).
  float shade = uAmbient + (1.0 - uAmbient) * clamp(vShade, 0.0, 1.0);
  // Baked relief hillshade makes mountains read as 3D — just a multiply, no per-frame work.
  fragColor = vec4(vColor * shade * vTerrain, 1.0);
}`;

type GeomEntry = {
  // Positions ARE the map's ring vertices, uploaded as-is (no fan expansion); idxBuf fans
  // each cell ring. Colour is a per-vertex palette INDEX (u16) resolved against palTex.
  posBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  shadeBuf: WebGLBuffer; // per-vertex u8 relief hillshade (static, built with the geometry)
  indexCount: number;
  colorKey: string | null;
  colorBuf: WebGLBuffer | null;
  palTex: WebGLTexture | null;
  bytes: number; // GPU bytes (pos + idx + shade + colour + palette) for the byte-budget LRU
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
  uPalette: WebGLUniformLocation;
  // Per-map GPU buffers, LRU-evicted by total bytes so GPU memory stays bounded.
  geom: Map<GlobeMap, GeomEntry>;
  geomBytes: number;
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
    if (entry.indexCount === 0 || !entry.colorBuf || !entry.palTex) return;

    gl.useProgram(st.program);
    gl.uniform4f(st.uQuat, orientation.x, orientation.y, orientation.z, orientation.w);
    gl.uniform2f(st.uViewport, canvas.width, canvas.height);
    gl.uniform1f(st.uRadius, radius);
    gl.uniform1f(st.uDepthBias, clear ? 0 : PATCH_DEPTH_BIAS);
    // NDC spans 2 across the canvas, so a width-fraction offset is 2× in NDC.
    gl.uniform1f(st.uOffsetX, 2 * LOD.GLOBE_OFFSET_FRACTION);
    gl.uniform1f(st.uAmbient, AMBIENT);

    // Positions are the ring vertices; idxBuf fans each cell. Colour is a u16 palette
    // index resolved against the 1×N palette texture bound on unit 0.
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.colorBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_SHORT, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, entry.shadeBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, true, 0, 0); // normalized → [0,1]
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.palTex);
    gl.uniform1i(st.uPalette, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, entry.idxBuf);
    gl.drawElements(gl.TRIANGLES, entry.indexCount, gl.UNSIGNED_INT, 0);
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
      uPalette: uni("uPalette"),
      geom: new Map(),
      geomBytes: 0,
    };
    this.states.set(canvas, state);
    return state;
  }

  /**
   * Geometry + colour buffers for a map. Positions are built once (the mesh never
   * changes); colours rebuild only when the theme changes. LRU-bounded.
   */
  private getGeom(st: GLState, map: GlobeMap, settings: MapSettings): GeomEntry {
    const { gl } = st;
    let entry = st.geom.get(map);
    if (entry) {
      st.geom.delete(map); // move to most-recently-used
      st.geom.set(map, entry);
    } else {
      // Positions = the map's ring vertices verbatim (no fan expansion → ~half the bytes,
      // no main-thread rebuild); idxBuf fans each ring into triangles.
      const { indices, indexCount } = buildIndices(map);
      entry = {
        posBuf: makeBuffer(gl, gl.ARRAY_BUFFER, map.ringVerts),
        idxBuf: makeBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices),
        shadeBuf: makeBuffer(gl, gl.ARRAY_BUFFER, buildShadeBytes(map)),
        indexCount,
        colorKey: null,
        colorBuf: null,
        palTex: null,
        bytes: map.ringVerts.byteLength + indices.byteLength + map.ringVerts.length / 3,
      };
      st.geom.set(map, entry);
      st.geomBytes += entry.bytes;
      // Evict the least-recently-used sets until under the byte budget (keep ≥ 1).
      while (st.geomBytes > GEOM_CACHE_BUDGET_BYTES && st.geom.size > 1) {
        const oldest = st.geom.keys().next().value;
        if (oldest === undefined || oldest === map) break;
        const e = st.geom.get(oldest)!;
        gl.deleteBuffer(e.posBuf);
        gl.deleteBuffer(e.idxBuf);
        gl.deleteBuffer(e.shadeBuf);
        if (e.colorBuf) gl.deleteBuffer(e.colorBuf);
        if (e.palTex) gl.deleteTexture(e.palTex);
        st.geomBytes -= e.bytes;
        st.geom.delete(oldest);
      }
    }

    const colorKey = settings.theme;
    if (entry.colorKey !== colorKey) {
      const { palette, colorIdx } = computeCellColors(map, settings.theme);
      const colorIndices = buildColorIndices(map, colorIdx);
      if (entry.colorBuf) gl.deleteBuffer(entry.colorBuf);
      if (entry.palTex) gl.deleteTexture(entry.palTex);
      st.geomBytes -= entry.bytes;
      entry.colorBuf = makeBuffer(gl, gl.ARRAY_BUFFER, colorIndices);
      entry.palTex = makePaletteTexture(gl, palette);
      entry.colorKey = colorKey;
      entry.bytes =
        map.ringVerts.byteLength +
        entry.indexCount * 4 +
        colorIndices.byteLength +
        palette.length * 4;
      st.geomBytes += entry.bytes;
    }
    return entry;
  }
}

/** Fan indices for every cell ring, into the map's ring-vertex array (vertex `j` of cell `i`
 *  lives at ringVerts[3*(ringOffsets[i] + local)]). Topology only — no terrain data, so this
 *  could move to the worker later. Convex cell → simple fan from v0. */
function buildIndices(map: GlobeMap): { indices: Uint32Array; indexCount: number } {
  const { ringOffsets, cellCount } = map;
  let triCount = 0;
  for (let i = 0; i < cellCount; i++) {
    const m = ringOffsets[i + 1] - ringOffsets[i];
    if (m >= 3) triCount += m - 2;
  }
  const indexCount = triCount * 3;
  const indices = new Uint32Array(indexCount);
  let o = 0;
  for (let i = 0; i < cellCount; i++) {
    const s = ringOffsets[i];
    const m = ringOffsets[i + 1] - s;
    if (m < 3) continue;
    for (let k = 1; k <= m - 2; k++) {
      indices[o++] = s;
      indices[o++] = s + k;
      indices[o++] = s + k + 1;
    }
  }
  return { indices, indexCount };
}

/** One u8 [0,255] relief-shade per ring vertex (every vertex of a cell shares the cell's
 *  shade), in ring-vertex order. Read as a normalized [0,1] float attribute in the shader. */
function buildShadeBytes(map: GlobeMap): Uint8Array {
  const { ringOffsets, cellCount, shade } = map;
  const out = new Uint8Array(map.ringVerts.length / 3);
  for (let i = 0; i < cellCount; i++) {
    const s = Math.max(0, Math.min(255, Math.round(shade[i] * 255)));
    for (let v = ringOffsets[i]; v < ringOffsets[i + 1]; v++) out[v] = s;
  }
  return out;
}

/** One u16 palette index per ring vertex (every vertex of a cell shares the cell's colour),
 *  in the ring-vertex order of map.ringVerts. Resolved to RGB by the palette texture. */
function buildColorIndices(map: GlobeMap, colorIdx: Int32Array): Uint16Array {
  const { ringOffsets, cellCount } = map;
  const out = new Uint16Array(map.ringVerts.length / 3);
  for (let i = 0; i < cellCount; i++) {
    const ci = colorIdx[i];
    for (let v = ringOffsets[i]; v < ringOffsets[i + 1]; v++) out[v] = ci;
  }
  return out;
}

/** 1×N RGBA8 texture of the deduped cell palette; texelFetched by index in the shader. The
 *  palette is small (≤ ~600 colours measured, well under MAX_TEXTURE_SIZE). */
function makePaletteTexture(gl: WebGL2RenderingContext, palette: string[]): WebGLTexture {
  const n = Math.max(1, palette.length);
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < palette.length; i++) {
    const rgb = hexToRgb(palette[i]) ?? { r: 0, g: 0, b: 0 };
    data[4 * i] = rgb.r;
    data[4 * i + 1] = rgb.g;
    data[4 * i + 2] = rgb.b;
    data[4 * i + 3] = 255;
  }
  const tex = gl.createTexture();
  if (!tex) throw new Error("failed to create palette texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeBuffer(
  gl: WebGL2RenderingContext,
  target: number,
  data: AllowSharedBufferSource
): WebGLBuffer {
  const buf = gl.createBuffer();
  if (!buf) throw new Error("failed to create GL buffer");
  gl.bindBuffer(target, buf);
  gl.bufferData(target, data, gl.STATIC_DRAW);
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
