/**
 * THE ARCHIVE — projects shown on the site.
 *
 * Only real work goes here. To add a project: put a screenshot in
 * public/archive/, add an entry below, and add its texts to every file in
 * shared/locales/ under the keys you name in `kindKey` and `descKey`.
 * Empty slots are drawn automatically and are clearly marked as placeholders.
 */
export interface Project {
  id: string;
  title: string;
  year: string;
  /** locale key: one line about what kind of work this is */
  kindKey: string;
  /** locale key: the description */
  descKey: string;
  tags: string[];
  /** path under public/, e.g. '/archive/my-project.jpg' */
  image?: string;
  /** where the project lives; leave empty when there is nothing to open */
  url?: string;
  /** locale key of a short label over the image */
  badgeKey?: string;
}

export const PROJECTS: Project[] = [
  {
    id: 'transfer-by-van',
    title: 'Transfer by Van',
    year: '2026',
    kindKey: 'arc.ttt.kind',
    descKey: 'arc.ttt.desc',
    tags: ['JavaScript', 'Tailwind CSS', 'Leaflet', 'Stripe'],
    image: '/archive/transfer-by-van.jpg',
    url: 'https://ttt-72na.onrender.com/',
  },
  {
    id: 'guarantic',
    title: 'Guarantic',
    year: '2026',
    kindKey: 'arc.guar.kind',
    descKey: 'arc.guar.desc',
    tags: ['Telegram Mini App', 'JavaScript', 'Telegram Stars', 'TON'],
    image: '/archive/guarantic.jpg',
    // works only inside Telegram: opened in a normal browser it cannot load the
    // user's data. Put the bot link here (https://t.me/…) to add an "Open" button.
    url: '',
  },
  {
    id: 'nightwntr-2',
    title: 'NIGHTWNTR 2.0',
    year: '2026',
    kindKey: 'arc.v2.kind',
    descKey: 'arc.v2.desc',
    tags: ['React', 'TypeScript', 'Three.js', 'GLSL', 'GSAP'],
    image: '/archive/nightwntr-2.jpg',
    badgeKey: 'arc.here',
  },
  {
    id: 'nightwntr-1',
    title: 'NIGHTWNTR 1.0',
    year: '2026',
    kindKey: 'arc.v1.kind',
    descKey: 'arc.v1.desc',
    tags: ['HTML', 'CSS', 'JavaScript', 'Three.js', 'WebGL'],
    image: '/archive/nightwntr-1.jpg',
    badgeKey: 'arc.archived',
    // 2.0 lives at nightwntr.com; 1.0 stays online at its old address.
    // Empty this if that old site is ever taken down.
    url: 'https://bio-nightwntr.netlify.app/',
  },
];

/** How many "open slot" placeholders follow the real projects. */
export const OPEN_SLOTS = 2;
