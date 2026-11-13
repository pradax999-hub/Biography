import type { ServerEnv } from '../env';
import type { OrderStore } from '../store';
import type { PaymentProvider } from '../types';
import { SandboxProvider } from './sandbox';
import { StripeProvider } from './stripe';

let cached: { key: string; provider: PaymentProvider } | null = null;

/** The configured payment provider, or null when online payments are off. */
export function getPaymentProvider(env: ServerEnv, store: OrderStore): PaymentProvider | null {
  if (!env.provider) return null;
  const key = `${env.provider}:${env.stripeSecretKey?.slice(-6) ?? ''}:${env.sandboxWebhookSecret?.slice(-6) ?? ''}:${store.kind}`;
  if (cached && cached.key === key) return cached.provider;
  const provider = env.provider === 'stripe' ? new StripeProvider(env) : new SandboxProvider(env, store);
  cached = { key, provider };
  return provider;
}
