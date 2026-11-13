/**
 * Sandbox payment provider — a built-in stand-in for a real provider.
 *
 * It lets the whole lifecycle be exercised without any account or keys:
 * hosted checkout page, redirect back, signed webhook, server-side
 * verification, idempotency. No money ever moves. It is only active when
 * PAYMENT_PROVIDER=sandbox, and every screen it touches is labelled TEST.
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { ServerEnv } from '../env';
import { safeEqual } from '../ids';
import type { OrderStore } from '../store';
import { WebhookSignatureError, type CreatedSession, type OrderRecord, type PaymentProvider, type SessionState, type WebhookEvent } from '../types';

export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';
const TOLERANCE_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const SESSION_RE = /^sbx_(NW-\d{6}-\d{4,6})_[A-Za-z0-9_-]{16,}$/;

export const sandboxOrderId = (sessionId: string): string | null => SESSION_RE.exec(sessionId)?.[1] ?? null;

export function signSandboxPayload(secret: string, body: string, timestamp = Date.now()): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export function verifySandboxSignature(secret: string, body: string, header: string | null, now = Date.now()): void {
  if (!header) throw new WebhookSignatureError('missing signature header');
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=') as [string, string]));
  const ts = Number(parts.t);
  if (!Number.isFinite(ts) || !parts.v1) throw new WebhookSignatureError('malformed signature header');
  if (Math.abs(now - ts) > TOLERANCE_MS) throw new WebhookSignatureError('signature timestamp outside tolerance');
  const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  if (!safeEqual(expected, parts.v1)) throw new WebhookSignatureError('signature mismatch');
}

export interface SandboxEventPayload {
  id: string;
  type: 'checkout.completed' | 'checkout.pending' | 'checkout.failed' | 'checkout.expired';
  session: { id: string; order_id: string; amount_minor: number; currency: string; reference: string };
}

const OUTCOME: Record<SandboxEventPayload['type'], SessionState['outcome']> = {
  'checkout.completed': 'paid',
  'checkout.pending': 'pending',
  'checkout.failed': 'failed',
  'checkout.expired': 'expired',
};

export class SandboxProvider implements PaymentProvider {
  id = 'sandbox' as const;
  testMode = true;
  private secret: string;

  constructor(
    env: ServerEnv,
    private store: OrderStore,
  ) {
    this.secret = env.sandboxWebhookSecret || '';
  }

  async createSession(order: OrderRecord, ctx: { siteUrl: string; amountMinor: number; attempt: number }): Promise<CreatedSession> {
    const sessionId = `sbx_${order.id}_${randomBytes(18).toString('base64url')}`;
    return {
      sessionId,
      url: `${ctx.siteUrl}/api/sandbox/checkout?s=${encodeURIComponent(sessionId)}`,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
  }

  async fetchSession(sessionId: string): Promise<SessionState | null> {
    const orderId = sandboxOrderId(sessionId);
    if (!orderId) return null;
    const order = await this.store.get(orderId);
    if (!order || !order.payment.sessionIds.includes(sessionId)) return null;
    const current = order.payment.sessionId === sessionId;
    let outcome: SessionState['outcome'] = current ? (order.payment.sandboxState ?? 'open') : 'expired';
    if (outcome === 'open' && order.payment.sessionExpiresAt && Date.parse(order.payment.sessionExpiresAt) < Date.now()) outcome = 'expired';
    return {
      sessionId,
      orderId,
      outcome,
      amountMinor: Math.round(order.pricing.now * 100),
      currency: order.currency,
      reference: `sbx_pay_${sessionId.slice(-10)}`,
    };
  }

  async expireSession(sessionId: string): Promise<void> {
    const orderId = sandboxOrderId(sessionId);
    if (!orderId) return;
    await this.store.update(orderId, o => {
      if (o.payment.sessionId !== sessionId || (o.payment.sandboxState ?? 'open') !== 'open') return null;
      o.payment.sandboxState = 'expired';
      return o;
    });
  }

  /** Builds and signs the webhook the sandbox "sends" for an outcome. */
  buildEvent(type: SandboxEventPayload['type'], order: OrderRecord, sessionId: string, amountMinor?: number): { body: string; signature: string } {
    const payload: SandboxEventPayload = {
      id: `evt_sbx_${randomBytes(12).toString('hex')}`,
      type,
      session: {
        id: sessionId,
        order_id: order.id,
        amount_minor: amountMinor ?? Math.round(order.pricing.now * 100),
        currency: order.currency,
        reference: `sbx_pay_${sessionId.slice(-10)}`,
      },
    };
    const body = JSON.stringify(payload);
    return { body, signature: signSandboxPayload(this.secret, body) };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
    verifySandboxSignature(this.secret, rawBody, headers.get(SANDBOX_SIGNATURE_HEADER));
    let payload: SandboxEventPayload;
    try {
      payload = JSON.parse(rawBody) as SandboxEventPayload;
    } catch {
      throw new WebhookSignatureError('body is not JSON');
    }
    const outcome = OUTCOME[payload.type];
    if (!outcome || !payload.session?.id) return { id: String(payload.id), type: String(payload.type), session: null };
    return {
      id: payload.id,
      type: payload.type,
      session: {
        sessionId: payload.session.id,
        orderId: payload.session.order_id,
        outcome,
        amountMinor: payload.session.amount_minor,
        currency: payload.session.currency,
        reference: payload.session.reference,
      },
    };
  }
}
