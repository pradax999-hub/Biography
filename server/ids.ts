import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Order reference in the same shape the original site used: NW-YYMMDD-NNNN.
 * Digits only after the prefix, so the reference doubles as the variable
 * symbol of a Czech bank transfer.
 */
export function makeOrderId(now: Date = new Date(), digits = 4): string {
  const min = 10 ** (digits - 1);
  const rnd = randomInt(min, min * 10);
  return `NW-${String(now.getUTCFullYear()).slice(2)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${rnd}`;
}

export const ORDER_ID_RE = /^NW-\d{6}-\d{4,6}$/;

export const makeToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const tokenMatches = (token: string | null | undefined, tokenHash: string): boolean =>
  !!token && token.length <= 200 && safeEqual(hashToken(token), tokenHash);
