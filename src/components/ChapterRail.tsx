/**
 * The vertical index on the right edge of wide screens: six chapters, the
 * current one lit, plus the scroll progress line across the top.
 */
import { useEffect, useRef, useState } from 'react';
import { scrollToTarget } from '../lib/motion';

const CHAPTERS = [
  { id: 'top', name: 'Void' },
  { id: 'about', name: 'Creator' },
  { id: 'archive', name: 'Archive' },
  { id: 'services', name: 'Services' },
  { id: 'order', name: 'Order' },
  { id: 'contact', name: 'Connection' },
];

export function ChapterRail() {
  const [active, setActive] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? (window.scrollY / max).toFixed(4) : 0})`;
      const mid = window.scrollY + window.innerHeight * 0.5;
      let current = 0;
      CHAPTERS.forEach((c, i) => {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top + window.scrollY <= mid) current = i;
      });
      setActive(current);
    };
    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <>
      <div className="progress" ref={bar} aria-hidden="true" />
      <ol className="rail" aria-hidden="true">
        {CHAPTERS.map((c, i) => (
          <li key={c.id} className={i === active ? 'is-active' : ''}>
            <button type="button" tabIndex={-1} onClick={() => scrollToTarget(c.id === 'top' ? document.body : '#' + c.id)}>
              <span className="rail-name">{c.name}</span>
              <span className="rail-n">{String(i + 1).padStart(2, '0')}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}
