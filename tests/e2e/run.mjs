/**
 * End-to-end check of the whole site in a real browser.
 *
 *   npm run dev            (in one terminal; the sandbox payment provider is on by default)
 *   npm run test:e2e       (in another)
 *
 * BASE_URL overrides the address (default http://localhost:5173).
 * Screenshots of every stage land in tests/e2e/out/.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

// software WebGL so the suite also runs on machines without a GPU
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

let passed = 0;
const failures = [];
function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
  }
}
const section = title => console.log(`\n${title}`);

async function open(browser, options = {}, url = BASE + '/?q=minimal') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', ...options });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
  // anything the Content-Security-Policy blocks is recorded and fails the run
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI}`));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 15000 });
  await page.waitForTimeout(1300);
  return { context, page, errors };
}

const cspClean = async page => {
  const hits = await page.evaluate(() => window.__csp || []);
  check('nothing is blocked by the Content-Security-Policy', hits.length === 0, hits.slice(0, 3).join(' | '));
};

const toOrder = async page => {
  await page.evaluate(() => document.querySelector('#order .order-grid').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(500);
};
const text = (page, selector) => page.locator(selector).first().innerText();
const next = page => page.locator('.step-nav .btn-primary').click();
const choose = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"] + .choice-card`).click();

/** Walks the wizard up to the payment step with valid data. */
async function fillWizard(page, { service = 'website', contact = 'alex@example.com' } = {}) {
  await toOrder(page);
  await choose(page, 'service', service);
  await next(page);
  await page.fill('#f-details', 'A landing page for a coffee shop, dark style, four sections');
  await next(page);
  await page.fill('#f-name', 'Alex');
  await page.fill('#f-contact', contact);
  await next(page);
  await page.waitForSelector('input[name="plan"]', { state: 'attached' });
}

