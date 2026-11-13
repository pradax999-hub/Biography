/**
 * Server-side Telegram notifications for the site owner.
 *
 * The bot token lives only in the server environment. Messages carry the
 * order summary; they never contain card data (this site never sees any),
 * API keys, or the customer's access token.
 */
import { money } from '../shared/catalog';
import { translator } from '../shared/locales';
import { orderText } from '../shared/orderText';
import type { ServerEnv } from './env';
import type { OrderRecord } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const OWNER_LANG = 'ru' as const;
const MAX_LEN = 3900; // Telegram caps messages at 4096 characters

export const telegramConfigured = (env: ServerEnv): boolean => !!(env.telegramBotToken && env.telegramChatId);

export async function sendTelegram(env: ServerEnv, text: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  if (!telegramConfigured(env)) return false;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.telegramChatId,
        text: text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '…' : text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      // never log the URL: it contains the bot token
      console.error(`[telegram] sendMessage failed with HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[telegram] sendMessage failed:', err instanceof Error ? err.name : 'error');
    return false;
  }
}

const testTag = (order: OrderRecord, t: ReturnType<typeof translator>): string => (order.payment.testMode ? ` [${t('msg.test')}]` : '');

export function newOrderMessage(env: ServerEnv, order: OrderRecord): string {
  const t = translator(OWNER_LANG);
  if (env.telegramDetail === 'minimal') {
    return [
      `❄ ${t('msg.title')} ${order.id}${testTag(order, t)}`,
      `${t('msg.service')}: ${t('svc.' + order.service + '.name')}`,
      `${t('msg.total')}: ${money(order.pricing.total)}`,
      `${t('msg.now')}: ${money(order.pricing.now)}`,
      `${t('msg.method')}: ${t('pm.' + order.pm + '.t')}`,
    ].join('\n');
  }
  const text = orderText(t, { ...order, id: order.id });
  return order.payment.testMode ? text.replace('\n', ` [${t('msg.test')}]\n`) : text;
}

export function paymentMessage(order: OrderRecord, kind: 'paid' | 'pending' | 'failed' | 'review', note?: string): string {
  const t = translator(OWNER_LANG);
  const icon = { paid: '✅', pending: '⏳', failed: '⚠️', review: '🚨' }[kind];
  const amount = order.payment.amountPaid ?? order.pricing.now;
  const lines = [
    `${icon} ${t('ntf.' + kind)}${testTag(order, t)}`,
    `${t('ntf.order')}: ${order.id}`,
    `${t('msg.service')}: ${t('svc.' + order.service + '.name')}`,
    `${t('ntf.amount')}: ${money(amount)} ${order.currency}`,
    `${t('msg.total')}: ${money(order.pricing.total)}`,
  ];
  if (note) lines.push(note);
  return lines.join('\n');
}
