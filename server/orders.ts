/**
 * Order lifecycle: creation, checkout, verification, status changes.
 *
 * Rules the rest of the code relies on:
 *  - every amount is computed here from shared/catalog, never taken from the browser
 *  - an order only becomes `paid` when the provider says so (signed webhook or a
 *    direct server-to-provider query) and the amount and currency match
 *  - `paid` is final: later events cannot downgrade it, and a paid order cannot
 *    be sent to checkout again
 */
import { CURRENCY, calcPrice } from '../shared/catalog';
import type { OrderStatus, PublicOrder } from '../shared/types';
import { parseOrderInput } from '../shared/validation';
import type { ServerEnv } from './env';
import { ORDER_ID_RE, hashToken, makeOrderId, makeToken, safeEqual, tokenMatches } from './ids';
import type { OrderStore } from './store';
import { newOrderMessage, paymentMessage, sendTelegram, telegramConfigured, type FetchLike } from './telegram';
import { HttpError, type OrderRecord, type PaymentProvider, type SessionState, type WebhookEvent } from './types';

export interface Deps {
  env: ServerEnv;
  store: OrderStore;
  provider: PaymentProvider | null;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

const MAX_EVENTS = 40;
const MAX_PROCESSED = 60;
const RECONCILE_EVERY_MS = 4000;
const CHECKOUT_LOCK_MS = 20_000;

const nowOf = (deps: Deps): Date => (deps.now ? deps.now() : new Date());
const iso = (d: Date): string => d.toISOString();

export const amountMinor = (order: OrderRecord): number => Math.round(order.pricing.now * 100);

function log(order: OrderRecord, at: Date, type: string, note?: string): void {
  order.events.push(note ? { at: iso(at), type, note } : { at: iso(at), type });
  if (order.events.length > MAX_EVENTS) order.events.splice(0, order.events.length - MAX_EVENTS);
  order.updatedAt = iso(at);
}

export function toPublic(order: OrderRecord): PublicOrder {
  return {
    id: order.id,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    lang: order.lang,
    service: order.service,
    addons: order.addons,
    plan: order.plan,
    pm: order.pm,
    details: order.details,
    ref: order.ref,
    name: order.name,
    contact: order.contact,
    pricing: order.pricing,
    currency: order.currency,
    notified: order.notified.created,
    payment: {
      provider: order.payment.provider,
      testMode: order.payment.testMode,
      paidAt: order.payment.paidAt,
      amountPaid: order.payment.amountPaid,
    },
  };
}

/* ----------------------------------------------------------------- create */

export async function createOrder(deps: Deps, raw: unknown): Promise<{ order: PublicOrder; token: string }> {
  const parsed = parseOrderInput(raw);
  if (!parsed.ok) throw new HttpError(400, parsed.error, undefined, parsed.field);
  const input = parsed.value;

  if (input.pm === 'card' && !deps.provider) throw new HttpError(409, 'card_unavailable');

  const at = nowOf(deps);
  const token = makeToken();
  const base: Omit<OrderRecord, 'id'> = {
    tokenHash: hashToken(token),
    createdAt: iso(at),
    updatedAt: iso(at),
    lang: input.lang,
    service: input.service,
    addons: input.addons,
    plan: input.plan,
    pm: input.pm,
    details: input.details,
    ref: input.ref,
    name: input.name,
    contact: input.contact,
    // the price is always recomputed on the server
    pricing: calcPrice(input.service, input.addons, input.plan),
    currency: CURRENCY,
    status: 'created',
    payment: {
      provider: input.pm === 'card' ? deps.provider!.id : null,
      testMode: input.pm === 'card' ? deps.provider!.testMode : false,
      sessionId: null,
      sessionUrl: null,
      sessionExpiresAt: null,
      sessionIds: [],
      attempts: 0,
      reference: null,
      amountPaid: null,
      paidAt: null,
      lastReconcileAt: null,
      lockUntil: null,
    },
    notified: { created: false, paid: false },
    processedEvents: [],
    events: [{ at: iso(at), type: 'created' }],
  };

  // unique reference: retry on the rare collision, then widen the random part
  let order: OrderRecord | null = null;
  for (let i = 0; i < 8 && !order; i++) {
    const candidate: OrderRecord = { id: makeOrderId(at, i < 5 ? 4 : 6), ...base };
    if (await deps.store.create(candidate)) order = candidate;
  }
  if (!order) throw new HttpError(503, 'order_id_unavailable');

  if (telegramConfigured(deps.env)) {
    const sent = await sendTelegram(deps.env, newOrderMessage(deps.env, order), deps.fetchImpl);
    if (sent) {
      order =
        (await deps.store.update(order.id, o => {
          o.notified.created = true;
          return o;
        })) ?? order;
    }
  }
  return { order: toPublic(order), token };
}

/* ------------------------------------------------------------------- read */

export interface OrderAuth {
  token?: string | null;
  sessionId?: string | null;
}

function authorize(order: OrderRecord, auth: OrderAuth): boolean {
  if (tokenMatches(auth.token, order.tokenHash)) return true;
  const sid = auth.sessionId;
  // a checkout session id is an unguessable secret only the payer's browser received
  return !!sid && sid.length <= 200 && order.payment.sessionIds.some(s => safeEqual(s, sid));
}

async function loadAuthorized(deps: Deps, id: string, auth: OrderAuth): Promise<OrderRecord> {
  if (!ORDER_ID_RE.test(id)) throw new HttpError(404, 'order_not_found');
  const order = await deps.store.get(id);
  // same answer for "missing" and "not yours", so ids cannot be probed
  if (!order || !authorize(order, auth)) throw new HttpError(404, 'order_not_found');
  return order;
}

export async function getOrder(deps: Deps, id: string, auth: OrderAuth): Promise<PublicOrder> {
  let order = await loadAuthorized(deps, id, auth);
  order = await reconcile(deps, order);
  return toPublic(order);
}

/* ----------------------------------------------------- provider → order */

type Effect = { kind: 'paid' | 'pending' | 'failed' | 'review'; note?: string };

/**
 * Applies what the provider says about a session to an order.
 * Pure: returns the next order (or null for "no change") and the side effects to run.
 */
export function transition(order: OrderRecord, state: SessionState, at: Date): { next: OrderRecord | null; effects: Effect[] } {
  const effects: Effect[] = [];
  if (!order.payment.sessionIds.includes(state.sessionId)) return { next: null, effects };
  const isCurrent = order.payment.sessionId === state.sessionId;
  const o = order;

  switch (state.outcome) {
    case 'paid': {
      if (o.status === 'paid') {
        // a second, different session got paid: that is a duplicate payment to refund
        if (o.payment.reference && state.reference && o.payment.reference !== state.reference) {
          log(o, at, 'duplicate_payment', state.sessionId);
          effects.push({ kind: 'review', note: `duplicate payment, session ${state.sessionId}` });
          return { next: o, effects };
        }
        return { next: null, effects };
      }
      const expected = amountMinor(o);
      if (state.amountMinor !== expected || (state.currency || '').toUpperCase() !== o.currency) {
        o.status = 'failed';
        log(o, at, 'amount_mismatch', `expected ${expected} ${o.currency}, got ${state.amountMinor} ${state.currency}`);
        effects.push({ kind: 'review', note: `amount mismatch: expected ${expected / 100} ${o.currency}, provider reported ${(state.amountMinor ?? 0) / 100} ${state.currency}` });
        return { next: o, effects };
      }
      o.status = 'paid';
      o.payment.sessionId = state.sessionId;
      o.payment.reference = state.reference;
      o.payment.amountPaid = expected / 100;
      o.payment.paidAt = iso(at);
      o.notified.paid = true;
      log(o, at, 'paid', state.sessionId);
      effects.push({ kind: 'paid' });
      return { next: o, effects };
    }
    case 'pending': {
      if (o.status === 'paid' || o.status === 'pending' || !isCurrent) return { next: null, effects };
      o.status = 'pending';
      log(o, at, 'pending', state.sessionId);
      effects.push({ kind: 'pending' });
      return { next: o, effects };
    }
    case 'failed': {
      if (o.status === 'paid' || o.status === 'failed' || !isCurrent) return { next: null, effects };
      o.status = 'failed';
      log(o, at, 'failed', state.sessionId);
      effects.push({ kind: 'failed' });
      return { next: o, effects };
    }
    case 'expired': {
      if (!isCurrent || (o.status !== 'awaiting_payment' && o.status !== 'created')) return { next: null, effects };
      o.status = 'expired';
      log(o, at, 'expired', state.sessionId);
      return { next: o, effects };
    }
    default:
      return { next: null, effects };
  }
}

async function runEffects(deps: Deps, order: OrderRecord, effects: Effect[]): Promise<void> {
  for (const e of effects) {
    await sendTelegram(deps.env, paymentMessage(order, e.kind, e.note), deps.fetchImpl);
  }
}

async function applySession(deps: Deps, orderId: string, state: SessionState, eventId?: string): Promise<OrderRecord | null> {
  let effects: Effect[] = [];
  const at = nowOf(deps);
  const stored = await deps.store.update(orderId, o => {
    effects = [];
    if (eventId && o.processedEvents.includes(eventId)) return null;
    const res = transition(o, state, at);
    effects = res.effects;
    const next = res.next ?? (eventId ? o : null);
    if (next && eventId) {
      next.processedEvents.push(eventId);
      if (next.processedEvents.length > MAX_PROCESSED) next.processedEvents.splice(0, next.processedEvents.length - MAX_PROCESSED);
    }
    return next;
  });
  if (stored && effects.length) await runEffects(deps, stored, effects);
  return stored;
}

/** Asks the provider directly when an order is still waiting for its payment. */
async function reconcile(deps: Deps, order: OrderRecord, force = false): Promise<OrderRecord> {
  const p = deps.provider;
  if (!p || order.payment.provider !== p.id || !order.payment.sessionId) return order;
  if (order.status !== 'awaiting_payment' && order.status !== 'pending') return order;
  const at = nowOf(deps);
  const last = order.payment.lastReconcileAt ? Date.parse(order.payment.lastReconcileAt) : 0;
  if (!force && at.getTime() - last < RECONCILE_EVERY_MS) return order;

  const state = await p.fetchSession(order.payment.sessionId);
  await deps.store.update(order.id, o => {
    o.payment.lastReconcileAt = iso(at);
    return o;
  });
  if (!state) return order;
  return (await applySession(deps, order.id, state)) ?? order;
}

/* --------------------------------------------------------------- checkout */

export async function startCheckout(deps: Deps, id: string, token: string | null, siteUrl: string): Promise<{ url: string }> {
  const provider = deps.provider;
  if (!provider) throw new HttpError(409, 'card_unavailable');
  let order = await loadAuthorized(deps, id, { token });
  if (order.pm !== 'card') throw new HttpError(409, 'not_a_card_order');

  // make sure we act on what the provider knows, not on a stale status
  order = await reconcile(deps, order, true);
  if (order.status === 'paid') throw new HttpError(409, 'already_paid');
  if (order.status === 'pending') throw new HttpError(409, 'payment_pending');

  const at = nowOf(deps);
  const open =
    order.status === 'awaiting_payment' &&
    order.payment.sessionUrl &&
    order.payment.sessionExpiresAt &&
    Date.parse(order.payment.sessionExpiresAt) - at.getTime() > 60_000;
  // an open session is reused: one order never has two payable sessions
  if (open) return { url: order.payment.sessionUrl! };

  // take a short lock so two tabs cannot open two sessions at once
  let attempt = 0;
  let locked = false;
  const withLock = await deps.store.update(id, o => {
    locked = false;
    const held = !!o.payment.lockUntil && Date.parse(o.payment.lockUntil) > at.getTime();
    if (held || o.status === 'paid' || o.status === 'pending') return null;
    o.payment.attempts += 1;
    o.payment.lockUntil = iso(new Date(at.getTime() + CHECKOUT_LOCK_MS));
    attempt = o.payment.attempts;
    locked = true;
    log(o, at, 'checkout_started', `attempt ${attempt}`);
    return o;
  });
  if (!withLock) throw new HttpError(404, 'order_not_found');
  if (!locked) {
    if (withLock.status === 'paid') throw new HttpError(409, 'already_paid');
    if (withLock.status === 'pending') throw new HttpError(409, 'payment_pending');
    throw new HttpError(409, 'checkout_in_progress');
  }

  const previous = withLock.payment.sessionId;
  try {
    if (previous) await provider.expireSession(previous);
    const session = await provider.createSession(withLock, { siteUrl, amountMinor: amountMinor(withLock), attempt });
    await deps.store.update(id, o => {
      o.status = 'awaiting_payment';
      o.payment.provider = provider.id;
      o.payment.testMode = provider.testMode;
      o.payment.sessionId = session.sessionId;
      o.payment.sessionUrl = session.url;
      o.payment.sessionExpiresAt = session.expiresAt;
      o.payment.sessionIds.push(session.sessionId);
      o.payment.lockUntil = null;
      if (provider.id === 'sandbox') o.payment.sandboxState = 'open';
      log(o, nowOf(deps), 'checkout_ready', session.sessionId);
      return o;
    });
    return { url: session.url };
  } catch (err) {
    await deps.store.update(id, o => {
      o.payment.lockUntil = null;
      log(o, nowOf(deps), 'checkout_error', err instanceof Error ? err.message.slice(0, 200) : 'error');
      return o;
    });
    console.error('[checkout] could not create a session:', err instanceof Error ? err.message : err);
    throw new HttpError(502, 'provider_error');
  }
}

export async function cancelCheckout(deps: Deps, id: string, token: string | null): Promise<PublicOrder> {
  let order = await loadAuthorized(deps, id, { token });
  // the customer may have paid in another tab: check before cancelling anything
  order = await reconcile(deps, order, true);
  if (order.status !== 'awaiting_payment') return toPublic(order);
  const sessionId = order.payment.sessionId;
  if (deps.provider && sessionId) await deps.provider.expireSession(sessionId);
  const at = nowOf(deps);
  const next = await deps.store.update(id, o => {
    if (o.status !== 'awaiting_payment' || o.payment.sessionId !== sessionId) return null;
    o.status = 'cancelled';
    o.payment.sessionUrl = null;
    log(o, at, 'cancelled', sessionId ?? undefined);
    return o;
  });
  return toPublic(next ?? order);
}

/* ---------------------------------------------------------------- webhook */

export async function handleWebhook(deps: Deps, rawBody: string, headers: Headers): Promise<{ handled: boolean; event: WebhookEvent }> {
  if (!deps.provider) throw new HttpError(404, 'provider_not_configured');
  // throws WebhookSignatureError when the signature does not verify
  const event = await deps.provider.parseWebhook(rawBody, headers);
  const state = event.session;
  if (!state || !state.orderId || !ORDER_ID_RE.test(state.orderId)) return { handled: false, event };
  const existing = await deps.store.get(state.orderId);
  if (!existing) return { handled: false, event };
  await applySession(deps, state.orderId, state, event.id);
  return { handled: true, event };
}

/* ------------------------------------------------------------------ admin */

const ADMIN_SETTABLE: OrderStatus[] = ['created', 'paid', 'cancelled', 'failed'];

export async function adminList(deps: Deps, limit = 100): Promise<Array<PublicOrder & { events: OrderRecord['events']; reference: string | null }>> {
  const orders = await deps.store.list(limit);
  return orders.map(o => ({ ...toPublic(o), events: o.events, reference: o.payment.reference }));
}

/** Manual confirmation, e.g. after a bank transfer arrived. */
export async function adminSetStatus(deps: Deps, id: string, status: unknown, note?: unknown): Promise<PublicOrder> {
  if (!ORDER_ID_RE.test(id)) throw new HttpError(404, 'order_not_found');
  if (typeof status !== 'string' || !ADMIN_SETTABLE.includes(status as OrderStatus)) throw new HttpError(400, 'invalid_status');
  const at = nowOf(deps);
  const next = await deps.store.update(id, o => {
    o.status = status as OrderStatus;
    if (status === 'paid') {
      o.payment.paidAt = o.payment.paidAt ?? iso(at);
      o.payment.amountPaid = o.payment.amountPaid ?? o.pricing.now;
    }
    log(o, at, 'admin_status', `${status}${typeof note === 'string' && note ? ': ' + note.slice(0, 200) : ''}`);
    return o;
  });
  if (!next) throw new HttpError(404, 'order_not_found');
  return toPublic(next);
}
