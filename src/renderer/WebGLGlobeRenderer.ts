import { Quat, Vec3 } from "../common/3DMath";
import { hexToRgb } from "../common/colorUtils";
import type { GlobeMap } from "../common/map";
import { COUNTRIES, LOD, OCEANS, type MapSettings, type TerrainParams } from "../common/settings";
import { GpuField } from "../mapgen/gpu/GpuField";
import type { PlateData } from "../mapgen/gpu/plateData";
import { computeCellColors, koppenPaletteRgb, type ChoroplethTint } from "./BiomeColor";
import { KOPPEN_ZONE_COUNT } from "../common/koppen";
import { bakeCountryTexture, COUNTRY_TEX_H, COUNTRY_TEX_W, HUES } from "./countryTexture";
import { globeRadiusPx, GlobeRenderer } from "./GlobeRenderer";

/** Per-seed inputs the GPU patch path needs to compute the field (built main-side from the seed). */
export type GpuFieldInputs = { params: TerrainParams; perm: Float32Array; plate: PlateData };

/** Fine per-cell country data for a GPU patch (from the worker re-grow): per-cell compact country index
 *  aligned to the patch's cells (-1 = water/none), the 4-colour class per country (→ hue), and the
 *  hovered country (-1 = none). The renderer bakes these into one per-cell RGBA texture and tints +
 *  highlights the patch from it — no equirect texture, no dilation. */
export type PatchCountryTint = { countryOf: Int32Array; colors: Int32Array; hovered: number };

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
    skipCap?: SkipCap,
    choropleth?: ChoroplethTint
  ): void;
  /** Horizontal offset of the globe centre as a fraction of canvas width (the globe is nudged
   *  right to clear the menu). Renderer-specific, so a 2D overlay can match the projection. */
  horizontalOffsetFraction(): number;
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
layout(location = 3) in vec4 aCountry;  // per-cell choropleth: rgb = country hue, a = land/has-country flag
uniform vec4 uQuat;      // world -> view rotation (x,y,z,w)
uniform vec2 uViewport;  // canvas size in device px
uniform float uRadius;   // apparent globe radius in px
uniform float uDepthBias;
uniform float uOffsetX;  // globe horizontal shift in NDC (room beside the menu)
uniform sampler2D uPalette; // 1×N RGBA8 palette; cell colour fetched by index
out vec3 vColor;
out float vShade;        // view-space z → limb darkening
out float vTerrain;      // baked relief hillshade
out vec3 vWorldDir;      // un-rotated unit-sphere direction → samples the country choropleth texture
flat out vec4 vCountry;  // per-cell country tint + land flag (every vert of a cell shares it → flat)

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
  vWorldDir = aPos;
  vCountry = aCountry;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec3 vColor;
