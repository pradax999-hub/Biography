/**
 * Stripe adapter tests. They run offline: requests go to a fake HTTP client
 * and webhook signatures are produced with Stripe's own test helper, so the
 * real verification code runs. A live Stripe account is NOT exercised here.
 */
import Stripe from 'stripe';
import { beforeEach, describe, expect, it } from 'vitest';
import { readEnv } from '../../server/env';
import type { Deps } from '../../server/orders';
import { StripeProvider } from '../../server/payments/stripe';
import { handleApi, resetRateLimit } from '../../server/router';
import { MemoryStore } from '../../server/store';
import type { CreateOrderResponse, PublicOrder } from '../../shared/types';

const WHSEC = 'whsec_test_secret_for_unit_tests';
const ORIGIN = 'https://nightwntr.test';

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  idempotencyKey: string | null;
}

function setup(sessionOverrides: () => Record<string, unknown> = () => ({})) {
  const env = readEnv({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_unit', STRIPE_WEBHOOK_SECRET: WHSEC, ORDER_STORE: 'memory' });
  const calls: Call[] = [];
  let n = 0;
  const sessions = new Map<string, Record<string, unknown>>();

  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const params = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    const headers = new Headers(init?.headers);
    calls.push({ method: init?.method || 'GET', path: url.pathname, params, idempotencyKey: headers.get('idempotency-key') });
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } });

    if (init?.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const id = `cs_test_${++n}`;
      const session = {
        id,
        object: 'checkout.session',
        url: `https://checkout.stripe.com/c/pay/${id}`,
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: params.get('client_reference_id'),
        amount_total: Number(params.get('line_items[0][price_data][unit_amount]')),
        currency: params.get('line_items[0][price_data][currency]'),
        expires_at: Number(params.get('expires_at')),
        metadata: { order_id: params.get('metadata[order_id]') },
        payment_intent: null,
      };
      sessions.set(id, session);
      return reply(session);
    }
    const m = /^\/v1\/checkout\/sessions\/(cs_test_\d+)(\/expire)?$/.exec(url.pathname);
    if (m) {
      const s = sessions.get(m[1]);
      if (!s) return reply({ error: { message: 'No such session', type: 'invalid_request_error' } }, 404);
      if (m[2]) s.status = 'expired';
      return reply({ ...s, ...sessionOverrides() });
    }
    return reply({ error: { message: 'unexpected request', type: 'invalid_request_error' } }, 400);
  };

  const client = new Stripe('sk_test_unit', { httpClient: Stripe.createFetchHttpClient(fakeFetch as typeof fetch), maxNetworkRetries: 0 });
  const store = new MemoryStore();
  const provider = new StripeProvider(env, client);
  const deps: Partial<Deps> = { env, store, provider };
  return { env, store, provider, deps, calls, sessions, client };
}

type World = ReturnType<typeof setup>;

async function api<T = any>(w: World, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const res = await handleApi(
    new Request(ORIGIN + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    w.deps,
  );
  return { status: res.status, data: (await res.json()) as T };
}

const orderInput = {
  service: 'website',
  addons: { rush: false, lang: 1, support: false },
  plan: 'full',
  pm: 'card',
  details: 'A landing page for a coffee shop, dark style',
  ref: '',
  name: 'Alex',
  contact: 'alex@example.com',
  lang: 'de',
};

async function createAndCheckout(w: World) {
  const created = await api<CreateOrderResponse>(w, 'POST', '/api/orders', orderInput);
  expect(created.status).toBe(201);
  const { order, token } = created.data;
  const co = await api<{ url: string }>(w, 'POST', `/api/orders/${order.id}/checkout`, { token });
  expect(co.status).toBe(200);
  const sessionId = [...w.sessions.keys()].at(-1)!;
  return { order, token, url: co.data.url, sessionId };
}

function event(type: string, session: Record<string, unknown>, id = 'evt_1') {
  return JSON.stringify({ id, object: 'event', type, api_version: '2026-10-28', created: Math.floor(Date.now() / 1000), data: { object: session } });
}

const sign = (w: World, payload: string, secret = WHSEC, timestamp?: number) => w.client.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });

const webhook = (w: World, payload: string, signature?: string) => api(w, 'POST', '/api/webhooks/stripe', payload, signature ? { 'stripe-signature': signature } : {});

const getStatus = async (w: World, id: string, token: string) => (await api<{ order: PublicOrder }>(w, 'GET', `/api/orders/${id}`, undefined, { 'x-order-token': token })).data.order;

