/**
 * 06 — THE CONNECTION
 * The closing statement, Telegram and email, and the footer.
 */
import { useEffect, useRef } from 'react';
import { Chapter } from '../components/Chapter';
import { Icon } from '../components/Icon';
import { AnchorLink } from '../components/Magnetic';
import { Reveal, SplitReveal } from '../components/Text';
import { useToast } from '../components/Toast';
import { SITE, TELEGRAMS, telegramUrl } from '../config/site';
import { useI18n } from '../i18n/I18nProvider';
import { emit } from '../lib/bus';
import { gsap, reducedMotion } from '../lib/motion';

export function Connection() {
  const { t } = useI18n();
  const { copy } = useToast();
  const root = useRef<HTMLElement>(null);
  const mailRef = useRef<HTMLSpanElement>(null);
  const [user, host] = SITE.email.split('@');

  // closing gesture: the statement settles into place and the ring answers with a pulse
  useEffect(() => {
    if (reducedMotion || !root.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.mega', { letterSpacing: '0.06em' }, { letterSpacing: '-0.02em', ease: 'none', scrollTrigger: { trigger: '.mega', start: 'top 95%', end: 'top 35%', scrub: 0.6 } });
      gsap.fromTo('.closing-ring', { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top 60%', end: 'bottom bottom', scrub: 0.8 } });
    }, root);
    let fired = false;
    const io = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !fired) {
          fired = true;
          emit('burst', 0.7);
        }
        if (!entries[0].isIntersecting) fired = false;
      },
      { threshold: 0.55 },
    );
    io.observe(root.current);
    return () => {
      ctx.revert();
      io.disconnect();
    };
  }, []);

  return (
    <section className="section connection" id="contact" data-scene="connection" ref={root}>
      <i className="closing-ring" aria-hidden="true" />
      <div className="wrap">
        <Chapter index="06" name="The Connection" label={t('contact.eyebrow')} />
        <SplitReveal html={t('contact.big')} className="mega" stagger={60} />
        <Reveal as="p" className="sub">
          {t('contact.sub')}
        </Reveal>

        <div className="links">
          {TELEGRAMS.map((user, i) => (
            <Reveal key={user} delay={i}>
              <a className="link-row" href={telegramUrl(undefined, user)} target="_blank" rel="noopener" data-cursor={t('cur.open')}>
                <span className="lbl">
                  <Icon name="send" />
                  Telegram
                </span>
                <span className="val">@{user}</span>
                <span className="go">
                  <Icon name="upright" />
                </span>
              </a>
            </Reveal>
          ))}
          <Reveal delay={TELEGRAMS.length}>
            <div className="link-row">
              <span className="lbl">
                <Icon name="mail" />
                {t('contact.mail')}
              </span>
              <span className="val mail-addr" ref={mailRef}>
                {user}
                <wbr />@{host}
              </span>
              <span className="row">
                <button type="button" className="btn btn-ghost btn-sm" aria-label={t('btn.copyMail')} data-cursor={t('cur.copy')} onClick={() => void copy(SITE.email, t('toast.copied'), mailRef.current)}>
                  <Icon name="copy" />
                  <span>{t('btn.copy')}</span>
                </button>
                <a className="btn btn-ghost btn-sm" href={`mailto:${SITE.email}`}>
                  <span>{t('contact.write')}</span>
                  <Icon name="arrow" className="arrow" />
                </a>
              </span>
            </div>
          </Reveal>
        </div>
      </div>

      <footer className="site-footer">
        <div className="wrap foot">
          <span>
            © 2026 nightwntr aka {SITE.aka} · {t('foot.made')}
          </span>
          <span className="foot-built">{t('foot.built')}</span>
          <AnchorLink href="#top">
            <span>{t('foot.top')}</span>
            <Icon name="up" />
          </AnchorLink>
        </div>
      </footer>
    </section>
  );
}
