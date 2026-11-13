/**
 * 02 — THE CREATOR
 * About, numbers, what I do, languages and the path so far. All of the text
 * and every figure comes from nightwntr 1.0.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import { Chapter } from '../components/Chapter';
import { useLanguageSwitch } from '../components/Nav';
import { Reveal, SplitReveal } from '../components/Text';
import { TECH } from '../config/site';
import { LANGUAGE_CARDS, useI18n } from '../i18n/I18nProvider';
import { gsap, reducedMotion } from '../lib/motion';

/* --------------------------------------------------------------- about */

/** A paragraph that lights up word by word as it is scrolled through. */
function ScrubText({ texts }: { texts: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reducedMotion || !ref.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.sw', { opacity: 0.16 }, { opacity: 1, ease: 'none', stagger: 0.06, scrollTrigger: { trigger: ref.current, start: 'top 82%', end: 'bottom 48%', scrub: 0.4 } });
    }, ref);
    return () => ctx.revert();
  }, [texts]);
  return (
    <div className="creator-text" ref={ref}>
      {texts.map((text, i) => (
        <p key={i} aria-label={text}>
          {text.split(/(\s+)/).map((part, k) =>
            /^\s+$/.test(part) ? (
              ' '
            ) : (
              <span className="sw" key={k} aria-hidden="true">
                {part}
              </span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion) return;
    const io = new IntersectionObserver(
      entries => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (now: number): void => {
          const p = Math.min(1, (now - t0) / 1400);
          el.textContent = Math.round(to * (1 - Math.pow(1 - p, 4))) + suffix;
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to, suffix]);
  return (
    <dd ref={ref}>
      {to}
      {suffix}
    </dd>
  );
}

export function Creator() {
  const { t } = useI18n();
  const stats: Array<{ to: number; suffix?: string; label: string }> = [
    { to: 14, label: t('stat.age') },
    { to: 2, label: t('stat.years') },
    { to: 5, suffix: '+', label: t('stat.courses') },
    { to: 5, label: t('stat.langs') },
  ];
  return (
    <section className="section creator" id="about" data-scene="creator">
      <div className="wrap">
        <Chapter index="02" name="The Creator" label={t('about.eyebrow')} />
        <div className="creator-copy">
          <SplitReveal html={t('about.title')} className="h2" />
          <ScrubText texts={[t('about.p1'), t('about.p2')]} />
        </div>
        <dl className="stats">
          {stats.map((s, i) => (
            <Reveal className="stat" key={i} delay={i}>
              <Counter to={s.to} suffix={s.suffix} />
              <dt>{s.label}</dt>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- skills */

function Marquee({ items, reverse = false, outlined = false }: { items: string[]; reverse?: boolean; outlined?: boolean }) {
  const row = items.map((s, i) => <span key={i}>{s}</span>);
  return (
    <div className={`marquee ${reverse ? 'is-reverse' : ''} ${outlined ? 'is-outlined' : ''}`}>
      <div className="track">
        {[0, 1, 2, 3].map(n => (
          <div className="group" key={n}>
            {row}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Skills() {
  const { t } = useI18n();
  const skills = ['design', 'code', 'dev'];
  return (
    <section className="section skills" id="skills" data-scene="skills">
      <div className="wrap skills-grid">
        <div className="skills-head">
          <Reveal as="p" className="eyebrow">
            {t('skills.eyebrow')}
          </Reveal>
          <SplitReveal html={t('skills.title')} className="h2" />
        </div>
        <ol className="skill-list">
          {skills.map((s, i) => (
            <Reveal as="li" className="skill" key={s} delay={i}>
              <span className="n">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{t(`skill.${s}.t`)}</h3>
                <p>{t(`skill.${s}.d`)}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </div>
      <div className="ribbons" aria-hidden="true">
        <Marquee items={TECH} outlined />
        <Marquee items={t('ribbon').split('|')} reverse />
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- languages */

/** The draggable 3D ring of language cards from 1.0: tap a card, the site switches. */
export function Languages() {
  const { t, lang } = useI18n();
  const switchLang = useLanguageSwitch();
  const stage = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const api = useRef<{ faceTo: (l: string) => void; moved: () => number } | null>(null);
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    const stageEl = stage.current;
    const el = ring.current;
    if (!stageEl || !el) return;
    const cards = [...el.querySelectorAll<HTMLElement>('.lang-card')];
    const N = cards.length;
    const step = 360 / N;
    let angle = 0;
    let target: number | null = null;
    let vel = 0;
    let R = 260;
    let hover = false;
    let visible = false;
    let down = false;
    let captured = false;
    let lastX = 0;
    let moved = 0;
    let raf = 0;

    const idx = (l: string): number => cards.findIndex(c => c.dataset.lang === l);
    const nearest = (a: number): number => angle + ((((a - angle) % 360) + 540) % 360) - 180;
    const layout = (): void => {
      const w = cards[0].offsetWidth || 200;
      R = Math.round(w / 2 / Math.tan(Math.PI / N) + 48);
      cards.forEach((c, i) => {
        c.style.transform = `rotateY(${i * step}deg) translateZ(${R}px)`;
      });
    };
    const paint = (): void => {
      el.style.transform = `translateZ(${-R}px) rotateY(${-angle}deg)`;
      cards.forEach((c, i) => {
        const d = ((i * step - angle) * Math.PI) / 180;
        c.style.setProperty('--face', ((Math.cos(d) + 1) / 2).toFixed(3));
      });
    };
    const frame = (): void => {
      if (visible) {
        if (target !== null && !down) {
          angle += (target - angle) * 0.1;
          if (Math.abs(target - angle) < 0.05) {
            angle = target;
            target = null;
          }
        } else if (!down) {
          angle += vel;
          vel *= 0.94;
          if (!hover && !reducedMotion && Math.abs(vel) < 0.03) angle += 0.07;
        }
        paint();
      }
      raf = requestAnimationFrame(frame);
    };
    const faceTo = (l: string): void => {
      const i = idx(l);
      if (i >= 0) target = nearest(i * step);
    };

    const onEnter = (): void => void (hover = true);
    const onLeave = (): void => void (hover = false);
    const onDown = (e: PointerEvent): void => {
      down = true;
      captured = false;
      moved = 0;
      lastX = e.clientX;
      vel = 0;
      target = null;
    };
    const onMove = (e: PointerEvent): void => {
      if (!down) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      moved += Math.abs(dx);
      if (!captured && moved > 6) {
        captured = true;
        stageEl.setPointerCapture(e.pointerId);
        stageEl.classList.add('is-drag');
      }
      if (captured) {
        angle -= dx * 0.28;
        vel = -dx * 0.28;
      }
    };
    const onUp = (): void => {
      down = false;
      captured = false;
      stageEl.classList.remove('is-drag');
    };
    const onResize = (): void => {
      layout();
      paint();
    };

    stageEl.addEventListener('pointerenter', onEnter);
    stageEl.addEventListener('pointerleave', onLeave);
    stageEl.addEventListener('pointerdown', onDown);
    stageEl.addEventListener('pointermove', onMove);
    stageEl.addEventListener('pointerup', onUp);
    stageEl.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
    });
    io.observe(stageEl);

    angle = Math.max(0, idx(langRef.current)) * step;
    layout();
    paint();
    raf = requestAnimationFrame(frame);
    void document.fonts?.ready.then(onResize);
    api.current = { faceTo, moved: () => moved };

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      stageEl.removeEventListener('pointerenter', onEnter);
      stageEl.removeEventListener('pointerleave', onLeave);
      stageEl.removeEventListener('pointerdown', onDown);
      stageEl.removeEventListener('pointermove', onMove);
      stageEl.removeEventListener('pointerup', onUp);
      stageEl.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // whichever way the language changes, the ring turns to face it
  useEffect(() => {
    api.current?.faceTo(lang);
  }, [lang]);

  return (
    <section className="section langs" id="langs" data-scene="langs">
      <div className="wrap langs-grid">
        <div className="langs-head">
          <Reveal as="p" className="eyebrow">
            {t('langs.eyebrow')}
          </Reveal>
          <SplitReveal html={t('langs.title')} className="h2" />
          <Reveal as="p" className="sub">
            {t('langs.sub')}
          </Reveal>
        </div>
        <Reveal>
          <div className="ring-stage" ref={stage} data-cursor={t('cur.drag')}>
            <div className="ring" ref={ring}>
              {LANGUAGE_CARDS.map(c => (
                <button
                  className={`lang-card ${lang === c.lang ? 'is-current' : ''}`}
                  type="button"
                  key={c.lang}
                  data-lang={c.lang}
                  lang={c.lang}
                  onFocus={() => api.current?.faceTo(c.lang)}
                  onClick={e => {
                    if ((api.current?.moved() ?? 0) > 6) {
                      e.preventDefault();
                      return;
                    }
                    switchLang(c.lang);
                    api.current?.faceTo(c.lang);
                  }}
                >
                  <span className="code">{c.code}</span>
                  <span className="hi">{c.hi}</span>
                  <span className="nm">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="ring-hint">{t('langs.hint')}</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- path */

export function Path() {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);

  // the line draws itself as the timeline is scrolled through
  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      if (!wrap.current || !line.current) return;
      const r = wrap.current.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.62 - r.top) / r.height));
      line.current.style.transform = `scaleY(${p.toFixed(4)})`;
      wrap.current.style.setProperty('--p', p.toFixed(4));
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

  const items = [
    { year: '2024', t: t('path.1.t'), d: t('path.1.d') },
    { year: '5+', t: t('path.2.t'), d: t('path.2.d') },
    { year: t('path.3.y'), t: t('path.3.t'), d: t('path.3.d') },
    { year: '2026', t: t('path.4.t'), d: t('path.4.d') },
  ];

  return (
    <section className="section path-section" id="path" data-scene="path">
      <div className="wrap">
        <Reveal as="p" className="eyebrow">
          {t('path.eyebrow')}
        </Reveal>
        <SplitReveal html={t('path.title')} className="h2" />
        <div className="path-wrap" ref={wrap}>
          <div className="path-line" ref={line} />
          <ol className="path">
            {items.map((item, i) => (
              <Reveal as="li" key={i} style={{ '--at': (i + 0.5) / items.length } as CSSProperties}>
                <span className="node" />
                <span className="yr">{item.year}</span>
                <div className="path-card">
                  <h3>{item.t}</h3>
                  <p>{item.d}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

