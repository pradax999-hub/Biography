/**
 * НАСТРОЙКИ САЙТА / SITE SETTINGS
 *
 * Contacts and the manual payment methods. Prices live in shared/catalog.ts
 * (the server uses the same file), texts live in shared/locales/.
 * Nothing secret belongs here: this file is shipped to the browser.
 */
import type { Lang } from '../../shared/validation';

export interface BankConfig {
  /** recipient, exactly as the bank has it */
  name: string;
  /** Czech account number "prefix-number/bank"; the IBAN is derived from it */
  account: string;
  /** or the IBAN itself, e.g. "CZ65 0800 ..." (then `account` may stay empty) */
  iban: string;
  bic: string;
  /** currency of the account */
  currency: string;
  /** units of `currency` per 1 USD; update from time to time (cnb.cz) */
  rate: number;
  /** round the amount due up to this many units */
  round: number;
  /** 'spd' = Czech QR Platba, 'epc' = SEPA QR for EUR accounts, '' = no QR */
  qr: 'spd' | 'epc' | '';
  demo?: boolean;
}

export interface SiteConfig {
  /** Telegram username without @ */
  telegram: string;
  email: string;
  /**
   * Bank transfer by QR code. The customer scans the code in a banking app:
   * account, amount and order number are filled in automatically.
   * While no account is set this method is hidden. A typo in the account
   * number hides it too: the site checks the number itself.
   * Open the site with #paydemo at the end of the address to preview it.
   */
  bank: BankConfig;
  /**
   * Payment link. {amount} and {order} are substituted.
   * Example for PayPal: 'https://paypal.me/YOUR_NAME/{amount}USD'
   * While empty this method is hidden.
   */
  payLink: string;
  defaultLang: Lang;
}

export const SITE: SiteConfig = {
  telegram: 'nightwntr',
  email: 'pradax999@gmail.com',

  bank: {
    name: 'Tetiana Tymkovych',
    account: '333278000/0300',
    iban: '',
    bic: '',
    currency: 'CZK',
    rate: 21.74, // CZK per $1, Czech National Bank rate on 23.10.2026
    round: 10,
    qr: 'spd',
  },

  payLink: '',

  defaultLang: 'ru',
};

/** Technologies shown on the marquee (carried over from 1.0). */
export const TECH = ['HTML', 'CSS', 'JavaScript', 'Figma', 'UI/UX', 'Frontend'];

export const telegramUrl = (text?: string): string => `https://t.me/${SITE.telegram}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
