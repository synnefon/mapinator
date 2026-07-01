import { KZ } from "../../common/koppen";

/**
 * GLSL twin of src/common/koppen.ts. Keep this branch-for-branch aligned with the TS classifier.
 * Zone constants are generated from KZ so palette indices cannot drift.
 */
const ZONE_CONSTS = Object.entries(KZ)
  .map(([k, v]) => `const int KZ_${k} = ${v};`)
  .join("\n");

export const KOPPEN_GLSL = /* glsl */ `
${ZONE_CONSTS}
const float DEG_PER_RAD = 57.2957795;
const float PI = 3.141592653589793;

// --- climate generation constants; mirror koppen.ts EARTH_CLIMATE ---
const float PRECIP_MAX_MM = 3200.0;
const float PRECIP_MOISTURE_EXPONENT = 1.75;
const float HADLEY_DRY_FLOOR = 0.28;
const float HADLEY_STORM_TRACK_WEIGHT = 0.7;
const float COASTAL_PRECIP_BOOST = 1.08;
const float INTERIOR_PRECIP_FACTOR = 0.9;
const float DRY_SEASON_STRENGTH = 0.58;
const float WET_SEASON_STRENGTH = 0.62;
const float WEAK_SEASONAL_PRECIP_STRENGTH = 0.18;
const float MEDITERRANEAN_LAT_MIN = 28.0;
const float MEDITERRANEAN_LAT_MAX = 45.0;
const float MEDITERRANEAN_MOISTURE_MIN = 0.25;
const float MEDITERRANEAN_MOISTURE_MAX = 0.68;
const float MEDITERRANEAN_MAX_CONTINENTALITY = 0.5;
const float MONSOON_LAT_MAX = 28.0;
const float MONSOON_MOISTURE_MAX = 0.62;

// --- locked Köppen constants; mirror koppen.ts KOPPEN ---
const float K_TROPICAL_COLD_MONTH_MIN_C = 18.0;
const float K_POLAR_WARM_MONTH_MAX_C = 6.0;
const float K_ICE_CAP_WARM_MONTH_MAX_C = 0.0;
const float K_TREE_MONTH_MIN_C = 10.0;
const float K_TEMPERATE_COLD_MONTH_MIN_C = 0.0;
const float K_ARID_HOT_MEAN_ANNUAL_C = 18.0;
const float K_HOT_SUMMER_WARM_MONTH_MIN_C = 22.0;
const int K_WARM_MONTHS_FOR_B = 4;
const float K_EXTREME_COLD_WINTER_C = -38.0;
const float K_AF_DRIEST_MONTH_MIN_MM = 60.0;
const float K_AM_DRIEST_MONTH_BASE_MM = 100.0;
const float K_AM_DRIEST_MONTH_ANNUAL_DIVISOR = 25.0;
const float K_DRY_SUMMER_MAX_DRIEST_SUMMER_MM = 40.0;
const float K_DRY_SUMMER_WINTER_RATIO = 1.0;
const float K_DRY_WINTER_SUMMER_RATIO = 1.12;
const float K_ARID_SUMMER_DRY_OFFSET_MM = 0.0;
const float K_ARID_EVEN_OFFSET_MM = 140.0;
const float K_ARID_WINTER_DRY_OFFSET_MM = 280.0;

// --- highland terrain override; not real Köppen ---
const float HIGHLAND_MOUNTAIN_LAND_E = 0.18;
const float HIGHLAND_PERENNIAL_SNOW_TWARM_C = -8.0;
const float HIGHLAND_BARE_ROCK_TWARM_C = 3.0;

float meanAnnualTempC(float latDeg, float displayElevation, float seaLevel) {
  float a = min(1.0, abs(latDeg) / 90.0);
  float sealevelMat = 27.0 - (27.0 - (-25.0)) * pow(a, 1.4);
  float frac = max(0.0, (displayElevation - seaLevel) / max(1.0 - seaLevel, 1e-6));
  return sealevelMat - 0.0065 * frac * 8849.0;
}

float seasonalAmplitudeC(float lat0to1, float continentality, float base, float continentalWeight) {
  float latShape = lat0to1 * lat0to1;
  return base * latShape * (1.0 + continentalWeight * continentality);
}

float moistureToPrecipMm(float moisture) {
  return pow(clamp(moisture, 0.0, 1.0), PRECIP_MOISTURE_EXPONENT) * PRECIP_MAX_MM;
}

float gauss1(float x, float mu, float sigma) {
  float d = (x - mu) / sigma;
  return exp(-0.5 * d * d);
}

float hadleyPrecipFactor(float absLatDeg, float strength) {
  float itcz = gauss1(absLatDeg, 0.0, 13.0);
  float stormTrack = HADLEY_STORM_TRACK_WEIGHT * gauss1(absLatDeg, 50.0, 18.0);
  float shaped = HADLEY_DRY_FLOOR + (1.0 - HADLEY_DRY_FLOOR) * max(itcz, stormTrack);
  return 1.0 + strength * (shaped - 1.0);
}

int precipMode(float absLatDeg, float moisture, float continentality) {
  bool mediterranean = absLatDeg >= MEDITERRANEAN_LAT_MIN && absLatDeg <= MEDITERRANEAN_LAT_MAX &&
    continentality < MEDITERRANEAN_MAX_CONTINENTALITY &&
    moisture >= MEDITERRANEAN_MOISTURE_MIN && moisture <= MEDITERRANEAN_MOISTURE_MAX;
  if (mediterranean) return 1;
  if (absLatDeg < MONSOON_LAT_MAX && moisture < MONSOON_MOISTURE_MAX) return 2;
  return 0;
}

// The scalar API reconstructs synthetic monthly climate, then applies real Köppen logic.
int classifyKoppen(float matC, float tWarm, float tCold, float precipMm, float absLatDeg, float moisture, float elevation, float seaLevel, float continentality) {
  if (elevation < seaLevel) {
    float d = elevation / max(seaLevel, 1e-6);
    if (d < 0.34) return KZ_OCEAN_DEEP;
    if (d < 0.7) return KZ_OCEAN_MID;
    return KZ_OCEAN_SHALLOW;
  }

  float amp = max(0.0, max(abs(tWarm - matC), abs(matC - tCold)));
  int mode = precipMode(absLatDeg, moisture, continentality);
  float c = clamp(continentality, 0.0, 1.0);
  float annualPrecip = precipMm * mix(COASTAL_PRECIP_BOOST, INTERIOR_PRECIP_FACTOR, c);

  float warmestMonthC = -999.0;
  float coldestMonthC = 999.0;
  float meanAnnual = 0.0;
  float driestMonth = 99999.0;
  float driestSummer = 99999.0;
  float driestWinter = 99999.0;
  float wettestSummer = 0.0;
  float wettestWinter = 0.0;
  float summerPrecip = 0.0;
  float winterPrecip = 0.0;
  int monthsAbove10 = 0;
  float weights[12];
  float weightSum = 0.0;

  for (int month = 0; month < 12; month++) {
    float seasonal = cos((2.0 * PI * float(month)) / 12.0);
    float temp = matC + amp * seasonal;
    warmestMonthC = max(warmestMonthC, temp);
    coldestMonthC = min(coldestMonthC, temp);
    meanAnnual += temp;
    if (temp > K_TREE_MONTH_MIN_C) monthsAbove10++;

    float warmSeason01 = (seasonal + 1.0) * 0.5;
    float w = 1.0;
    if (mode == 1) {
      w = 1.0 - DRY_SEASON_STRENGTH * warmSeason01 + WET_SEASON_STRENGTH * (1.0 - warmSeason01);
    } else if (mode == 2) {
      w = 1.0 - DRY_SEASON_STRENGTH * (1.0 - warmSeason01) + WET_SEASON_STRENGTH * warmSeason01;
    } else {
      float summerBias = mix(-0.35, 0.35, c);
      w = 1.0 + WEAK_SEASONAL_PRECIP_STRENGTH * summerBias * seasonal;
    }
    w = max(0.05, w);
    weights[month] = w;
    weightSum += w;
  }
  meanAnnual /= 12.0;

  for (int month = 0; month < 12; month++) {
    float p = annualPrecip * weights[month] / weightSum;
    driestMonth = min(driestMonth, p);
    if (month < 6) {
      summerPrecip += p;
      driestSummer = min(driestSummer, p);
      wettestSummer = max(wettestSummer, p);
    } else {
      winterPrecip += p;
      driestWinter = min(driestWinter, p);
      wettestWinter = max(wettestWinter, p);
    }
  }

  float landE = (elevation - seaLevel) / max(1.0 - seaLevel, 1e-6);
  if (landE > HIGHLAND_MOUNTAIN_LAND_E) {
    if (warmestMonthC < HIGHLAND_PERENNIAL_SNOW_TWARM_C) return KZ_EF;
    if (warmestMonthC < HIGHLAND_BARE_ROCK_TWARM_C) return KZ_BARE;
    return KZ_ALPINE;
  }

  if (warmestMonthC < K_POLAR_WARM_MONTH_MAX_C) {
    return warmestMonthC < K_ICE_CAP_WARM_MONTH_MAX_C ? KZ_EF : KZ_ET;
  }

  float summerShare = annualPrecip <= 0.0 ? 0.0 : summerPrecip / annualPrecip;
  float winterShare = annualPrecip <= 0.0 ? 0.0 : winterPrecip / annualPrecip;
  float offset = summerShare >= 0.7 ? K_ARID_WINTER_DRY_OFFSET_MM : (winterShare >= 0.7 ? K_ARID_SUMMER_DRY_OFFSET_MM : K_ARID_EVEN_OFFSET_MM);
  float pth = max(0.0, 20.0 * meanAnnual + offset);
  if (annualPrecip < pth) {
    bool hot = meanAnnual >= K_ARID_HOT_MEAN_ANNUAL_C;
    if (annualPrecip < 0.5 * pth) return hot ? KZ_BWh : KZ_BWk;
    return hot ? KZ_BSh : KZ_BSk;
  }

  if (coldestMonthC >= K_TROPICAL_COLD_MONTH_MIN_C) {
    if (driestMonth >= K_AF_DRIEST_MONTH_MIN_MM) return KZ_Af;
    float monsoonCutoff = K_AM_DRIEST_MONTH_BASE_MM - annualPrecip / K_AM_DRIEST_MONTH_ANNUAL_DIVISOR;
    if (driestMonth >= monsoonCutoff) return KZ_Am;
    return driestSummer < driestWinter ? KZ_As : KZ_Aw;
  }

  bool drySummer = driestSummer < K_DRY_SUMMER_MAX_DRIEST_SUMMER_MM && driestSummer * K_DRY_SUMMER_WINTER_RATIO < wettestWinter;
  bool dryWinter = driestWinter * K_DRY_WINTER_SUMMER_RATIO < wettestSummer;
  int dry = drySummer ? 1 : (dryWinter ? 2 : 0);

  int heat = 2;
  if (warmestMonthC >= K_HOT_SUMMER_WARM_MONTH_MIN_C) heat = 0;
  else if (monthsAbove10 >= K_WARM_MONTHS_FOR_B) heat = 1;
  else if (coldestMonthC <= K_EXTREME_COLD_WINTER_C) heat = 3;
  int h = min(heat, 2);

  if (coldestMonthC > K_TEMPERATE_COLD_MONTH_MIN_C) {
    if (dry == 1) return KZ_Csa + h;
    if (dry == 2) return KZ_Cwa + h;
    return KZ_Cfa + h;
  }

  if (dry == 1) return KZ_Dsa + heat;
  if (dry == 2) return KZ_Dwa + heat;
  return KZ_Dfa + heat;
}

// Per-cell Köppen zone. Use reportElevation for temperature/lapse-rate climate; use rendered elevation for
// ocean depth + highland terrain override.
float koppenZone(vec3 site, float elevation, float reportElevation, float moisture, float continentality,
                 float seaLevel, float seasonality, float continentalSeasonality,
                 float jitter, float jitterScale, float hadley) {
  float latDeg = asin(clamp(site.y, -1.0, 1.0)) * DEG_PER_RAD;
  float absLat = abs(latDeg);
  float lat01 = absLat / 90.0;
  float jT = jitter * 8.0 * fbm3(site + vec3(11.3, 4.7, 19.1), jitterScale, 1.0, 5.0, 0.5, 2.0);
  float jM = jitter * 0.18 * fbm3(site + vec3(31.7, 23.9, 7.5), jitterScale, 1.0, 5.0, 0.5, 2.0);
  float matC = meanAnnualTempC(latDeg, reportElevation, seaLevel) + jT;
  float moist = clamp(moisture + jM, 0.0, 1.0);
  float amp = seasonalAmplitudeC(lat01, continentality, seasonality, continentalSeasonality);
  float precipMm = moistureToPrecipMm(moist) * hadleyPrecipFactor(absLat, hadley);
  return float(classifyKoppen(matC, matC + amp, matC - amp, precipMm, absLat, moist, elevation, seaLevel, continentality));
}
`;
