/**
 * The plain-text order summary. It is what the customer copies or sends on
 * Telegram, and what the server sends to the owner. Same layout as 1.0.
 */
import { SERVICES, money, type AddonSelection, type PlanId, type PriceLine, type Pricing, type ServiceId } from './catalog';
import type { Translate } from './locales';
import type { PaymentMethod } from './validation';

export interface OrderTextInput {
  id: string | null;
  service: ServiceId;
  addons: AddonSelection;
  plan: PlanId;
  pm: PaymentMethod;
  pricing: Pricing;
  name: string;
  contact: string;
  details: string;
  ref: string;
}

export const priceLabel = (t: Translate, id: ServiceId): string => (SERVICES[id].from ? t('price.from') + ' ' : '') + money(SERVICES[id].price);

export const addonLabel = (t: Translate, line: PriceLine): string => t('sum.' + line.id, { n: line.qty });

export function orderText(t: Translate, o: OrderTextInput): string {
  const c = o.pricing;
  const L = [`❄ ${t('msg.title')} ${o.id || ''}`.trim()];
  L.push(`${t('msg.service')}: ${t('svc.' + o.service + '.name')} (${priceLabel(t, o.service)})`);
  if (c.lines.length) L.push(`${t('msg.extras')}: ${c.lines.map(l => `${addonLabel(t, l)} +${money(l.cost)}`).join(', ')}`);
  L.push(`${t('msg.total')}: ${money(c.total)}`);
  L.push(`${t('msg.now')}: ${money(c.now)} (${t(o.plan === 'full' ? 'sum.full' : 'sum.half')})`);
  L.push(`${t('msg.method')}: ${t('pm.' + o.pm + '.t')}`);
  L.push('');
  L.push(`${t('msg.name')}: ${o.name.trim()}`);
  L.push(`${t('msg.contact')}: ${o.contact.trim()}`);
  L.push(`${t('msg.details')}: ${o.details.trim()}`);
  if (o.ref.trim()) L.push(`${t('msg.ref')}: ${o.ref.trim()}`);
  return L.join('\n');
}
