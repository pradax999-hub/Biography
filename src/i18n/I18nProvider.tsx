/**
 * Five interface languages. The choice is remembered, otherwise the
 * browser's preferred languages decide, otherwise the site default.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALES, translator, type Locale, type Translate } from '../../shared/locales';
import { LANGS, type Lang } from '../../shared/validation';
import { SITE } from '../config/site';
import { store } from '../lib/store';

interface I18n {
  lang: Lang;
  locale: Locale;
  t: Translate;
  setLang: (lang: Lang) => void;
}

const Ctx = createContext<I18n | null>(null);

function detectLang(): Lang {
  const saved = store.get('nw-lang');
  if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  for (const l of navigator.languages || [navigator.language || '']) {
    const code = String(l).slice(0, 2).toLowerCase();
    if ((LANGS as readonly string[]).includes(code)) return code as Lang;
  }
  return SITE.defaultLang;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const setLang = useCallback((next: Lang) => {
    if (!LOCALES[next]) return;
    store.set('nw-lang', next);
    setLangState(next);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.querySelector('meta[name="description"]')?.setAttribute('content', LOCALES[lang]['meta.desc']);
  }, [lang]);

  const value = useMemo<I18n>(() => ({ lang, locale: LOCALES[lang], t: translator(lang), setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Language names and greetings, in the order they are shown. */
export const LANGUAGE_CARDS: Array<{ lang: Lang; code: string; hi: string; name: string }> = [
  { lang: 'ru', code: 'RU', hi: 'Привет', name: 'Русский' },
  { lang: 'uk', code: 'UA', hi: 'Привіт', name: 'Українська' },
  { lang: 'en', code: 'EN', hi: 'Hello', name: 'English' },
  { lang: 'de', code: 'DE', hi: 'Hallo', name: 'Deutsch' },
  { lang: 'cs', code: 'CZ', hi: 'Ahoj', name: 'Čeština' },
];
