/**
 * The fixed WebGL stage behind the whole page.
 *
 * Owns the engine's lifetime and feeds it the three things it needs from the
 * page: where the visitor is (scroll → scene), where the pointer is, and
 * bursts. If WebGL is missing or fails, a CSS-only backdrop takes over.
 */
import { useEffect, useRef, useState } from 'react';
import { emit, on } from '../lib/bus';
import { finePointer, reducedMotion } from '../lib/motion';
import { SCENE_IDS } from '../webgl/scenes';
import { webglSupport } from '../webgl/support';

interface Anchor {
  index: number;
  top: number;
}

type EngineClass = typeof import('../webgl/Engine').Engine;

/** Creates the engine and wires it to the page. Returns the function that undoes all of it. */
function mount(canvas: HTMLCanvasElement, Engine: EngineClass, fail: (reason: string) => void): (() => void) | null {
  let engine: InstanceType<EngineClass>;
  try {
    engine = new Engine({ canvas, calm: reducedMotion, onStats: s => emit('stats', s), onFail: fail });
  } catch (err) {
    console.warn('[scene] WebGL engine could not start:', err);
    fail('init');
    return null;
  }
  // with reduced motion the cloud is shown already formed, not being born
  if (reducedMotion) engine.warp(5);
  engine.start();
  if (import.meta.env.DEV) (window as unknown as { __engine: unknown }).__engine = engine;

  /* scroll → scene ------------------------------------------------------ */
  let anchors: Anchor[] = [];
  const update = (): void => {
    if (!anchors.length) return;
    const vh = window.innerHeight;
    const center = window.scrollY + vh * 0.5;
    let pos = anchors[0].index;
    for (let j = 1; j < anchors.length; j++) {
      // a formation starts changing when the next section enters from below
      // and has finished changing shortly after that section reaches mid-screen
      const p = (center - (anchors[j].top - vh * 0.5)) / (vh * 0.62);
      if (p <= 0) break;
      const from = anchors[j - 1].index;
      pos = from + (anchors[j].index - from) * Math.min(1, p);
    }
    engine.setScene(pos);
  };
  const measure = (): void => {
    anchors = [...document.querySelectorAll<HTMLElement>('[data-scene]')]
      .map(el => ({ index: SCENE_IDS.indexOf(el.dataset.scene || ''), top: el.getBoundingClientRect().top + window.scrollY }))
      .filter(a => a.index >= 0)
      .sort((a, b) => a.top - b.top);
    update();
  };
  let scrollFrame = 0;
  const onScroll = (): void => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      update();
    });
  };

  /* size ---------------------------------------------------------------- */
  let resizeFrame = 0;
  const onResize = (): void => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      engine.resize();
      measure();
    });
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(document.body);

  /* pointer ------------------------------------------------------------- */
  const onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') engine.setPointer(e.clientX, e.clientY);
  };
  const interactive = 'a, button, input, textarea, select, label, [role="button"], .order-panel';
  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    // holding the button over empty space draws the cloud in; over controls it does nothing
    if (e.target instanceof Element && e.target.closest(interactive)) return;
    engine.setPointer(e.clientX, e.clientY);
    engine.setPress(true);
  };
  const onPointerUp = (): void => engine.setPress(false);
  const onLeave = (): void => engine.releasePointer();

  // touch: the cloud reacts under the finger, including while the page scrolls
  const onTouch = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (t) engine.setPointer(t.clientX, t.clientY);
  };
  const onTouchEnd = (): void => engine.releasePointer();

  // phones without a permission prompt (Android): tilt gives a little parallax
  const onTilt = (e: DeviceOrientationEvent): void => {
    if (e.gamma == null || e.beta == null) return;
    engine.setTilt(e.gamma / 45, (e.beta - 45) / 45);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });
  window.addEventListener('blur', onLeave);
  document.documentElement.addEventListener('mouseleave', onLeave);
  window.addEventListener('touchstart', onTouch, { passive: true });
  window.addEventListener('touchmove', onTouch, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  const needsPermission = typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function';
  const tiltAllowed = !finePointer && !reducedMotion && typeof DeviceOrientationEvent !== 'undefined' && !needsPermission;
  if (tiltAllowed) window.addEventListener('deviceorientation', onTilt, { passive: true });

  const offBurst = on('burst', strength => engine.burst(strength));
  measure();
  // fonts change the layout once they arrive
  void document.fonts?.ready.then(measure);

  return () => {
    cancelAnimationFrame(scrollFrame);
    cancelAnimationFrame(resizeFrame);
    ro.disconnect();
    offBurst();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    window.removeEventListener('blur', onLeave);
    document.documentElement.removeEventListener('mouseleave', onLeave);
    window.removeEventListener('touchstart', onTouch);
    window.removeEventListener('touchmove', onTouch);
    window.removeEventListener('touchend', onTouchEnd);
    window.removeEventListener('touchcancel', onTouchEnd);
    window.removeEventListener('deviceorientation', onTilt);
    engine.dispose();
  };
}

export function Scene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    const fail = (reason: string): void => {
      setFallback(true);
      document.documentElement.classList.add('no-webgl');
      emit('fallback', reason);
    };

    const support = webglSupport();
    if (!support.ok) {
      fail(support.reason || 'unsupported');
      return;
    }

    // the engine (and three.js with it) is a separate chunk: the page is readable before it arrives
    import('../webgl/Engine')
      .then(({ Engine }) => {
        if (cancelled) return;
        cleanup = mount(canvas, Engine, fail);
      })
      .catch(err => {
        console.warn('[scene] WebGL engine could not load:', err);
        if (!cancelled) fail('load');
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div className="stage" aria-hidden="true">
      {/* always present underneath: it is the whole picture when WebGL is not available */}
      <div className={`stage-fallback ${fallback ? 'is-on' : ''}`}>
        <i />
        <i />
        <i />
      </div>
      <canvas ref={canvasRef} className="stage-canvas" hidden={fallback} />
    </div>
  );
}
