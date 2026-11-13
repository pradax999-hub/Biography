/** Types shared by the browser and the server API. */
import type { AddonSelection, PlanId, Pricing, ServiceId } from './catalog';
import type { Lang, PaymentMethod } from './validation';

/**
 * created           order stored, nothing paid yet (manual methods stay here until confirmed)
 * awaiting_payment  a hosted checkout session is open
 * pending           the provider accepted the payment but the money has not settled yet
 * paid              the provider (or the owner, for manual transfers) confirmed the money
 * failed            the payment was declined or did not pass verification
 * cancelled         the customer left the checkout page
 * expired           the checkout session timed out
 */
export type OrderStatus = 'created' | 'awaiting_payment' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';

export const ORDER_STATUSES: OrderStatus[] = ['created', 'awaiting_payment', 'pending', 'paid', 'failed', 'cancelled', 'expired'];

export type ProviderId = 'stripe' | 'sandbox';

/** What the browser is allowed to know about an order. */
export interface PublicOrder {
  id: string;
  status: OrderStatus;
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
  currency: string;
  /** true when the owner has already been notified server-side */
  notified: boolean;
  payment: {
    provider: ProviderId | null;
    testMode: boolean;
    paidAt: string | null;
    amountPaid: number | null;
  };
}

export interface PublicConfig {
  payments: {
    provider: ProviderId | null;
    /** 'test' for the sandbox and for Stripe test keys, 'live' for real money */
    mode: 'test' | 'live' | null;
    currency: string;
  };
  /** true when server-side Telegram notifications are configured */
  notifications: boolean;
}

export interface CreateOrderResponse {
  order: PublicOrder;
  /** secret capability that lets this browser read and pay the order */
  token: string;
}

export interface ApiError {
  error: string;
  field?: string;
  message?: string;
}
