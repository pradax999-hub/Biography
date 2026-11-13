import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from '../../dev/securityHeaders';

describe('security headers', () => {
  const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');

  it('netlify.toml and the preview server send the same headers', () => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(toml, name).toContain(`${name} = "${value}"`);
    }
  });

  it('the policy allows nothing from outside except Netlify\'s own badge frame', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'];
    const outside = csp.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(outside).toEqual(['https://app.netlify.com']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
