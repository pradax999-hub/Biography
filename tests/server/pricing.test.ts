import { describe, expect, it } from 'vitest';
import { ADDONS, SERVICES, calcPrice, money } from '../../shared/catalog';
import { LOCALES, translator } from '../../shared/locales';
import { orderText } from '../../shared/orderText';
import { contactOk, detailsOk, nameOk, parseOrderInput } from '../../shared/validation';

const none = { rush: false, lang: 0, support: false };

describe('catalog — prices carried over from nightwntr 1.0', () => {
  it('keeps the three services and their prices', () => {
    expect(SERVICES).toEqual({
      website: { price: 650, from: false },
      video: { price: 200, from: true },
      app: { price: 900, from: true },
    });
  });

  it('keeps the three add-ons', () => {
    expect(ADDONS.rush).toEqual({ type: 'percent', value: 25 });
    expect(ADDONS.lang).toEqual({ type: 'each', value: 60, max: 4, only: ['website', 'app'] });
    expect(ADDONS.support).toEqual({ type: 'fixed', value: 50 });
  });
});

describe('calcPrice', () => {
  it('website, no add-ons, 50/50', () => {
    expect(calcPrice('website', none, 'half')).toEqual({ base: 650, lines: [], total: 650, now: 325 });
  });

  it('website, everything, paid in full', () => {
    const p = calcPrice('website', { rush: true, lang: 4, support: true }, 'full');
    // 650 + 25% (163) + 4 × 60 + 50
    expect(p.lines).toEqual([
      { id: 'rush', qty: 1, cost: 163 },
      { id: 'lang', qty: 4, cost: 240 },
      { id: 'support', qty: 1, cost: 50 },
    ]);
    expect(p.total).toBe(1103);
    expect(p.now).toBe(1103);
  });

  it('rounds the half payment up', () => {
    const p = calcPrice('website', { rush: true, lang: 0, support: false }, 'half');
    expect(p.total).toBe(813);
    expect(p.now).toBe(407);
  });

  it('ignores the language add-on for videos', () => {
    const p = calcPrice('video', { rush: false, lang: 3, support: false }, 'full');
    expect(p.lines).toEqual([]);
    expect(p.total).toBe(200);
  });

  it('clamps the number of extra languages', () => {
    expect(calcPrice('app', { rush: false, lang: 99, support: false }, 'full').total).toBe(900 + 4 * 60);
    expect(calcPrice('app', { rush: false, lang: -3, support: false }, 'full').total).toBe(900);
  });

  it('formats money like 1.0', () => {
    expect(money(650)).toBe('$650');
    expect(money(1103)).toBe('$1,103');
  });
});

describe('validation', () => {
  it('applies the 1.0 rules', () => {
    expect(detailsOk('short')).toBe(false);
    expect(detailsOk('a landing page for a coffee shop')).toBe(true);
    expect(nameOk('A')).toBe(false);
    expect(nameOk('Al')).toBe(true);
    expect(contactOk('@nightwntr')).toBe(true);
    expect(contactOk('night_wntr')).toBe(true);
    expect(contactOk('mail@example.com')).toBe(true);
    expect(contactOk('@abc')).toBe(false);
    expect(contactOk('not a contact')).toBe(false);
  });

  const valid = {
    service: 'website',
    addons: { rush: true, lang: 2, support: false },
    plan: 'half',
    pm: 'chat',
    details: 'a landing page for a coffee shop',
    ref: '',
    name: 'Alex',
    contact: '@alex_dev',
    lang: 'en',
  };

  it('accepts a clean payload', () => {
    const r = parseOrderInput(valid);
    expect(r.ok).toBe(true);
  });

  it.each([
    [{ service: 'yacht' }, 'invalid_service'],
    [{ plan: 'free' }, 'invalid_plan'],
    [{ pm: 'bitcoin' }, 'invalid_payment_method'],
    [{ addons: { lang: 9 } }, 'invalid_addons'],
    [{ details: 'too short' }, 'invalid_details'],
    [{ name: '' }, 'invalid_name'],
    [{ contact: 'nope' }, 'invalid_contact'],
    [{ details: 'x'.repeat(5000) }, 'details_too_long'],
  ])('rejects %j', (patch, error) => {
    const r = parseOrderInput({ ...valid, ...patch });
    expect(r).toMatchObject({ ok: false, error });
  });

  it('never lets extra fields through', () => {
    const r = parseOrderInput({ ...valid, total: 1, pricing: { now: 1 }, status: 'paid' });
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['addons', 'contact', 'details', 'lang', 'name', 'plan', 'pm', 'ref', 'service']);
  });
});

describe('locales', () => {
  it('every language has every key', () => {
    const keys = Object.keys(LOCALES.ru).sort();
    for (const lang of ['uk', 'en', 'de', 'cs'] as const) expect(Object.keys(LOCALES[lang]).sort()).toEqual(keys);
  });

  it('builds the order text in the 1.0 layout', () => {
    const t = translator('en');
    const text = orderText(t, {
      id: 'NW-261112-1234',
      service: 'website',
      addons: { rush: true, lang: 1, support: false },
      plan: 'half',
      pm: 'chat',
      pricing: calcPrice('website', { rush: true, lang: 1, support: false }, 'half'),
      name: ' Alex ',
      contact: '@alex_dev',
      details: 'a landing page',
      ref: 'https://example.com',
    });
    expect(text).toBe(
      [
        '❄ New order NW-261112-1234',
        'Service: Website ($650)',
        'Extras: Rush +$163, Extra language × 1 +$60',
        'Total: $873',
        'Due now: $437 (50% now, 50% after delivery)',
        'Payment method: In chat',
        '',
        'Name: Alex',
        'Contact: @alex_dev',
        'Task: a landing page',
        'Reference: https://example.com',
      ].join('\n'),
    );
  });
});
