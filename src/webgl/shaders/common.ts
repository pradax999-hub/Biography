/**
 * Shared GLSL ES 3.00 building blocks.
 * Every shader in the engine is a RawShaderMaterial, so nothing is injected
 * by three.js except the #version line.
 */

export const HEAD = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

const float PI = 3.141592653589793;
const float TAU = 6.283185307179586;
`;

/** Integer hashing (PCG3D): stable, fast, no sine tricks. */
export const HASH = /* glsl */ `
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 hash3(uvec3 p) { return vec3(pcg3d(p)) * (1.0 / 4294967296.0); }
float hash1(vec2 p) {
  uvec3 h = pcg3d(uvec3(floatBitsToUint(p.x), floatBitsToUint(p.y), 7u));
  return float(h.x) * (1.0 / 4294967296.0);
}
`;

/**
 * 3D simplex noise with analytic gradient (Ashima Arts / Stefan Gustavson, MIT)
 * and a divergence-free flow field built from it. Being divergence-free is
 * what makes the particle motion read as a fluid: nothing piles up, nothing
 * drains away, everything swirls.
 */
export const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));

  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 105.0;

  return 105.0 * dot(m4, pdotx);
}

float snoise(vec3 v) { vec3 g; return snoise(v, g); }

/* Divergence-free field: the cross product of two noise gradients. */
vec3 flowRaw(vec3 p) {
  vec3 g1; vec3 g2;
  snoise(p, g1);
  snoise(p.yzx * 1.07 + vec3(31.4, -17.2, 8.6), g2);
  return cross(g1, g2.zxy);
}
/* Same field with its strength evened out (roughly unit length, never above 2). */
vec3 flow(vec3 p) {
  vec3 f = flowRaw(p);
  return f * inversesqrt(1.0 + 0.25 * dot(f, f));
}
`;

export const FULLSCREEN_VS = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Violet → purple → cyan → ice, the whole identity in one ramp (linear RGB). */
export const PALETTE = /* glsl */ `
uniform vec3 uViolet;
uniform vec3 uPurple;
uniform vec3 uCyan;
uniform vec3 uIce;
vec3 palette(float h) {
  h = clamp(h, 0.0, 1.0);
  vec3 c = mix(uViolet, uPurple, smoothstep(0.0, 0.38, h));
  c = mix(c, uCyan, smoothstep(0.34, 0.74, h));
  c = mix(c, uIce, smoothstep(0.72, 1.0, h));
  return c;
}
`;
