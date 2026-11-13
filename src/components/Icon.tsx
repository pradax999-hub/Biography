/** Line icons. Paths carried over from nightwntr 1.0, plus a lock for checkout. */
import type { ReactNode } from 'react';

const PATHS: Record<string, { box: string; d: ReactNode }> = {
  flake: {
    box: '0 0 32 32',
    d: (
      <path d="M16 3v26M4.74 9.5l22.52 13M4.74 22.5l22.52-13M12.5 5.5L16 8.5l3.5-3M23.34 7.72l-.84 4.53 4.34 1.53M26.84 18.22l-4.34 1.53.84 4.53M19.5 26.5L16 23.5l-3.5 3M8.66 24.28l.84-4.53-4.34-1.53M5.16 13.78l4.34-1.53-.84-4.53" />
    ),
  },
  globe: {
    box: '0 0 24 24',
    d: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z" />
      </>
    ),
  },
  arrow: { box: '0 0 24 24', d: <path d="M5 12h14M13 6l6 6-6 6" /> },
  upright: { box: '0 0 24 24', d: <path d="M7 17L17 7M8 7h9v9" /> },
  down: { box: '0 0 24 24', d: <path d="M12 5v14M6 13l6 6 6-6" /> },
  up: { box: '0 0 24 24', d: <path d="M12 19V5M6 11l6-6 6 6" /> },
  web: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M3 9h18M6.5 6.5h.01M9.5 6.5h.01" />
      </>
    ),
  },
  film: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M10 9.2v5.6l4.8-2.8z" />
      </>
    ),
  },
  app: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="2" />
        <rect x="13" y="4" width="7" height="7" rx="2" />
        <rect x="4" y="13" width="7" height="7" rx="2" />
        <path d="M16.5 13v7M13 16.5h7" />
      </>
    ),
  },
  send: {
    box: '0 0 24 24',
    d: (
      <>
        <path d="M21 3L10 14" />
        <path d="M21 3l-7 18-4-7-7-4 18-7z" />
      </>
    ),
  },
  mail: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M4 7l8 6 8-6" />
      </>
    ),
  },
  copy: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2.5" />
        <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
      </>
    ),
  },
  card: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="3" y="5.5" width="18" height="13" rx="3" />
        <path d="M3 10h18M7 15h4" />
      </>
    ),
  },
  check: { box: '0 0 24 24', d: <path d="M5 12.5l4.5 4.5L19 7.5" /> },
  cross: { box: '0 0 24 24', d: <path d="M6 6l12 12M18 6L6 18" /> },
  clock: {
    box: '0 0 24 24',
    d: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  lock: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  qr: {
    box: '0 0 24 24',
    d: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <path d="M14 14h3v3h-3zM20.5 14v.01M14 20.5h.01M17.5 20.5H21v-3.5" />
      </>
    ),
  },
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  const icon = PATHS[name];
  if (!icon) return null;
  return (
    <svg className={`i ${className}`} viewBox={icon.box} aria-hidden="true" focusable="false">
      {icon.d}
    </svg>
  );
}
