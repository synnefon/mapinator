// 3D simplex noise, a LINE-FOR-LINE GLSL port of simplex-noise v4's `noise3D` (Jonas Wagner / Stefan
// Gustavson), reading the seed's permutation + gradient table from `uPerm` (built by permTable.ts).
// Unlike the throwaway Ashima noise the spike used, this reproduces the CPU's `noise3D` for the SAME
// seed (up to float32 rounding — highp is float32, the CPU runs float64), so a GPU-generated detail
// patch shows the SAME continents as the CPU-generated globe it nests inside. The JS twin in
// permTable.test.ts is verified bit-identical to the library, so this mirror is correct by construction.
//
// uPerm is a 512×1 RGBA32F texture: texel i = (permGrad3{x,y,z}[i], perm[i]). F3 = 1/3, G3 = 1/6.
export const EXACT_SNOISE_GLSL = /* glsl */ `
uniform highp sampler2D uPerm; // 512x1 RGBA32F: .rgb = gradient(by hashed index), .a = perm[i]

int  permAt(int i) { return int(texelFetch(uPerm, ivec2(i, 0), 0).a); }
vec3 gradAt(int i) { return texelFetch(uPerm, ivec2(i, 0), 0).xyz; }

float snoise(vec3 P) {
  const float F3 = 0.3333333333333333;
  const float G3 = 0.16666666666666666;
  // Skew into simplex cell.
  float s = (P.x + P.y + P.z) * F3;
  float fi = floor(P.x + s), fj = floor(P.y + s), fk = floor(P.z + s);
  float t = (fi + fj + fk) * G3;
  float x0 = P.x - (fi - t);
  float y0 = P.y - (fj - t);
  float z0 = P.z - (fk - t);
  // Which of the six tetrahedra (rank-order x0,y0,z0).
  int i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0)      { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
    else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
    else               { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
  } else {
    if (y0 < z0)       { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
    else if (x0 < z0)  { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
    else               { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
  }
  float x1 = x0 - float(i1) + G3,       y1 = y0 - float(j1) + G3,       z1 = z0 - float(k1) + G3;
  float x2 = x0 - float(i2) + 2.0 * G3, y2 = y0 - float(j2) + 2.0 * G3, z2 = z0 - float(k2) + 2.0 * G3;
  float x3 = x0 - 1.0 + 3.0 * G3,       y3 = y0 - 1.0 + 3.0 * G3,       z3 = z0 - 1.0 + 3.0 * G3;
  int ii = int(fi) & 255, jj = int(fj) & 255, kk = int(fk) & 255;

  float n0 = 0.0, n1 = 0.0, n2 = 0.0, n3 = 0.0;
  float t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
  if (t0 >= 0.0) { int gi = ii + permAt(jj + permAt(kk)); t0 *= t0; vec3 g = gradAt(gi); n0 = t0*t0*(g.x*x0 + g.y*y0 + g.z*z0); }
  float t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
  if (t1 >= 0.0) { int gi = ii + i1 + permAt(jj + j1 + permAt(kk + k1)); t1 *= t1; vec3 g = gradAt(gi); n1 = t1*t1*(g.x*x1 + g.y*y1 + g.z*z1); }
  float t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
  if (t2 >= 0.0) { int gi = ii + i2 + permAt(jj + j2 + permAt(kk + k2)); t2 *= t2; vec3 g = gradAt(gi); n2 = t2*t2*(g.x*x2 + g.y*y2 + g.z*z2); }
  float t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
  if (t3 >= 0.0) { int gi = ii + 1 + permAt(jj + 1 + permAt(kk + 1)); t3 *= t3; vec3 g = gradAt(gi); n3 = t3*t3*(g.x*x3 + g.y*y3 + g.z*z3); }
  return 32.0 * (n0 + n1 + n2 + n3);
}
`;
