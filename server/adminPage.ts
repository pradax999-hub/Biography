/**
 * Owner panel at /api/admin — a plain server-rendered page, no scripts.
 *
 * The owner enters ADMIN_TOKEN, sees the orders and can mark a manual
 * payment (QR transfer, link, chat) as received. The token is never stored
 * in the browser: it travels in the form that is submitted, over HTTPS.
 * Everything a customer typed is escaped before it is shown.
 */
import { money } from '../shared/catalog';
import { translator } from '../shared/locales';
import type { OrderStatus } from '../shared/types';
import type { OrderRecord } from './types';

const t = translator('ru');

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
*{box-sizing:border-box}
html{color-scheme:dark}
body{margin:0;padding:28px 16px 64px;background:#050507;color:#f4f4f5;font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:980px;margin:0 auto}
h1{font-size:15px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 4px}
.mono{font:500 11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.12em;text-transform:uppercase;color:#85838f}
.bar{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0 26px}
.pill{padding:6px 10px;border:1px solid rgba(244,244,245,.16);font:500 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase}
.pill.ok{border-color:rgba(186,230,253,.5);color:#bae6fd}
.pill.warn{border-color:rgba(255,143,177,.55);color:#ff8fb1}
.order{border:1px solid rgba(244,244,245,.14);background:#0a0812;padding:18px;margin-bottom:12px}
.head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px 16px}
.id{font:600 15px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em}
.status{padding:4px 9px;border-radius:999px;font-size:12px;font-weight:600;background:rgba(167,139,250,.18);color:#c9b8ff}
.status.paid{background:rgba(56,189,248,.2);color:#bae6fd}
.status.failed,.status.cancelled,.status.expired{background:rgba(255,143,177,.16);color:#ff8fb1}
.rows{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 18px;margin:14px 0}
.rows div span{display:block}
.rows b{font-weight:600}
details{margin:8px 0 0}
summary{cursor:pointer;color:#bae6fd;font-size:13px}
pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0 0;padding:12px;background:#050507;border:1px solid rgba(244,244,245,.1);font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#cfced6}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
form{margin:0}
button,input[type=password]{font:inherit}
button{padding:9px 16px;border-radius:999px;border:1px solid rgba(244,244,245,.22);background:transparent;color:#f4f4f5;cursor:pointer;font-size:13px;font-weight:600}
button:hover{border-color:#a78bfa;background:rgba(124,58,237,.16)}
button.primary{background:#f4f4f5;color:#050507;border-color:#f4f4f5}
button.primary:hover{background:#bae6fd;border-color:#bae6fd}
button:focus-visible,input:focus-visible{outline:2px solid #38bdf8;outline-offset:3px}
.login{max-width:380px;margin:12vh auto 0;display:grid;gap:14px}
input[type=password]{width:100%;padding:13px 14px;border:1px solid rgba(244,244,245,.22);background:rgba(244,244,245,.05);color:#f4f4f5;font-size:16px}
.note{color:#85838f;font-size:13px}
.error{color:#ff8fb1;font-size:14px}
.empty{padding:40px 0;color:#85838f}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function adminLoginPage(message = ''): string {
  return page(
    'NIGHTWNTR · заказы',
    `<form class="login" method="post" action="/api/admin" autocomplete="off">
  <div><h1>NIGHTWNTR · заказы</h1><p class="mono">панель владельца</p></div>
  <label class="mono" for="token">ADMIN_TOKEN</label>
  <input id="token" name="token" type="password" required autofocus>
  ${message ? `<p class="error">${esc(message)}</p>` : ''}
  <button class="primary" type="submit">Войти</button>
  <p class="note">Токен задаётся в переменных окружения сайта и нигде не сохраняется в браузере.</p>
</form>`,
  );
}

export function adminDisabledPage(): string {
  return page(
    'NIGHTWNTR · заказы',
    `<div class="login"><h1>Панель выключена</h1><p class="note">Задай переменную окружения <b>ADMIN_TOKEN</b> (длинная случайная строка) и передеплой сайт.</p></div>`,
  );
}

export interface AdminInfo {
  payments: string;
  mode: string | null;
  notifications: boolean;
  store: string;
  hint: string | null;
}

const date = (iso: string): string => {
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' }).format(new Date(iso));
  } catch {
    return iso;
  }
};

function action(token: string, id: string, status: OrderStatus, label: string, primary = false): string {
  return `<form method="post" action="/api/admin"><input type="hidden" name="token" value="${esc(token)}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="status" value="${status}"><button type="submit"${primary ? ' class="primary"' : ''}>${esc(label)}</button></form>`;
}

function orderCard(o: OrderRecord, token: string): string {
  const manual = o.pm !== 'card';
  const actions: string[] = [];
  // card payments are confirmed by the provider; only manual ones are confirmed by hand
  if (manual && o.status !== 'paid') actions.push(action(token, o.id, 'paid', `Оплата получена · ${money(o.pricing.now)}`, true));
  if (manual && o.status === 'paid') actions.push(action(token, o.id, 'created', 'Вернуть в «Оформлен»'));
  if (o.status !== 'paid' && o.status !== 'cancelled') actions.push(action(token, o.id, 'cancelled', 'Отменить заказ'));
  const extras = o.pricing.lines.map(l => `${t('sum.' + l.id, { n: l.qty })} +${money(l.cost)}`).join(', ');
  const log = o.events.map(e => `${date(e.at)}  ${e.type}${e.note ? '  ' + e.note : ''}`).join('\n');

  return `<article class="order">
  <div class="head">
    <span class="id">${esc(o.id)}${o.payment.testMode ? ' · ТЕСТ' : ''}</span>
    <span class="status ${esc(o.status)}">${esc(t('st.' + o.status))}</span>
  </div>
  <div class="rows">
    <div><span class="mono">Создан</span><b>${esc(date(o.createdAt))}</b></div>
    <div><span class="mono">Услуга</span><b>${esc(t('svc.' + o.service + '.name'))}</b>${extras ? `<span>${esc(extras)}</span>` : ''}</div>
    <div><span class="mono">Итого / сейчас</span><b>${esc(money(o.pricing.total))} / ${esc(money(o.pricing.now))}</b><span>${esc(t(o.plan === 'full' ? 'sum.full' : 'sum.half'))}</span></div>
    <div><span class="mono">Оплата</span><b>${esc(t('pm.' + o.pm + '.t'))}</b>${o.payment.paidAt ? `<span>получено ${esc(date(o.payment.paidAt))}</span>` : ''}</div>
    <div><span class="mono">Клиент</span><b>${esc(o.name)}</b><span>${esc(o.contact)}</span></div>
  </div>
  <details><summary>Задача и история</summary><pre>${esc(o.details)}${o.ref ? '\n\nРеференс: ' + esc(o.ref) : ''}\n\n${esc(log)}</pre></details>
  ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}
</article>`;
}

export function adminPanelPage(orders: OrderRecord[], token: string, info: AdminInfo, message = ''): string {
  const pills = [
    `<span class="pill ${info.payments === 'off' ? 'warn' : 'ok'}">оплата картой: ${esc(info.payments)}${info.mode ? ' · ' + esc(info.mode) : ''}</span>`,
    `<span class="pill ${info.notifications ? 'ok' : 'warn'}">telegram: ${info.notifications ? 'включён' : 'не настроен'}</span>`,
    `<span class="pill">хранилище: ${esc(info.store)}</span>`,
  ];
  return page(
    'NIGHTWNTR · заказы',
    `<h1>NIGHTWNTR · заказы</h1>
<p class="mono">${orders.length} ${orders.length === 1 ? 'заказ' : 'заказов'} · время пражское</p>
<div class="bar">${pills.join('')}</div>
${info.hint ? `<p class="note">Почему оплата картой выключена: ${esc(info.hint)}</p>` : ''}
${message ? `<p class="error">${esc(message)}</p>` : ''}
<form method="post" action="/api/admin" style="margin:0 0 18px"><input type="hidden" name="token" value="${esc(token)}"><button type="submit">Обновить</button></form>
${orders.length ? orders.map(o => orderCard(o, token)).join('\n') : '<p class="empty">Заказов пока нет.</p>'}`,
  );
}
