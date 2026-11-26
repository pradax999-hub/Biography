/**
 * 01 — THE VOID
 * The first screen: the wordmark across the full width, the living particle
 * structure behind it, the status, the lead, and a strip of technical readouts.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { SERVICES, money } from '../../shared/catalog';
import { Icon } from '../components/Icon';
import { AnchorLink } from '../components/Magnetic';
import { Rich } from '../components/Text';
import { SITE } from '../config/site';
import { useI18n } from '../i18n/I18nProvider';
import { on } from '../lib/bus';
import { ScrollTrigger, finePointer, gsap, reducedMotion } from '../lib/motion';
import { useOrder } from '../order/OrderContext';
import type { EngineStats } from '../webgl/Engine';

const WORD = 'NIGHTWNTR';

/** Sets the font size of each line so that it spans its container exactly. */
function useFitLines(deps: unknown[]) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = (): void => {
      const width = el.clientWidth;
      if (!width) return;
      el.querySelectorAll<HTMLElement>('.wm-line').forEach(line => {
        line.style.fontSize = '100px';
        const natural = line.scrollWidth;
        if (natural) line.style.fontSize = `${((100 * width) / natural).toFixed(2)}px`;
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function Hud() {
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [off, setOff] = useState(false);
  const { t } = useI18n();
  useEffect(() => {
    const a = on('stats', setStats);
    const b = on('fallback', () => setOff(true));
    return () => {
      a();
      b();
    };
  }, []);
  if (off) return <span className="hud-stats">{t('gl.fallback')}</span>;
  return (
    <span className="hud-stats" aria-hidden="true">
      WebGL · <b>{stats?.fps ?? 60}</b> FPS · <b>{(stats?.particles ?? 0).toLocaleString('en-US')}</b> PTS
      <span className="hud-extra">
        {' '}
        · {stats?.trails ?? 0} TRAILS · FORMATION {stats?.formation ?? 'VOID'}
      </span>
    </span>
  );
}

/** Live pointer coordinates in the corner: honest technical metadata, nothing invented. */
function Coordinates() {
  const x = useRef<HTMLSpanElement>(null);
  const y = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!finePointer) return;
    const fmt = (v: number): string => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(3);
    const onMove = (e: PointerEvent): void => {
      if (x.current) x.current.textContent = fmt((e.clientX / window.innerWidth) * 2 - 1);
      if (y.current) y.current.textContent = fmt(-((e.clientY / window.innerHeight) * 2 - 1));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return (
    <p className="hero-coords mono" aria-hidden="true">
      <span>
        X <span ref={x}>+0.000</span>
      </span>
      <span>
        Y <span ref={y}>+0.000</span>
      </span>
    </p>
  );
}

export function Hero() {
  const { t } = useI18n();
  const { pick } = useOrder();
  const [stacked, setStacked] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches);
  const lines = stacked ? [WORD.slice(0, 5), WORD.slice(5)] : [WORD];
  const wordmark = useFitLines([stacked]);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = matchMedia('(max-width: 720px)');
    const onChange = (): void => setStacked(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // leaving the first screen: the wordmark lifts and dissolves into the next chapter
  useEffect(() => {
    if (reducedMotion || !root.current) return;
    const ctx = gsap.context(() => {
      // explicit start values: the elements are still hidden behind the preloader when this runs
      gsap.fromTo('.wordmark', { yPercent: 0, opacity: 1 }, { yPercent: -28, opacity: 0, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: 'bottom 35%', scrub: true } });
      gsap.fromTo('.hero-fade', { opacity: 1, y: 0 }, { opacity: 0, y: -40, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top top', end: '55% top', scrub: true } });
    }, root);
    return () => ctx.revert();
  }, []);
  useEffect(() => {
    ScrollTrigger.refresh();
  }, [stacked]);

  let letter = 0;
  return (
    <header className="hero" id="top" data-scene="void" ref={root}>
      <div className="wrap hero-top hero-fade">
        <p className="status">
          <i />
          <span>{t('hero.status')}</span>
        </p>
        <Coordinates />
      </div>

      <div className="wrap hero-bottom">
        <p className="hero-role hero-fade">
          <span>Creative Developer</span>
          <i>/</i>
          <span>Digital Experimenter</span>
          <i className="aka-sep">/</i>
          <span className="aka">aka {SITE.aka}</span>
          <b>01 — The Void</b>
        </p>

        <h1 className="wordmark" aria-label={WORD} ref={wordmark}>
          {lines.map(line => (
            <span className="wm-line" key={line} aria-hidden="true">
              {[...line].map(ch => (
                <span className="ch" key={letter} style={{ '--i': letter++ } as CSSProperties}>
                  <span>{ch}</span>
                </span>
              ))}
            </span>
          ))}
        </h1>

        <div className="hero-row hero-fade">
          <p className="lead">
            <Rich html={t('hero.lead')} />
          </p>
          <ul className="hero-tags">
            <li>{t('tag.design')}</li>
            <li>{t('tag.code')}</li>
            <li>{t('tag.dev')}</li>
            <li>{t('tag.langs')}</li>
          </ul>
          <div className="hero-cta">
            <AnchorLink className="btn btn-primary" href="#order" magnetic onClick={() => pick('website')}>
              <span>{t('hero.cta')}</span>
              <span aria-hidden="true">·</span>
              <span>{money(SERVICES.website.price)}</span>
              <Icon name="arrow" className="arrow" />
            </AnchorLink>
            <AnchorLink className="btn btn-ghost" href="#about" magnetic>
              {t('hero.more')}
            </AnchorLink>
          </div>
        </div>

        <div className="hud hero-fade">
          <Hud />
          <span className="hud-hint">{t(finePointer ? 'hero.hint' : 'hero.hint.touch')}</span>
          <AnchorLink className="scroll-hint" href="#about">
            <span>{t('hero.scroll')}</span>
            <i />
          </AnchorLink>
        </div>
      </div>
    </header>
  );
}
