/**
 * Drawing: particles, ribbon trails, background dust — all additive light.
 */
import { HASH, HEAD, PALETTE } from './common';

/* ------------------------------------------------------------- particles */

export const POINTS_VS = /* glsl */ `
${HEAD}
${PALETTE}

in vec3 position;          // xy = this particle's texel (uv), z unused

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tA;
uniform sampler2D tB;
uniform sampler2D tRand;
uniform float uMorph;
uniform float uPx;         // pixels per world unit at distance 1
uniform float uSize;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxSize;
uniform float uAlpha;
uniform float uHue;
uniform float uFree;
uniform float uGlow;

out vec3 vColor;
out float vBlur;

void main() {
  vec4 P = texture(tPos, position.xy);
  vec4 V = texture(tVel, position.xy);
  vec4 rnd = texture(tRand, position.xy);
  float hA = texture(tA, position.xy).w;
  float hB = texture(tB, position.xy).w;
  float m = smoothstep(0.0, 1.0, clamp(uMorph * 1.7 - rnd.x * 0.7, 0.0, 1.0));

  vec4 mv = viewMatrix * vec4(P.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.05);

  // thin-lens depth of field: out-of-focus particles grow and dim
  float sharp = uSize * (0.55 + 0.9 * rnd.w) * uPx / depth;
  float blur = abs(depth - uFocus) * uAperture * uPx / depth;
  float d = sharp + blur;
  float size = clamp(d, 1.0, uMaxSize);
  gl_PointSize = size;

  // keep the emitted energy constant whatever the sprite size
  float energy = (sharp * sharp) / (size * size);
  energy *= min(d * d, 1.0);                       // sub-pixel points fade instead of aliasing
  energy = mix(energy, sqrt(energy), 0.35);        // let bokeh stay visible

  float speed = V.w;
  float hue = mix(hA, hB, m) + (rnd.x - 0.5) * 0.22 + uHue + speed * 0.10;
  vec3 col = palette(hue);
  col *= 1.0 + speed * speed * uGlow;              // fast particles run hot
  col = mix(col, vec3(dot(col, vec3(0.33))) * 1.4, smoothstep(2.5, 7.0, speed) * 0.6);

  // free particles fade in at birth and out before they are recycled
  float isFree = step(rnd.z, uFree);
  float lifeFade = mix(1.0, smoothstep(0.0, 0.18, P.w) * smoothstep(1.0, 0.86, P.w), isFree);

  // a few particles are far brighter than the rest: that is what makes the cloud glitter
  float sparkle = 0.32 + 3.0 * pow(rnd.y, 6.0);
  vColor = col * uAlpha * energy * lifeFade * sparkle;
  vBlur = clamp(blur / max(sharp, 0.5), 0.0, 4.0);
}
`;

export const POINTS_FS = /* glsl */ `
${HEAD}
in vec3 vColor;
in float vBlur;
out vec4 outColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  // in focus: a soft gaussian core. out of focus: a flatter disc with a faint rim
  float core = exp(-r2 * 3.2);
  float disc = smoothstep(1.0, 0.72, r2) * (0.55 + 0.45 * r2);
  float a = mix(core, disc, clamp(vBlur * 0.5, 0.0, 1.0));
  outColor = vec4(vColor * a, 1.0);
}
`;

/* ---------------------------------------------------------------- trails */

