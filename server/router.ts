/**
 * HTTP API. One function, `handleApi(Request) → Response`, built on web
 * standards so the same code runs as a Netlify Function in production and
 * inside the Vite dev server locally.
 *
 *   GET  /api/config                      what the browser may know
 *   GET  /api/health                      configuration check
 *   POST /api/orders                      create an order
 *   GET  /api/orders/:id                  order status (token or session id required)
 *   POST /api/orders/:id/checkout         open the hosted payment page
 *   POST /api/orders/:id/cancel           customer came back without paying
 *   POST /api/webhooks/stripe             Stripe → us (signed)
 *   POST /api/webhooks/sandbox            sandbox → us (signed)
 *   GET  /api/sandbox/checkout            sandbox hosted page
 *   POST /api/sandbox/complete            sandbox outcome
 *   GET  /api/admin                       owner panel: sign-in page
 *   POST /api/admin                       owner panel: orders, confirm manual payments
 *   GET  /api/admin/orders                owner: list orders (ADMIN_TOKEN)
 *   POST /api/admin/orders/:id/status     owner: confirm a manual payment (ADMIN_TOKEN)
 */
import type { PublicConfig } from '../shared/types';
import { CURRENCY } from '../shared/catalog';
import { adminDisabledPage, adminLoginPage, adminPanelPage } from './adminPage';
import { providerProblem, readEnv, type ServerEnv } from './env';
import { safeEqual } from './ids';
import { adminList, adminSetStatus, cancelCheckout, createOrder, getOrder, handleWebhook, startCheckout, type Deps } from './orders';
import { getPaymentProvider } from './payments';
import { SANDBOX_SIGNATURE_HEADER, SandboxProvider, sandboxOrderId, type SandboxEventPayload } from './payments/sandbox';
import { sandboxCheckoutPage, sandboxMessagePage } from './sandboxPage';
import { getOrderStore } from './store';
import { telegramConfigured } from './telegram';
import { HttpError, WebhookSignatureError } from './types';

const MAX_BODY = 64_000;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const html = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  });

const redirect = (url: string): Response => new Response(null, { status: 303, headers: { location: url, 'cache-control': 'no-store' } });

