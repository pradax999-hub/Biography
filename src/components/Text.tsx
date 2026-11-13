/**
 * Text helpers.
 *
 * Locale strings may contain three inline tags: <b>, <em> and
 * <span class="grad-text">. They come from our own locale files, never from
 * a visitor, so they are safe to render.
 */
import { createElement, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { reducedMotion } from '../lib/motion';

type Tag = 'em' | 'b' | 'span' | null;
interface Chunk {
  tag: Tag;
  text: string;
}

const CHUNK_RE = /<(em|b|span)[^>]*>([\s\S]*?)<\/\1>|([^<]+)/g;

function chunks(html: string): Chunk[] {
  const out: Chunk[] = [];
  let m: RegExpExecArray | null;
  CHUNK_RE.lastIndex = 0;
  while ((m = CHUNK_RE.exec(html))) {
    if (m[3] !== undefined) out.push({ tag: null, text: m[3] });
    else out.push({ tag: m[1] as Tag, text: m[2].replace(/<[^>]+>/g, '') });
  }
  return out;
}

/** A locale string with its inline emphasis rendered. */
export function Rich({ html }: { html: string }) {
  return (
    <>
      {chunks(html).map((c, i) => {
        if (c.tag === 'em' || c.tag === 'span') return <em key={i}>{c.text}</em>;
        if (c.tag === 'b') return <b key={i}>{c.text}</b>;
        return <span key={i}>{c.text}</span>;
      })}
    </>
  );
}

/* --------------------------------------------------------------- reveal */

let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver | null {
  if (reducedMotion || typeof IntersectionObserver === 'undefined') return null;
  observer ??= new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
  );
  return observer;
}

/** Adds `is-in` to the element the first time it scrolls into view. */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = getObserver();
    if (!io) {
      el.classList.add('is-in');
      return;
    }
    io.observe(el);
    return () => io.unobserve(el);
  }, []);
  return ref;
}

interface RevealProps {
  as?: keyof HTMLElementTagNameMap;
  className?: string;
  delay?: number;
  children: ReactNode;
  style?: CSSProperties;
  id?: string;
}

/** Fades and lifts its content in when it enters the viewport. */
export function Reveal({ as = 'div', className = '', delay = 0, children, style, id }: RevealProps) {
  const ref = useReveal<HTMLElement>();
  return createElement(as, { ref, id, className: `rv ${className}`, style: { ...style, '--d': delay } as CSSProperties }, children);
}

interface SplitProps {
  html: string;
  as?: keyof HTMLElementTagNameMap;
  className?: string;
  /** stagger between words, ms */
  stagger?: number;
}

/**
 * A heading whose words rise out of a mask one after another.
 * Screen readers get the plain sentence.
 */
export function SplitReveal({ html, as = 'h2', className = '', stagger = 34 }: SplitProps) {
  const ref = useReveal<HTMLElement>();
  let index = 0;
  const plain = chunks(html)
    .map(c => c.text)
    .join('');
  const body = chunks(html).map((c, ci) => {
    const words = c.text.split(/(\s+)/).map((part, wi) => {
      if (!part) return null;
      if (/^\s+$/.test(part)) return ' ';
      const i = index++;
      return (
        <span className="w" key={wi}>
          <span className="wi" style={{ '--i': i } as CSSProperties}>
            {part}
          </span>
        </span>
      );
    });
    if (c.tag === 'em' || c.tag === 'span') return <em key={ci}>{words}</em>;
    if (c.tag === 'b') return <b key={ci}>{words}</b>;
    return <span key={ci}>{words}</span>;
  });
  return createElement(
    as,
    { ref, className: `split ${className}`, 'aria-label': plain, style: { '--stagger': `${stagger}ms` } as CSSProperties },
    <span aria-hidden="true">{body}</span>,
  );
}
