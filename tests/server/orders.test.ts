import { beforeEach, describe, expect, it } from 'vitest';
import { readEnv, type ServerEnv } from '../../server/env';
import type { Deps } from '../../server/orders';
import { SANDBOX_SIGNATURE_HEADER, SandboxProvider, signSandboxPayload } from '../../server/payments/sandbox';
import { handleApi, resetRateLimit } from '../../server/router';
import { MemoryStore } from '../../server/store';
import type { CreateOrderResponse, PublicOrder } from '../../shared/types';

const SECRET = 'test-sandbox-secret-0123456789';
const ORIGIN = 'https://nightwntr.test';

interface World {
  env: ServerEnv;
  store: MemoryStore;
  deps: Partial<Deps>;
  telegram: Array<{ url: string; body: { chat_id: string; text: string } }>;
}

function world(extraEnv: Record<string, string> = {}, withProvider = true): World {
  const env = readEnv({
    PAYMENT_PROVIDER: withProvider ? 'sandbox' : '',
    SANDBOX_WEBHOOK_SECRET: SECRET,
    ORDER_STORE: 'memory',
    ...extraEnv,
  });
  const store = new MemoryStore();
  const telegram: World['telegram'] = [];
  const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
    telegram.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response('{"ok":true}', { status: 200 });
  };
  const provider = withProvider ? new SandboxProvider(env, store) : null;
  return { env, store, telegram, deps: { env, store, provider, fetchImpl } };
}

const input = (patch: Record<string, unknown> = {}) => ({
  service: 'website',
  addons: { rush: false, lang: 0, support: false },
  plan: 'half',
  pm: 'card',
  details: 'A landing page for a coffee shop, dark style',
  ref: '',
  name: 'Alex',
  contact: 'alex@example.com',
  lang: 'en',
  ...patch,
});

async function api<T = any>(w: World, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T; res: Response }> {
  const res = await handleApi(
    new Request(ORIGIN + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    w.deps,
  );
  const text = await res.text();
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, data, res };
}

async function create(w: World, patch: Record<string, unknown> = {}): Promise<CreateOrderResponse> {
  const r = await api<CreateOrderResponse>(w, 'POST', '/api/orders', input(patch));
  expect(r.status).toBe(201);
  return r.data;
}

async function checkout(w: World, id: string, token: string): Promise<string> {
  const r = await api<{ url: string }>(w, 'POST', `/api/orders/${id}/checkout`, { token });
  expect(r.status).toBe(200);
  return r.data.url;
}

const sessionOf = (url: string): string => new URL(url).searchParams.get('s')!;

async function sandboxOutcome(w: World, sessionId: string, outcome: string): Promise<Response> {
  const res = await handleApi(
    new Request(ORIGIN + '/api/sandbox/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ s: sessionId, outcome }).toString(),
    }),
    w.deps,
  );
  return res;
}

async function status(w: World, id: string, token: string): Promise<PublicOrder> {
  const r = await api<{ order: PublicOrder }>(w, 'GET', `/api/orders/${id}`, undefined, { 'x-order-token': token });
  expect(r.status).toBe(200);
  return r.data.order;
}

beforeEach(() => resetRateLimit());

