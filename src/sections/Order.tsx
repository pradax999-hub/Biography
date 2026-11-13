/**
 * 05 — THE ORDER
 * The four-step order form from 1.0 (service → details → contact → payment),
 * its live summary, and what follows: the order reference, the invoice text,
 * and the payment — by card on the provider's page, by QR bank transfer, by
 * link, or agreed in chat.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { LANG_ADDON_MAX, SERVICES, SERVICE_IDS, addonApplies, money, type ServiceId } from '../../shared/catalog';
import { addonLabel, orderText, priceLabel } from '../../shared/orderText';
import type { OrderStatus } from '../../shared/types';
import type { PaymentMethod } from '../../shared/validation';
import { Chapter } from '../components/Chapter';
import { Icon } from '../components/Icon';
import { Reveal, SplitReveal } from '../components/Text';
import { useToast } from '../components/Toast';
import { SITE, telegramUrl } from '../config/site';
import { useI18n } from '../i18n/I18nProvider';
import { reducedMotion } from '../lib/motion';
import { STEP_COUNT, addonPriceLabel, useOrder } from '../order/OrderContext';
import { bankAmount, formatCurrency, paymentNote, qrPath, qrPayload, variableSymbol } from '../order/bank';

const SERVICE_ICON: Record<ServiceId, string> = { website: 'web', video: 'film', app: 'app' };
const PM_ICON: Record<PaymentMethod, string> = { card: 'card', qr: 'qr', link: 'card', chat: 'send' };
const PM_NOTE: Record<PaymentMethod, string> = { card: 'pay.card', qr: 'pay.qr', link: 'pay.link', chat: 'pay.manual' };

/* ------------------------------------------------------------- helpers */

function useAnimatedNumber(value: number): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const p = Math.min(1, (now - t0) / 650);
      setShown(start + (value - start) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value]);
  return shown;
}

function TestBadge() {
  const { t } = useI18n();
  return <span className="test-badge">{t('pay.test')}</span>;
}

/* -------------------------------------------------------------- wizard */

