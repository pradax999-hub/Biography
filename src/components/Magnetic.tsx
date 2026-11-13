import { useEffect, useRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { finePointer, reducedMotion, scrollToTarget } from '../lib/motion';

/** Pulls an element a little toward the pointer while it is hovered. */
export function useMagnetic<T extends HTMLElement>(strength = 0.22) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !strength || !finePointer || reducedMotion) return;
    const onMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * strength}px, ${(e.clientY - r.top - r.height / 2) * strength * 1.4}px)`;
    };
    const onLeave = (): void => {
      el.style.transform = '';
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [strength]);
  return ref;
}

interface AnchorProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  magnetic?: boolean;
  children: ReactNode;
}

/** An in-page link (#id) that scrolls smoothly and can be magnetic. */
export function AnchorLink({ href, magnetic = false, onClick, children, ...rest }: AnchorProps) {
  const ref = useMagnetic<HTMLAnchorElement>(magnetic ? 0.2 : 0);
  return (
    <a
      ref={ref}
      href={href}
      onClick={e => {
        onClick?.(e);
        if (e.defaultPrevented || !href.startsWith('#')) return;
        e.preventDefault();
        scrollToTarget(href === '#top' ? document.body : href);
        history.replaceState(null, '', href === '#top' ? location.pathname + location.search : href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