in float vShade;
in float vTerrain;
in vec3 vWorldDir;
flat in vec4 vCountry;         // per-cell choropleth tint + land flag (baked from countryOf, see draw)
uniform float uAmbient;
uniform sampler2D uCountryTex; // equirect choropleth FALLBACK (CPU-overlay path): rgb = hue, a = land flag
uniform float uChoropleth;     // 0 = off, else the country-tint OPACITY (mix amount)
uniform float uUseCellCountry; // 1 = per-cell vCountry (base globe), 0 = equirect uCountryTex (CPU overlay)
out vec4 fragColor;
void main() {
  // Hillshade (vTerrain) makes mountains read as 3D; it's applied to the BIOME only. The flat country
  // tint is laid on top (a clean political overlay, NOT relief-shaded), and only over country LAND
  // (the alpha flag) so open water keeps its natural colour — no darkened sea, no shaded tint.
  vec3 dir = normalize(vWorldDir);
  vec2 uv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  vec3 col = vColor * vTerrain;
  if (uChoropleth > 0.0) {
    // Per-cell tint (vCountry) for the base globe: gated on the SAME per-cell countryOf the biome's
    // land/water + the GPU patch derive from, so the tint boundary IS the rendered coast — no equirect
    // re-rasterization, no coastal specks. The equirect (uCountryTex) is only the CPU-overlay fallback,
    // where the drawn (finer) mesh's cells don't match the base countryOf.
    vec4 cc = uUseCellCountry > 0.5 ? vCountry : texture(uCountryTex, uv);
    if (cc.a > 0.5) col = mix(col, cc.rgb, uChoropleth); // a = land flag; uChoropleth = tint opacity
  }
  // Per-pixel limb darkening (smoother than the Canvas2D per-cell shade buckets).
  float shade = uAmbient + (1.0 - uAmbient) * clamp(vShade, 0.0, 1.0);
  fragColor = vec4(col * shade, 1.0);
}`;

// --- GPU detail-patch path (no readback): the field is computed on this context into a texture
// (GpuField), and these shaders sample it per cell + a baked colour LUT, so no per-cell colour/shade
// is uploaded and the worker never runs the CPU noise. Used only for mesh-only detail patches.
const PATCH_VERT_SRC = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec3 aPos;       // unit-sphere ring vertex
layout(location = 1) in uint aCellIndex; // which cell this vertex belongs to (→ field texel)
uniform vec4 uQuat;
uniform vec2 uViewport;
uniform float uRadius;
uniform float uDepthBias;
uniform float uOffsetX;
uniform highp sampler2D uField; // RGBA32F per-cell field: (elevation, moisture, ice, shade)
uniform sampler2D uCountryField; // RGBA8 per-cell country: rgb = country hue, a = (index+1)/255 (0 = none)
uniform int uFieldWidth;
flat out vec4 vField;           // per-cell, so flat (no interpolation across the cell)
flat out vec4 vCountry;         // per-cell country tint + index (see uCountryField)
out float vLimb;                // view-space z → limb darkening
out vec3 vWorldDir;             // un-rotated direction → equirect country sample (re-grow-gap fallback)
vec3 qrot(vec4 q, vec3 v) { vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
void main() {
  vec3 r = qrot(uQuat, aPos);
  float ndcX = 2.0 * uRadius * r.x / uViewport.x + uOffsetX;
  float ndcY = 2.0 * uRadius * r.y / uViewport.y;
  float ndcZ = -r.z * ${Z_SQUASH.toFixed(3)} - uDepthBias;
  gl_Position = vec4(ndcX, ndcY, ndcZ, 1.0);
  int idx = int(aCellIndex);
  ivec2 texel = ivec2(idx % uFieldWidth, idx / uFieldWidth);
  vField = texelFetch(uField, texel, 0);
  vCountry = texelFetch(uCountryField, texel, 0);
  vLimb = r.z;
  vWorldDir = aPos;
}`;