describe('GET /api/config', () => {
  it('reports the sandbox as a test provider', async () => {
    const r = await api(world(), 'GET', '/api/config');
    expect(r.data).toEqual({ payments: { provider: 'sandbox', mode: 'test', currency: 'USD' }, notifications: false });
  });

  it('reports payments as off when nothing is configured', async () => {
    const r = await api(world({}, false), 'GET', '/api/config');
    expect(r.data.payments).toEqual({ provider: null, mode: null, currency: 'USD' });
  });

  it('does not enable Stripe with a key but no webhook secret', () => {
    expect(readEnv({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x' }).provider).toBeNull();
    expect(readEnv({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }).provider).toBe('stripe');
  });
});

describe('creating an order', () => {
  it('stores it, prices it on the server and returns a reference and a token', async () => {
    const w = world();
    const { order, token } = await create(w, { addons: { rush: true, lang: 2, support: true } });
    expect(order.id).toMatch(/^NW-\d{6}-\d{4}$/);
    expect(token.length).toBeGreaterThan(30);
    expect(order.status).toBe('created');
    expect(order.pricing).toEqual({
      base: 650,
      lines: [
        { id: 'rush', qty: 1, cost: 163 },
        { id: 'lang', qty: 2, cost: 120 },
        { id: 'support', qty: 1, cost: 50 },
      ],
      total: 983,
      now: 492,
    });
  });

  it('ignores any price the browser sends', async () => {
    const w = world();
    const { order } = await create(w, { pricing: { base: 1, lines: [], total: 1, now: 1 }, total: 1, now: 1, status: 'paid' });
    expect(order.pricing.total).toBe(650);
    expect(order.pricing.now).toBe(325);
    expect(order.status).toBe('created');
  });

  it('never stores the token itself', async () => {
    const w = world();
    const { order, token } = await create(w);
    const stored = await w.store.get(order.id);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('rejects invalid input with the field name', async () => {
    const w = world();
    const r = await api(w, 'POST', '/api/orders', input({ contact: 'nope' }));
    expect(r.status).toBe(400);
    expect(r.data).toEqual({ error: 'invalid_contact', field: 'contact' });
  });

  it('rejects the honeypot, broken JSON and oversized bodies', async () => {
    const w = world();
    expect((await api(w, 'POST', '/api/orders', input({ company: 'ACME' }))).status).toBe(400);
    expect((await api(w, 'POST', '/api/orders', '{nope')).status).toBe(400);
    expect((await api(w, 'POST', '/api/orders', input({ details: 'x'.repeat(70_000) }))).status).toBe(413);
  });

  it('refuses card orders when no provider is configured, but keeps manual orders working', async () => {
    const w = world({}, false);
    const card = await api(w, 'POST', '/api/orders', input());
    expect(card.status).toBe(409);
    expect(card.data.error).toBe('card_unavailable');
    const chat = await api(w, 'POST', '/api/orders', input({ pm: 'chat' }));
    expect(chat.status).toBe(201);
  });

  it('rate-limits order creation', async () => {
    const w = world();
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) codes.push((await api(w, 'POST', '/api/orders', input({ pm: 'chat' }))).status);
    expect(codes.filter(c => c === 201).length).toBe(8);
    expect(codes.filter(c => c === 429).length).toBe(2);
  });
});

describe('reading an order', () => {
  it('needs the token', async () => {
    const w = world();
    const { order, token } = await create(w);
    expect((await api(w, 'GET', `/api/orders/${order.id}`)).status).toBe(404);
    expect((await api(w, 'GET', `/api/orders/${order.id}`, undefined, { 'x-order-token': 'wrong' })).status).toBe(404);
    expect((await api(w, 'GET', `/api/orders/NW-000000-0000`, undefined, { 'x-order-token': token })).status).toBe(404);
    expect((await status(w, order.id, token)).id).toBe(order.id);
  });

  it('accepts the checkout session id instead of the token', async () => {
    const w = world();
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    const r = await api(w, 'GET', `/api/orders/${order.id}?session_id=${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect((await api(w, 'GET', `/api/orders/${order.id}?session_id=sbx_${order.id}_AAAAAAAAAAAAAAAAAAAAAAAA`)).status).toBe(404);
  });

  it('does not expose internal fields', async () => {
    const w = world();
    const { order, token } = await create(w);
    await checkout(w, order.id, token);
    const pub = await status(w, order.id, token);
    const flat = JSON.stringify(pub);
    for (const secret of ['tokenHash', 'sessionId', 'sessionUrl', 'processedEvents', 'events']) expect(flat).not.toContain(secret);
  });
});

describe('checkout', () => {
  it('opens a hosted session and marks the order as awaiting payment', async () => {
    const w = world();
    const { order, token } = await create(w);
    const url = await checkout(w, order.id, token);
    expect(url).toMatch(new RegExp(`^${ORIGIN}/api/sandbox/checkout\\?s=sbx_${order.id}_`));
    expect((await status(w, order.id, token)).status).toBe('awaiting_payment');
  });

  it('reuses the open session instead of creating a second one', async () => {
    const w = world();
    const { order, token } = await create(w);
    const a = await checkout(w, order.id, token);
    const b = await checkout(w, order.id, token);
    expect(b).toBe(a);
    expect((await w.store.get(order.id))!.payment.sessionIds).toHaveLength(1);
  });

  it('needs the token and a card order', async () => {
    const w = world();
    const { order } = await create(w);
    expect((await api(w, 'POST', `/api/orders/${order.id}/checkout`, { token: 'wrong' })).status).toBe(404);
    const manual = await create(w, { pm: 'chat' });
    const r = await api(w, 'POST', `/api/orders/${manual.order.id}/checkout`, { token: manual.token });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('not_a_card_order');
  });

  it('refuses a second checkout while one is being created', async () => {
    const w = world();
    const { order, token } = await create(w);
    await w.store.update(order.id, o => {
      o.payment.lockUntil = new Date(Date.now() + 10_000).toISOString();
      return o;
    });
    const r = await api(w, 'POST', `/api/orders/${order.id}/checkout`, { token });
    expect(r.status).toBe(409);
    expect(r.data.error).toBe('checkout_in_progress');
  });

  it('serves the sandbox hosted page for a known session only', async () => {
    const w = world();
    const { order, token } = await create(w);
    const url = await checkout(w, order.id, token);
    const page = await api(w, 'GET', new URL(url).pathname + new URL(url).search);
    expect(page.status).toBe(200);
    expect(page.data).toContain('Test mode');
    expect(page.data).toContain(order.id);
    expect(page.data).toContain('$325');
    expect((await api(w, 'GET', '/api/sandbox/checkout?s=sbx_NW-000000-0000_AAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
  });
});

describe('payment outcomes', () => {
  it('success: signed webhook marks the order paid and redirects back', async () => {
    const w = world({ TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_CHAT_ID: '42' });
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    const res = await sandboxOutcome(w, sid, 'paid');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?order=${order.id}&checkout=success&session_id=${encodeURIComponent(sid)}`);
    const pub = await status(w, order.id, token);
    expect(pub.status).toBe('paid');
    expect(pub.payment.amountPaid).toBe(325);
    expect(pub.payment.paidAt).toBeTruthy();
    expect(pub.payment.testMode).toBe(true);
    // owner was told twice: new order, then payment
    expect(w.telegram).toHaveLength(2);
    expect(w.telegram[1].body.text).toContain('Оплата получена');
    expect(w.telegram[1].body.text).toContain(order.id);
  });

  it('paid is final: the order cannot be paid twice', async () => {
    const w = world();
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    await sandboxOutcome(w, sid, 'paid');
    const again = await api(w, 'POST', `/api/orders/${order.id}/checkout`, { token });
    expect(again.status).toBe(409);
    expect(again.data.error).toBe('already_paid');
    // pressing the sandbox button again changes nothing
    await sandboxOutcome(w, sid, 'failed');
    expect((await status(w, order.id, token)).status).toBe('paid');
  });

  it('failure: the order is marked failed and can be retried with a new session', async () => {
    const w = world();
    const { order, token } = await create(w);
    const first = sessionOf(await checkout(w, order.id, token));
    await sandboxOutcome(w, first, 'failed');
    expect((await status(w, order.id, token)).status).toBe('failed');
    const second = sessionOf(await checkout(w, order.id, token));
    expect(second).not.toBe(first);
    await sandboxOutcome(w, second, 'paid');
    expect((await status(w, order.id, token)).status).toBe('paid');
  });

  it('pending: stays pending until the provider settles it', async () => {
    const w = world();
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    await sandboxOutcome(w, sid, 'pending');
    expect((await status(w, order.id, token)).status).toBe('pending');
    const blocked = await api(w, 'POST', `/api/orders/${order.id}/checkout`, { token });
    expect(blocked.data.error).toBe('payment_pending');
    await sandboxOutcome(w, sid, 'settle_ok');
    expect((await status(w, order.id, token)).status).toBe('paid');
  });

  it('pending can also settle as failed', async () => {
    const w = world();
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    await sandboxOutcome(w, sid, 'pending');
    await sandboxOutcome(w, sid, 'settle_fail');
    expect((await status(w, order.id, token)).status).toBe('failed');
  });

  it('cancel: marks the order cancelled, closes the session, allows a retry', async () => {
    const w = world();
    const { order, token } = await create(w);
    const first = sessionOf(await checkout(w, order.id, token));
    const res = await sandboxOutcome(w, first, 'cancel');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/?order=${order.id}&checkout=cancelled`);
    const r = await api<{ order: PublicOrder }>(w, 'POST', `/api/orders/${order.id}/cancel`, { token });
    expect(r.data.order.status).toBe('cancelled');
    // the old session can no longer be paid
    await sandboxOutcome(w, first, 'paid');
    expect((await status(w, order.id, token)).status).toBe('cancelled');
    const second = sessionOf(await checkout(w, order.id, token));
    expect(second).not.toBe(first);
  });

  it('cancel does not undo a payment that already went through', async () => {
    const w = world();
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    await sandboxOutcome(w, sid, 'paid');
    const r = await api<{ order: PublicOrder }>(w, 'POST', `/api/orders/${order.id}/cancel`, { token });
    expect(r.data.order.status).toBe('paid');
  });

  it('amount mismatch: a "paid" event for the wrong amount is refused and flagged', async () => {
    const w = world({ TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_CHAT_ID: '42' });
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    await sandboxOutcome(w, sid, 'mismatch');
    const pub = await status(w, order.id, token);
    expect(pub.status).toBe('failed');
    expect(pub.payment.amountPaid).toBeNull();
    expect(w.telegram.at(-1)!.body.text).toContain('Нужна ручная проверка');
  });

  it('server-side verification works without any webhook', async () => {
    const w = world();
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    // the provider knows the session is paid, but no webhook has arrived
    await w.store.update(order.id, o => {
      o.payment.sandboxState = 'paid';
      return o;
    });
    const r = await api<{ order: PublicOrder }>(w, 'GET', `/api/orders/${order.id}?session_id=${encodeURIComponent(sid)}`);
    expect(r.data.order.status).toBe('paid');
  });
});

describe('webhook security', () => {
  async function prepared() {
    const w = world();
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    const payload = JSON.stringify({
      id: 'evt_test_1',
      type: 'checkout.completed',
      session: { id: sid, order_id: order.id, amount_minor: 32500, currency: 'USD', reference: 'pay_1' },
    });
    return { w, order, token, sid, payload };
  }

  it('rejects unsigned, wrongly signed, stale and tampered webhooks', async () => {
    const { w, order, token, payload } = await prepared();
    const post = (body: string, sig?: string) => api(w, 'POST', '/api/webhooks/sandbox', body, sig ? { [SANDBOX_SIGNATURE_HEADER]: sig } : {});

    expect((await post(payload)).status).toBe(400);
    expect((await post(payload, signSandboxPayload('another-secret', payload))).status).toBe(400);
    expect((await post(payload, signSandboxPayload(SECRET, payload, Date.now() - 10 * 60 * 1000))).status).toBe(400);
    const tampered = payload.replace('32500', '1');
    expect((await post(tampered, signSandboxPayload(SECRET, payload))).status).toBe(400);
    expect((await status(w, order.id, token)).status).toBe('awaiting_payment');
  });

  it('accepts a correctly signed webhook', async () => {
    const { w, order, token, payload } = await prepared();
    const r = await api(w, 'POST', '/api/webhooks/sandbox', payload, { [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(SECRET, payload) });
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ received: true, handled: true });
    expect((await status(w, order.id, token)).status).toBe('paid');
  });

  it('is idempotent: a redelivered event is acknowledged and applied once', async () => {
    const w = world({ TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_CHAT_ID: '42' });
    const { order, token } = await create(w);
    const sid = sessionOf(await checkout(w, order.id, token));
    const payload = JSON.stringify({
      id: 'evt_test_dup',
      type: 'checkout.completed',
      session: { id: sid, order_id: order.id, amount_minor: 32500, currency: 'USD', reference: 'pay_1' },
    });
    const send = () => api(w, 'POST', '/api/webhooks/sandbox', payload, { [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(SECRET, payload) });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const stored = (await w.store.get(order.id))!;
    expect(stored.events.filter(e => e.type === 'paid')).toHaveLength(1);
    expect(stored.processedEvents).toEqual(['evt_test_dup']);
    // one "new order" + exactly one "payment received"
    expect(w.telegram.filter(m => m.body.text.includes('Оплата получена'))).toHaveLength(1);
  });

  it('a late "expired" event cannot downgrade a paid order', async () => {
    const { w, order, token, sid, payload } = await prepared();
    await api(w, 'POST', '/api/webhooks/sandbox', payload, { [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(SECRET, payload) });
    const late = JSON.stringify({ id: 'evt_late', type: 'checkout.expired', session: { id: sid, order_id: order.id, amount_minor: 32500, currency: 'USD', reference: 'pay_1' } });
    await api(w, 'POST', '/api/webhooks/sandbox', late, { [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(SECRET, late) });
    expect((await status(w, order.id, token)).status).toBe('paid');
  });

  it('ignores events for sessions the order never opened', async () => {
    const { w, order, token } = await prepared();
    const foreign = JSON.stringify({
      id: 'evt_foreign',
      type: 'checkout.completed',
      session: { id: `sbx_${order.id}_ZZZZZZZZZZZZZZZZZZZZZZZZ`, order_id: order.id, amount_minor: 32500, currency: 'USD', reference: 'pay_x' },
    });
    const r = await api(w, 'POST', '/api/webhooks/sandbox', foreign, { [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(SECRET, foreign) });
    expect(r.status).toBe(200);
    expect((await status(w, order.id, token)).status).toBe('awaiting_payment');
  });

  it('does not accept webhooks for a provider that is not the configured one', async () => {
    const { w, payload } = await prepared();
    expect((await api(w, 'POST', '/api/webhooks/stripe', payload)).status).toBe(404);
  });
});

describe('Telegram notifications', () => {
  it('sends the order summary to the owner and marks the order as notified', async () => {
    const w = world({ TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_CHAT_ID: '42' });
    const { order, token } = await create(w, { pm: 'chat', contact: '@alex_dev' });
    expect(order.notified).toBe(true);
    expect(w.telegram).toHaveLength(1);
    const msg = w.telegram[0];
    expect(msg.url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
    expect(msg.body.chat_id).toBe('42');
    expect(msg.body.text).toContain(`Новый заказ ${order.id}`);
    expect(msg.body.text).toContain('Контакт: @alex_dev');
    expect(msg.body.text).toContain('Итого: $650');
    // nothing secret goes to Telegram
    expect(msg.body.text).not.toContain(token);
    expect(msg.body.text).not.toContain(SECRET);
  });

  it('minimal mode leaves the customer details out', async () => {
    const w = world({ TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_CHAT_ID: '42', TELEGRAM_NOTIFY_DETAIL: 'minimal' });
    await create(w, { pm: 'chat', contact: '@alex_dev' });
    expect(w.telegram[0].body.text).not.toContain('@alex_dev');
    expect(w.telegram[0].body.text).not.toContain('coffee shop');
  });

  it('a Telegram outage does not block the order', async () => {
    const w = world({ TELEGRAM_BOT_TOKEN: '123:ABC', TELEGRAM_CHAT_ID: '42' });
    w.deps.fetchImpl = async () => {
      throw new Error('network down');
    };
    const { order } = await create(w, { pm: 'chat' });
    expect(order.status).toBe('created');
    expect(order.notified).toBe(false);
  });

  it('stays silent when it is not configured', async () => {
    const w = world();
    const { order } = await create(w, { pm: 'chat' });
    expect(order.notified).toBe(false);
    expect(w.telegram).toHaveLength(0);
  });
});

describe('admin API', () => {
  it('does not exist without ADMIN_TOKEN and needs it when set', async () => {
    expect((await api(world(), 'GET', '/api/admin/orders')).status).toBe(404);
    const w = world({ ADMIN_TOKEN: 'owner-secret' });
    expect((await api(w, 'GET', '/api/admin/orders')).status).toBe(401);
    expect((await api(w, 'GET', '/api/admin/orders', undefined, { authorization: 'Bearer nope' })).status).toBe(401);
    expect((await api(w, 'GET', '/api/admin/orders', undefined, { authorization: 'Bearer owner-secret' })).status).toBe(200);
  });

  it('lists orders and confirms a manual bank transfer', async () => {
    const w = world({ ADMIN_TOKEN: 'owner-secret' });
    const { order, token } = await create(w, { pm: 'qr' });
    const auth = { authorization: 'Bearer owner-secret' };
    const list = await api(w, 'GET', '/api/admin/orders', undefined, auth);
    expect(list.data.orders.map((o: PublicOrder) => o.id)).toEqual([order.id]);
    const set = await api(w, 'POST', `/api/admin/orders/${order.id}/status`, { status: 'paid', note: 'bank transfer received' }, auth);
    expect(set.status).toBe(200);
    const pub = await status(w, order.id, token);
    expect(pub.status).toBe('paid');
    expect(pub.payment.amountPaid).toBe(325);
    expect((await api(w, 'POST', `/api/admin/orders/${order.id}/status`, { status: 'whatever' }, auth)).status).toBe(400);
  });
});

describe('owner panel (/api/admin)', () => {
  const form = (w: World, fields: Record<string, string>) =>
    handleApi(
      new Request(ORIGIN + '/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
      w.deps,
    );

  it('is switched off without ADMIN_TOKEN', async () => {
    const res = await handleApi(new Request(ORIGIN + '/api/admin'), world().deps);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('ADMIN_TOKEN');
  });

  it('shows a sign-in page and refuses a wrong token', async () => {
    const w = world({ ADMIN_TOKEN: 'owner-secret' });
    const login = await handleApi(new Request(ORIGIN + '/api/admin'), w.deps);
    expect(login.status).toBe(200);
    expect(login.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(login.headers.get('cache-control')).toBe('no-store');
    expect(await login.text()).toContain('type="password"');
    const wrong = await form(w, { token: 'nope' });
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain('NW-');
  });

  it('lists orders and escapes everything the customer typed', async () => {
    const w = world({ ADMIN_TOKEN: 'owner-secret' });
    const { order } = await create(w, { pm: 'qr', name: '<b>Alex</b>', details: 'A page <script>alert(1)</script> for a coffee shop' });
    const res = await form(w, { token: 'owner-secret' });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain(order.id);
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page).not.toContain('<script');
    expect(page).not.toContain('<b>Alex</b>');
    // nothing internal is printed
    expect(page).not.toContain((await w.store.get(order.id))!.tokenHash);
  });

  it('confirms a manual payment and can undo it', async () => {
    const w = world({ ADMIN_TOKEN: 'owner-secret' });
    const { order, token } = await create(w, { pm: 'qr' });
    const paid = await form(w, { token: 'owner-secret', id: order.id, status: 'paid' });
    expect(paid.status).toBe(200);
    expect((await status(w, order.id, token)).status).toBe('paid');
    await form(w, { token: 'owner-secret', id: order.id, status: 'created' });
    expect((await status(w, order.id, token)).status).toBe('created');
    // an action with a wrong token changes nothing
    await form(w, { token: 'nope', id: order.id, status: 'paid' });
    expect((await status(w, order.id, token)).status).toBe('created');
  });

  it('offers no manual "paid" button for card orders', async () => {
    const w = world({ ADMIN_TOKEN: 'owner-secret' });
    await create(w, { pm: 'card' });
    const page = await (await form(w, { token: 'owner-secret' })).text();
    expect(page).not.toContain('name="status" value="paid"');
    expect(page).toContain('name="status" value="cancelled"');
  });
});
