/**
 * 03 — THE ARCHIVE
 * Real projects as large plates, followed by clearly marked empty slots.
 * Nothing here is invented: see src/content/projects.ts.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Chapter } from '../components/Chapter';
import { Icon } from '../components/Icon';
import { AnchorLink } from '../components/Magnetic';
import { Reveal, SplitReveal } from '../components/Text';
import { OPEN_SLOTS, PROJECTS, type Project } from '../content/projects';
import { useI18n } from '../i18n/I18nProvider';
import { finePointer, gsap, reducedMotion } from '../lib/motion';

/** The image leans toward the pointer and drifts a little against the scroll. */
function usePlateMotion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.plate-img', { yPercent: -3.4 }, { yPercent: 3.4, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
    }, el);
    if (!finePointer) return () => ctx.revert();
    const onMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', `${(-y * 5).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`);
      el.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
    };
    const onLeave = (): void => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      ctx.revert();
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, []);
  return ref;
}

function Plate({ project, index }: { project: Project; index: number }) {
  const { t } = useI18n();
  const media = usePlateMotion();
  const [broken, setBroken] = useState(!project.image);
  const number = String(index + 1).padStart(2, '0');

  return (
    <article className={`plate ${index % 2 ? 'is-flip' : ''}`}>
      <Reveal className="plate-media-wrap">
        <div className="plate-media" ref={media}>
          <div className="plate-frame">
            {!broken && <img className="plate-img" src={project.image} alt={`${project.title} — ${t(project.kindKey)}`} loading="lazy" decoding="async" onError={() => setBroken(true)} />}
            {broken && <div className="plate-img plate-generative" />}
            <i className="plate-sheen" />
          </div>
          {project.badgeKey && <span className="plate-badge">{t(project.badgeKey)}</span>}
        </div>
      </Reveal>
      <div className="plate-info">
        <Reveal as="p" className="plate-meta">
          <span>{number}</span>
          <i />
          <span>{project.year}</span>
        </Reveal>
        <SplitReveal as="h3" html={project.title} className="plate-title" />
        <Reveal as="p" className="plate-kind">
          {t(project.kindKey)}
        </Reveal>
        <Reveal as="p" className="plate-desc">
          {t(project.descKey)}
        </Reveal>
        <Reveal as="ul" className="tags">
          {project.tags.map(tag => (
            <li key={tag}>{tag}</li>
          ))}
        </Reveal>
        {project.url && (
          <Reveal>
            <a className="btn btn-ghost" href={project.url} target="_blank" rel="noopener" data-cursor={t('cur.open')}>
              <span>{t('cur.open')}</span>
              <Icon name="upright" className="arrow" />
            </a>
          </Reveal>
        )}
      </div>
    </article>
  );
}

function Slot({ index }: { index: number }) {
  const { t } = useI18n();
  const number = String(index + 1).padStart(2, '0');
  return (
    <Reveal as="article" className="slot" delay={index % 2}>
      <div className="slot-frame" style={{ '--seed': index } as CSSProperties}>
        <span className="slot-number" aria-hidden="true">
          {number}
        </span>
        <span className="slot-kind">{t('arc.slot.kind')}</span>
      </div>
      <div className="slot-info">
        <h3>{t('arc.slot.title')}</h3>
        <p>{t('arc.slot.desc')}</p>
        <AnchorLink className="link-arrow" href="#order">
          <span>{t('arc.slot.cta')}</span>
          <Icon name="arrow" className="arrow" />
        </AnchorLink>
      </div>
    </Reveal>
  );
}

export function Archive() {
  const { t } = useI18n();
  return (
    <section className="section archive" id="archive" data-scene="archive">
      <div className="wrap">
        <Chapter index="03" name="The Archive" label={t('arc.eyebrow')} />
        <div className="archive-head">
          <SplitReveal html={t('arc.title')} className="h2" />
          <Reveal as="p" className="sub">
            {t('arc.sub')}
          </Reveal>
        </div>
        <div className="plates">
          {PROJECTS.map((p, i) => (
            <Plate project={p} index={i} key={p.id} />
          ))}
        </div>
        <div className="slots">
          {Array.from({ length: OPEN_SLOTS }, (_, i) => (
            <Slot index={PROJECTS.length + i} key={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
