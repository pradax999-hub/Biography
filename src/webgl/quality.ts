/**
 * Quality tiers. The engine picks one from what the device reports and then
 * keeps watching the frame rate, stepping the render scale and the particle
 * budget down if the device cannot hold it.
 */

export type TierName = 'ultra' | 'high' | 'medium' | 'low' | 'minimal';

export interface Tier {
  name: TierName;
  /** side of the simulation texture; particles = simSize² */
  simSize: number;
  trailCount: number;
  trailSegments: number;
  /** device pixel ratio is capped at this */
  dprMax: number;
  bloomLevels: number;
  dust: number;
  /** 0 = follow the display */
  maxFps: number;
}

export const TIERS: Record<TierName, Tier> = {
  ultra: { name: 'ultra', simSize: 512, trailCount: 720, trailSegments: 56, dprMax: 2, bloomLevels: 6, dust: 5000, maxFps: 0 },
  high: { name: 'high', simSize: 384, trailCount: 540, trailSegments: 52, dprMax: 1.75, bloomLevels: 6, dust: 4000, maxFps: 0 },
  medium: { name: 'medium', simSize: 256, trailCount: 380, trailSegments: 44, dprMax: 1.5, bloomLevels: 5, dust: 2500, maxFps: 0 },
  low: { name: 'low', simSize: 192, trailCount: 240, trailSegments: 36, dprMax: 1.25, bloomLevels: 5, dust: 1500, maxFps: 0 },
  minimal: { name: 'minimal', simSize: 128, trailCount: 130, trailSegments: 30, dprMax: 1, bloomLevels: 4, dust: 800, maxFps: 30 },
};

const ORDER: TierName[] = ['ultra', 'high', 'medium', 'low', 'minimal'];

export function lowerTier(name: TierName): TierName | null {
  const i = ORDER.indexOf(name);
  return i < ORDER.length - 1 ? ORDER[i + 1] : null;
}

interface NavigatorHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export function rendererName(gl: WebGL2RenderingContext): string {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return '';
  }
}

export function detectTier(gl: WebGL2RenderingContext): Tier {
  // manual override for testing: ?q=ultra|high|medium|low|minimal
  const forced = new URLSearchParams(location.search).get('q') as TierName | null;
  if (forced && forced in TIERS) return TIERS[forced];

  const name = rendererName(gl);
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) return TIERS.minimal;

  const nav = navigator as Navigator & NavigatorHints;
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory || 4;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;

  if (coarse && small) return cores >= 6 && memory >= 4 ? TIERS.medium : TIERS.low;
  if (coarse) return TIERS.medium;

  const strong = /(rtx|gtx|geforce|radeon rx|radeon pro|quadro|arc\b|apple m\d|apple gpu)/i.test(name);
  const weak = /(intel|uhd|iris|hd graphics|mali|adreno|powervr|microsoft)/i.test(name) && !strong;
  if (strong) return cores >= 8 ? TIERS.ultra : TIERS.high;
  if (weak) return TIERS.medium;
  return TIERS.high;
}
