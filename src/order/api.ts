/**
 * Browser side of the order API. Every call can fail softly: the site still
 * works as a static page (manual order flow) when the API is not deployed.
 */
import type { ApiError, CreateOrderResponse, PublicConfig, PublicOrder } from '../../shared/types';
import type { OrderInput } from '../../shared/validation';

export class ApiFailure extends Error {
  status: number;
  code: string;
  field?: string;
  constructor(status: number, code: string, field?: string) {
    super(code);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.field = field;
  }
  /** the API is not there at all (static hosting) or the network is down */
  get unreachable(): boolean {
    return this.status === 0 || this.code === 'not_json';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  } catch {
    throw new ApiFailure(0, 'network');
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new ApiFailure(res.status, 'not_json');
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || !data) throw new ApiFailure(res.status, data?.error || 'error', data?.field);
  return data;
}

export const fetchConfig = (): Promise<PublicConfig> => call<PublicConfig>('/api/config');

export const createOrder = (input: OrderInput & { company?: string }): Promise<CreateOrderResponse> =>
  call<CreateOrderResponse>('/api/orders', { method: 'POST', body: JSON.stringify(input) });

export async function fetchOrder(id: string, auth: { token?: string | null; sessionId?: string | null }): Promise<PublicOrder> {
  const qs = auth.sessionId ? `?session_id=${encodeURIComponent(auth.sessionId)}` : '';
  const { order } = await call<{ order: PublicOrder }>(`/api/orders/${encodeURIComponent(id)}${qs}`, {
    headers: auth.token ? { 'x-order-token': auth.token } : {},
  });
  return order;
}

export const startCheckout = (id: string, token: string): Promise<{ url: string }> =>
  call<{ url: string }>(`/api/orders/${encodeURIComponent(id)}/checkout`, { method: 'POST', body: JSON.stringify({ token }) });

export async function cancelCheckout(id: string, token: string): Promise<PublicOrder> {
  const { order } = await call<{ order: PublicOrder }>(`/api/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ token }) });
  return order;
}
