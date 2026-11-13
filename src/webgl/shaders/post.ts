/**
 * Post-processing: bloom (dual-filter blur pyramid) and the final grade.
 */
import { HASH, HEAD, NOISE } from './common';

/** First bloom step: keep only the bright part, with a soft knee, at half size. */
export const BLOOM_PREFILTER_FS = /* glsl */ `
${HEAD}
uniform sampler2D tMap;
uniform vec2 uTexel;       // 1 / source size
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 outColor;

vec3 bright(vec3 c) {
  c = min(c, vec3(24.0));                         // tame single hot pixels
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  return c * max(soft, l - uThreshold) / max(l, 1e-4);
}

void main() {
  vec3 c = bright(texture(tMap, vUv).rgb) * 4.0;
  c += bright(texture(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
  c += bright(texture(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  c += bright(texture(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
  c += bright(texture(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb);
  outColor = vec4(c / 8.0, 1.0);
}
`;

export const BLOOM_DOWN_FS = /* glsl */ `
${HEAD}
uniform sampler2D tMap;
uniform vec2 uTexel;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec3 c = texture(tMap, vUv).rgb * 4.0;
  c += texture(tMap, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  c += texture(tMap, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture(tMap, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
  c += texture(tMap, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  outColor = vec4(c / 8.0, 1.0);
}
`;

/** Tent upsample of the smaller level, added to the level above it. */
export const BLOOM_UP_FS = /* glsl */ `
${HEAD}
uniform sampler2D tMap;    // smaller, blurrier level
uniform sampler2D tBase;   // this level
uniform vec2 uTexel;       // 1 / size of tMap
uniform float uSpread;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 o = uTexel * uSpread;
  vec3 c = texture(tMap, vUv + vec2(-o.x * 2.0, 0.0)).rgb;
  c += texture(tMap, vUv + vec2(o.x * 2.0, 0.0)).rgb;
  c += texture(tMap, vUv + vec2(0.0, -o.y * 2.0)).rgb;
  c += texture(tMap, vUv + vec2(0.0, o.y * 2.0)).rgb;
  c += texture(tMap, vUv + vec2(-o.x, o.y)).rgb * 2.0;
  c += texture(tMap, vUv + vec2(o.x, o.y)).rgb * 2.0;
  c += texture(tMap, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  c += texture(tMap, vUv + vec2(o.x, -o.y)).rgb * 2.0;
  outColor = vec4(c / 12.0 + texture(tBase, vUv).rgb, 1.0);
}
`;

/**
 * Final image: atmosphere behind the light, scene + bloom, a filmic curve,
 * a restrained vignette, chromatic fringing toward the corners and grain.
 */
export const COMPOSITE_FS = /* glsl */ `
${HEAD}
${HASH}
${NOISE}

uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uResolution;
uniform float uTime;
uniform float uFrame;
uniform float uBloom;
uniform float uExposure;
uniform float uFringe;
uniform float uGrain;
uniform float uVignette;
uniform float uHaze;
uniform vec2 uGlowPos;     // where the structure sits on screen, 0..1
uniform float uGlow;
uniform vec3 uBg;
uniform vec3 uBg2;
uniform vec3 uViolet;
uniform vec3 uCyan;
in vec2 vUv;
out vec4 outColor;

vec3 filmic(vec3 x) {
  // ACES fit (Narkowicz): keeps the violet saturated while rolling the highlights to white
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / uResolution.y;
  vec2 centered = (uv - 0.5) * vec2(aspect, 1.0);
  float rad = length(centered);

  // light: the red and blue channels are sampled slightly apart near the edges
  vec2 off = (uv - 0.5) * uFringe * rad;
  vec3 scene = vec3(
    texture(tScene, uv + off).r,
    texture(tScene, uv).g,
    texture(tScene, uv - off).b
  );
  vec3 bloom = texture(tBloom, uv).rgb;
  vec3 light = scene + bloom * uBloom;

  // atmosphere: near-black with a slow haze and a glow where the structure is
  vec2 gp = (uv - uGlowPos) * vec2(aspect, 1.0);
  float glow = exp(-dot(gp, gp) * 2.6);
  float n = snoise(vec3(centered * 1.1, uTime * 0.02)) * 0.5 + 0.5;
  float n2 = snoise(vec3(centered * 2.3 + 4.0, uTime * 0.03 + 9.0)) * 0.5 + 0.5;
  vec3 bg = mix(uBg, uBg2, smoothstep(-0.6, 0.9, centered.y + n * 0.35));
  bg += uViolet * glow * uGlow * (0.55 + 0.45 * n);
  bg += mix(uViolet, uCyan, n2) * n * n2 * uHaze;

  vec3 col = bg + filmic(light * uExposure);

  col *= 1.0 - uVignette * smoothstep(0.35, 1.25, rad);

  // sRGB encode, then grain in display space so it reads as film, not noise
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  float g = hash3(uvec3(uint(gl_FragCoord.x), uint(gl_FragCoord.y), uint(uFrame))).x - 0.5;
  col += g * uGrain;

  outColor = vec4(col, 1.0);
}
`;