const PATCH_FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;
flat in vec4 vField;
flat in vec4 vCountry; // per-cell: rgb = country hue, a = (index+1)/255 (0 = water / no country)
in float vLimb;
in vec3 vWorldDir;
uniform float uAmbient;
uniform float uSeaLevel;       // land/ocean split — clips the country tint to the patch's own (fine) coastline
uniform vec3 uPalette[${KOPPEN_ZONE_COUNT}]; // Köppen zone id → earth colour (mirrors KOPPEN_COLORS)
uniform float uChoropleth;     // 0 = off, else the country-tint OPACITY (mix amount)
uniform float uUseCellCountry; // 1 = per-cell (re-grow landed), 0 = coarse equirect fallback (gap)
uniform int uHoverCountry;     // hovered country index, or -1 = none
uniform sampler2D uCountryTex; // equirect choropleth: rgb = dilated country hue (gated by per-cell coast)
out vec4 fragColor;
void main() {
  float elev = vField.r, shade = vField.a;
  // Biome colour: the field baked the cell's KÖPPEN ZONE into .b (ElevationCalculator / the field shader
  // ran the classifier), so the draw is a pure palette lookup — no LUT, no ice mix. +0.5 rounds the float
  // zone id; ocean is just the OCEAN_DEEP/MID/SHALLOW zones, so the biome coast IS the classifier's waterline.
  int zone = int(vField.b + 0.5);
  vec3 biome = uPalette[zone];
  // Hillshade applies to TERRAIN only; the country tint + highlight are laid FLAT on top — a clean
  // political overlay, crisp to the fine coast (per-cell from vCountry, no equirect sampling/dilation).
  vec3 col = biome * shade;
  if (elev >= uSeaLevel) {
    if (uUseCellCountry > 0.5) {
      // Re-grow landed. Choropleth tint is gated on the colours layer; the hover highlight is INDEPENDENT
      // (it works with just borders/labels on, no choropleth needed) — both flat over the shaded terrain.
      int country = int(vCountry.a * 255.0 + 0.5) - 1; // -1 = none
      if (country >= 0) {
        if (uChoropleth > 0.0) col = mix(col, vCountry.rgb, uChoropleth);
        if (country == uHoverCountry) col = mix(col, vec3(0.8, 0.12, 0.12), 0.25);
      }
    } else if (uChoropleth > 0.0) {
      // Country tint from the equirect (rgb = the owning country's hue, grown over water by contiguity).
      // Gated only by THIS patch's per-cell coast (the enclosing elev test), so the fill follows the fine
      // coastline — no re-grow, no per-patch classification. uChoropleth doubles as the tint opacity.
      vec3 dir = normalize(vWorldDir);
      vec2 uv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5, asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5);
      col = mix(col, texture(uCountryTex, uv).rgb, uChoropleth);
    }
  }
  float limb = uAmbient + (1.0 - uAmbient) * clamp(vLimb, 0.0, 1.0);
  fragColor = vec4(col * limb, 1.0);
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
  // Per-cell choropleth attribute (RGBA8 per ring vertex: rgb = country hue, a = land flag), baked from
  // the choropleth's countryOf + rebuilt only when the assignment (countryKey) changes. Null when this
  // map isn't the choropleth's base map (e.g. a CPU-overlay mesh → equirect fallback) or colours are off.
  countryBuf: WebGLBuffer | null;
  countryKey: string | null;
  countryBytes: number; // countryBuf's contribution to `bytes` (so the byte-budget LRU stays balanced)
  bytes: number; // GPU bytes (pos + idx + shade + colour + palette + country) for the byte-budget LRU
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
  uCountryTex: WebGLUniformLocation;
  uChoropleth: WebGLUniformLocation;
  uUseCellCountry: WebGLUniformLocation;
  // Choropleth country texture (equirect): the GPU patch's pre-re-grow gap fallback + the CPU-overlay
  // path. The base globe now tints per-cell from its own country attribute (see GeomEntry.countryBuf).
  countryTex: WebGLTexture | null;
  countryKey: string | null;
  // Per-map GPU buffers, LRU-evicted by total bytes so GPU memory stays bounded.
  geom: Map<GlobeMap, GeomEntry>;
  geomBytes: number;
  // GPU detail-patch path (lazy: `undefined` = not tried yet, `null` = unavailable on this device).
  patch?: PatchProgram | null;
  gpuField?: GpuField | null;
  riverField?: GpuField | null; // separate field sampler for river routing (readback) — keeps the patch texture undisturbed
  patchGeom: Map<GlobeMap, PatchGeomEntry>; // pos + fan idx + cell index + per-cell country tex, LRU by count
  // The patch field is a pure function of (sites, params, perm, plate); cache the last render so orbit/zoom
  // frames over an unchanged overlay reuse its texture instead of recomputing the field + re-uploading + syncing.
  lastPatchField?: { texture: WebGLTexture; width: number; count: number } | null;
  lastPatchFieldMap?: GlobeMap | null;
  lastPatchFieldInputs?: GpuFieldInputs | null;
};

