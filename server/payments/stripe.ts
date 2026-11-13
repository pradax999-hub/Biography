/**
 * Stripe Checkout (hosted payment page).
 *
 * Card details are entered on Stripe's own domain and never touch this site.
 * The secret key and the webhook signing secret stay on the server.
 */
import Stripe from 'stripe';
import { translator } from '../../shared/locales';
import { isEmail } from '../../shared/validation';
import type { ServerEnv } from '../env';
import { WebhookSignatureError, type CreatedSession, type OrderRecord, type PaymentProvider, type SessionState, type WebhookEvent } from '../types';

/** Checkout page languages Stripe supports among the site's five. Ukrainian falls back to auto-detect. */
const STRIPE_LOCALE: Record<string, Stripe.Checkout.SessionCreateParams.Locale> = { ru: 'ru', en: 'en', de: 'de', cs: 'cs', uk: 'auto' };

const SESSION_TTL_MS = 60 * 60 * 1000;

export function sessionToState(session: Stripe.Checkout.Session, forced?: SessionState['outcome']): SessionState {
  let outcome: SessionState['outcome'] = 'open';
  if (forced) outcome = forced;
  else if (session.status === 'expired') outcome = 'expired';
  else if (session.status === 'complete') outcome = session.payment_status === 'unpaid' ? 'pending' : 'paid';
  const pi = session.payment_intent;
  return {
    sessionId: session.id,
    orderId: session.client_reference_id || session.metadata?.order_id || null,
    outcome,
    amountMinor: session.amount_total ?? null,
    currency: session.currency ? session.currency.toUpperCase() : null,
    reference: typeof pi === 'string' ? pi : pi?.id ?? null,
  };
}

export class StripeProvider implements PaymentProvider {
  id = 'stripe' as const;
  testMode: boolean;
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(env: ServerEnv, client?: Stripe) {
    const key = env.stripeSecretKey || '';
    this.testMode = !/^(sk|rk)_live_/.test(key);
    this.webhookSecret = env.stripeWebhookSecret || '';
    this.stripe =
      client ??
      new Stripe(key, {
        maxNetworkRetries: 2,
        timeout: 12_000,
        appInfo: { name: 'nightwntr', version: '2.0.0' },
      });
  }

  async createSession(order: OrderRecord, ctx: { siteUrl: string; amountMinor: number; attempt: number }): Promise<CreatedSession> {
    const t = translator(order.lang);
    const back = `${ctx.siteUrl}/?order=${encodeURIComponent(order.id)}`;
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        client_reference_id: order.id,
        locale: STRIPE_LOCALE[order.lang] ?? 'auto',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: order.currency.toLowerCase(),
              unit_amount: ctx.amountMinor,
              product_data: {
                name: `NIGHTWNTR · ${t('svc.' + order.service + '.name')} · ${order.id}`,
                description: t(order.plan === 'full' ? 'sum.full' : 'sum.half'),
              },
            },
          },
        ],
        metadata: { order_id: order.id, plan: order.plan },
        payment_intent_data: { description: `NIGHTWNTR ${order.id}`, metadata: { order_id: order.id } },
        ...(isEmail(order.contact) ? { customer_email: order.contact.trim() } : {}),
        success_url: `${back}&checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${back}&checkout=cancelled`,
        expires_at: Math.floor((Date.now() + SESSION_TTL_MS) / 1000),
      },
      // one key per attempt: a network retry can never open a second session
      { idempotencyKey: `nw-checkout-${order.id}-${ctx.attempt}` },
    );
    if (!session.url) throw new Error('Stripe returned a session without a URL');
    return {
      sessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    };
  }

  async fetchSession(sessionId: string): Promise<SessionState | null> {
    try {
      return sessionToState(await this.stripe.checkout.sessions.retrieve(sessionId));
    } catch (err) {
      console.error('[stripe] could not retrieve session:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async expireSession(sessionId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch {
      // already completed or expired: nothing to do
    }
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
    const signature = headers.get('stripe-signature');
    if (!signature) throw new WebhookSignatureError('missing stripe-signature header');
    let event: Stripe.Event;
    try {
      event = await this.stripe.webhooks.constructEventAsync(rawBody, signature, this.webhookSecret);
    } catch (err) {
      throw new WebhookSignatureError(err instanceof Error ? err.message : 'signature verification failed');
    }
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return { id: event.id, type: event.type, session: sessionToState(event.data.object) };
      case 'checkout.session.async_payment_failed':
        return { id: event.id, type: event.type, session: sessionToState(event.data.object, 'failed') };
      case 'checkout.session.expired':
        return { id: event.id, type: event.type, session: sessionToState(event.data.object, 'expired') };
      default:
        return { id: event.id, type: event.type, session: null };
    }
  }
}