function Wizard() {
  const { t } = useI18n();
  const o = useOrder();
  const s = o.state;
  const langApplies = addonApplies('lang', s.service);
  const testMode = o.config?.payments.mode === 'test';

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (s.step < STEP_COUNT - 1) o.next();
    else o.submit();
  };

  const err = (field: 'details' | 'name' | 'contact'): string => (s.errors[field] ? t('err.' + field) : '');

  return (
    <form className="wizard" id="orderForm" noValidate onSubmit={onSubmit}>
      <ol className="steps">
        {[1, 2, 3, 4].map((n, i) => (
          <li key={n} className={i === s.step ? 'is-active' : i < s.step ? 'is-done' : ''} aria-current={i === s.step ? 'step' : undefined}>
            <span className="n">{String(n).padStart(2, '0')}</span>
            <span>{t('step.' + n)}</span>
          </li>
        ))}
      </ol>

      <fieldset className="step" hidden={s.step !== 0}>
        <legend tabIndex={-1}>{t('o.s1')}</legend>
        <div className="choices">
          {SERVICE_IDS.map(id => (
            <label className="choice" key={id}>
              <input className="sr" type="radio" name="service" value={id} checked={s.service === id} onChange={() => o.setService(id)} />
              <span className="choice-card">
                <span className="ic">
                  <Icon name={SERVICE_ICON[id]} />
                </span>
                <b>{t(`svc.${id}.name`)}</b>
                <small>{priceLabel(t, id)}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="step" hidden={s.step !== 1}>
        <legend tabIndex={-1}>{t('o.s2')}</legend>
        <div className="addons">
          <label className={`addon ${s.addons.rush ? 'is-on' : ''}`}>
            <span className="switch">
              <input type="checkbox" checked={s.addons.rush} onChange={e => o.setAddon('rush', e.target.checked)} />
              <i />
            </span>
            <span className="addon-text">
              <b>{t('ad.rush.t')}</b>
              <small>{t('ad.rush.d')}</small>
            </span>
            <span className="addon-price">{addonPriceLabel('rush')}</span>
          </label>
          <div className={`addon ${s.addons.lang > 0 ? 'is-on' : ''}`} hidden={!langApplies}>
            <span className="addon-text">
              <b>{t('ad.lang.t')}</b>
              <small>{t('ad.lang.d')}</small>
            </span>
            <span className="addon-price">{addonPriceLabel('lang')}</span>
            <span className="stepper">
              <button type="button" aria-label={t('ad.lang.minus')} disabled={s.addons.lang <= 0} onClick={() => o.stepLang(-1)}>
                −
              </button>
              <output aria-live="polite">{s.addons.lang}</output>
              <button type="button" aria-label={t('ad.lang.plus')} disabled={s.addons.lang >= LANG_ADDON_MAX} onClick={() => o.stepLang(1)}>
                +
              </button>
            </span>
          </div>
          <label className={`addon ${s.addons.support ? 'is-on' : ''}`}>
            <span className="switch">
              <input type="checkbox" checked={s.addons.support} onChange={e => o.setAddon('support', e.target.checked)} />
              <i />
            </span>
            <span className="addon-text">
              <b>{t('ad.support.t')}</b>
              <small>{t('ad.support.d')}</small>
            </span>
            <span className="addon-price">{addonPriceLabel('support')}</span>
          </label>
        </div>
        <div className="fields">
          <div className="field">
            <label htmlFor="f-details">{t('f.details')}</label>
            <textarea
              id="f-details"
              value={s.details}
              placeholder={t('f.details.ph')}
              aria-invalid={!!s.errors.details}
              aria-describedby="err-details"
              maxLength={4000}
              onChange={e => o.setField('details', e.target.value)}
            />
            <span className="err" id="err-details" aria-live="polite">
              {err('details')}
            </span>
          </div>
          <div className="field">
            <label htmlFor="f-ref">{t('f.ref')}</label>
            <input id="f-ref" type="text" inputMode="url" autoComplete="off" placeholder="https://" value={s.ref} maxLength={500} onChange={e => o.setField('ref', e.target.value)} />
          </div>
        </div>
      </fieldset>

      <fieldset className="step" hidden={s.step !== 2}>
        <legend tabIndex={-1}>{t('o.s3')}</legend>
        <div className="two">
          <div className="field">
            <label htmlFor="f-name">{t('f.name')}</label>
            <input
              id="f-name"
              type="text"
              autoComplete="name"
              placeholder={t('f.name.ph')}
              value={s.name}
              maxLength={80}
              aria-invalid={!!s.errors.name}
              aria-describedby="err-name"
              onChange={e => o.setField('name', e.target.value)}
            />
            <span className="err" id="err-name" aria-live="polite">
              {err('name')}
            </span>
          </div>
          <div className="field">
            <label htmlFor="f-contact">{t('f.contact')}</label>
            <input
              id="f-contact"
              type="text"
              autoComplete="email"
              placeholder={t('f.contact.ph')}
              value={s.contact}
              maxLength={120}
              aria-invalid={!!s.errors.contact}
              aria-describedby="err-contact"
              onChange={e => o.setField('contact', e.target.value)}
            />
            <span className="err" id="err-contact" aria-live="polite">
              {err('contact')}
            </span>
          </div>
        </div>
        {/* honeypot: hidden from people and assistive technology */}
        <div className="hp" aria-hidden="true">
          <label htmlFor="f-company">Company</label>
          <input id="f-company" type="text" name="company" tabIndex={-1} autoComplete="off" defaultValue="" />
        </div>
      </fieldset>

      <fieldset className="step" hidden={s.step !== 3}>
        <legend tabIndex={-1}>{t('o.s4')}</legend>
        <div className="choices cols-2">
          {(['half', 'full'] as const).map(id => (
            <label className="choice" key={id}>
              <input className="sr" type="radio" name="plan" value={id} checked={s.plan === id} onChange={() => o.setPlan(id)} />
              <span className="choice-card">
                <b>{t(`plan.${id}.t`)}</b>
                <small>{t(`plan.${id}.d`)}</small>
              </span>
            </label>
          ))}
        </div>
        {o.methods.length > 1 && (
          <>
            <p className="pm-title" id="pmTitle">
              {t('pm.title')}
            </p>
            <div className={`choices pm-choices n-${o.methods.length}`} role="radiogroup" aria-labelledby="pmTitle">
              {o.methods.map(pm => (
                <label className="choice" key={pm}>
                  <input className="sr" type="radio" name="pm" value={pm} checked={s.pm === pm} onChange={() => o.setPm(pm)} />
                  <span className="choice-card">
                    <span className="ic">
                      <Icon name={PM_ICON[pm]} />
                    </span>
                    <b>{t(`pm.${pm}.t`)}</b>
                    <small>{t(`pm.${pm}.d`)}</small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        <p className="pay-note">
          <Icon name={s.pm === 'card' ? 'lock' : 'card'} />
          <span>{t(PM_NOTE[s.pm])}</span>
        </p>
        {s.pm === 'card' && testMode && <TestBadge />}
      </fieldset>

      <div className="step-nav">
        <div className="grow">
          <span>{t('sum.total')}</span>
          <b>{money(o.pricing.total)}</b>
        </div>
        {s.step > 0 && (
          <button type="button" className="btn btn-ghost" onClick={o.prev} disabled={s.submitting}>
            <span>{t('btn.back')}</span>
          </button>
        )}
        {/* distinct keys: "Next" must never turn into the submit button in place,
            or the click that reaches the last step would also submit the form */}
        {s.step < STEP_COUNT - 1 ? (
          <button key="next" type="button" className="btn btn-primary" onClick={o.next}>
            <span>{t('btn.next')}</span>
            <Icon name="arrow" className="arrow" />
          </button>
        ) : (
          <button key="submit" type="submit" className="btn btn-primary" disabled={s.submitting}>
            <span>{s.submitting ? t('btn.sending') : t(s.pm === 'card' ? 'co.go' : 'btn.submit')}</span>
            <Icon name="arrow" className="arrow" />
          </button>
        )}
      </div>
    </form>
  );
}

/* --------------------------------------------------------- bank / QR */

function BankTransfer() {
  const { t, locale } = useI18n();
  const { copy } = useToast();
  const o = useOrder();
  const bank = o.bank;
  const orderId = o.state.orderId;

  const view = useMemo(() => {
    if (!bank || !orderId) return null;
    const amount = bankAmount(bank, o.pricing.now);
    const amountText = formatCurrency(amount.value, amount.cur, locale._locale);
    const payload = qrPayload(bank, amount, orderId, SITE.telegram);
    return { amount, amountText, payload, qr: payload ? qrPath(payload) : null };
  }, [bank, orderId, o.pricing.now, locale._locale]);
  if (!bank || !orderId || !view) return null;

  const { amount, amountText, payload, qr } = view;
  const usd = money(o.pricing.now);
  const rate = Number(bank.rate).toLocaleString(locale._locale);
  const sentMessage = t('pay.sent.msg', { order: orderId, amount: amount.cur === 'USD' ? amountText : `${amountText} (${usd})` });

  const rows: Array<{ label: string; value: string; note?: string; shown?: string }> = [
    { label: t('pay.f.amount'), value: String(amount.value), shown: amountText, note: amount.cur === 'USD' ? undefined : t('pay.rate', { usd, rate }) },
    { label: t('pay.f.name'), value: bank.name },
  ];
  if (bank.account) rows.push({ label: t('pay.f.account'), value: bank.account });
  rows.push({ label: t('pay.f.iban'), value: bank.iban });
  if (bank.bic) rows.push({ label: t('pay.f.bic'), value: bank.bic });
  if (bank.qr === 'spd') rows.push({ label: t('pay.f.vs'), value: variableSymbol(orderId) });
  rows.push({ label: t('pay.f.msg'), value: paymentNote(orderId, SITE.telegram) });

  return (
    <div className="pay">
      <div className="pay-head">
        <h4>{t(payload ? 'pay.qr.title' : 'pay.bank.title')}</h4>
        {bank.demo && <span className="pay-demo">{t(o.bankError ? 'pay.badcfg' : 'pay.demo')}</span>}
      </div>
      <div className="pay-grid">
        {qr && (
          <div className="qr-card">
            {/* scanners need dark modules on white, whatever the page theme */}
            <svg className="qr" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={`QR ${amountText}`}>
              <rect width={qr.size} height={qr.size} fill="#ffffff" />
              <path d={qr.d} fill="#050507" />
            </svg>
          </div>
        )}
        <div className="pay-info">
          <p className="pay-how">{t(qr ? 'pay.qr.how' : payload ? 'pay.noqr' : 'pay.bank.how')}</p>
          <dl className="pay-fields">
            {rows.map(row => (
              <div className="pf" key={row.label}>
                <dt>{row.label}</dt>
                <dd>
                  <span className="pf-v">
                    {row.shown ?? row.value}
                    {row.note && <small>{row.note}</small>}
                  </span>
                  <button type="button" aria-label={`${t('btn.copy')}: ${row.label}`} data-cursor={t('cur.copy')} onClick={e => void copy(row.value, t('toast.copied'), e.currentTarget.previousElementSibling as HTMLElement)}>
                    <Icon name="copy" />
                  </button>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="pay-actions">
        <a className="btn btn-primary" href={telegramUrl(sentMessage)} target="_blank" rel="noopener" onClick={() => void copy(sentMessage, t('toast.sent'))}>
          <Icon name="check" />
          <span>{t('pay.sent')}</span>
        </a>
        <p className="sum-foot">{t('pay.check')}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ card payment */

const STATUS_ICON: Record<OrderStatus, string> = {
  created: 'lock',
  awaiting_payment: 'lock',
  pending: 'clock',
  paid: 'check',
  failed: 'cross',
  cancelled: 'cross',
  expired: 'clock',
};

function PaymentStatus() {
  const { t } = useI18n();
  const o = useOrder();
  const { order, checking, paying } = o.state;
  if (!order) return null;
  const status = order.status;
  const isCard = order.pm === 'card';
  // manual orders only get this block once the owner has confirmed the money
  if (!isCard && status !== 'paid') return null;

  const amount = money(order.payment.amountPaid ?? order.pricing.now);
  const payable = status === 'created' || status === 'awaiting_payment' || status === 'failed' || status === 'cancelled' || status === 'expired';
  const fresh = status === 'created' || status === 'awaiting_payment';

  let title = t('pm.card.t');
  let text = t('pay.card');
  if (checking) {
    title = t('stm.checking');
    text = t('co.secure');
  } else if (!fresh) {
    title = t(`stm.${status}.title`);
    text = t(`stm.${status}.text`, { order: order.id, amount });
  }

  return (
    <div className={`pay-status is-${checking ? 'checking' : status}`} role="status" aria-live="polite">
      <div className="ps-head">
        <span className="ps-icon">{checking ? <i className="spinner" /> : <Icon name={STATUS_ICON[status]} />}</span>
        <div>
          <h4>{title}</h4>
          <p>{text}</p>
        </div>
      </div>
      {isCard && payable && !checking && (
        <div className="ps-actions">
          <button type="button" className="btn btn-primary btn-pay" onClick={o.pay} disabled={paying}>
            <Icon name="lock" />
            <span>{paying ? t('co.redirect') : fresh || status === 'cancelled' ? t('done.pay', { amount }) : t('btn.retry')}</span>
            <Icon name="arrow" className="arrow" />
          </button>
        </div>
      )}
      {(status === 'pending' || checking) && (
        <div className="ps-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={o.refresh}>
            {t('btn.refresh')}
          </button>
        </div>
      )}
      {isCard && status !== 'paid' && (
        <p className="ps-secure">
          <Icon name="lock" />
          <span>{t('co.secure')}</span>
        </p>
      )}
      {order.payment.testMode && <TestBadge />}
    </div>
  );
}

/* ---------------------------------------------------------------- done */

function Done() {
  const { t, locale } = useI18n();
  const { copy } = useToast();
  const o = useOrder();
  const s = o.state;
  const invoiceRef = useRef<HTMLPreElement>(null);

  if (s.lost) {
    return (
      <div className="done">
        <div className="done-head">
          <span className="check is-warn">
            <Icon name="cross" />
          </span>
          <div>
            <h3 tabIndex={-1}>{s.orderId}</h3>
            <p>{t('stm.lost')}</p>
          </div>
        </div>
        <div className="done-actions">
          <a className="btn btn-ghost" href={telegramUrl()} target="_blank" rel="noopener">
            <Icon name="send" />
            <span>Telegram</span>
          </a>
          <button type="button" className="btn btn-ghost" onClick={o.reset}>
            {t('done.new')}
          </button>
        </div>
      </div>
    );
  }

  const text = orderText(t, { id: s.orderId, service: s.service, addons: s.addons, plan: s.plan, pm: s.pm, pricing: o.pricing, name: s.name, contact: s.contact, details: s.details, ref: s.ref });
  const date = new Intl.DateTimeFormat(locale._locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(s.createdAt ? new Date(s.createdAt) : new Date());
  const notified = !!s.order?.notified;
  const payLink = SITE.payLink && s.pm === 'link' ? SITE.payLink.replace('{amount}', String(o.pricing.now)).replace('{order}', encodeURIComponent(s.orderId || '')) : '';

  return (
    <div className="done" id="done">
      <div className="done-head">
        <span className="check">
          <Icon name="check" />
        </span>
        <div>
          <h3 tabIndex={-1}>{t('done.title')}</h3>
          <p>{t(notified ? 'done.sent' : 'done.text')}</p>
        </div>
      </div>

      <PaymentStatus />

      <div className="invoice">
        <div className="invoice-head">
          <span>
            <span>{t('inv.no')}</span> <b>{s.orderId}</b>
          </span>
          <span>
            <span>{t('inv.date')}</span> <b>{date}</b>
          </span>
        </div>
        <pre ref={invoiceRef}>{text}</pre>
      </div>

      {s.pm === 'qr' && s.order?.status !== 'paid' && <BankTransfer />}

      <div className="done-actions">
        <button type="button" className="btn btn-primary" data-cursor={t('cur.copy')} onClick={() => void copy(text, t('toast.order'), invoiceRef.current)}>
          <Icon name="copy" />
          <span>{t('done.copy')}</span>
        </button>
        <a className="btn btn-ghost" href={telegramUrl(text)} target="_blank" rel="noopener" onClick={() => void copy(text, t('toast.order'))}>
          <Icon name="send" />
          <span>{t('done.tg')}</span>
        </a>
        {payLink && (
          <a className="btn btn-ghost" href={payLink} target="_blank" rel="noopener">
            <Icon name="card" />
            <span>{t('done.pay', { amount: money(o.pricing.now) })}</span>
          </a>
        )}
      </div>
      <p className="mail-line">
        <span>{t('done.mail')}</span>
        <code className="mail-addr">{SITE.email}</code>
        <button type="button" className="link-btn" onClick={e => void copy(SITE.email, t('toast.copied'), e.currentTarget.previousElementSibling as HTMLElement)}>
          {t('btn.copy')}
        </button>
      </p>
      {!notified && <p className="sum-foot">{t('done.note')}</p>}
      <div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={o.reset}>
          {t('done.new')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- summary */

function Summary() {
  const { t } = useI18n();
  const o = useOrder();
  const s = o.state;
  const total = useAnimatedNumber(o.pricing.total);
  const status = s.order?.status;

  return (
    <aside className="panel summary" aria-live="polite">
      <h3>
        <span>{t('sum.title')}</span>
        <span className="sum-id">{s.orderId || t('sum.draft')}</span>
      </h3>
      <ul className="sum-rows">
        <li>
          <span>{t(`svc.${s.service}.name`)}</span>
          <b>{priceLabel(t, s.service)}</b>
        </li>
        {o.pricing.lines.map(line => (
          <li key={line.id}>
            <span>{addonLabel(t, line)}</span>
            <b>+{money(line.cost)}</b>
          </li>
        ))}
      </ul>
      <div className="sum-total">
        <span>{t('sum.total')}</span>
        <b>{money(total)}</b>
      </div>
      <div className="sum-now">
        <span>{`${t('sum.now')} · ${s.plan === 'full' ? '100%' : '50%'}`}</span>
        <b>{money(o.pricing.now)}</b>
      </div>
      {status && (
        <div className={`sum-status is-${status}`}>
          <span>{t('sum.status')}</span>
          <b>
            <i />
            {t('st.' + status)}
          </b>
        </div>
      )}
      {SERVICES[s.service].from && <p className="sum-foot">{t('sum.foot')}</p>}
    </aside>
  );
}

/* ------------------------------------------------------------- section */

export function Order() {
  const { t } = useI18n();
  const { state } = useOrder();

  return (
    <section className="section order-section" id="order" data-scene="order">
      <div className="wrap">
        <Chapter index="05" name="The Order" label={t('order.eyebrow')} />
        <SplitReveal html={t('order.title')} className="h2" />
        <Reveal as="p" className="sub">
          {t('order.sub')}
        </Reveal>
        <Reveal as="ol" className="how">
          {[1, 2, 3, 4].map(n => (
            <li key={n} style={{ '--i': n - 1 } as CSSProperties}>
              <span className="n">{String(n).padStart(2, '0')}</span>
              <span>{t('how.' + n)}</span>
            </li>
          ))}
        </Reveal>
        <div className="order-grid">
          <Reveal className="panel order-panel">{state.done ? <Done /> : <Wizard />}</Reveal>
          <Summary />
        </div>
      </div>
    </section>
  );
}
