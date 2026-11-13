/**
 * GPU simulation. Two programs, both run as full-screen passes:
 *
 *  PARTICLE_SIM  one texel per particle; position and velocity are written
 *                together through two colour attachments (MRT).
 *  TRAIL_SIM     one row per trail; column 0 is the head, every other
 *                column copies its left neighbour, so a row is the head's
 *                recent history — a ribbon.
 */
import { HASH, HEAD, NOISE } from './common';

export const PARTICLE_SIM_FS = /* glsl */ `
${HEAD}
${HASH}
${NOISE}

uniform sampler2D tPos;    // xyz position, w life
uniform sampler2D tVel;    // xyz velocity, w speed
uniform sampler2D tA;      // formation the cloud is leaving
uniform sampler2D tB;      // formation the cloud is becoming
uniform sampler2D tRand;

uniform mat4 uMatA;
uniform mat4 uMatB;
uniform float uMorph;      // 0..1 between A and B
uniform float uTime;
uniform float uDt;
uniform float uSeed;       // 1 on the very first step
uniform float uIntro;      // 0..1 birth of the cloud
uniform float uSpring;
uniform float uTurb;
uniform float uFlowScale;
uniform float uDamp;
uniform float uFree;       // share of particles allowed to drift away and be reborn

uniform vec3 uRayO;        // pointer ray, world space
uniform vec3 uRayD;
uniform vec3 uPointerVel;
uniform float uPointer;    // 0..1 presence of the pointer
uniform float uPress;      // 0..1 pointer held down → attraction
uniform float uRadius;
uniform float uBurst;      // one-frame radial impulse
uniform vec3 uBurstCenter;

layout(location = 0) out vec4 outPos;
layout(location = 1) out vec4 outVel;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(tPos, c, 0);
  vec4 V = texelFetch(tVel, c, 0);
  vec4 rnd = texelFetch(tRand, c, 0);
  vec4 A = texelFetch(tA, c, 0);
  vec4 B = texelFetch(tB, c, 0);

  // particles do not switch formation together: the change sweeps through the cloud
  float m = smoothstep(0.0, 1.0, clamp(uMorph * 1.7 - rnd.x * 0.7, 0.0, 1.0));
  vec3 target = mix((uMatA * vec4(A.xyz, 1.0)).xyz, (uMatB * vec4(B.xyz, 1.0)).xyz, m);

  if (uSeed > 0.5) {
    // everything starts as a single point of light
    vec3 dir = normalize(rnd.xyz - 0.5 + 1e-4);
    outPos = vec4(dir * 0.02 * rnd.w, rnd.y);
    outVel = vec4(dir * (0.6 + 2.4 * rnd.z), 0.0);
    return;
  }

  vec3 pos = P.xyz;
  vec3 vel = V.xyz;
  float life = P.w;
  float dt = uDt;

  float isFree = step(rnd.z, uFree);
  float churn = sin(PI * m);   // strongest halfway through a morph

  // 1. the pull home
  float k = uSpring * (0.45 + 1.1 * rnd.y) * mix(1.0, 0.035, isFree) * (0.15 + 0.85 * uIntro);
  vec3 acc = (target - pos) * k;

  // 2. the fluid
  vec3 f = flow(pos * uFlowScale + vec3(0.0, uTime * 0.045, uTime * 0.02));
  acc += f * uTurb * (1.0 + 2.6 * isFree + 5.0 * churn);

  // 3. the pointer: a soft cylinder along the view ray
  vec3 rel = pos - uRayO;
  vec3 toRay = rel - uRayD * dot(rel, uRayD);
  float d = length(toRay) + 1e-4;
  vec3 away = toRay / d;
  float r = uRadius;
  float near = exp(-(d * d) / (r * r));
  float speed = length(uPointerVel);
  // push aside, swirl around the ray, and get dragged along with the motion
  acc += away * near * 4.0 * uPointer * (1.0 - uPress);
  acc += cross(uRayD, away) * near * (1.5 + 3.0 * min(speed, 3.0)) * uPointer;
  acc += uPointerVel * near * 1.2 * uPointer;
  // held down: the cloud is drawn toward the ray and winds around it
  float wide = exp(-(d * d) / (r * r * 9.0));
  acc -= away * wide * 11.0 * uPress * smoothstep(0.02, 0.25, d);
  acc += cross(uRayD, away) * wide * 6.0 * uPress;

  vel += acc * dt;
  vel *= exp(-uDamp * dt);

  // shock wave (order placed, formation change)
  vec3 fromCenter = pos - uBurstCenter;
  vel += normalize(fromCenter + 1e-4) * uBurst * (0.5 + rnd.w) / (1.0 + dot(fromCenter, fromCenter) * 0.25);

  float sp = length(vel);
  if (sp > 9.0) vel *= 9.0 / sp;
  pos += vel * dt;

  // free particles live, wander off along the flow, fade, and are born again at home
  life -= dt * (0.07 + 0.22 * rnd.w) * isFree;
  if (life <= 0.0) {
    vec3 jitter = (hash3(uvec3(uint(c.x), uint(c.y), uint(uTime * 60.0))) - 0.5) * 0.04;
    pos = target + jitter;
    vel = f * 0.15;
    life = 1.0;
  }

  outPos = vec4(pos, life);
  outVel = vec4(vel, length(vel));
}
`;

