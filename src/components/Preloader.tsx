/**
 * A short curtain while the fonts arrive and the first frames render.
 * When it lifts, <html> gets `is-ready` and the hero plays its entrance.
 */
import { useEffect, useState } from 'react';
import { reducedMotion } from '../lib/motion';
import { Icon } from './Icon';

const MIN_MS = 1100;
const MAX_MS = 2600;

/** Someone coming back from the payment page wants the result, not an intro. */
const returning = typeof location !== 'undefined' && new URLSearchParams(location.search).has('order');
const skip = reducedMotion || returning;

export function Preloader() {
  const [count, setCount] = useState(0);
  const [gone, setGone] = useState(skip);

  useEffect(() => {
    const html = document.documentElement;
    if (skip) {
      html.classList.add('is-ready');
      return;
    }
    const t0 = performance.now();
    let fontsReady = false;
    let raf = 0;
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      fontsReady = true;
    });
    const tick = (now: number): void => {
      const elapsed = now - t0;
      const done = (fontsReady && elapsed >= MIN_MS) || elapsed >= MAX_MS;
      // the counter runs to 100 on its own schedule but waits at 99 for the fonts
      const p = Math.min(done ? 1 : 0.99, elapsed / MIN_MS);
      setCount(Math.round(100 * (1 - Math.pow(1 - p, 2.2))));
      if (done) {
        html.classList.add('is-ready');
        window.setTimeout(() => setGone(true), 1100);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (gone) return null;
  return (
    <div className="preloader" aria-hidden="true">
      <div className="pre-mark">
        <Icon name="flake" className="logo-mark" />
      </div>
      <div className="pre-row">
        <span>NIGHTWNTR 2.0</span>
        <span>Entering the void</span>
        <b>{String(count).padStart(3, '0')}</b>
      </div>
    </div>
  );
}
