/**
 * Server configuration, read from environment variables on every request so
 * that tests and local development can change it without restarting.
 * Nothing in here is ever sent to the browser.
 */
import type { ProviderId } from '../shared/types';

export interface ServerEnv {
  siteUrl: string | null;
  provider: ProviderId | null;
  currency: string;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  sandboxWebhookSecret: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  telegramDetail: 'full' | 'minimal';
  adminToken: string | null;
  orderStore: 'blobs' | 'file' | 'memory' | null;
  dataDir: string;
}

const clean = (v: string | undefined): string | null => {
  const s = (v ?? '').trim();
  return s ? s : null;
};

export function readEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const rawProvider = (clean(source.PAYMENT_PROVIDER) || '').toLowerCase();
  const stripeSecretKey = clean(source.STRIPE_SECRET_KEY);
  const stripeWebhookSecret = clean(source.STRIPE_WEBHOOK_SECRET);
  const sandboxWebhookSecret = clean(source.SANDBOX_WEBHOOK_SECRET);

  // A provider only counts as configured when everything it needs is present.
  // Online payments stay switched off otherwise; nothing is ever half-enabled.
  let provider: ProviderId | null = null;
  if (rawProvider === 'stripe' && stripeSecretKey && stripeWebhookSecret) provider = 'stripe';
  else if (rawProvider === 'sandbox' && sandboxWebhookSecret) provider = 'sandbox';

  const store = (clean(source.ORDER_STORE) || '').toLowerCase();
  const detail = (clean(source.TELEGRAM_NOTIFY_DETAIL) || 'full').toLowerCase();

  return {
    siteUrl: clean(source.SITE_URL)?.replace(/\/+$/, '') ?? null,
    provider,
    currency: (clean(source.PAYMENT_CURRENCY) || 'usd').toLowerCase(),
    stripeSecretKey,
    stripeWebhookSecret,
    sandboxWebhookSecret,
    telegramBotToken: clean(source.TELEGRAM_BOT_TOKEN),
    telegramChatId: clean(source.TELEGRAM_CHAT_ID),
    telegramDetail: detail === 'minimal' ? 'minimal' : 'full',
    adminToken: clean(source.ADMIN_TOKEN),
    orderStore: store === 'blobs' || store === 'file' || store === 'memory' ? store : null,
    dataDir: clean(source.ORDER_DATA_DIR) || '.data',
  };
}

/** Explains why online payments are off, for /api/health and the logs. */
export function providerProblem(source: Record<string, string | undefined> = process.env): string | null {
  const raw = (clean(source.PAYMENT_PROVIDER) || '').toLowerCase();
  if (!raw) return 'PAYMENT_PROVIDER is not set';
  if (raw === 'stripe') {
    if (!clean(source.STRIPE_SECRET_KEY)) return 'STRIPE_SECRET_KEY is missing';
    if (!clean(source.STRIPE_WEBHOOK_SECRET)) return 'STRIPE_WEBHOOK_SECRET is missing';
    return null;
  }
  if (raw === 'sandbox') {
    if (!clean(source.SANDBOX_WEBHOOK_SECRET)) return 'SANDBOX_WEBHOOK_SECRET is missing';
    return null;
  }
  return `unknown PAYMENT_PROVIDER "${raw}"`;
}