async function readText(req: Request): Promise<string> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'body_too_large');
  return text;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await readText(req);
  try {
    const data: unknown = text ? JSON.parse(text) : {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/* ------------------------------------------------- best-effort rate limit */

const hits = new Map<string, number[]>();

function rateLimit(req: Request, bucket: string, max: number, windowMs = 60_000): void {
  const ip = req.headers.get('x-nf-client-connection-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= max) throw new HttpError(429, 'rate_limited');
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
}

export const resetRateLimit = (): void => hits.clear();

/* ------------------------------------------------------------------ misc */

function buildDeps(overrides?: Partial<Deps>): Deps {
  const env = overrides?.env ?? readEnv();
  const store = overrides?.store ?? getOrderStore(env);
  const provider = overrides && 'provider' in overrides ? (overrides.provider ?? null) : getPaymentProvider(env, store);
  return { env, store, provider, fetchImpl: overrides?.fetchImpl, now: overrides?.now };
}

const siteUrlOf = (env: ServerEnv, req: Request): string => env.siteUrl ?? new URL(req.url).origin;

function publicConfig(deps: Deps): PublicConfig {
  const p = deps.provider;
  return {
    payments: { provider: p?.id ?? null, mode: p ? (p.testMode ? 'test' : 'live') : null, currency: CURRENCY },
    notifications: telegramConfigured(deps.env),
  };
}

function isAdmin(env: ServerEnv, req: Request): boolean {
  if (!env.adminToken) return false;
  const header = req.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  return !!given && safeEqual(given, env.adminToken);
}

/* ---------------------------------------------------------------- sandbox */

async function sandboxCheckout(deps: Deps, url: URL): Promise<Response> {
  if (deps.provider?.id !== 'sandbox') return html(sandboxMessagePage('The sandbox provider is not enabled.'), 404);
  const sessionId = url.searchParams.get('s') || '';
  const orderId = sandboxOrderId(sessionId);
  const order = orderId ? await deps.store.get(orderId) : null;
  if (!order || !order.payment.sessionIds.includes(sessionId)) return html(sandboxMessagePage('Unknown checkout session.'), 404);
  return html(sandboxCheckoutPage(order, sessionId));
}

async function sandboxComplete(deps: Deps, req: Request): Promise<Response> {
  const provider = deps.provider;
  if (!(provider instanceof SandboxProvider)) return html(sandboxMessagePage('The sandbox provider is not enabled.'), 404);
  const form = new URLSearchParams(await readText(req));
  const sessionId = form.get('s') || '';
  const outcome = form.get('outcome') || '';
  const orderId = sandboxOrderId(sessionId);
  const order = orderId ? await deps.store.get(orderId) : null;
  if (!order || !order.payment.sessionIds.includes(sessionId)) return html(sandboxMessagePage('Unknown checkout session.'), 404);

  const back = `${siteUrlOf(deps.env, req)}/?order=${encodeURIComponent(order.id)}`;
  const success = `${back}&checkout=success&session_id=${encodeURIComponent(sessionId)}`;
  if (outcome === 'cancel') return redirect(`${back}&checkout=cancelled`);
  if (outcome === 'return') return redirect(success);

  const state = order.payment.sessionId === sessionId ? (order.payment.sandboxState ?? 'open') : 'expired';
  const plan: Record<string, { from: string; to: 'paid' | 'pending' | 'failed'; type: SandboxEventPayload['type']; amount?: number }> = {
    paid: { from: 'open', to: 'paid', type: 'checkout.completed' },
    pending: { from: 'open', to: 'pending', type: 'checkout.pending' },
    failed: { from: 'open', to: 'failed', type: 'checkout.failed' },
    // a "paid" event whose amount does not match the order: the server must refuse it
    mismatch: { from: 'open', to: 'paid', type: 'checkout.completed', amount: 100 },
    settle_ok: { from: 'pending', to: 'paid', type: 'checkout.completed' },
    settle_fail: { from: 'pending', to: 'failed', type: 'checkout.failed' },
  };
  const step = plan[outcome];
  if (!step || step.from !== state) return redirect(success);

  await deps.store.update(order.id, o => {
    if (o.payment.sessionId !== sessionId) return null;
    o.payment.sandboxState = step.to;
    return o;
  });
  // deliver the signed webhook through the same code path a real provider uses
  const event = provider.buildEvent(step.type, order, sessionId, step.amount);
  await handleWebhook(deps, event.body, new Headers({ [SANDBOX_SIGNATURE_HEADER]: event.signature }));
  return redirect(success);
}

/* ------------------------------------------------------------ owner panel */

async function adminPanel(deps: Deps, req: Request): Promise<Response> {
  const expected = deps.env.adminToken;
  if (!expected) return html(adminDisabledPage(), 404);
  if (req.method.toUpperCase() === 'GET') return html(adminLoginPage());

  rateLimit(req, 'admin', 20);
  const form = new URLSearchParams(await readText(req));
  const token = form.get('token') || '';
  if (!token || token.length > 300 || !safeEqual(token, expected)) return html(adminLoginPage('Неверный токен.'), 401);

  let message = '';
  const id = form.get('id');
  const status = form.get('status');
  if (id && status) {
    try {
      await adminSetStatus(deps, id, status, 'панель владельца');
    } catch {
      message = 'Не удалось изменить статус заказа.';
    }
  }
  const cfg = publicConfig(deps);
  const info = {
    payments: cfg.payments.provider ?? 'off',
    mode: cfg.payments.mode,
    notifications: cfg.notifications,
    store: deps.store.kind,
    hint: deps.provider ? null : providerProblem(),
  };
  return html(adminPanelPage(await deps.store.list(200), token, info, message));
}

/* ----------------------------------------------------------------- router */

export async function handleApi(req: Request, overrides?: Partial<Deps>): Promise<Response> {
  try {
    const deps = buildDeps(overrides);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
    const method = req.method.toUpperCase();
    let m: RegExpExecArray | null;

    if (path === '/config' && method === 'GET') return json(publicConfig(deps));

    if (path === '/health' && method === 'GET') {
      const cfg = publicConfig(deps);
      const base = { ok: true, payments: cfg.payments.provider ?? 'off', mode: cfg.payments.mode, notifications: cfg.notifications, store: deps.store.kind };
      // configuration hints are only shown to the owner
      return json(isAdmin(deps.env, req) ? { ...base, hint: deps.provider ? null : providerProblem() } : base);
    }

    if (path === '/orders' && method === 'POST') {
      rateLimit(req, 'create', 8);
      const body = await readJson(req);
      // honeypot: real people never fill this field in
      if (typeof body.company === 'string' && body.company.trim()) throw new HttpError(400, 'rejected');
      return json(await createOrder(deps, body), 201);
    }

    if ((m = /^\/orders\/([A-Za-z0-9-]{6,24})$/.exec(path)) && method === 'GET') {
      rateLimit(req, 'read', 90);
      const order = await getOrder(deps, m[1], { token: req.headers.get('x-order-token'), sessionId: url.searchParams.get('session_id') });
      return json({ order });
    }

    if ((m = /^\/orders\/([A-Za-z0-9-]{6,24})\/checkout$/.exec(path)) && method === 'POST') {
      rateLimit(req, 'checkout', 12);
      const body = await readJson(req);
      return json(await startCheckout(deps, m[1], typeof body.token === 'string' ? body.token : null, siteUrlOf(deps.env, req)));
    }

    if ((m = /^\/orders\/([A-Za-z0-9-]{6,24})\/cancel$/.exec(path)) && method === 'POST') {
      rateLimit(req, 'checkout', 12);
      const body = await readJson(req);
      return json({ order: await cancelCheckout(deps, m[1], typeof body.token === 'string' ? body.token : null) });
    }

    if ((m = /^\/webhooks\/(stripe|sandbox)$/.exec(path)) && method === 'POST') {
      if (!deps.provider || deps.provider.id !== m[1]) return json({ error: 'provider_not_configured' }, 404);
      const raw = await readText(req);
      const result = await handleWebhook(deps, raw, req.headers);
      return json({ received: true, handled: result.handled });
    }

    if (path === '/sandbox/checkout' && method === 'GET') return await sandboxCheckout(deps, url);
    if (path === '/sandbox/complete' && method === 'POST') return await sandboxComplete(deps, req);

    if (path === '/admin' && (method === 'GET' || method === 'POST')) return await adminPanel(deps, req);

    if (path.startsWith('/admin/')) {
      // without a configured ADMIN_TOKEN the admin API does not exist
      if (!deps.env.adminToken) return json({ error: 'not_found' }, 404);
      if (!isAdmin(deps.env, req)) return json({ error: 'unauthorized' }, 401);
      if (path === '/admin/orders' && method === 'GET') return json({ orders: await adminList(deps, Math.min(500, Number(url.searchParams.get('limit')) || 100)) });
      if ((m = /^\/admin\/orders\/([A-Za-z0-9-]{6,24})\/status$/.exec(path)) && method === 'POST') {
        const body = await readJson(req);
        return json({ order: await adminSetStatus(deps, m[1], body.status, body.note) });
      }
    }

    return json({ error: 'not_found' }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.code, ...(err.field ? { field: err.field } : {}) }, err.status);
    if (err instanceof WebhookSignatureError) {
      console.warn('[webhook] rejected:', err.message);
      return json({ error: 'invalid_signature' }, 400);
    }
    console.error('[api] unexpected error:', err);
    return json({ error: 'internal_error' }, 500);
  }
}
