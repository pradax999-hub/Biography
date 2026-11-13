import type { Lang } from '../validation';
import cs from './cs';
import de from './de';
import en from './en';
import ru from './ru';
import uk from './uk';

export type Locale = { _locale: string; _code: string } & Record<string, string>;

export const LOCALES: Record<Lang, Locale> = { ru, uk, en, de, cs };

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** Looks a key up in `lang`, falls back to Russian (the source language), then to the key. */
export function translator(lang: Lang): Translate {
  return (key, vars) => {
    let s = LOCALES[lang]?.[key] ?? LOCALES.ru[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
    return s;
  };
}
