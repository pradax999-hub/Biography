/**
 * A tiny typed event bus between the page and the WebGL engine, so sections
 * never need a reference to the engine itself.
 */
import type { EngineStats } from '../webgl/Engine';

interface Events {
  /** a shock wave through the particle cloud */
  burst: number;
  stats: EngineStats;
  /** WebGL is unavailable or failed; the CSS fallback is showing */
  fallback: string;
}

type Handler<K extends keyof Events> = (payload: Events[K]) => void;

const handlers: { [K in keyof Events]?: Set<Handler<K>> } = {};

/** State-like events: whoever subscribes late still gets the latest value. */
const STICKY: Array<keyof Events> = ['stats', 'fallback'];
const last: Partial<Events> = {};

export function on<K extends keyof Events>(event: K, handler: Handler<K>): () => void {
  const set = (handlers[event] ??= new Set() as never) as Set<Handler<K>>;
  set.add(handler);
  if (event in last) handler(last[event] as Events[K]);
  return () => set.delete(handler);
}

export function emit<K extends keyof Events>(event: K, payload: Events[K]): void {
  if (STICKY.includes(event)) last[event] = payload;
  (handlers[event] as Set<Handler<K>> | undefined)?.forEach(h => h(payload));
}
