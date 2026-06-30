import { KZ } from "../../common/koppen";

/**
 * GLSL twin of src/common/koppen.ts — the Köppen classifier on the GPU. Mirrors classifyKoppen +
 * its helpers branch-for-branch (same way terrainShader mirrors ElevationCalculator). The zone-index
 * constants are GENERATED from KZ so they can never drift from the TS palette ordering. The climate
 * constants (MAT_*, lapse, precip max, regime bands) are hand-copied — keep them in sync with koppen.ts.
 */

// const int KZ_OCEAN_DEEP = 0; ... — generated from KZ so GLSL indices == KOPPEN_COLORS indices.
const ZONE_CONSTS = Object.entries(KZ)
  .map(([k, v]) => `const int KZ_${k} = ${v};`)
  .join("\n");

export const KOPPEN_GLSL = /* glsl */ `
${ZONE_CONSTS}
const float DEG_PER_RAD = 57.2957795;

// koppen.ts:meanAnnualTempC (MAT_EQUATOR_C 27, MAT_POLE_C -25, LATITUDE_FALLOFF 1.4, lapse 0.0065/m, Everest 8849m)
float meanAnnualTempC(float latDeg, float displayElevation, float seaLevel) {
  float a = min(1.0, abs(latDeg) / 90.0);
  float sealevelMat = 27.0 - (27.0 - (-25.0)) * pow(a, 1.4);
  float frac = max(0.0, (displayElevation - seaLevel) / max(1.0 - seaLevel, 1e-6));
  return sealevelMat - 0.0065 * frac * 8849.0;
}

// koppen.ts:seasonalAmplitudeC
float seasonalAmplitudeC(float lat0to1, float continentality, float base, float continentalWeight) {
  return base * lat0to1 * lat0to1 * (1.0 + continentalWeight * continentality);
}

// koppen.ts:moistureToPrecipMm (MAX_PRECIP_MM 3000)
float moistureToPrecipMm(float moisture) {
  float m = clamp(moisture, 0.0, 1.0);
  return m * m * 3000.0;
}

// koppen.ts:precipRegime — 1 = dry-summer (mediterranean), 2 = dry-winter (savanna/monsoon), 0 = none.
// TODO(monsoon): geometric proxy; replace with a real prevailing-wind / monsoon model (with mountains).
int precipRegime(float absLatDeg, float moisture, float continentality) {
  bool subtropical = absLatDeg >= 28.0 && absLatDeg <= 45.0;
  if (subtropical && continentality < 0.45 && moisture >= 0.25 && moisture <= 0.62) return 1; // dry-summer (coastal)
  if (absLatDeg < 28.0 && moisture < 0.55) return 2;
  return 0;
}

// koppen.ts:heatLetter — 0=a,1=b,2=c,3=d
int heatLetter(float tWarm, float tCold) {
  if (tCold < -38.0) return 3;
  if (tWarm >= 22.0) return 0;
  if (tWarm >= 16.0) return 1;
  return 2;
}

// koppen.ts:classifyKoppen
int classifyKoppen(float matC, float tWarm, float tCold, float precipMm, float absLatDeg, float moisture, float elevation, float seaLevel, float continentality) {
  if (elevation < seaLevel) {
    float d = elevation / max(seaLevel, 1e-6);
    if (d < 0.34) return KZ_OCEAN_DEEP;
    if (d < 0.7) return KZ_OCEAN_MID;
    return KZ_OCEAN_SHALLOW;
  }
  // E / highland treeline: mountain (high landE) → alpine → bare rock → snow; lowland → tundra / ice sheet.
  float landE = (elevation - seaLevel) / max(1.0 - seaLevel, 1e-6);
  if (tWarm < 10.0) {
    if (landE > 0.18) {
      if (tWarm < -8.0) return KZ_EF;
      if (tWarm < 3.0) return KZ_BARE;
      return KZ_ALPINE;
    }
    return tWarm < 0.0 ? KZ_EF : KZ_ET;
  }

  int regime = precipRegime(absLatDeg, moisture, continentality);

  float offset = regime == 1 ? 0.0 : (regime == 2 ? 280.0 : 140.0);
  float pth = max(0.0, 20.0 * matC + offset);
  if (precipMm < pth) {
    bool hot = matC >= 18.0;
    if (precipMm < 0.5 * pth) return hot ? KZ_BWh : KZ_BWk;
    return hot ? KZ_BSh : KZ_BSk;
  }

  if (tCold >= 18.0) {
    if (moisture > 0.82) return KZ_Af;
    if (moisture > 0.6) return KZ_Am;
    return regime == 1 ? KZ_As : KZ_Aw;
  }

  int heat = heatLetter(tWarm, tCold);
  if (tCold >= 0.0) {
    int h = min(heat, 2);
    if (regime == 1) return KZ_Csa + h;
    if (regime == 2) return KZ_Cwa + h;
    return KZ_Cfa + h;
  }
  if (regime == 1) return KZ_Dsa + heat;
  if (regime == 2) return KZ_Dwa + heat;
  return KZ_Dfa + heat;
}

// koppen.ts:hadleyPrecipFactor — Earth's zonal rain bands (wet equator/ITCZ, dry ±27° horse latitudes,
// wet ~50° storm tracks, dry poles). strength fades 0 (off) → 1 (full bands).
float gauss1(float x, float mu, float sigma) { float d = (x - mu) / sigma; return exp(-0.5 * d * d); }
float hadleyPrecipFactor(float absLatDeg, float strength) {
  float itcz = gauss1(absLatDeg, 0.0, 13.0);
  float stormTrack = 0.65 * gauss1(absLatDeg, 50.0, 18.0);
  float shaped = 0.3 + 0.7 * max(itcz, stormTrack);
  return 1.0 + strength * (shaped - 1.0);
}

// The per-cell Köppen zone (as a float, for the field's .b channel). Mirrors ElevationCalculator.koppenZoneAt:
// latitude from the site, MAT from lat+elevation, a synthesized seasonal swing from latitude + continentality,
// Hadley rain bands on precipitation, and a multi-octave climate JITTER that mottles the biome boundaries
// (dither: perturb the inputs, then classify — pure colours, organic edges).
float koppenZone(vec3 site, float elevation, float moisture, float continentality,
                 float seaLevel, float seasonality, float continentalSeasonality,
                 float jitter, float jitterScale, float hadley) {
  float latDeg = asin(clamp(site.y, -1.0, 1.0)) * DEG_PER_RAD;
  float absLat = abs(latDeg);
  float lat01 = absLat / 90.0;
  // Mottle: decorrelated jitter on temperature (°C) + moisture before classifying. 5 octaves so finer texture
  // keeps resolving as you zoom in (toward — not yet at — stand-level detail).
  float jT = jitter * 8.0 * fbm3(site + vec3(11.3, 4.7, 19.1), jitterScale, 1.0, 5.0, 0.5, 2.0);
  float jM = jitter * 0.18 * fbm3(site + vec3(31.7, 23.9, 7.5), jitterScale, 1.0, 5.0, 0.5, 2.0);
  float matC = meanAnnualTempC(latDeg, elevation, seaLevel) + jT;
  float moist = clamp(moisture + jM, 0.0, 1.0);
  float amp = seasonalAmplitudeC(lat01, continentality, seasonality, continentalSeasonality);
  float precipMm = moistureToPrecipMm(moist) * hadleyPrecipFactor(absLat, hadley);
  return float(classifyKoppen(matC, matC + amp, matC - amp, precipMm, absLat, moist, elevation, seaLevel, continentality));
}
`;
