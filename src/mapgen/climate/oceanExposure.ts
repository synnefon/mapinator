/**
 * oceanExposure.ts
 *
 * Estimates whether a site's air recently passed over ocean.
 */

import type { Vec3 } from "../../common/3DMath";
import { PLANET_RADIUS_KM } from "../../common/settings";
import type { ClimateWind } from "./airCurrents";
import type { ClimateWorldSampler } from "./types";
import {
  addVec3,
  clamp01,
  dotVec3,
  normalizeVec3,
  scaleVec3,
} from "./utils";

export type OceanExposureOptions = {
  maxFetchKm: number;
  steps: number;
  terrainBarrierHeightM: number;
  terrainBarrierPenalty: number;
};

export const DEFAULT_OCEAN_EXPOSURE_OPTIONS: OceanExposureOptions = {
  maxFetchKm: 1800,
  steps: 24,
  terrainBarrierHeightM: 1800,
  terrainBarrierPenalty: 0.65,
};

export function estimateUpwindOceanExposure01(args: {
  site: Vec3;
  wind: ClimateWind;
  /** Waterline in the same normalized space as `world.elevationAt`. */
  seaLevel: number;
  world: ClimateWorldSampler;
  options?: OceanExposureOptions;
}): number {
  const { site, wind, seaLevel, world } = args;
  const options = args.options ?? DEFAULT_OCEAN_EXPOSURE_OPTIONS;

  const origin = normalizeVec3(site);
  const upwind = normalizeVec3(scaleVec3(wind.vector, -1));

  let exposure = 0;
  let barrier = 1;

  for (let i = 1; i <= options.steps; i++) {
    const t = i / options.steps;
    const distanceKm = t * options.maxFetchKm;
    const sample = stepAlongSphere(origin, upwind, distanceKm);

    const distanceWeight = 1 - t;

    if (world.elevationMAt(sample) > options.terrainBarrierHeightM) {
      barrier *= options.terrainBarrierPenalty;
    }

    if (world.elevationAt(sample) < seaLevel) {
      exposure += distanceWeight * barrier;
    }
  }

  const maxPossible = Array.from({ length: options.steps }, (_, i) => {
    const t = (i + 1) / options.steps;
    return 1 - t;
  }).reduce((a, b) => a + b, 0);

  return clamp01(exposure / Math.max(maxPossible, 1e-6));
}

/**
 * Move from a point along a tangent direction by surface distance.
 *
 * `site` must be on the unit sphere.
 * `tangentDirection` should be tangent to the sphere at `site`.
 */
export function stepAlongSphere(
  site: Vec3,
  tangentDirection: Vec3,
  distanceKm: number,
  planetRadiusKm: number = PLANET_RADIUS_KM,
): Vec3 {
  const p = normalizeVec3(site);

  const tangent = normalizeVec3(
    addVec3(
      tangentDirection,
      scaleVec3(p, -dotVec3(tangentDirection, p)),
    ),
  );

  const angle = distanceKm / planetRadiusKm;

  return normalizeVec3(
    addVec3(
      scaleVec3(p, Math.cos(angle)),
      scaleVec3(tangent, Math.sin(angle)),
    ),
  );
}
