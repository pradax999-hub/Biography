/**
 * Own payment: bank transfer by QR code. Carried over from nightwntr 1.0.
 *
 * The customer scans the code in a banking app and the account, the amount
 * and the order number are filled in. This site only draws the code: it
 * cannot see whether the transfer was made, so the owner confirms it by hand.
 */
import qrcode from 'qrcode-generator';
import type { BankConfig } from '../config/site';

// bank code 0000 and IBAN check digits 00 do not exist: every banking app
// rejects them, so the demo can never take money
export const DEMO_BANK: BankConfig = {
  name: 'DEMO NIGHTWNTR',
  account: '0000000000/0000',
  iban: 'CZ00 0000 0000 0000 0000 0000',
  bic: '',
  currency: 'CZK',
  rate: 21.74,
  round: 10,
  qr: 'spd',
  demo: true,
};

// Czech account checksum: the weighted digit sum must divide by 11
const czMod11 = (digits: string, weights: number[]): boolean => [...digits].reduce((s, d, i) => s + Number(d) * weights[i], 0) % 11 === 0;

export function ibanValid(iban: string): boolean {
  let rem = 0;
  for (const ch of iban.slice(4) + iban.slice(0, 4)) {
    for (const d of /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/** '19-2000145399/0800' → 'CZ6508000000192000145399' */
export function czAccountToIban(account: string): string {
  const m = String(account)
    .replace(/\s+/g, '')
    .match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!m) return '';
  const prefix = (m[1] || '').padStart(6, '0');
  const number = m[2].padStart(10, '0');
  if (!czMod11(prefix, [10, 5, 8, 4, 2, 1]) || !czMod11(number, [6, 3, 7, 9, 10, 5, 8, 4, 2, 1])) return '';
  const bban = m[3] + prefix + number;
  let rem = 0;
  for (const d of bban + '123500') rem = (rem * 10 + Number(d)) % 97; // "CZ00" as digits
  return 'CZ' + String(98 - rem).padStart(2, '0') + bban;
}

export interface ReadyBank extends BankConfig {
  /** formatted in groups of four */
  iban: string;
}

/** The configured account if it is usable, null if it is empty, 'error' if it has a typo. */
export function readBank(b: BankConfig | undefined): ReadyBank | null | 'error' {
  if (!b || (!b.iban && !b.account)) return null;
  const iban = String(b.iban || '').replace(/\s+/g, '').toUpperCase() || czAccountToIban(b.account);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban) || !ibanValid(iban) || !String(b.name || '').trim()) return 'error';
  return { ...b, name: String(b.name).trim(), account: String(b.account || '').replace(/\s+/g, ''), iban: iban.replace(/(.{4})/g, '$1 ').trim() };
}

const ascii = (s: string): string =>
  String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\*/g, '')
    .trim();

/** Digits of the order id: the variable symbol of a Czech transfer. */
export const variableSymbol = (orderId: string): string => orderId.replace(/\D/g, '').slice(-10);

export const paymentNote = (orderId: string, telegram: string): string => `${orderId} ${telegram}`;

export interface BankAmount {
  cur: string;
  value: number;
}

export function bankAmount(bank: BankConfig, usd: number): BankAmount {
  const cur = (bank.currency || 'USD').toUpperCase();
  if (cur === 'USD') return { cur, value: usd };
  const step = Math.max(1, Number(bank.round) || 1);
  return { cur, value: Math.ceil((usd * (Number(bank.rate) || 1)) / step) * step };
}

/** SPD = Czech "QR Platba", EPC = SEPA credit transfer QR (EUR only). */
export function qrPayload(bank: ReadyBank | BankConfig, amount: BankAmount, orderId: string, telegram: string): string | null {
  const iban = bank.iban.replace(/\s+/g, '').toUpperCase();
  const bic = (bank.bic || '').replace(/\s+/g, '').toUpperCase();
  const note = paymentNote(orderId, telegram);
  if (bank.qr === 'spd') {
    return [
      'SPD',
      '1.0',
      'ACC:' + iban + (bic ? '+' + bic : ''),
      'AM:' + amount.value.toFixed(2),
      'CC:' + amount.cur,
      'X-VS:' + variableSymbol(orderId),
      'MSG:' + ascii(note).slice(0, 60),
      'RN:' + ascii(bank.name).slice(0, 35),
    ].join('*');
  }
  if (bank.qr === 'epc' && amount.cur === 'EUR') {
    return ['BCD', '002', '1', 'SCT', bic, bank.name.slice(0, 70), iban, 'EUR' + amount.value.toFixed(2), '', '', note.slice(0, 140)].join('\n');
  }
  return null;
}

/** SVG path data for a QR code, or null if it cannot be drawn. */
export function qrPath(text: string): { size: number; d: string } | null {
  try {
    if (qrcode.stringToBytesFuncs?.['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const quiet = 4;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    return { size: n + quiet * 2, d };
  } catch {
    return null;
  }
}

export function formatCurrency(value: number, cur: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${value} ${cur}`;
  }
}