export const TRAIL_VS = /* glsl */ `
${HEAD}
${HASH}
${PALETTE}

in vec3 position;          // x = segment, y = trail, z = side (-1 | +1)

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform sampler2D tTrail;
uniform float uSegments;
uniform float uFrac;       // progress toward the next simulation step, for smooth motion
uniform vec2 uViewport;    // pixels
uniform float uPx;
uniform float uWidth;
uniform float uAlpha;
uniform float uHue;
uniform float uFocus;
uniform float uAperture;
uniform float uChase;
uniform float uPointer;

out vec3 vColor;
out float vSide;

// the simulation ticks at 30 Hz; sliding every point toward its newer
// neighbour in between makes the ribbon move at the display rate
vec3 at(int seg, int row, int last) {
  vec3 a = texelFetch(tTrail, ivec2(clamp(seg, 0, last), row), 0).xyz;
  vec3 b = texelFetch(tTrail, ivec2(clamp(seg + 1, 0, last), row), 0).xyz;
  return mix(b, a, uFrac);
}

void main() {
  int seg = int(position.x);
  int row = int(position.y);
  int last = int(uSegments) - 1;
  vec3 P = at(seg, row, last);
  vec3 Pn = at(seg + 1, row, last);
  vec3 Pp = at(seg - 1, row, last);
  float headSpeed = texelFetch(tTrail, ivec2(0, row), 0).w;

  vec4 mv = viewMatrix * vec4(P, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec4 cn = projectionMatrix * viewMatrix * vec4(Pn, 1.0);
  vec4 cp = projectionMatrix * viewMatrix * vec4(Pp, 1.0);
  vec2 dir = (cn.xy / max(cn.w, 1e-4) - cp.xy / max(cp.w, 1e-4)) * uViewport;
  float dl = length(dir);
  dir = dl > 1e-5 ? dir / dl : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);

  float depth = max(-mv.z, 0.05);
  float t = position.x / float(last);              // 0 head → 1 tail
  vec3 r = hash3(uvec3(uint(row), 5u, 41u));
  vec3 r2 = hash3(uvec3(uint(row), 9u, 43u));

  float taper = smoothstep(0.0, 0.07, t) * pow(1.0 - t, 1.1);
  float blur = abs(depth - uFocus) * uAperture * uPx / depth;
  float px = max(uWidth * (0.45 + 1.1 * r.y * r.y) * uPx / depth * taper + blur * 0.4, 1.1);
  clip.xy += normal * (px / uViewport) * clip.w * position.z;
  gl_Position = clip;

  // a hot head cooling down the tail: ice and cyan first, violet last
  float chaser = step(r2.x, uChase) * uPointer;
  float hueHead = mix(0.38 + 0.6 * r.x, 1.0, chaser);
  float hueTail = 0.02 + 0.22 * r.z;
  vec3 col = palette(mix(hueHead, hueTail, pow(t, 0.7)) + uHue);
  float fade = smoothstep(0.0, 0.05, t) * pow(1.0 - t, 1.5);
  float moving = smoothstep(0.001, 0.012, headSpeed);         // a resting trail goes dark
  float energy = 1.0 / (1.0 + blur * 0.3);
  vColor = col * uAlpha * fade * moving * energy * (0.35 + 1.3 * r.z * r.z) * (1.0 + 1.4 * chaser);
  vSide = position.z;
}
`;

export const TRAIL_FS = /* glsl */ `
${HEAD}
in vec3 vColor;
in float vSide;
out vec4 outColor;
void main() {
  float edge = 1.0 - abs(vSide);
  outColor = vec4(vColor * edge * edge * (3.0 - 2.0 * edge) * 1.5, 1.0);
}
`;

/* ------------------------------------------------------------------ dust */

export const DUST_VS = /* glsl */ `
${HEAD}
${PALETTE}

in vec3 position;
in vec4 aSeed;

uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uPx;
uniform float uFocus;
uniform float uAperture;
uniform float uAlpha;

out vec3 vColor;
out float vBlur;

void main() {
  vec3 p = position;
  p += vec3(sin(uTime * 0.07 + aSeed.x * 40.0), cos(uTime * 0.05 + aSeed.y * 40.0), sin(uTime * 0.06 + aSeed.z * 40.0)) * 0.18;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = max(-mv.z, 0.05);
  float sharp = (0.006 + 0.012 * aSeed.w) * uPx / depth;
  float blur = abs(depth - uFocus) * uAperture * 0.8 * uPx / depth;
  float d = sharp + blur;
  float size = clamp(d, 1.0, 40.0);
  gl_PointSize = size;
  float energy = (sharp * sharp) / (size * size) * min(d * d, 1.0);
  energy = mix(energy, sqrt(energy), 0.5);
  float twinkle = 0.6 + 0.4 * sin(uTime * (0.6 + aSeed.x * 1.8) + aSeed.y * 30.0);
  vColor = palette(aSeed.z) * uAlpha * energy * twinkle;
  vBlur = clamp(blur / max(sharp, 0.5), 0.0, 4.0);
}
`;
