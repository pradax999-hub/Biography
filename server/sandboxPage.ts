/**
 * The sandbox provider's "hosted checkout page". Plain server-rendered HTML,
 * no scripts, no external requests. It exists only to test the order flow.
 */
import { money } from '../shared/catalog';
import { translator } from '../shared/locales';
import type { OrderRecord } from './types';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:#050507;color:#f4f4f5;
  font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background-image:radial-gradient(60% 50% at 80% 0%,rgba(124,58,237,.22),transparent 70%),radial-gradient(50% 40% at 0% 100%,rgba(56,189,248,.14),transparent 70%)}
main{width:100%;max-width:460px}
.banner{font:600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;
  color:#050507;background:#bae6fd;padding:10px 14px;border-radius:3px 3px 0 0}
.card{border:1px solid rgba(244,244,245,.14);border-top:0;background:#0a0812;padding:28px 24px 24px;border-radius:0 0 3px 3px}
.mono{font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:#85838f}
h1{font-size:15px;font-weight:600;margin:6px 0 20px;letter-spacing:.02em}
.amount{font-size:44px;font-weight:600;letter-spacing:-.03em;line-height:1;margin:6px 0 4px}
.rows{margin:22px 0;padding:0;border-top:1px solid rgba(244,244,245,.1)}
.rows div{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid rgba(244,244,245,.1);font-size:14px}
.rows dt{color:#85838f}.rows dd{margin:0;text-align:right}
form{margin:0}
button{width:100%;font:inherit;font-weight:600;padding:14px 18px;border-radius:999px;border:1px solid rgba(244,244,245,.2);
  background:transparent;color:#f4f4f5;cursor:pointer;margin-top:10px;transition:background .2s,border-color .2s}
button:hover{border-color:#a78bfa;background:rgba(124,58,237,.14)}
button.primary{background:#f4f4f5;color:#050507;border-color:#f4f4f5}
button.primary:hover{background:#bae6fd;border-color:#bae6fd}
button.quiet{border-color:transparent;color:#85838f;font-weight:500}
button:focus-visible{outline:2px solid #38bdf8;outline-offset:3px}
.note{font-size:13px;color:#85838f;margin:18px 0 0}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<div class="banner">Test mode · sandbox checkout · no real money moves</div>
<div class="card">${body}</div>
</main>
</body>
</html>`;
}

const action = (sessionId: string, outcome: string, label: string, cls = ''): string =>
  `<form method="post" action="/api/sandbox/complete"><input type="hidden" name="s" value="${esc(sessionId)}"><input type="hidden" name="outcome" value="${outcome}"><button type="submit"${cls ? ` class="${cls}"` : ''}>${esc(label)}</button></form>`;

export function sandboxCheckoutPage(order: OrderRecord, sessionId: string): string {
  const t = translator(order.lang);
  const state = order.payment.sessionId === sessionId ? (order.payment.sandboxState ?? 'open') : 'expired';
  const head = `
<p class="mono">NIGHTWNTR · ${esc(order.id)}</p>
<h1>${esc(t('svc.' + order.service + '.name'))} — ${esc(t(order.plan === 'full' ? 'sum.full' : 'sum.half'))}</h1>
<p class="mono">${esc(t('sum.now'))}</p>
<p class="amount">${esc(money(order.pricing.now))}</p>
<dl class="rows">
  <div><dt>${esc(t('msg.total'))}</dt><dd>${esc(money(order.pricing.total))}</dd></div>
  <div><dt>${esc(t('sum.status'))}</dt><dd>${esc(t('st.' + order.status))}</dd></div>
</dl>`;

  if (state === 'open') {
    return page(
      `Sandbox checkout · ${order.id}`,
      head +
        action(sessionId, 'paid', `Simulate successful payment of ${money(order.pricing.now)}`, 'primary') +
        action(sessionId, 'pending', 'Simulate a payment that stays pending') +
        action(sessionId, 'failed', 'Simulate a failed payment') +
        action(sessionId, 'mismatch', 'Simulate a tampered amount (must be rejected)') +
        action(sessionId, 'cancel', 'Cancel and return to the site', 'quiet') +
        `<p class="note">Each button sends a signed webhook to this site, exactly like a real provider would, and then returns you to the order.</p>`,
    );
  }
  if (state === 'pending') {
    return page(
      `Sandbox checkout · ${order.id}`,
      head +
        action(sessionId, 'settle_ok', 'Settle the pending payment: success', 'primary') +
        action(sessionId, 'settle_fail', 'Settle the pending payment: failure') +
        action(sessionId, 'return', 'Return to the site', 'quiet'),
    );
  }
  return page(
    `Sandbox checkout · ${order.id}`,
    head + `<p class="note">This checkout session is closed (${esc(state)}).</p>` + action(sessionId, 'return', 'Return to the site', 'primary'),
  );
}

export function sandboxMessagePage(message: string): string {
  return page('Sandbox checkout', `<p class="mono">NIGHTWNTR</p><h1>${esc(message)}</h1><p class="note"><a href="/" style="color:#bae6fd">Back to the site</a></p>`);
}
