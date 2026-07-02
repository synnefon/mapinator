/**
 * airCurrents.ts
 *
 * Sphere-native prevailing wind model.
 *
 * Owns:
 * - pressure-belt vertical motion
 * - latitude-based wind belts
 * - tangent wind vectors on a 3D planet
 *
 * Does not own:
 * - humidity
 * - precipitation
 * - terrain sampling
 * - Köppen classification
 */

import type { Vec3 } from "../../common/3DMath";
import { addVec3, clamp, clamp01, gaussian, localEast, localNorth, normalizeVec3, scaleVec3, sphereLatitudeDeg } from "./utils";

export type WindBelt = "trade" | "westerly" | "polar";

export type ClimateWind = {
  /** Tangent direction the air is moving across the sphere. */
  vector: Vec3;

  /** 0..1 rough horizontal wind strength. */
  strength01: number;

  belt: WindBelt;

  /**
   * Positive = rising air / wetter tendency.
   * Negative = sinking air / drier tendency.
   */
  verticalMotion: number;
};

export function estimateWindAtSite(site: Vec3): ClimateWind {
  const position = normalizeVec3(site);
  const latDeg = sphereLatitudeDeg(position);
  const absLatDeg = Math.abs(latDeg);

  const belt = estimateWindBelt(absLatDeg);
  const verticalMotion = estimateVerticalMotionByLatitude(absLatDeg);

  return {
    vector: estimatePrevailingWindVector(position, latDeg, belt),
    strength01: estimateWindStrength(absLatDeg, belt, verticalMotion),
    belt,
    verticalMotion,
  };
}

export function estimateWindBelt(absLatDeg: number): WindBelt {
  if (absLatDeg < 30) return "trade";
  if (absLatDeg < 60) return "westerly";
  return "polar";
}

export function estimateVerticalMotionByLatitude(absLatDeg: number): number {
  /**
   * Crude Earth-like circulation:
   *
   * 0°  → rising air, wet tropics
   * 30° → sinking air, subtropical deserts
   * 60° → rising air, storm tracks
   * 90° → sinking cold dry air
   */

  const equatorRise = gaussian(absLatDeg, 0, 16) * 1.0;
  const subtropicalSink = gaussian(absLatDeg, 30, 11) * -1.0;
  const subpolarRise = gaussian(absLatDeg, 60, 10) * 0.65;
  const polarSink = gaussian(absLatDeg, 90, 13) * -0.55;

  return clamp(equatorRise + subtropicalSink + subpolarRise + polarSink, -1, 1);
}

function estimatePrevailingWindVector(position: Vec3, latDeg: number, belt: WindBelt): Vec3 {
  const east = localEast(position);
  const north = localNorth(position);
  const latSign = latDeg >= 0 ? 1 : -1;

  /**
   * Direction means where air is going, not where it came from.
   *
   * Earth-ish approximation:
   * - trade winds: westward + equatorward
   * - westerlies: eastward + poleward
   * - polar easterlies: westward + equatorward
   */

  if (belt === "trade") {
    return normalizeVec3(addVec3(scaleVec3(east, -1), scaleVec3(north, -0.35 * latSign)));
  }

  if (belt === "westerly") {
    return normalizeVec3(addVec3(scaleVec3(east, 1), scaleVec3(north, 0.25 * latSign)));
  }

  return normalizeVec3(addVec3(scaleVec3(east, -1), scaleVec3(north, -0.2 * latSign)));
}

function estimateWindStrength(absLatDeg: number, belt: WindBelt, verticalMotion: number): number {
  /**
   * Intentionally simple.
   *
   * Horizontal winds are strongest around the trade/westerly/polar current cores
   * and slightly weaker where vertical motion dominates.
   */

  const beltCore =
    belt === "trade"
      ? gaussian(absLatDeg, 18, 14)
      : belt === "westerly"
        ? gaussian(absLatDeg, 45, 13)
        : gaussian(absLatDeg, 72, 12);

  const verticalPenalty = 1 - 0.25 * Math.abs(verticalMotion);

  return clamp01((0.35 + 0.65 * beltCore) * verticalPenalty);
}