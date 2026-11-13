/**
 * Order form rules. The browser runs them for instant feedback and the server
 * runs the same functions again before an order is stored.
 */
import { LANG_ADDON_MAX, PLAN_IDS, SERVICE_IDS, type AddonSelection, type PlanId, type ServiceId } from './catalog';

export const RE_TELEGRAM = /^@?[a-zA-Z0-9_]{5,32}$/;
export const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const LIMITS = {
  detailsMin: 10,
  detailsMax: 4000,
  refMax: 500,
  nameMin: 2,
  nameMax: 80,
  contactMax: 120,
} as const;

export type PaymentMethod = 'card' | 'qr' | 'link' | 'chat';
export const PAYMENT_METHODS: PaymentMethod[] = ['card', 'qr', 'link', 'chat'];

export const LANGS = ['ru', 'uk', 'en', 'de', 'cs'] as const;
export type Lang = (typeof LANGS)[number];

export interface OrderInput {
  service: ServiceId;
  addons: AddonSelection;
  plan: PlanId;
  pm: PaymentMethod;
  details: string;
  ref: string;
  name: string;
  contact: string;
  lang: Lang;
}

export type FieldError = 'details' | 'name' | 'contact';

export const detailsOk = (s: string): boolean => s.trim().length >= LIMITS.detailsMin;
export const nameOk = (s: string): boolean => s.trim().length >= LIMITS.nameMin;
export const contactOk = (s: string): boolean => {
  const c = s.trim();
  return RE_TELEGRAM.test(c) || RE_EMAIL.test(c);
};
export const isEmail = (s: string): boolean => RE_EMAIL.test(s.trim());

export type ParseResult = { ok: true; value: OrderInput } | { ok: false; error: string; field?: FieldError };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Strict parsing of an untrusted payload into a clean OrderInput. */
export function parseOrderInput(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_body' };
  const r = raw as Record<string, unknown>;

  const service = str(r.service) as ServiceId;
  if (!SERVICE_IDS.includes(service)) return { ok: false, error: 'invalid_service' };

  const plan = str(r.plan) as PlanId;
  if (!PLAN_IDS.includes(plan)) return { ok: false, error: 'invalid_plan' };

  const pm = str(r.pm) as PaymentMethod;
  if (!PAYMENT_METHODS.includes(pm)) return { ok: false, error: 'invalid_payment_method' };

  const a = (r.addons && typeof r.addons === 'object' ? r.addons : {}) as Record<string, unknown>;
  const langCount = Math.trunc(Number(a.lang) || 0);
  if (langCount < 0 || langCount > LANG_ADDON_MAX) return { ok: false, error: 'invalid_addons' };
  const addons: AddonSelection = { rush: a.rush === true, lang: langCount, support: a.support === true };

  const details = str(r.details).trim();
  if (!detailsOk(details)) return { ok: false, error: 'invalid_details', field: 'details' };
  if (details.length > LIMITS.detailsMax) return { ok: false, error: 'details_too_long', field: 'details' };

  const ref = str(r.ref).trim();
  if (ref.length > LIMITS.refMax) return { ok: false, error: 'ref_too_long' };

  const name = str(r.name).trim();
  if (!nameOk(name) || name.length > LIMITS.nameMax) return { ok: false, error: 'invalid_name', field: 'name' };

  const contact = str(r.contact).trim();
  if (!contactOk(contact) || contact.length > LIMITS.contactMax) return { ok: false, error: 'invalid_contact', field: 'contact' };

  const lang = (LANGS as readonly string[]).includes(str(r.lang)) ? (str(r.lang) as Lang) : 'ru';

  return { ok: true, value: { service, addons, plan, pm, details, ref, name, contact, lang } };
}