async function run() {
  const browser = await chromium.launch({ args: GL_ARGS });

  /* ---------------------------------------------------------------- page */
  section('Page and WebGL');
  {
    const { context, page, errors } = await open(browser);
    check('page loads and the preloader lifts', await page.locator('.wordmark').isVisible());
    check('WebGL canvas is running', await page.evaluate(() => !document.querySelector('.stage-canvas').hidden && !document.documentElement.classList.contains('no-webgl')));
    const stats = await text(page, '.hud-stats');
    check('HUD reports particles', /PTS/.test(stats) && !/ 0\s*PTS/.test(stats), stats);
    check('hero shows the real status, lead and price', (await text(page, '.status')).length > 3 && (await text(page, '.hero-cta')).includes('$650'));
    for (const id of ['about', 'skills', 'langs', 'path', 'archive', 'services', 'order', 'contact']) {
      check(`section #${id} exists`, (await page.locator(`#${id}`).count()) === 1);
    }
    await page.screenshot({ path: path.join(OUT, '01-hero.png') });

    // navigation
    await page.locator('.nav-links a[href="#services"]').click();
    await page.waitForTimeout(2200);
    const top = await page.evaluate(() => document.querySelector('#services').getBoundingClientRect().top);
    check('nav link scrolls to its section', Math.abs(top - 72) < 80, `top=${Math.round(top)}`);

    // context loss and recovery
    const recovered = await page.evaluate(async () => {
      const canvas = document.querySelector('.stage-canvas');
      const gl = canvas.getContext('webgl2');
      const ext = gl.getExtension('WEBGL_lose_context');
      if (!ext) return 'no-extension';
      ext.loseContext();
      await new Promise(r => setTimeout(r, 400));
      ext.restoreContext();
      await new Promise(r => setTimeout(r, 1800));
      return !gl.isContextLost() && !canvas.hidden;
    });
    check('WebGL context loss is survived', recovered === true || recovered === 'no-extension', String(recovered));
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    const headers = (await page.request.get(BASE + '/')).headers();
    if (headers['content-security-policy']) {
      check('production security headers are sent', headers['x-frame-options'] === 'DENY' && headers['content-security-policy'].includes("script-src 'self'"));
    } else {
      console.log('  · security headers are only sent by the built site (npm run preview): skipped');
    }
    await cspClean(page);
    await context.close();
  }

  /* ----------------------------------------------------------- languages */
  section('Languages');
  {
    const { context, page } = await open(browser);
    check('browser language is detected (en)', (await text(page, '.nav-links')).toLowerCase().includes('about'));
    await page.locator('.lang-btn').click();
    await page.locator('#langMenu button', { hasText: 'Deutsch' }).click();
    await page.waitForTimeout(500);
    check('menu switches the site to German', (await text(page, '.nav-links')).toLowerCase().includes('über mich'));
    check('html lang attribute follows', (await page.evaluate(() => document.documentElement.lang)) === 'de');
    await page.evaluate(() => document.querySelector('#langs').scrollIntoView());
    await page.waitForTimeout(700);
    // the ring turns on its own; focusing a card turns the ring to face it
    await page.locator('.lang-card[data-lang="cs"]').focus();
    await page.waitForTimeout(1800);
    await page.locator('.lang-card[data-lang="cs"]').click({ force: true });
    await page.waitForTimeout(600);
    check('language card switches the site to Czech', (await text(page, '.nav-links')).toLowerCase().includes('o mně'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    check('the choice is remembered', (await page.evaluate(() => document.documentElement.lang)) === 'cs');
    await context.close();
  }

  /* -------------------------------------------------------------- wizard */
  section('Order form: steps, validation, pricing');
  {
    const { context, page, errors } = await open(browser);
    await toOrder(page);
    check('starts on step 1 with the website selected', (await text(page, '.sum-total b')) === '$650');
    check('due now is half by default', (await text(page, '.sum-now b')) === '$325');

    await choose(page, 'service', 'video');
    await page.waitForTimeout(900);
    check('choosing "video" updates the summary', (await text(page, '.sum-rows')).includes('from $200') && (await text(page, '.sum-total b')) === '$200');
    await next(page);
    check('extra-language add-on is hidden for videos', await page.locator('.addon', { hasText: 'Extra language' }).isHidden());
    await next(page);
    check('step 2 blocks on an empty description', (await text(page, '#err-details')).length > 5 && (await page.locator('#f-details').getAttribute('aria-invalid')) === 'true');
    await page.fill('#f-details', 'short');
    await next(page);
    check('step 2 blocks on a too-short description', (await text(page, '#err-details')).length > 5);

    await page.locator('.step-nav .btn-ghost').click();
    await choose(page, 'service', 'website');
    await next(page);
    await page.locator('.addon', { hasText: 'Rush order' }).locator('.switch').click();
    await page.locator('.stepper button').last().click();
    await page.locator('.stepper button').last().click();
    await page.locator('.addon', { hasText: '30 days of support' }).locator('.switch').click();
    await page.waitForTimeout(900);
    // 650 + 163 (25%) + 2 × 60 + 50
    check('add-ons are priced like in 1.0 ($983)', (await text(page, '.sum-total b')) === '$983', await text(page, '.sum-total b'));
    check('half payment rounds up ($492)', (await text(page, '.sum-now b')) === '$492');
    for (let i = 0; i < 4; i++) await page.locator('.stepper button').last().click({ force: true }).catch(() => undefined);
    check('extra languages stop at 4', (await text(page, '.stepper output')) === '4');

    await page.fill('#f-details', 'A landing page for a coffee shop, dark style');
    await next(page);
    await next(page);
    check('step 3 needs a name and a contact', (await text(page, '#err-name')).length > 3 && (await text(page, '#err-contact')).length > 3);
    await page.fill('#f-name', 'Alex');
    await page.fill('#f-contact', 'not a contact');
    await next(page);
    check('step 3 rejects an invalid contact', (await text(page, '#err-contact')).length > 3);
    await page.fill('#f-contact', '@alex_dev');
    await next(page);
    check('reaches the payment step', await page.locator('input[name="plan"][value="half"] + .choice-card').isVisible());
    await page.waitForTimeout(600);
    check('reaching the payment step does not submit the order', (await page.locator('.done').count()) === 0 && (await page.locator('.step-nav button[type="submit"]').isVisible()));

    await choose(page, 'plan', 'full');
    await page.waitForTimeout(300);
    check('paying in full changes the amount due', (await text(page, '.sum-now')).includes('100%') && (await text(page, '.sum-now b')) === '$1,103');
    const methods = await page.locator('input[name="pm"]').evaluateAll(els => els.map(e => e.value));
    check('payment methods: card, QR transfer and chat', ['card', 'qr', 'chat'].every(m => methods.includes(m)), methods.join(','));
    check('payment link stays hidden while it is not configured', !methods.includes('link'));

    // the draft survives a reload
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await toOrder(page);
    check('the draft is restored after a reload', (await text(page, '.sum-total b')) === '$1,103');
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  /* ------------------------------------------------------- manual orders */
  section('Order placed, paid in chat (manual flow with the server)');
  {
    const { context, page } = await open(browser);
    await fillWizard(page, { contact: '@alex_dev' });
    await choose(page, 'pm', 'chat');
    await page.locator('.step-nav button[type="submit"]').click();
    await page.waitForSelector('.done', { timeout: 10000 });
    const id = await text(page, '.invoice-head b');
    check('order gets a reference NW-YYMMDD-NNNN', /^NW-\d{6}-\d{4}$/.test(id), id);
    const invoice = await text(page, '.invoice pre');
    check('invoice lists service, total and contact', invoice.includes('Website ($650)') && invoice.includes('Total: $650') && invoice.includes('@alex_dev'));
    const tg = await page.locator('.done-actions a[href^="https://t.me/"]').getAttribute('href');
    check('Telegram button carries the order text', tg.startsWith('https://t.me/nightwntr?text=') && decodeURIComponent(tg).includes(id));
    await page.locator('.done-actions .btn-primary').click();
    await page.waitForTimeout(400);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    check('"copy order" puts the invoice on the clipboard', clip.includes(id), clip.slice(0, 40));
    check('summary shows the order status', (await text(page, '.sum-status')).includes('Created'));
    check('email is offered as an alternative', (await text(page, '.mail-line')).includes('pradax999@gmail.com'));
    await page.screenshot({ path: path.join(OUT, '02-order-chat.png') });
    await page.locator('.done .btn-sm').last().click();
    await page.waitForTimeout(400);
    check('"new order" returns to step 1', await page.locator('input[name="service"][value="website"] + .choice-card').isVisible());
    await context.close();
  }

  section('Order placed, QR bank transfer');
  {
    const { context, page } = await open(browser);
    await fillWizard(page);
    await choose(page, 'pm', 'qr');
    await page.locator('.step-nav button[type="submit"]').click();
    await page.waitForSelector('.pay .qr', { timeout: 10000 });
    const id = await text(page, '.invoice-head b');
    const fields = await text(page, '.pay-fields');
    check('QR code is drawn', (await page.locator('.pay .qr path').getAttribute('d')).length > 500);
    check('shows the recipient and the account from the settings', fields.includes('Tetiana Tymkovych') && fields.includes('333278000/0300'));
    check('IBAN is derived from the Czech account number', fields.replace(/\s/g, '').includes('CZ3903000000000333278000'), fields.replace(/\s+/g, ' ').slice(0, 200));
    check('variable symbol is the digits of the order number', fields.includes(id.replace(/\D/g, '')));
    // $325 × 21.74 = 7065.5 → rounded up to the next 10
    check('amount is converted to CZK and rounded up', /7[\s ,.]?070/.test(fields), fields.slice(0, 80));
    await page.screenshot({ path: path.join(OUT, '03-order-qr.png') });
    await cspClean(page);
    await context.close();
  }

  /* ------------------------------------------------------- card payments */
  async function cardOrder() {
    const opened = await open(browser);
    await fillWizard(opened.page);
    await choose(opened.page, 'pm', 'card');
    await opened.page.locator('.step-nav button[type="submit"]').click();
    await opened.page.waitForSelector('.pay-status', { timeout: 10000 });
    return opened;
  }
  const toCheckout = async page => {
    await page.locator('.btn-pay').click();
    await page.waitForURL(/\/api\/sandbox\/checkout/, { timeout: 15000 });
  };
  const outcome = async (page, label) => {
    await page.locator('button', { hasText: label }).click();
    await page.waitForURL(u => !String(u).includes('/api/'), { timeout: 15000 });
    await page.waitForSelector('.pay-status', { timeout: 15000 });
  };
  const waitStatus = (page, cls) => page.waitForSelector(`.pay-status.${cls}`, { timeout: 25000 }).then(() => true, () => false);

  section('Card payment: success');
  {
    const { context, page, errors } = await cardOrder();
    const id = await text(page, '.invoice-head b');
    check('checkout screen shows the amount to pay', (await text(page, '.btn-pay')).includes('$325'));
    check('test mode is labelled', (await text(page, '.pay-status')).toLowerCase().includes('test mode'));
    await page.screenshot({ path: path.join(OUT, '04-checkout.png') });
    await toCheckout(page);
    const hosted = await page.locator('body').innerText();
    check('hosted page shows the order and amount', hosted.includes(id) && hosted.includes('$325') && /test mode/i.test(hosted));
    await page.screenshot({ path: path.join(OUT, '05-sandbox-page.png') });
    await outcome(page, 'Simulate successful payment');
    check('server confirms the payment', await waitStatus(page, 'is-paid'));
    check('address bar is cleaned of payment parameters', !page.url().includes('session_id') && !page.url().includes('order='));
    check('confirmation names the order and the amount', (await text(page, '.pay-status')).includes(id) && (await text(page, '.pay-status')).includes('$325'));
    check('summary shows "Paid"', (await text(page, '.sum-status')).includes('Paid'));
    check('a paid order offers no pay button', (await page.locator('.btn-pay').count()) === 0);
    await page.evaluate(() => document.querySelector('.order-panel').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '06-paid.png') });
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await cspClean(page);
    await context.close();
  }

  section('Card payment: failure, then a successful retry');
  {
    const { context, page } = await cardOrder();
    await toCheckout(page);
    await outcome(page, 'Simulate a failed payment');
    check('failed payment is reported', await waitStatus(page, 'is-failed'));
    await page.screenshot({ path: path.join(OUT, '07-failed.png') });
    await toCheckout(page);
    await outcome(page, 'Simulate successful payment');
    check('retry succeeds', await waitStatus(page, 'is-paid'));
    await context.close();
  }

  section('Card payment: cancelled');
  {
    const { context, page } = await cardOrder();
    await toCheckout(page);
    await outcome(page, 'Cancel and return');
    check('cancelled payment is reported', await waitStatus(page, 'is-cancelled'));
    check('the order can still be paid', (await page.locator('.btn-pay').count()) === 1);
    await page.screenshot({ path: path.join(OUT, '08-cancelled.png') });
    await context.close();
  }

  section('Card payment: pending, then settled');
  {
    const { context, page } = await cardOrder();
    const id = await text(page, '.invoice-head b');
    await toCheckout(page);
    const sessionUrl = page.url();
    await outcome(page, 'stays pending');
    check('pending payment is reported', await waitStatus(page, 'is-pending'));
    check('a pending order cannot be paid again', (await page.locator('.btn-pay').count()) === 0);
    await page.screenshot({ path: path.join(OUT, '09-pending.png') });
    // the provider settles the payment later, in another tab
    const other = await context.newPage();
    await other.goto(sessionUrl);
    await other.locator('button', { hasText: 'Settle the pending payment: success' }).click();
    await other.waitForURL(u => !String(u).includes('/api/'));
    await other.close();
    check('the open page notices the settlement by itself', await waitStatus(page, 'is-paid'));
    check('still the same order', (await text(page, '.invoice-head b')) === id);
    await context.close();
  }

  section('Card payment: tampered amount');
  {
    const { context, page } = await cardOrder();
    await toCheckout(page);
    await outcome(page, 'tampered amount');
    check('a payment for the wrong amount is not accepted', await waitStatus(page, 'is-failed'));
    await context.close();
  }

  /* ---------------------------------------------------- static fallback */
  section('Without the API (static hosting): the original manual flow');
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    await context.route('**/api/**', route => route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>Not found</title>' }));
    const page = await context.newPage();
    await page.goto(BASE + '/?q=minimal', { waitUntil: 'load' });
    await page.waitForTimeout(3200);
    await fillWizard(page, { contact: '@alex_dev' });
    const methods = await page.locator('input[name="pm"]').evaluateAll(els => els.map(e => e.value));
    check('card payment is not offered', !methods.includes('card'), methods.join(','));
    await choose(page, 'pm', 'chat');
    await page.locator('.step-nav button[type="submit"]').click();
    await page.waitForSelector('.done', { timeout: 10000 });
    check('the order is still created locally', /^NW-\d{6}-\d{4}$/.test(await text(page, '.invoice-head b')));
    check('the customer is told to send it manually', (await text(page, '.done')).includes('isn’t sent automatically'));
    await context.close();
  }

  /* -------------------------------------------------------------- mobile */
  section('Mobile');
  {
    const { context, page, errors } = await open(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    check('wordmark is stacked on two lines', (await page.locator('.wm-line').count()) === 2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check('no horizontal overflow', overflow <= 1, `overflow ${overflow}px`);
    await page.screenshot({ path: path.join(OUT, '10-mobile-hero.png') });
    await page.locator('.menu-btn').click();
    await page.waitForTimeout(900);
    check('menu opens full screen', await page.locator('.menu.is-open .menu-links a').first().isVisible());
    await page.screenshot({ path: path.join(OUT, '11-mobile-menu.png') });
    await page.locator('.menu-links a[href="#order"]').click();
    await page.waitForTimeout(1600);
    check('menu link closes the menu', !(await page.locator('.menu').evaluate(el => el.classList.contains('is-open'))));
    await fillWizard(page);
    await page.screenshot({ path: path.join(OUT, '12-mobile-order.png') });
    const widths = await page.evaluate(() => [...document.querySelectorAll('main section')].map(s => s.scrollWidth - s.clientWidth));
    check('no section overflows sideways', widths.every(w => w <= 1), widths.join(','));
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  /* --------------------------------------------- every language, two sizes */
  section('Layout in all five languages');
  for (const lang of ['ru', 'uk', 'en', 'de', 'cs']) {
    for (const [label, viewport, mobile] of [['phone', { width: 360, height: 780 }, true], ['desktop', { width: 1280, height: 720 }, false]]) {
      const context = await browser.newContext({ viewport, locale: 'en-US', hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
      await context.addInitScript(l => localStorage.setItem('nw-lang', l), lang);
      const page = await context.newPage();
      await page.goto(BASE + '/?q=minimal', { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      const report = await page.evaluate(async () => {
        await document.fonts.ready;
        const out = [];
        const doc = document.documentElement.scrollWidth - window.innerWidth;
        if (doc > 1) out.push(`page +${doc}px`);
        // headings and buttons must fit the box they sit in
        for (const el of document.querySelectorAll('.h2, .mega, .plate-title, .svc h3, .skill h3, .path-card h3, .link-row .val, .btn, .choice-card b, .steps li, .lang-card .hi')) {
          const r = el.getBoundingClientRect();
          if (!r.width) continue;
          if (r.right > window.innerWidth + 1 || r.left < -1) out.push(`${el.className.split(' ')[0]} "${el.textContent.trim().slice(0, 24)}" sticks out`);
          else if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible') out.push(`${el.className.split(' ')[0]} "${el.textContent.trim().slice(0, 24)}" is clipped`);
        }
        return out;
      });
      check(`${lang} · ${label}: nothing overflows or is clipped`, report.length === 0, report.slice(0, 4).join(' | '));
      await context.close();
    }
  }

  /* ------------------------------------------------------ reduced motion */
  section('Reduced motion');
  {
    const { context, page, errors } = await open(browser, { reducedMotion: 'reduce' });
    check('no preloader', (await page.locator('.preloader').count()) === 0);
    check('no custom cursor', !(await page.evaluate(() => document.documentElement.classList.contains('has-cursor'))));
    await page.evaluate(() => document.querySelector('#services').scrollIntoView());
    await page.waitForTimeout(400);
    check('content is visible without animation', (await page.locator('#services .svc').first().evaluate(el => getComputedStyle(el.closest('.rv')).opacity)) === '1');
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  await browser.close();

  /* ------------------------------------------------------- without WebGL */
  section('Without WebGL');
  {
    const plain = await chromium.launch({ args: ['--disable-gpu', '--disable-3d-apis'] });
    const { context, page, errors } = await open(plain, {}, BASE + '/');
    check('CSS backdrop takes over', await page.evaluate(() => document.documentElement.classList.contains('no-webgl') && !!document.querySelector('.stage-fallback.is-on')));
    check('the page and the order form still work', (await page.locator('.wordmark').isVisible()) && (await page.locator('#orderForm').count()) === 1);
    const hud = await text(page, '.hud-stats');
    check('HUD says so instead of showing counters', hud.toLowerCase().includes('webgl') && !/FPS/i.test(hud), hud);
    await page.screenshot({ path: path.join(OUT, '13-no-webgl.png') });
    check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
    await plain.close();
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('Failed:\n' + failures.map(f => '  - ' + f).join('\n'));
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