export const TRAIL_SIM_FS = /* glsl */ `
${HEAD}
${HASH}
${NOISE}

uniform sampler2D tTrail;  // x = segment, y = trail
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uSimSize;
uniform mat4 uMatA;
uniform mat4 uMatB;
uniform float uMorph;
uniform float uTime;
uniform float uSeed;
uniform float uTurb;
uniform float uFlowScale;
uniform float uSpring;
uniform vec3 uPointerPos;  // pointer on the focal plane, world space
uniform float uPointer;
uniform float uPress;
uniform float uChase;      // share of trails that follow the pointer
uniform float uBurst;
uniform vec3 uBurstCenter;

out vec4 outColor;

vec3 spinY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  uint row = uint(c.y);
  vec3 r1 = hash3(uvec3(row, 5u, 41u));
  vec3 r2 = hash3(uvec3(row, 9u, 43u));

  // each trail is tied to one particle's home and circles the structure's axis,
  // most of them the same way round, so together they read as currents
  ivec2 anchorTexel = ivec2(int(r1.x * uSimSize), int(r1.y * uSimSize));
  float dirSign = r2.y < 0.82 ? 1.0 : -1.0;
  float angle = uTime * (0.16 + 0.42 * r2.x) * dirSign;
  vec3 A = spinY(texelFetch(tA, anchorTexel, 0).xyz * (1.02 + 0.14 * r2.z), angle);
  vec3 B = spinY(texelFetch(tB, anchorTexel, 0).xyz * (1.02 + 0.14 * r2.z), angle);
  float m = smoothstep(0.0, 1.0, clamp(uMorph * 1.7 - r1.z * 0.7, 0.0, 1.0));
  vec3 home = mix((uMatA * vec4(A, 1.0)).xyz, (uMatB * vec4(B, 1.0)).xyz, m);

  if (uSeed > 0.5) {
    outColor = vec4(home * 0.02, 0.0);
    return;
  }

  if (c.x > 0) {
    // history: take the value of the segment in front
    outColor = texelFetch(tTrail, ivec2(c.x - 1, c.y), 0);
    return;
  }

  vec3 head = texelFetch(tTrail, ivec2(0, c.y), 0).xyz;
  vec3 prev = texelFetch(tTrail, ivec2(1, c.y), 0).xyz;
  vec3 vel = head - prev;                       // Verlet: velocity is implied by history
  const float dt = 1.0 / 30.0;

  // some trails leave home to follow the pointer, each with its own lag and radius
  float ph = uTime * (0.6 + 1.2 * r2.x) + r2.y * TAU;
  float chaser = step(r2.x, uChase) * uPointer;
  vec3 around = vec3(cos(ph * 2.3), sin(ph * 1.9), cos(ph * 1.1)) * (0.04 + 0.30 * r1.z) * (1.0 - 0.7 * uPress);
  home = mix(home, uPointerPos + around, chaser);

  float k = uSpring * mix(1.0, 2.2 + 3.0 * r1.x, chaser);
  vec3 acc = (home - head) * k;
  acc += flow(head * uFlowScale + vec3(uTime * 0.04, 0.0, r1.x * 3.0)) * uTurb * (1.0 - 0.5 * chaser);

  vec3 fromCenter = head - uBurstCenter;
  vec3 kick = normalize(fromCenter + 1e-4) * uBurst * 0.03;

  vec3 next = head + vel * (0.90 - 0.05 * chaser) + acc * dt * dt + kick;
  outColor = vec4(next, length(next - head));
}
`;
