/**
 * Scenes — what the particle cloud does in each part of the page.
 *
 * A scene is a formation plus where it sits and how it behaves. The page
 * reports a single number (scene index + progress to the next one) and the
 * engine blends everything in between.
 */

export interface SceneDef {
  id: string;
  /** index into the formations (see shaders/formations.ts) */
  formation: number;
  /** position as a fraction of the visible half-width / half-height at the focal plane */
  x: number;
  y: number;
  z: number;
  scale: number;
  tiltX: number;
  tiltZ: number;
  /** rotation around the vertical axis, radians per second */
  spin: number;
  hue: number;
  /** particle brightness */
  alpha: number;
  /** particle diameter in world units */
  size: number;
  turb: number;
  spring: number;
  /** share of particles that drift away along the flow and are reborn */
  free: number;
  /** trail brightness */
  trail: number;
  /** background glow behind the structure */
  glow: number;
  aperture: number;
  bloom: number;
}

const base: Omit<SceneDef, 'id' | 'formation'> = {
  x: 0,
  y: 0,
  z: 0,
  scale: 1,
  tiltX: 0.16,
  tiltZ: 0,
  spin: 0.07,
  hue: 0,
  alpha: 1,
  size: 0.0125,
  turb: 0.55,
  spring: 3.2,
  free: 0.16,
  trail: 1,
  glow: 1,
  aperture: 0.011,
  bloom: 1,
};

/** Wide screens: the structure shares the stage with the typography. */
export const SCENES: SceneDef[] = [
  { ...base, id: 'void', formation: 0, y: 0.1, scale: 1.04, alpha: 1.5, glow: 1.2, aperture: 0.008 },
  { ...base, id: 'creator', formation: 1, x: 0.5, scale: 0.78, spin: 0.09, tiltX: 0.3, hue: 0.04, alpha: 0.9, glow: 0.7 },
  { ...base, id: 'skills', formation: 1, x: -0.5, y: 0.05, scale: 0.8, spin: -0.07, tiltX: -0.2, hue: 0.12, alpha: 0.62, trail: 0.7, glow: 0.45 },
  { ...base, id: 'langs', formation: 1, x: 0.05, y: -0.05, z: -1.6, scale: 1.25, spin: 0.05, hue: -0.05, alpha: 0.34, trail: 0.5, glow: 0.4, aperture: 0.016 },
  { ...base, id: 'path', formation: 1, x: 0.5, y: 0.0, scale: 0.72, spin: 0.11, tiltX: 0.5, hue: 0.1, alpha: 0.55, trail: 0.6, glow: 0.4 },
  { ...base, id: 'archive', formation: 2, y: -0.62, z: -0.4, scale: 1.0, tiltX: 0.2, spin: 0.012, hue: 0.06, alpha: 0.7, size: 0.011, turb: 0.3, free: 0.1, trail: 0.55, glow: 0.3, aperture: 0.014 },
  { ...base, id: 'services', formation: 3, y: 0.02, z: -0.6, scale: 1.0, tiltX: 0.1, spin: 0.1, alpha: 0.5, trail: 0.6, glow: 0.5, aperture: 0.013 },
  { ...base, id: 'order', formation: 4, z: -0.5, scale: 1.0, tiltX: 0, spin: 0.015, alpha: 0.2, size: 0.011, turb: 0.4, spring: 1.6, free: 0.3, trail: 0.3, glow: 0.15, aperture: 0.016, bloom: 0.8 },
  { ...base, id: 'connection', formation: 5, y: 0.04, scale: 1.08, tiltX: 0.04, spin: 0, hue: 0, alpha: 0.95, turb: 0.22, free: 0.24, trail: 0.9, glow: 0.9 },
];

/** Tall screens: the structure becomes the backdrop, centred and quieter behind text. */
const PORTRAIT: Record<string, Partial<SceneDef>> = {
  void: { x: 0, y: 0.24, scale: 0.62, alpha: 0.85, glow: 0.9 },
  creator: { x: 0.3, y: 0.42, scale: 0.5, alpha: 0.34, trail: 0.5 },
  skills: { x: -0.3, y: 0.4, scale: 0.5, alpha: 0.24, trail: 0.4 },
  langs: { x: 0, y: 0, scale: 0.8, alpha: 0.2 },
  path: { x: 0.4, y: 0.4, scale: 0.46, alpha: 0.24, trail: 0.4 },
  archive: { y: -0.5, scale: 0.62, alpha: 0.26, trail: 0.35 },
  services: { scale: 0.56, alpha: 0.26 },
  order: { alpha: 0.14 },
  connection: { y: 0.3, scale: 0.52, alpha: 0.7 },
};

export function sceneFor(index: number, portrait: number): SceneDef {
  const s = SCENES[Math.max(0, Math.min(SCENES.length - 1, index))];
  if (portrait <= 0) return s;
  const p = PORTRAIT[s.id];
  if (!p) return s;
  const out = { ...s };
  for (const key of Object.keys(p) as Array<keyof SceneDef>) {
    const a = s[key];
    const b = p[key];
    if (typeof a === 'number' && typeof b === 'number') (out[key] as number) = a + (b - a) * portrait;
  }
  return out;
}

export const SCENE_IDS = SCENES.map(s => s.id);
