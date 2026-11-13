/**
 * Custom cursor for mouse users: a dot that is exactly where the pointer is,
 * and a ring that follows with a little inertia, grows over anything
 * clickable and can carry a short label (data-cursor="…").
 */
import { useEffect, useRef } from 'react';
import { finePointer, reducedMotion } from '../lib/motion';

const INTERACTIVE = 'a, button, label, summary, [role="button"], [role="menuitemradio"], [data-cursor]';
const TEXT_FIELDS = 'input, textarea, select';

export function Cursor() {
  const root = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLElement>(null);
  const ring = useRef<HTMLElement>(null);
  const label = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!finePointer || reducedMotion) return;
    const el = root.current;
    if (!el || !dot.current || !ring.current || !label.current) return;
    const html = document.documentElement;
    html.classList.add('has-cursor');
    el.classList.add('is-hidden');

    let x = 0;
    let y = 0;
    let rx = 0;
    let ry = 0;
    let seen = false;
    let raf = 0;

    const onMove = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX;
      y = e.clientY;
      if (!seen) {
        seen = true;
        rx = x;
        ry = y;
      }
      dot.current!.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      const target = e.target instanceof Element ? e.target : null;
      const hit = target?.closest(INTERACTIVE) as HTMLElement | null;
      const text = target?.closest('[data-cursor]')?.getAttribute('data-cursor') || '';
      el.classList.toggle('is-hover', !!hit);
      el.classList.toggle('has-label', !!text);
      el.classList.toggle('is-hidden', !!target?.closest(TEXT_FIELDS));
      if (label.current!.textContent !== text) label.current!.textContent = text;
    };
    const onDown = (): void => el.classList.add('is-down');
    const onUp = (): void => el.classList.remove('is-down');
    const onLeave = (): void => el.classList.add('is-hidden');

    const loop = (): void => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      ring.current!.style.transform = `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    html.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      html.classList.remove('has-cursor');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      html.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div className="cursor" ref={root} aria-hidden="true">
      <i className="c-ring" ref={ring}>
        <b ref={label} />
      </i>
      <i className="c-dot" ref={dot} />
    </div>
  );
}