beforeEach(() => resetRateLimit());

describe('Stripe: creating a Checkout Session', () => {
  it('sends the server-side amount, the reference and return URLs', async () => {
    const w = setup();
    const { order, url } = await createAndCheckout(w);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const call = w.calls.find(c => c.method === 'POST' && c.path === '/v1/checkout/sessions')!;
    const p = call.params;
    expect(p.get('mode')).toBe('payment');
    expect(p.get('client_reference_id')).toBe(order.id);
    // 650 + 60 = 710 dollars, paid in full, in cents
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('71000');
    expect(p.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(p.get('line_items[0][quantity]')).toBe('1');
    expect(p.get('metadata[order_id]')).toBe(order.id);
    expect(p.get('customer_email')).toBe('alex@example.com');
    expect(p.get('locale')).toBe('de');
    expect(p.get('success_url')).toBe(`${ORIGIN}/?order=${order.id}&checkout=success&session_id={CHECKOUT_SESSION_ID}`);
    expect(p.get('cancel_url')).toBe(`${ORIGIN}/?order=${order.id}&checkout=cancelled`);
    expect(call.idempotencyKey).toBe(`nw-checkout-${order.id}-1`);
  });

  it('reports test mode from the key and never returns the key', async () => {
    const w = setup();
    const cfg = await api(w, 'GET', '/api/config');
    expect(cfg.data.payments).toEqual({ provider: 'stripe', mode: 'test', currency: 'USD' });
    expect(JSON.stringify(cfg.data)).not.toContain('sk_test');
    const live = new StripeProvider(readEnv({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }));
    expect(live.testMode).toBe(false);
  });

  it('reuses the open session and expires the old one before opening another', async () => {
    const w = setup();
    const { order, token, sessionId } = await createAndCheckout(w);
    const again = await api<{ url: string }>(w, 'POST', `/api/orders/${order.id}/checkout`, { token });
    expect(again.data.url).toContain(sessionId);
    expect(w.sessions.size).toBe(1);

    // the customer cancels: the session is expired at Stripe and a retry opens a new one
    const cancelled = await api<{ order: PublicOrder }>(w, 'POST', `/api/orders/${order.id}/cancel`, { token });
    expect(cancelled.data.order.status).toBe('cancelled');
    expect(w.calls.some(c => c.path === `/v1/checkout/sessions/${sessionId}/expire`)).toBe(true);
    const retry = await api<{ url: string }>(w, 'POST', `/api/orders/${order.id}/checkout`, { token });
    expect(retry.status).toBe(200);
    expect(w.sessions.size).toBe(2);
    expect(w.calls.filter(c => c.method === 'POST' && c.path === '/v1/checkout/sessions').map(c => c.idempotencyKey)).toEqual([
      `nw-checkout-${order.id}-1`,
      `nw-checkout-${order.id}-2`,
    ]);
  });
});

describe('Stripe: webhooks', () => {
  it('rejects a missing, forged or stale signature', async () => {
    const w = setup();
    const { order, token, sessionId } = await createAndCheckout(w);
    const payload = event('checkout.session.completed', { ...w.sessions.get(sessionId), status: 'complete', payment_status: 'paid', payment_intent: 'pi_1' });
    expect((await webhook(w, payload)).status).toBe(400);
    expect((await webhook(w, payload, sign(w, payload, 'whsec_wrong'))).status).toBe(400);
    expect((await webhook(w, payload, sign(w, payload, WHSEC, Math.floor(Date.now() / 1000) - 3600))).status).toBe(400);
    expect((await webhook(w, payload.replace('71000', '100'), sign(w, payload))).status).toBe(400);
    expect((await getStatus(w, order.id, token)).status).toBe('awaiting_payment');
  });

  it('checkout.session.completed with payment_status=paid marks the order paid', async () => {
    const w = setup();
    const { order, token, sessionId } = await createAndCheckout(w);
    const payload = event('checkout.session.completed', { ...w.sessions.get(sessionId), status: 'complete', payment_status: 'paid', payment_intent: 'pi_1' });
    const r = await webhook(w, payload, sign(w, payload));
    expect(r.status).toBe(200);
    const pub = await getStatus(w, order.id, token);
    expect(pub.status).toBe('paid');
    expect(pub.payment.amountPaid).toBe(710);
    expect((await w.store.get(order.id))!.payment.reference).toBe('pi_1');
  });

  it('refuses a paid event whose amount or currency does not match the order', async () => {
    const w = setup();
    const { order, token, sessionId } = await createAndCheckout(w);
    const wrongAmount = event('checkout.session.completed', { ...w.sessions.get(sessionId), status: 'complete', payment_status: 'paid', amount_total: 100 });
    await webhook(w, wrongAmount, sign(w, wrongAmount));
    expect((await getStatus(w, order.id, token)).status).toBe('failed');

    const w2 = setup();
    const b = await createAndCheckout(w2);
    const wrongCurrency = event('checkout.session.completed', { ...w2.sessions.get(b.sessionId), status: 'complete', payment_status: 'paid', currency: 'czk' });
    await webhook(w2, wrongCurrency, sign(w2, wrongCurrency));
    expect((await getStatus(w2, b.order.id, b.token)).status).toBe('failed');
  });

  it('async payments: completed+unpaid is pending, then succeeds or fails', async () => {
    const w = setup();
    const a = await createAndCheckout(w);
    const base = { ...w.sessions.get(a.sessionId), status: 'complete', payment_intent: 'pi_2' };
    const pending = event('checkout.session.completed', { ...base, payment_status: 'unpaid' }, 'evt_p');
    await webhook(w, pending, sign(w, pending));
    expect((await getStatus(w, a.order.id, a.token)).status).toBe('pending');
    const ok = event('checkout.session.async_payment_succeeded', { ...base, payment_status: 'paid' }, 'evt_ok');
    await webhook(w, ok, sign(w, ok));
    expect((await getStatus(w, a.order.id, a.token)).status).toBe('paid');

    const w2 = setup();
    const b = await createAndCheckout(w2);
    const base2 = { ...w2.sessions.get(b.sessionId), status: 'complete', payment_intent: 'pi_3' };
    const pending2 = event('checkout.session.completed', { ...base2, payment_status: 'unpaid' }, 'evt_p2');
    await webhook(w2, pending2, sign(w2, pending2));
    const failed = event('checkout.session.async_payment_failed', { ...base2, payment_status: 'unpaid' }, 'evt_f2');
    await webhook(w2, failed, sign(w2, failed));
    expect((await getStatus(w2, b.order.id, b.token)).status).toBe('failed');
  });

  it('checkout.session.expired marks an unpaid order expired', async () => {
    const w = setup();
    const { order, sessionId } = await createAndCheckout(w);
    const payload = event('checkout.session.expired', { ...w.sessions.get(sessionId), status: 'expired' });
    await webhook(w, payload, sign(w, payload));
    expect((await w.store.get(order.id))!.status).toBe('expired');
  });

  it('acknowledges unrelated events without touching anything', async () => {
    const w = setup();
    const payload = event('customer.created', { id: 'cus_1', object: 'customer' });
    const r = await webhook(w, payload, sign(w, payload));
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ received: true, handled: false });
  });

  it('redelivery of the same event is applied once', async () => {
    const w = setup();
    const { order, sessionId } = await createAndCheckout(w);
    const payload = event('checkout.session.completed', { ...w.sessions.get(sessionId), status: 'complete', payment_status: 'paid', payment_intent: 'pi_1' }, 'evt_same');
    for (let i = 0; i < 3; i++) expect((await webhook(w, payload, sign(w, payload))).status).toBe(200);
    const stored = (await w.store.get(order.id))!;
    expect(stored.events.filter(e => e.type === 'paid')).toHaveLength(1);
  });
});

describe('Stripe: server-side verification on return', () => {
  it('asks Stripe for the session when the webhook has not arrived yet', async () => {
    let paid = false;
    const w = setup(() => (paid ? { status: 'complete', payment_status: 'paid', payment_intent: 'pi_9' } : {}));
    const { order, sessionId } = await createAndCheckout(w);
    paid = true;
    const r = await api<{ order: PublicOrder }>(w, 'GET', `/api/orders/${order.id}?session_id=${sessionId}`);
    expect(r.status).toBe(200);
    expect(r.data.order.status).toBe('paid');
    expect(w.calls.some(c => c.method === 'GET' && c.path === `/v1/checkout/sessions/${sessionId}`)).toBe(true);
  });

  it('a success URL alone proves nothing: unpaid stays unpaid', async () => {
    const w = setup();
    const { order, sessionId } = await createAndCheckout(w);
    const r = await api<{ order: PublicOrder }>(w, 'GET', `/api/orders/${order.id}?session_id=${sessionId}&checkout=success`);
    expect(r.data.order.status).toBe('awaiting_payment');
  });
});