type PatchProgram = {
  program: WebGLProgram;
  uQuat: WebGLUniformLocation;
  uViewport: WebGLUniformLocation;
  uRadius: WebGLUniformLocation;
  uDepthBias: WebGLUniformLocation;
  uOffsetX: WebGLUniformLocation;
  uAmbient: WebGLUniformLocation;
  uSeaLevel: WebGLUniformLocation;
  uField: WebGLUniformLocation;
  uFieldWidth: WebGLUniformLocation;
  uPalette: WebGLUniformLocation;
  uCountryField: WebGLUniformLocation;
  uCountryTex: WebGLUniformLocation;
  uChoropleth: WebGLUniformLocation;
  uUseCellCountry: WebGLUniformLocation;
  uHoverCountry: WebGLUniformLocation;
};

// Per-patch GPU buffers + its per-cell country texture (RGBA8: rgb = hue, a = index+1), all LRU'd
// together so a revisited patch reuses them — no re-upload of the country tint on pan-back / zoom.
type PatchGeomEntry = {
  posBuf: WebGLBuffer;
  idxBuf: WebGLBuffer;
  cellIdxBuf: WebGLBuffer;
  indexCount: number;
  countryTex: WebGLTexture | null; // baked on demand from the patch's re-grown countryOf
  countryOf: Int32Array | null; // the array last baked into countryTex (identity-compared to rebuild)
};

