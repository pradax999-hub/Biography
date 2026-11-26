/**
 * Navigation: logo, section links, language switcher and the order button.
 * On small screens the links move into a full-screen menu.
 */
import { useEffect, useRef, useState } from 'react';
import { LANGUAGE_CARDS, useI18n } from '../i18n/I18nProvider';
import { pauseScroll, resumeScroll } from '../lib/motion';
import { Icon } from './Icon';
import { AnchorLink } from './Magnetic';
import { useToast } from './Toast';
import { TELEGRAMS, SITE, telegramUrl } from '../config/site';
import type { Lang } from '../../shared/validation';

const LINKS: Array<{ href: string; key: string }> = [
  { href: '#about', key: 'nav.about' },
  { href: '#skills', key: 'nav.skills' },
  { href: '#archive', key: 'nav.archive' },
  { href: '#services', key: 'nav.services' },
  { href: '#order', key: 'nav.order' },
  { href: '#contact', key: 'nav.contact' },
];

/** Changes the language and says so. Shared by the nav menu and the language cards. */
export function useLanguageSwitch(): (lang: Lang) => void {
  const { lang, setLang } = useI18n();
  const { toast } = useToast();
  const pending = useRef<Lang | null>(null);
  const { t } = useI18n();
  useEffect(() => {
    if (pending.current === lang) {
      pending.current = null;
      toast(t('toast.lang'));
    }
  }, [lang, t, toast]);
  return next => {
    if (next === lang) return;
    pending.current = next;
    setLang(next);
  };
}

export function Nav() {
  const { t, lang, locale } = useI18n();
  const switchLang = useLanguageSwitch();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menu, setMenu] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [active, setActive] = useState('');
  const langRef = useRef<HTMLDivElement>(null);
  const langBtn = useRef<HTMLButtonElement>(null);

  // hide on the way down, return on the way up
  useEffect(() => {
    let last = window.scrollY;
    let frame = 0;
    const onScroll = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        setScrolled(y > 24);
        if (Math.abs(y - last) > 6) {
          setHidden(y > last && y > 240);
          last = y;
        }
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) if (e.isIntersecting) setActive('#' + e.target.id);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    document.querySelectorAll('main section[id]').forEach(s => io.observe(s));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenu(false);
        setLangOpen(false);
      }
    };
    const onClick = (e: MouseEvent): void => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, []);

  // the page behind the full-screen menu does not scroll
  useEffect(() => {
    document.documentElement.classList.toggle('menu-open', menu);
    if (menu) pauseScroll();
    else resumeScroll();
    return () => {
      document.documentElement.classList.remove('menu-open');
      resumeScroll();
    };
  }, [menu]);

  const section = active === '#langs' || active === '#path' ? '#about' : active;

  return (
    <>
      <nav className={`nav ${scrolled ? 'is-scrolled' : ''} ${hidden && !menu && !langOpen ? 'is-hidden' : ''} ${menu ? 'is-open' : ''}`} id="nav" aria-label="Main">
        <AnchorLink className="logo" href="#top" onClick={() => setMenu(false)} aria-label="NIGHTWNTR">
          <Icon name="flake" className="logo-mark" />
          <span>NIGHTWNTR</span>
        </AnchorLink>

        <ul className="nav-links">
          {LINKS.map(l => (
            <li key={l.href}>
              <AnchorLink href={l.href} className={section === l.href ? 'is-active' : ''}>
                {t(l.key)}
              </AnchorLink>
            </li>
          ))}
        </ul>

        <div className="nav-tools">
          <div className={`lang ${langOpen ? 'is-open' : ''}`} ref={langRef}>
            <button
              className="lang-btn"
              type="button"
              ref={langBtn}
              aria-haspopup="true"
              aria-expanded={langOpen}
              aria-controls="langMenu"
              aria-label={t('nav.lang')}
              onClick={() => setLangOpen(v => !v)}
            >
              <Icon name="globe" />
              <span>{locale._code}</span>
            </button>
            <ul className="lang-menu" id="langMenu" role="menu">
              {LANGUAGE_CARDS.map(l => (
                <li role="none" key={l.lang}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={lang === l.lang}
                    onClick={() => {
                      switchLang(l.lang);
                      setLangOpen(false);
                      langBtn.current?.focus();
                    }}
                  >
                    <span>{l.name}</span>
                    <span>{l.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <AnchorLink className="btn btn-primary nav-cta" href="#order" magnetic>
            <span>{t('nav.cta')}</span>
          </AnchorLink>
          <button className="menu-btn" type="button" aria-expanded={menu} aria-controls="menu" aria-label={menu ? t('nav.close') : t('nav.menu')} onClick={() => setMenu(v => !v)}>
            <i />
            <i />
          </button>
        </div>
      </nav>

      <div className={`menu ${menu ? 'is-open' : ''}`} id="menu" aria-hidden={!menu} inert={!menu}>
        <ol className="menu-links">
          {LINKS.map((l, i) => (
            <li key={l.href} style={{ transitionDelay: menu ? `${80 + i * 45}ms` : '0ms' }}>
              <AnchorLink href={l.href} tabIndex={menu ? 0 : -1} onClick={() => setMenu(false)}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <span>{t(l.key)}</span>
              </AnchorLink>
            </li>
          ))}
        </ol>
        <div className="menu-foot">
          {TELEGRAMS.map(user => (
            <a key={user} href={telegramUrl(undefined, user)} target="_blank" rel="noopener" tabIndex={menu ? 0 : -1}>
              @{user}
            </a>
          ))}
          <a href={`mailto:${SITE.email}`} tabIndex={menu ? 0 : -1}>
            {SITE.email}
          </a>
        </div>
      </div>
    </>
  );
}
