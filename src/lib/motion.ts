/**
 * Motion foundation: GSAP + ScrollTrigger, Lenis smooth scrolling, and the
 * media-query facts every animated component needs to respect.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

const mq = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;

/** The visitor asked for less motion: no smooth scroll, no entrance animation, a calm engine. */
export const reducedMotion = mq('(prefers-reduced-motion: reduce)');
/** A real mouse or trackpad: custom cursor, tilt and magnetic effects are worth it. */
export const finePointer = mq('(hover: hover) and (pointer: fine)');

export const EASE = 'expo.out';

let lenis: Lenis | null = null;

/** Starts smooth scrolling (mouse wheel only; touch keeps its native feel). */
export function startSmoothScroll(): () => void {
  if (reducedMotion || lenis) return () => undefined;
  const instance = new Lenis({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true });
  lenis = instance;
  instance.on('scroll', ScrollTrigger.update);
  const raf = (time: number): void => instance.raf(time * 1000);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);
  return () => {
    gsap.ticker.remove(raf);
    instance.destroy();
    if (lenis === instance) lenis = null;
  };
}

/**
 * Scrolls to an element or "#id", smoothly when allowed.
 * `gap` is the space left above the target (room for the fixed navigation).
 */
export function scrollToTarget(target: string | HTMLElement, gap = 72): void {
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!el) return;
  if (el === document.body) gap = 0;
  if (lenis) {
    // Lenis already subtracts the page's scroll-padding-top; correct for the difference
    const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
    lenis.scrollTo(el, { offset: padding - gap, duration: 1.4, easing: t => 1 - Math.pow(1 - t, 4) });
  } else {
    const top = el === document.body ? 0 : el.getBoundingClientRect().top + window.scrollY - gap;
    window.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
}

export const pauseScroll = (): void => lenis?.stop();
export const resumeScroll = (): void => lenis?.start();