// Detail patches are transient (re-derived on zoom) and large, so keep only a few resident.
const PATCH_GEOM_CACHE_CAP = 4;

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

  /** Whether the GPU detail-patch path is usable here: WebGL2 + a float render target (probed by
   *  actually constructing a GpuField on a throwaway canvas). Decided up front so generation knows
   *  whether to build detail rungs mesh-only (no CPU field sampling). */
  static canRenderGpuPatches(): boolean {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return false;
      const field = GpuField.create(gl); // float render target + the field shader
      if (!field) return false;
      field.dispose();
      gl.deleteProgram(linkProgram(gl, PATCH_VERT_SRC, PATCH_FRAG_SRC)); // and the patch program compiles
      return true;
    } catch {
      return false;
    }
  }

  /** WebGL shifts the globe right by LOD.GLOBE_OFFSET_FRACTION (the uOffsetX uniform). */
  public horizontalOffsetFraction(): number {
    return LOD.GLOBE_OFFSET_FRACTION;
  }

  /**
   * Sample the river routing field on the GPU (elevation + moisture + reportElevation) for an arbitrary
   * set of cell `sites`, with one readback. The rivers feature routes flow on a dedicated fine mesh; this
   * is the heavy multi-octave sampling, kept on the GPU. Returns null if the GPU field path is
   * unavailable here or the mesh exceeds one render strip. Owns a GpuField separate from the patch one,
   * so the per-frame patch texture is never disturbed.
   */
  public computeRiverField(
    canvas: HTMLCanvasElement,
    sites: Float32Array,
    inputs: GpuFieldInputs
  ): { elevation: Float32Array; moisture: Float32Array; ice: Float32Array; reportElevation: Float32Array } | null {
    const st = this.getState(canvas);
    if (st.riverField === undefined) st.riverField = GpuField.create(st.gl);
    if (!st.riverField || !st.riverField.fits(sites.length / 3)) return null;
    return st.riverField.computeRiverField(sites, inputs.params, inputs.perm, inputs.plate);
  }

  /**
   * Compute the base globe's full field on the GPU + read it back (elevation/moisture/ice/shade +
   * reportElevation), so the base globe's fields — and thus feature placement — come from the SAME field
   * the renderer draws, instead of a separate CPU noise pass. One-time per base map. Reuses the readback
   * field (shared with rivers; the per-frame patch texture is untouched). Null if the GPU path can't run.
   */
  public computeBaseField(
    canvas: HTMLCanvasElement,
    sites: Float32Array,
    inputs: GpuFieldInputs
  ): { elevation: Float32Array; moisture: Float32Array; koppenZone: Float32Array; shade: Float32Array; reportElevation: Float32Array } | null {
    const st = this.getState(canvas);
    if (st.riverField === undefined) st.riverField = GpuField.create(st.gl);
    if (!st.riverField || !st.riverField.fits(sites.length / 3)) return null;
    return st.riverField.computeBaseField(sites, inputs.params, inputs.perm, inputs.plate);
  }


  public draw(
    canvas: HTMLCanvasElement,
    map: GlobeMap,
    settings: MapSettings,
    orientation: Quat,
    clear = true,
    _skipCap?: SkipCap,
    choropleth?: ChoroplethTint
  ): void {
    const st = this.getState(canvas);
    const { gl } = st;

    gl.viewport(0, 0, canvas.width, canvas.height);
    if (clear) {
      gl.clearColor(0, 0, 0, 0); // transparent → page / export background shows through
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    const radius = globeRadiusPx(canvas, settings.zoom);
    const entry = this.getGeom(st, map, settings, choropleth);
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

    // Choropleth country texture on unit 1 (baked on demand, cached by key; shared by base + patch
    // passes so the tint follows onto detail patches). When off, bind any valid texture; the mix is 0.
    gl.activeTexture(gl.TEXTURE1);
    if (choropleth) {
      if (!st.countryTex) {
        st.countryTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, st.countryTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); // longitude seam wraps
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // poles clamp
        // NEAREST, not LINEAR: the choropleth is a discrete partition, so interpolating between two
        // countries' hues blurs the boundary (fuzzy borders) and, near a coast, blends to a wrong third
        // colour on the odd cell. NEAREST keeps each country's hue + the land/water alpha flag crisp.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, st.countryTex);
      }
      if (st.countryKey !== choropleth.key) {
        const data = bakeCountryTexture(choropleth.map, choropleth.countryOf, choropleth.countryColors);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, COUNTRY_TEX_W, COUNTRY_TEX_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        st.countryKey = choropleth.key;
      }
      gl.uniform1f(st.uChoropleth, COUNTRIES.CHOROPLETH_OPACITY.value); // doubles as the tint mix amount
    } else {
      gl.bindTexture(gl.TEXTURE_2D, entry.palTex); // any valid texture; the blend is scaled to 0
      gl.uniform1f(st.uChoropleth, 0.0);
    }
    gl.uniform1i(st.uCountryTex, 1);

    // Per-cell tint attribute (location 3): present iff this map is the choropleth's base map. When it is,
    // the shader gates the tint on it (the rendered coast, no specks); otherwise (CPU-overlay mesh, or
    // colours off) it falls back to the equirect sampled by direction.
    const useCellCountry = !!entry.countryBuf;
    if (useCellCountry) {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.countryBuf);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, 0, 0); // normalized → rgb/a in [0,1]
    } else {
      gl.disableVertexAttribArray(3);
    }
    gl.uniform1f(st.uUseCellCountry, useCellCountry ? 1.0 : 0.0);

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
      uCountryTex: uni("uCountryTex"),
      uChoropleth: uni("uChoropleth"),
      uUseCellCountry: uni("uUseCellCountry"),
      countryTex: null,
      countryKey: null,
      geom: new Map(),
      geomBytes: 0,
      patchGeom: new Map(),
    };
    this.states.set(canvas, state);
    return state;
  }

  /**
   * Draw a mesh-only detail patch by computing its field on the GPU (no readback) and sampling it +
   * a baked colour LUT in the shader — so the worker never ran the CPU noise and nothing round-trips.
   * Returns false if the GPU field path is unavailable here (no WebGL2 float RT), so the caller falls
   * back to the normal CPU `draw`. Drawn as an overlay (no clear, biased toward the camera).
   */
  public drawPatchGpu(
    canvas: HTMLCanvasElement,
    map: GlobeMap,
    inputs: GpuFieldInputs,
    settings: MapSettings,
    orientation: Quat,
    patchCountry?: PatchCountryTint
  ): boolean {
    const st = this.getState(canvas);
    const { gl } = st;
    if (st.gpuField === undefined) st.gpuField = GpuField.create(gl);
    if (!st.gpuField || !st.gpuField.fits(map.cellCount)) return false;
    if (st.patch === undefined) st.patch = this.buildPatchProgram(gl);
    if (!st.patch) return false;

    const geom = this.getPatchGeom(st, map);
    if (geom.indexCount === 0) return false;

    // Compute the field into a GPU texture (no readback) — but only when the patch or its inputs actually
    // changed. The field is static for a resident patch, so during orbit/zoom/momentum (same map + inputs)
    // we reuse the texture from the last render, skipping the full multi-octave pass + texture uploads + sync.
    let field = st.lastPatchField;
    if (!field || st.lastPatchFieldMap !== map || st.lastPatchFieldInputs !== inputs) {
      field = st.gpuField.renderToTexture(map.sites, inputs.params, inputs.perm, inputs.plate);
      st.lastPatchField = field;
      st.lastPatchFieldMap = map;
      st.lastPatchFieldInputs = inputs;
    }

    const p = st.patch;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(p.program);
    gl.uniform4f(p.uQuat, orientation.x, orientation.y, orientation.z, orientation.w);
    gl.uniform2f(p.uViewport, canvas.width, canvas.height);
    gl.uniform1f(p.uRadius, globeRadiusPx(canvas, settings.zoom));
    gl.uniform1f(p.uDepthBias, PATCH_DEPTH_BIAS); // overlay: bias toward the camera over the base
    gl.uniform1f(p.uOffsetX, 2 * LOD.GLOBE_OFFSET_FRACTION);
    gl.uniform1f(p.uAmbient, AMBIENT);
    gl.uniform1f(p.uSeaLevel, OCEANS.SEA_LEVEL.value);
    gl.uniform3fv(p.uPalette, koppenPaletteRgb(settings.theme)); // Köppen zone → colour (matches the CPU base mesh)
    gl.uniform1i(p.uFieldWidth, field.width);

    gl.bindBuffer(gl.ARRAY_BUFFER, geom.posBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, geom.cellIdxBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, field.texture);
    gl.uniform1i(p.uField, 0);

    // Per-cell country tint + highlight: bake the patch's re-grown countryOf (+ 4-colour classes) into an
    // RGBA8 strip matching the field layout (rgb = hue, a = index+1), rebuilt only when the array changes.
    // This is the crisp, no-dilation path (the equirect on unit 3 is only the pre-re-grow fallback). Select
    // unit 2 FIRST: the upload below binds + texImage2Ds on the ACTIVE unit, so without this it would
    // clobber the colour LUT on unit 1 for the upload frame (garbage biome on the first frame at a zoom).
    gl.activeTexture(gl.TEXTURE2);
    if (geom.countryTex === null) geom.countryTex = gl.createTexture();
    if (patchCountry && geom.countryOf !== patchCountry.countryOf) {
      const W = field.width, H = Math.ceil(map.cellCount / W);
      const data = new Uint8Array(W * H * 4);
      const { countryOf, colors } = patchCountry;
      for (let i = 0; i < map.cellCount; i++) {
        const ci = countryOf[i];
        if (ci < 0) continue; // water / no country → a = 0
        const hue = HUES[colors[ci]] ?? HUES[0];
        data[4 * i] = hue[0]; data[4 * i + 1] = hue[1]; data[4 * i + 2] = hue[2]; data[4 * i + 3] = ci + 1;
      }
      gl.bindTexture(gl.TEXTURE_2D, geom.countryTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      geom.countryOf = patchCountry.countryOf;
    }
    gl.bindTexture(gl.TEXTURE_2D, patchCountry && geom.countryTex ? geom.countryTex : field.texture);
    gl.uniform1i(p.uCountryField, 2);
    // Equirect choropleth on unit 3 — the COARSE fallback the shader uses UNTIL the per-cell re-grow lands
    // (baked by the base pass earlier this frame), so the choropleth doesn't blink off during pan/zoom. A
    // harmless stand-in when unbaked (choropleth is then off, so it isn't sampled).
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, st.countryTex ?? field.texture);
    gl.uniform1i(p.uCountryTex, 3);
    gl.uniform1f(p.uChoropleth, (settings.viewCountryColors ?? false) ? COUNTRIES.CHOROPLETH_OPACITY.value : 0.0);
    gl.uniform1f(p.uUseCellCountry, patchCountry ? 1.0 : 0.0);
    gl.uniform1i(p.uHoverCountry, patchCountry ? patchCountry.hovered : -1);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geom.idxBuf);
    gl.drawElements(gl.TRIANGLES, geom.indexCount, gl.UNSIGNED_INT, 0);
    return true;
  }

  // Compile the patch program (returns null on failure → caller falls back to the CPU path).
  private buildPatchProgram(gl: WebGL2RenderingContext): PatchProgram | null {
    let program: WebGLProgram;
    try {
      program = linkProgram(gl, PATCH_VERT_SRC, PATCH_FRAG_SRC);
    } catch (e) {
      console.error("patch program failed:", e);
      return null;
    }
    const uni = (name: string): WebGLUniformLocation => {
      const loc = gl.getUniformLocation(program, name);
      if (!loc) throw new Error(`missing patch uniform ${name}`);
      return loc;
    };
    return {
      program,
      uQuat: uni("uQuat"),
      uViewport: uni("uViewport"),
      uRadius: uni("uRadius"),
      uDepthBias: uni("uDepthBias"),
      uOffsetX: uni("uOffsetX"),
      uAmbient: uni("uAmbient"),
      uSeaLevel: uni("uSeaLevel"),
      uField: uni("uField"),
      uFieldWidth: uni("uFieldWidth"),
      uPalette: uni("uPalette"),
      uCountryField: uni("uCountryField"),
      uCountryTex: uni("uCountryTex"),
      uChoropleth: uni("uChoropleth"),
      uUseCellCountry: uni("uUseCellCountry"),
      uHoverCountry: uni("uHoverCountry"),
    };
  }

  // Geometry for a GPU patch: positions (ring verts) + fan indices + per-vertex cell index. No colour
  // buffers (the shader colours from the field texture). Small count-based LRU (patches are transient).
  private getPatchGeom(st: GLState, map: GlobeMap): PatchGeomEntry {
    const { gl } = st;
    const existing = st.patchGeom.get(map);
    if (existing) {
      st.patchGeom.delete(map);
      st.patchGeom.set(map, existing);
      return existing;
    }
    const { indices, indexCount } = buildIndices(map);
    const entry: PatchGeomEntry = {
      posBuf: makeBuffer(gl, gl.ARRAY_BUFFER, map.ringVerts),
      idxBuf: makeBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices),
      cellIdxBuf: makeBuffer(gl, gl.ARRAY_BUFFER, buildCellIndices(map)),
      indexCount,
      countryTex: null, // baked lazily in drawPatchGpu when this patch has country data
      countryOf: null,
    };
    st.patchGeom.set(map, entry);
    while (st.patchGeom.size > PATCH_GEOM_CACHE_CAP) {
      const oldest = st.patchGeom.keys().next().value;
      if (oldest === undefined || oldest === map) break;
      const e = st.patchGeom.get(oldest)!;
      gl.deleteBuffer(e.posBuf);
      gl.deleteBuffer(e.idxBuf);
      gl.deleteBuffer(e.cellIdxBuf);
      gl.deleteTexture(e.countryTex);
      st.patchGeom.delete(oldest);
    }
    return entry;
  }

  /**
   * Geometry + colour buffers for a map. Positions are built once (the mesh never
   * changes); colours rebuild only when the theme changes. LRU-bounded.
   */
  private getGeom(
    st: GLState,
    map: GlobeMap,
    settings: MapSettings,
    choropleth?: ChoroplethTint
  ): GeomEntry {
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
        countryBuf: null,
        countryKey: null,
        countryBytes: 0,
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
        if (e.countryBuf) gl.deleteBuffer(e.countryBuf);
        st.geomBytes -= e.bytes;
        st.geom.delete(oldest);
      }
    }

    const colorKey = `${settings.theme}|${settings.viewPlates}`;
    if (entry.colorKey !== colorKey) {
      const { palette, colorIdx } = computeCellColors(
        map,
        settings.theme,
        settings.viewPlates ?? false,
        settings.viewClimate ?? false
      );
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
        palette.length * 4 +
        entry.countryBytes;
      st.geomBytes += entry.bytes;
    }

    // Per-cell choropleth attribute — built only when THIS map is the choropleth's base map (so its cells
    // index 1:1 into countryOf). Rebuilt only when the assignment changes (key), NOT per frame or on a
    // sea-level drag: countryOf already reflects the live waterline (the derivation re-runs on it), and the
    // hue/flag don't depend on the live dial. A CPU-overlay mesh (finer, no matching countryOf) keeps
    // countryBuf null and falls back to the equirect (uUseCellCountry = 0 in draw).
    const wantCountry = !!choropleth && choropleth.map === map;
    const countryKey = wantCountry ? choropleth!.key : null;
    if (entry.countryKey !== countryKey) {
      if (entry.countryBuf) {
        gl.deleteBuffer(entry.countryBuf);
        entry.bytes -= entry.countryBytes;
        st.geomBytes -= entry.countryBytes;
        entry.countryBuf = null;
        entry.countryBytes = 0;
      }
      if (wantCountry) {
        const data = buildCountryBytes(map, choropleth!.countryOf, choropleth!.countryColors);
        entry.countryBuf = makeBuffer(gl, gl.ARRAY_BUFFER, data);
        entry.countryBytes = data.byteLength;
        entry.bytes += entry.countryBytes;
        st.geomBytes += entry.countryBytes;
      }
      entry.countryKey = countryKey;
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

/** One RGBA8 per ring vertex (every vertex of a cell shares the cell's value): rgb = the owning country's
 *  choropleth hue, a = 255 on land (countryOf >= 0) else 0 — the per-cell tint + land flag the base globe
 *  gates the choropleth on. countryOf >= 0 is exactly elevation >= seaLevel (every land cell is assigned a
 *  country; see assignCountries), so this boundary IS the biome coast the mesh draws — no equirect
 *  re-rasterization, no coastal specks. HUES is indexed by the country's colour class (countryColors). */
function buildCountryBytes(map: GlobeMap, countryOf: Int32Array, countryColors: Int32Array): Uint8Array {
  const { ringOffsets, cellCount } = map;
  const out = new Uint8Array((map.ringVerts.length / 3) * 4);
  for (let i = 0; i < cellCount; i++) {
    const ci = countryOf[i];
    if (ci < 0) continue; // water / no country → rgba stays 0 (a = 0 → no tint, ocean keeps its colour)
    const hue = HUES[countryColors[ci]] ?? HUES[0];
    for (let v = ringOffsets[i]; v < ringOffsets[i + 1]; v++) {
      const o = v * 4;
      out[o] = hue[0];
      out[o + 1] = hue[1];
      out[o + 2] = hue[2];
      out[o + 3] = 255; // land flag
    }
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

/** One u32 cell index per ring vertex (every vertex of a cell carries the cell's index), in
 *  ring-vertex order — the GPU patch shader uses it to fetch the cell's field texel. */
function buildCellIndices(map: GlobeMap): Uint32Array {
  const { ringOffsets, cellCount } = map;
  const out = new Uint32Array(map.ringVerts.length / 3);
  for (let i = 0; i < cellCount; i++) {
    for (let v = ringOffsets[i]; v < ringOffsets[i + 1]; v++) out[v] = i;
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
