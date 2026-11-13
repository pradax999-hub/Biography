/**
 * Catalog and pricing — the single source of truth for both the browser and
 * the server. The browser uses it to show prices and a live summary; the
 * server recomputes every total from the same numbers and never trusts an
 * amount sent by the browser.
 *
 * Prices are in US dollars. `from: true` means the price is a starting point
 * ("from $200") that is finalised after the task has been discussed.
 */

export type ServiceId = 'website' | 'video' | 'app';
export type AddonId = 'rush' | 'lang' | 'support';
export type PlanId = 'half' | 'full';

export interface Service {
  price: number;
  from: boolean;
}

export type Addon =
  | { type: 'percent'; value: number; only?: ServiceId[] }
  | { type: 'each'; value: number; max: number; only?: ServiceId[] }
  | { type: 'fixed'; value: number; only?: ServiceId[] };

export const SERVICES: Record<ServiceId, Service> = {
  website: { price: 650, from: false },
  video: { price: 200, from: true },
  app: { price: 900, from: true },
};

export const ADDONS: Record<AddonId, Addon> = {
  // +25% of the service price
  rush: { type: 'percent', value: 25 },
  // per extra language, websites and apps only
  lang: { type: 'each', value: 60, max: 4, only: ['website', 'app'] },
  support: { type: 'fixed', value: 50 },
};

export const SERVICE_IDS = Object.keys(SERVICES) as ServiceId[];
export const ADDON_IDS = Object.keys(ADDONS) as AddonId[];
export const PLAN_IDS: PlanId[] = ['half', 'full'];
export const LANG_ADDON_MAX = (ADDONS.lang as { max: number }).max;

/** Currency every price in this file is expressed in. */
export const CURRENCY = 'USD';

export interface AddonSelection {
  rush: boolean;
  lang: number;
  support: boolean;
}

export interface PriceLine {
  id: AddonId;
  qty: number;
  cost: number;
}

export interface Pricing {
  base: number;
  lines: PriceLine[];
  total: number;
  /** Amount due right now: the whole total, or half of it rounded up. */
  now: number;
}

export function addonApplies(id: AddonId, service: ServiceId): boolean {
  const only = ADDONS[id].only;
  return !only || only.includes(service);
}

export function calcPrice(service: ServiceId, addons: AddonSelection, plan: PlanId): Pricing {
  const base = SERVICES[service].price;
  const lines: PriceLine[] = [];
  let total = base;
  for (const id of ADDON_IDS) {
    const ad = ADDONS[id];
    if (!addonApplies(id, service)) continue;
    const qty = ad.type === 'each' ? Math.max(0, Math.min(ad.max, Math.trunc(Number(addons[id]) || 0))) : addons[id] ? 1 : 0;
    if (!qty) continue;
    const cost = ad.type === 'percent' ? Math.round((base * ad.value) / 100) : ad.value * qty;
    total += cost;
    lines.push({ id, qty, cost });
  }
  const now = plan === 'full' ? total : Math.ceil(total / 2);
  return { base, lines, total, now };
}

export const money = (n: number): string => '$' + Math.round(n).toLocaleString('en-US');
