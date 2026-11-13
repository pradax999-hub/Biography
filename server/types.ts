import type { AddonSelection, PlanId, Pricing, ServiceId } from '../shared/catalog';
import type { OrderStatus, ProviderId } from '../shared/types';
import type { Lang, PaymentMethod } from '../shared/validation';

export interface OrderEvent {
  at: string;
  type: string;
  note?: string;
}

export interface OrderPayment {
  provider: ProviderId | null;
  testMode: boolean;
  /** current hosted checkout session */
  sessionId: string | null;
  sessionUrl: string | null;
  sessionExpiresAt: string | null;
  /** every session ever opened for this order, newest last */
  sessionIds: string[];
  attempts: number;
  /** provider payment reference (Stripe PaymentIntent id) */
  reference: string | null;
  /** amount confirmed by the provider, in major units of `currency` */
  amountPaid: number | null;
  paidAt: string | null;
  lastReconcileAt: string | null;
  /** short lock while a checkout session is being created */
  lockUntil: string | null;
  /** sandbox only: the simulated state of the current session */
  sandboxState?: 'open' | 'paid' | 'pending' | 'failed' | 'expired';
}

/** The full order as it is stored. Never sent to the browser as is. */
export interface OrderRecord {
  id: string;
  /** sha-256 of the capability token handed to the customer's browser */
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  lang: Lang;
  service: ServiceId;
  addons: AddonSelection;
  plan: PlanId;
  pm: PaymentMethod;
  details: string;
  ref: string;
  name: string;
  contact: string;
  pricing: Pricing;
  /** ISO currency code, upper case */
  currency: string;
  status: OrderStatus;
  payment: OrderPayment;
  notified: { created: boolean; paid: boolean };
  /** ids of webhook events already applied, to make processing idempotent */
  processedEvents: string[];
  events: OrderEvent[];
}

/** Provider-neutral view of a hosted checkout session. */
export interface SessionState {
  sessionId: string;
  orderId: string | null;
  outcome: 'open' | 'paid' | 'pending' | 'failed' | 'expired';
  /** total of the session in minor units (cents) */
  amountMinor: number | null;
  currency: string | null;
  reference: string | null;
}

export interface WebhookEvent {
  id: string;
  type: string;
  /** null when the event is not about a checkout session we care about */
  session: SessionState | null;
}

export interface CreatedSession {
  sessionId: string;
  url: string;
  expiresAt: string | null;
}

export interface PaymentProvider {
  id: ProviderId;
  testMode: boolean;
  createSession(order: OrderRecord, ctx: { siteUrl: string; amountMinor: number; attempt: number }): Promise<CreatedSession>;
  /** Ask the provider for the authoritative state of a session. */
  fetchSession(sessionId: string): Promise<SessionState | null>;
  expireSession(sessionId: string): Promise<void>;
  /** Verify the signature of a webhook and normalise it. Throws WebhookSignatureError. */
  parseWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>;
}

export class WebhookSignatureError extends Error {
  constructor(message = 'invalid webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export class HttpError extends Error {
  status: number;
  code: string;
  field?: string;
  constructor(status: number, code: string, message?: string, field?: string) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}
