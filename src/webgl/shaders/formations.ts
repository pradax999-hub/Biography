/**
 * Formations — the shapes the particle cloud can take.
 *
 * Each one is generated entirely on the GPU, once, into a float texture:
 * one texel = one particle's home position (xyz) and its colour index (w).
 * Nothing here is modelled or loaded; every shape is a small program.
 */
import { HASH, HEAD, NOISE } from './common';

export const FORMATION_NAMES = ['VOID', 'MIND', 'STRATA', 'KNOT', 'FIELD', 'ECLIPSE'] as const;
export const FORMATION_COUNT = FORMATION_NAMES.length;

export const FORMATION_FS = /* glsl */ `
${HEAD}
${HASH}
${NOISE}

uniform int uKind;
uniform float uSize;
out vec4 outColor;

vec3 onSphere(vec2 u) {
  float y = u.x * 2.0 - 1.0;
  float a = u.y * TAU;
  float r = sqrt(max(0.0, 1.0 - y * y));
  return vec3(r * cos(a), y, r * sin(a));
}
float gauss(vec2 u) { return sqrt(-2.0 * log(max(u.x, 1e-6))) * cos(TAU * u.y); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

/* A direction pushed along a flow that stays on the sphere: marbled filaments. */
vec3 marble(vec3 d, float freq, float amount, int steps, vec3 seed) {
  for (int i = 0; i < 8; i++) {
    if (i >= steps) break;
    vec3 c = flow(d * freq + seed);
    c -= d * dot(c, d);
    d = normalize(d + c * amount);
  }
  return d;
}

/* Pulls a direction onto the zero-lines of a noise field: a network of veins. */
vec3 veins(vec3 d, float freq, vec3 seed, float tight) {
  for (int i = 0; i < 2; i++) {
    vec3 g; vec3 g2;
    float n = snoise(d * freq + seed, g) + 0.45 * snoise(d * freq * 2.3 - seed.zxy, g2);
    g = g * freq + g2 * (0.45 * freq * 2.3);
    vec3 gt = g - d * dot(g, d);
    d = normalize(d - gt * (n / (dot(gt, gt) + 0.08)) * tight);
  }
  return d;
}

/* 0 — VOID: a veined, breathing membrane around a bright core, with a tilted ring. */
float voidRadius(vec3 d) {
  return 1.14 * (1.0 + 0.24 * snoise(d * 1.05 + 1.3) + 0.07 * snoise(d * 2.7 - 4.1));
}
vec4 fVoid(vec3 r1, vec3 r2, vec3 r3) {
  float pick = r1.x;
  if (pick < 0.50) {
    // the veins: most of the light sits on a few long, branching lines
    vec3 d = veins(onSphere(r1.yz), 1.55, vec3(3.7, 1.1, -2.3), 0.86 + 0.1 * r3.y);
    float hue = 0.42 + 0.5 * snoise(d * 0.9 + 7.0) + 0.12 * (r3.x - 0.5);
    return vec4(d * (voidRadius(d) + gauss(r2.xy) * 0.008), clamp(hue, 0.0, 1.0));
  }
  if (pick < 0.70) {
    // the skin between them: thin, marbled haze
    vec3 d = marble(onSphere(r1.yz), 1.35, 0.11, 6, vec3(3.7, 1.1, -2.3));
    return vec4(d * (voidRadius(d) * (0.985 + 0.02 * r2.x)), clamp(0.12 + 0.3 * snoise(d * 1.4 + 2.0), 0.0, 0.45));
  }
  if (pick < 0.83) {
    vec3 d = veins(onSphere(r1.yz), 2.4, vec3(-1.9, 4.2, 0.6), 0.7);
    float R = 0.46 * pow(r2.x, 0.5) * (1.0 + 0.22 * snoise(d * 2.0 + 9.0));
    return vec4(d * R, 0.78 + 0.22 * r2.y);
  }
  if (pick < 0.975) {
    // a thin ring: bands of dust in one tilted plane
    float u = r2.x;
    float rad = 1.86 + 0.86 * pow(u, 1.5);
    rad += 0.05 * sin(rad * 30.0);
    float ang = r1.y * TAU;
    vec3 p = vec3(cos(ang) * rad, gauss(r2.yz) * 0.006, sin(ang) * rad);
    p = rotZ(0.36) * rotX(0.30) * p;
    return vec4(p, 0.04 + 0.30 * u + 0.10 * r3.x);
  }
  vec3 d = onSphere(r1.yz);
  return vec4(d * (2.1 + 1.5 * pow(r2.x, 0.7)), r2.y);
}

/* 1 — MIND: Thomas' cyclically symmetric strange attractor. */
vec4 fMind(vec3 r1, vec3 r2, vec3 r3) {
  vec3 p = (r1 - 0.5) * 4.0 + 0.001;
  const float b = 0.208186;
  const float dt = 0.11;
  int steps = 140 + int(r2.x * 260.0);
  vec3 v = vec3(0.0);
  for (int i = 0; i < 400; i++) {
    if (i >= steps) break;
    v = vec3(sin(p.y) - b * p.x, sin(p.z) - b * p.y, sin(p.x) - b * p.z);
    p += v * dt;
  }
  float sp = length(v);
  return vec4(p * 0.40 + (r3 - 0.5) * 0.012, clamp(0.12 + sp * 0.55 + 0.10 * r2.y, 0.0, 1.0));
}

/* 2 — STRATA: contour lines of a slow terrain, read like layers of a record. */
vec4 fStrata(vec3 r1, vec3 r2, vec3 r3) {
  if (r1.x < 0.9) {
    const float rows = 72.0;
    float row = floor(r1.y * rows);
    float z = ((row + 0.5) / rows - 0.5) * 7.4;
    float x = (r1.z - 0.5) * 11.0;
    float h = 0.44 * snoise(vec3(x * 0.26, z * 0.31, 0.7)) + 0.15 * snoise(vec3(x * 0.85, z * 0.8, 3.1));
    return vec4(x, h + gauss(r2.xy) * 0.004, z, clamp(0.46 + h * 0.95, 0.0, 1.0));
  }
  return vec4((r1.y - 0.5) * 11.0, pow(r2.x, 2.0) * 2.4 + 0.25, (r1.z - 0.5) * 7.4, r2.y);
}

/* 3 — KNOT: three lobes of one continuous wound strand. */
vec3 trefoil(float t) { return vec3(sin(t) + 2.0 * sin(2.0 * t), cos(t) - 2.0 * cos(2.0 * t), -sin(3.0 * t)); }
vec4 fKnot(vec3 r1, vec3 r2, vec3 r3) {
  float t = r1.x * TAU;
  vec3 c = trefoil(t);
  vec3 tang = normalize(trefoil(t + 0.01) - c);
  vec3 up = normalize(cross(tang, vec3(0.31, 0.52, 0.79)));
  vec3 side = cross(tang, up);
  float rad = 0.31 * (0.78 + 0.22 * sin(t * 3.0));
  vec3 p;
  if (r1.z < 0.14) {
    p = c + onSphere(r2.xy) * rad * 0.55 * sqrt(r2.z);
  } else {
    float a = t * 9.0 + floor(r1.y * 5.0) / 5.0 * TAU + gauss(r2.xy) * 0.07;
    p = c + (cos(a) * up + sin(a) * side) * rad * (0.93 + 0.07 * r2.z);
  }
  return vec4(p * 0.5, clamp(0.5 + 0.5 * sin(t + 0.6) + (r3.x - 0.5) * 0.12, 0.0, 1.0));
}

/* 4 — FIELD: quiet dust, so the order form stays readable. */
vec4 fField(vec3 r1, vec3 r2, vec3 r3) {
  vec3 p = vec3((r1.x - 0.5) * 12.0, (r1.y - 0.5) * 7.0, (r1.z - 0.5) * 8.0 - 1.0);
  p.y += 0.35 * sin(p.x * 0.7 + p.z * 0.4);
  return vec4(p, r2.x);
}

/* 5 — ECLIPSE: a thin ring of light with a corona streaming off it. */
vec4 fEclipse(vec3 r1, vec3 r2, vec3 r3) {
  float a = r1.y * TAU;
  if (r1.x < 0.48) {
    float rad = 1.42 + gauss(r2.xy) * 0.018;
    return vec4(cos(a) * rad, sin(a) * rad, gauss(r2.yz) * 0.02, 0.84 + 0.16 * r3.x);
  }
  if (r1.x < 0.86) {
    float clump = snoise(vec3(cos(a) * 2.2, sin(a) * 2.2, 1.7)) * 0.5 + 0.5;
    float len = pow(r2.x, 1.8) * (0.45 + 2.2 * clump * clump);
    float rad = 1.44 + len;
    float sw = len * 0.35;
    return vec4(cos(a + sw) * rad, sin(a + sw) * rad, gauss(r2.yz) * 0.05 * (1.0 + len), clamp(0.56 - len * 0.34 + 0.10 * r3.x, 0.0, 1.0));
  }
  if (r1.x < 0.93) {
    float rad = 1.36 * sqrt(r2.x);
    return vec4(cos(a) * rad, sin(a) * rad, gauss(r2.yz) * 0.03 - 0.12, 0.08 * r3.x);
  }
  vec3 d = onSphere(r1.yz);
  return vec4(d * (2.4 + 1.9 * r2.x), r2.y);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  uint id = uint(c.x) + uint(c.y) * uint(uSize);
  uint k = uint(uKind);
  vec3 r1 = hash3(uvec3(id, 11u + k * 101u, 3u));
  vec3 r2 = hash3(uvec3(id, 23u + k * 101u, 5u));
  vec3 r3 = hash3(uvec3(id, 37u + k * 101u, 9u));

  vec4 res;
  if (uKind == 0) res = fVoid(r1, r2, r3);
  else if (uKind == 1) res = fMind(r1, r2, r3);
  else if (uKind == 2) res = fStrata(r1, r2, r3);
  else if (uKind == 3) res = fKnot(r1, r2, r3);
  else if (uKind == 4) res = fField(r1, r2, r3);
  else res = fEclipse(r1, r2, r3);
  outColor = res;
}
`;

/** Static per-particle random numbers, generated once. */
export const RANDOM_FS = /* glsl */ `
${HEAD}
${HASH}
uniform float uSize;
out vec4 outColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  uint id = uint(c.x) + uint(c.y) * uint(uSize);
  vec3 a = hash3(uvec3(id, 71u, 13u));
  vec3 b = hash3(uvec3(id, 89u, 17u));
  outColor = vec4(a, b.x);
}
`;
