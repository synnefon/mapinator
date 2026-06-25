import { ELEVATION_BAND_BREAKS } from "../../common/elevationBands";
import { HILLSHADE, type TerrainParams } from "../../common/settings";
import { fieldTextureDims } from "./gpuFieldLayout";
import type { PlateData } from "./plateData";
import { FIELD_FRAG_SRC, FIELD_VERT_SRC } from "./terrainShader";

/** The full per-cell field computed on the GPU (one Float32Array per channel) + a wall-clock split:
 *  `upload` = pack sites/perm/plates + texImage2D; `render` = draw + gl.finish(); `readback` =
 *  readPixels + unpack. This is the READBACK path (for validation/benchmark); the renderer will use a
 *  no-readback variant that samples the field texture directly. */
export type GpuFieldResult = {
  fields: { elevation: Float32Array; moisture: Float32Array; ice: Float32Array; shade: Float32Array };
  width: number;
  height: number;
  timing: { upload: number; render: number; readback: number; total: number };
};

const now = (): number => performance.now();

// The landE at which the hillshade elevation gate turns on (MEDIUM→HIGH boundary): the break just before
// the first HIGH-elevation band. Derived so it tracks elevationBands.ts. Mirrors the CPU's
// getElevationBandNameRaw HIGH/VERY_HIGH gate in ElevationCalculator.hillshadeAt.
const SHADE_MIN_LAND_E = ELEVATION_BAND_BREAKS[
  ELEVATION_BAND_BREAKS.findIndex((b) => b.colorElevation === "HIGH") - 1
].breakPoint;

/**
 * Computes the full per-cell field (elevation, moisture, ice, shade) on the GPU for an arbitrary set
 * of cell sites — the GPU twin of ElevationCalculator.sampleCell (see terrainShader.ts). Seeded by the
 * CPU's permutation table (`perm`) and plate set (`plate`) so a GPU patch reproduces the CPU globe.
 *
 * Holds its program/FBO/textures across calls, reallocating only when the cell count's texture
 * dimensions change. Float render targets need EXT_color_buffer_float — `create` returns null without
 * it (a feasibility signal). The mesh stays on the CPU; only the field sampling is here.
 */
export class GpuField {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly loc: Record<string, WebGLUniformLocation | null> = {};
  private readonly maxTex: number;

  private sitesTex: WebGLTexture | null = null;
  private outTex: WebGLTexture | null = null;
  private permTex: WebGLTexture | null = null; // 512×1 seed permutation/gradient table
  private plateTex: WebGLTexture | null = null; // (count×2) plate seeds + Euler poles
  private fbo: WebGLFramebuffer | null = null;
  private dims = { width: 0, height: 0 };
  private srcBuf: Float32Array | null = null;
  private dstBuf: Float32Array | null = null;
  private plateBuf: Float32Array | null = null;

  private constructor(gl: WebGL2RenderingContext, program: WebGLProgram, vao: WebGLVertexArrayObject) {
    this.gl = gl;
    this.program = program;
    this.vao = vao;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  }

  /** Compile + link against an existing WebGL2 context. Null if float render targets are unavailable
   *  (no EXT_color_buffer_float) or compilation fails. */
  static create(gl: WebGL2RenderingContext): GpuField | null {
    if (!gl.getExtension("EXT_color_buffer_float")) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, FIELD_VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FIELD_FRAG_SRC);
    if (!vs || !fs) return null;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("GpuField link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return new GpuField(gl, program, gl.createVertexArray()!);
  }

  get maxTextureSize(): number {
    return this.maxTex;
  }

  /** True if `n` cells fit one render (≤ width*maxTextureSize); larger fields need tiling. */
  fits(n: number): boolean {
    return fieldTextureDims(n, this.maxTex).fits;
  }

  /**
   * Compute the full field for `sites` (length n*3, xyz per cell) under `params`, using the seed's
   * permutation table `perm` (512×4) and plate set `plate`, then READ IT BACK. For validation /
   * benchmarking; the renderer uses renderToTexture (no readback). Returns the channels + timing.
   */
  compute(sites: Float32Array, params: TerrainParams, perm: Float32Array, plate: PlateData): GpuFieldResult {
    const gl = this.gl;
    const { width, height, count, upload, render } = this.render(sites, params, perm, plate);

    const t2 = now();
    const dst = this.dstBuf!;
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.FLOAT, dst);
    const elevation = new Float32Array(count);
    const moisture = new Float32Array(count);
    const ice = new Float32Array(count);
    const shade = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      elevation[i] = dst[4 * i];
      moisture[i] = dst[4 * i + 1];
      ice[i] = dst[4 * i + 2];
      shade[i] = dst[4 * i + 3];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const readback = now() - t2;

