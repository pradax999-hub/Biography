/**
 * The response headers the site is served with in production (netlify.toml).
 * `vite preview` sends the same ones, so the browser tests run under the same
 * Content-Security-Policy a visitor gets. tests/server/headers.test.ts fails
 * if this file and netlify.toml drift apart.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self' https://app.netlify.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};