    return {
      fields: { elevation, moisture, ice, shade },
      width,
      height,
      timing: { upload, render, readback, total: upload + render + readback },
    };
  }

  /**
   * Compute the full field and LEAVE IT on the GPU as a texture (no readback) — the renderer's path.
   * Returns the RGBA32F field texture (texel = one cell's [elevation, moisture, ice, shade]) plus the
   * texture width and cell count, so the draw shader can map a cell index → texel. The texture is
   * owned by this GpuField (valid until the next render/dispose); the caller must use it before then.
   */
  renderToTexture(
    sites: Float32Array,
    params: TerrainParams,
    perm: Float32Array,
    plate: PlateData
  ): { texture: WebGLTexture; width: number; count: number } {
    const { width, count } = this.render(sites, params, perm, plate);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    return { texture: this.outTex!, width, count };
  }

  // Shared upload + render into this.outTex (the FBO colour attachment). Saves/restores DEPTH_TEST so
  // it composes with a renderer that keeps depth testing on for its globe draws. Leaves the FBO bound.
  private render(
    sites: Float32Array,
    params: TerrainParams,
    perm: Float32Array,
    plate: PlateData
  ): { width: number; height: number; count: number; upload: number; render: number } {
    const gl = this.gl;
    const n = (sites.length / 3) | 0;
    const { width, height, fits } = fieldTextureDims(n, this.maxTex);
    if (!fits) throw new Error(`GpuField: ${n} cells exceed a ${this.maxTex}-wide strip (tiling not implemented)`);

    const t0 = now();
    this.ensureTextures(width, height);
    this.uploadPerm(perm);
    this.uploadPlates(plate);
    const src = this.srcBuf!;
    for (let i = 0; i < n; i++) {
      src[4 * i] = sites[3 * i];
      src[4 * i + 1] = sites[3 * i + 1];
      src[4 * i + 2] = sites[3 * i + 2];
    }
    gl.bindTexture(gl.TEXTURE_2D, this.sitesTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, src);
    const t1 = now();

    const depthWasOn = gl.getParameter(gl.DEPTH_TEST) as boolean;
    gl.disable(gl.DEPTH_TEST); // the field is a flat pass to a depthless FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sitesTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.permTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
    this.setUniforms(params, plate.count, width, n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
    gl.bindVertexArray(null);
    if (depthWasOn) gl.enable(gl.DEPTH_TEST);
    return { width, height, count: n, upload: t1 - t0, render: now() - t1 };
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.sitesTex);
    gl.deleteTexture(this.outTex);
    gl.deleteTexture(this.permTex);
    gl.deleteTexture(this.plateTex);
    gl.deleteFramebuffer(this.fbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  private ensureTextures(width: number, height: number): void {
    if (this.dims.width === width && this.dims.height === height && this.fbo) return;
    const gl = this.gl;
    gl.deleteTexture(this.sitesTex);
    gl.deleteTexture(this.outTex);
    gl.deleteFramebuffer(this.fbo);

    this.sitesTex = makeFloatTexture(gl, width, height);
    this.outTex = makeFloatTexture(gl, width, height);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outTex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("GpuField: float framebuffer incomplete");
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.dims = { width, height };
    this.srcBuf = new Float32Array(width * height * 4);
    this.dstBuf = new Float32Array(width * height * 4);
  }

  // Upload the seed's 512×1 permutation/gradient table (8 KB; re-uploaded each compute).
  private uploadPerm(perm: Float32Array): void {
    const gl = this.gl;
    this.permTex ??= makeDataTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.permTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, perm.length / 4, 1, 0, gl.RGBA, gl.FLOAT, perm);
  }

  // Upload the plate set as a (count×2) RGBA32F texture: row 0 = seeds, row 1 = Euler poles.
  private uploadPlates(plate: PlateData): void {
    const gl = this.gl;
    const k = plate.count;
    if (!this.plateBuf || this.plateBuf.length !== k * 2 * 4) this.plateBuf = new Float32Array(k * 2 * 4);
    const buf = this.plateBuf;
    for (let i = 0; i < k; i++) {
      buf[4 * i] = plate.seeds[3 * i];
      buf[4 * i + 1] = plate.seeds[3 * i + 1];
      buf[4 * i + 2] = plate.seeds[3 * i + 2];
      const p = 4 * (k + i);
      buf[p] = plate.poles[3 * i];
      buf[p + 1] = plate.poles[3 * i + 1];
      buf[p + 2] = plate.poles[3 * i + 2];
    }
    this.plateTex ??= makeDataTexture(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.plateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, k, 2, 0, gl.RGBA, gl.FLOAT, buf);
  }

  private setUniforms(p: TerrainParams, plateCount: number, width: number, count: number): void {
    const gl = this.gl;
    const u = (name: string): WebGLUniformLocation | null =>
      (this.loc[name] ??= gl.getUniformLocation(this.program, name));
    const f = (name: string, v: number): void => gl.uniform1f(u(name), v);
    // CONTINENT
    f("uContWavelength", p.CONTINENT.WAVELENGTH);
    f("uContAmplitude", p.CONTINENT.AMPLITUDE);
    f("uContOctaves", p.CONTINENT.OCTAVES);
    f("uContGain", p.CONTINENT.GAIN);
    f("uContLacunarity", p.CONTINENT.LACUNARITY);
    f("uContWarp", p.CONTINENT.WARP);
    f("uBaseHeight", p.CONTINENT.BASE_HEIGHT);
    f("uElevationContrast", p.CONTINENT.ELEVATION_CONTRAST);
    // OCEAN
    f("uSeaLevel", p.OCEAN.SEA_LEVEL);
    f("uOceanWavelength", p.OCEAN.WAVELENGTH);
    f("uOceanAmplitude", p.OCEAN.AMPLITUDE);
    f("uOceanOctaves", p.OCEAN.OCTAVES);
    f("uOceanGain", p.OCEAN.GAIN);
    f("uOceanLacunarity", p.OCEAN.LACUNARITY);
    gl.uniform2f(u("uShelf"), p.OCEAN.SHELF[0], p.OCEAN.SHELF[1]);
    // COAST
    f("uCoastWavelength", p.COAST.WAVELENGTH);
    f("uCoastAmplitude", p.COAST.AMPLITUDE);
    f("uCoastOctaves", p.COAST.OCTAVES);
    f("uCoastGain", p.COAST.GAIN);
    f("uCoastLacunarity", p.COAST.LACUNARITY);
    // MOUNTAIN
    f("uRidgeWavelength", p.MOUNTAIN.RIDGE_WAVELENGTH);
    f("uRidgeAmplitude", p.MOUNTAIN.RIDGE_AMPLITUDE);
    f("uMountainOctaves", p.MOUNTAIN.OCTAVES);
    f("uMountainGain", p.MOUNTAIN.GAIN);
    f("uMountainLacunarity", p.MOUNTAIN.LACUNARITY);
    f("uSwellFraction", p.MOUNTAIN.SWELL_FRACTION);
    // TECTONIC
    f("uRangeWidth", p.TECTONIC.RANGE_WIDTH);
    f("uSinuosity", p.TECTONIC.SINUOSITY);
    f("uConvergenceThreshold", p.TECTONIC.CONVERGENCE_THRESHOLD);
    f("uVariation", p.TECTONIC.VARIATION);
    f("uCoastBias", p.TECTONIC.COAST_BIAS);
    gl.uniform1i(u("uPlateCount"), plateCount);
    // MOISTURE
    f("uMoistWavelength", p.MOISTURE.WAVELENGTH);
    f("uMoistAmplitude", p.MOISTURE.AMPLITUDE);
    f("uMoistOctaves", p.MOISTURE.OCTAVES);
    f("uMoistGain", p.MOISTURE.GAIN);
    f("uMoistLacunarity", p.MOISTURE.LACUNARITY);
    f("uMoistContrast", p.MOISTURE.CONTRAST);
    f("uWaterProximityEffect", p.MOISTURE.WATER_PROXIMITY_EFFECT);
    f("uDesertSteepness", p.MOISTURE.DESERT_STEEPNESS);
    f("uWaterSizeOctaves", p.MOISTURE.WATER_SIZE_OCTAVES);
    // ICE
    f("uIceCoverage", p.ICE.COVERAGE);
    f("uIceWobble", p.ICE.WOBBLE);
    f("uIceFill", p.ICE.FILL);
    f("uIceBlend", p.ICE.BLEND);
    // HILLSHADE — light precomputed from the fixed azimuth/altitude (mirrors ElevationCalculator).
    const az = (HILLSHADE.AZIMUTH_DEG * Math.PI) / 180;
    const alt = (HILLSHADE.ALTITUDE_DEG * Math.PI) / 180;
    gl.uniform3f(u("uLight"), Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt));
    f("uExaggeration", HILLSHADE.EXAGGERATION);
    f("uEpsilon", HILLSHADE.EPSILON);
    f("uShadeFloor", HILLSHADE.FLOOR);
    f("uShadeMinLandE", SHADE_MIN_LAND_E);
    // features
    f("uMountainsOn", p.features.mountains ? 1 : 0);
    f("uClimateOn", p.features.climate ? 1 : 0);
    f("uIceOn", p.features.ice ? 1 : 0);
    // samplers + layout
    gl.uniform1i(u("uSites"), 0);
    gl.uniform1i(u("uPerm"), 1);
    gl.uniform1i(u("uPlateTex"), 2);
    gl.uniform1i(u("uWidth"), width);
    gl.uniform1i(u("uCount"), count);
  }
}

function makeFloatTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
  setNearestClamp(gl);
  return tex;
}

// A texelFetch-only float data texture (perm / plates). NEAREST + CLAMP keeps it complete on every driver.
function makeDataTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  setNearestClamp(gl);
  return tex;
}

function setNearestClamp(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error("GpuField shader compile failed:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}
