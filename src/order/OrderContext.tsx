/**
 * Order state: the four-step wizard, live pricing, the draft, submission and
 * what happens after it (checkout, verification, status).
 *
 * The rules of 1.0 are kept: same steps, same fields, same validation, same
 * prices, same draft key in localStorage. What is new is the server: when
 * the API is reachable the order is stored and priced there, the owner is
 * notified automatically and card payments are verified server-side. When it
 * is not reachable, the wizard falls back to the original manual flow.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ADDONS, LANG_ADDON_MAX, SERVICES, addonApplies, calcPrice, type AddonSelection, type PlanId, type Pricing, type ServiceId } from '../../shared/catalog';
import type { PublicConfig, PublicOrder } from '../../shared/types';
import { contactOk, detailsOk, nameOk, type FieldError, type PaymentMethod } from '../../shared/validation';
import { useToast } from '../components/Toast';
import { SITE } from '../config/site';
import { useI18n } from '../i18n/I18nProvider';
import { emit } from '../lib/bus';
import { reducedMotion, scrollToTarget } from '../lib/motion';
import { store } from '../lib/store';
import { ApiFailure, cancelCheckout, createOrder, fetchConfig, fetchOrder, startCheckout } from './api';
import { DEMO_BANK, readBank, type ReadyBank } from './bank';

export const STEP_COUNT = 4;
type TextField = 'details' | 'ref' | 'name' | 'contact';

export interface OrderState {
  step: number;
  service: ServiceId;
  plan: PlanId;
  pm: PaymentMethod;
  addons: AddonSelection;
  details: string;
  ref: string;
  name: string;
  contact: string;
  errors: Partial<Record<FieldError, boolean>>;
  done: boolean;
  orderId: string | null;
  /** the server's copy; null in the manual (offline) flow */
  order: PublicOrder | null;
  token: string | null;
  createdAt: string | null;
  submitting: boolean;
  paying: boolean;
  /** waiting for the server to confirm a payment after coming back from checkout */
  checking: boolean;
  /** an order link was opened but the order could not be loaded */
  lost: boolean;
}

interface OrderApi {
  state: OrderState;
  config: PublicConfig | null;
  bank: ReadyBank | null;
  bankError: boolean;
  methods: PaymentMethod[];
  pricing: Pricing;
  setService: (id: ServiceId) => void;
  setPlan: (id: PlanId) => void;
  setPm: (pm: PaymentMethod) => void;
  setAddon: (id: 'rush' | 'support', on: boolean) => void;
  stepLang: (delta: number) => void;
  setField: (field: TextField, value: string) => void;
  next: () => void;
  prev: () => void;
  submit: () => void;
  reset: () => void;
  /** choose a service from elsewhere on the page and jump to the form */
  pick: (id: ServiceId) => void;
  pay: () => void;
  refresh: () => void;
}

const Ctx = createContext<OrderApi | null>(null);

const DRAFT_KEY = 'nw-draft';
const tokenKey = (id: string): string => `nw-order:${id}`;
const isDemo = (): boolean => typeof location !== 'undefined' && location.hash === '#paydemo';

const initial: OrderState = {
  step: 0,
  service: 'website',
  plan: 'half',
  pm: 'chat',
  addons: { rush: false, lang: 0, support: false },
  details: '',
  ref: '',
  name: '',
  contact: '',
  errors: {},
  done: false,
  orderId: null,
  order: null,
  token: null,
  createdAt: null,
  submitting: false,
  paying: false,
  checking: false,
  lost: false,
};

function loadDraft(): { state: OrderState; pmFromDraft: boolean } {
  const state: OrderState = { ...initial, addons: { ...initial.addons } };
  let pmFromDraft = false;
  try {
    const d = JSON.parse(store.get(DRAFT_KEY) || 'null') as Record<string, unknown> | null;
    if (d) {
      if (typeof d.service === 'string' && d.service in SERVICES) state.service = d.service as ServiceId;
      state.plan = d.plan === 'full' ? 'full' : 'half';
      const a = d.addons as Record<string, unknown> | undefined;
      if (a && typeof a === 'object') {
        state.addons.rush = !!a.rush;
        state.addons.support = !!a.support;
        state.addons.lang = Math.min(LANG_ADDON_MAX, Math.max(0, Number(a.lang) | 0));
      }
      for (const k of ['details', 'ref', 'name', 'contact'] as const) if (typeof d[k] === 'string') state[k] = d[k] as string;
      if (typeof d.pm === 'string') {
        state.pm = d.pm as PaymentMethod;
        pmFromDraft = true;
      }
    }
  } catch {
    /* broken draft: start clean */
  }
  return { state, pmFromDraft };
}

/** NW-YYMMDD-NNNN: digits only, so the id doubles as the bank variable symbol. */
function makeLocalId(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `NW-${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}-${rnd}`;
}

export function OrderProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const [boot] = useState(loadDraft);
  const [state, setState] = useState<OrderState>(boot.state);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const pmChosen = useRef(boot.pmFromDraft);
  const stateRef = useRef(state);
  stateRef.current = state;

  /* what can be paid with ---------------------------------------------- */
  const bankRead = useMemo(() => readBank(SITE.bank), []);
  const bankError = bankRead === 'error';
  const bank = useMemo<ReadyBank | null>(() => {
    if (bankRead && bankRead !== 'error') return bankRead;
    return isDemo() ? { ...DEMO_BANK, rate: Number(SITE.bank?.rate) || DEMO_BANK.rate } : null;
  }, [bankRead]);

  const methods = useMemo<PaymentMethod[]>(() => {
    const list: PaymentMethod[] = [];
    if (config?.payments.provider) list.push('card');
    if (bank) list.push('qr');
    if (SITE.payLink) list.push('link');
    list.push('chat');
    return list;
  }, [config, bank]);

  // the first available method is the default until the visitor picks one
  useEffect(() => {
    setState(s => {
      if (s.done) return s;
      if (methods.includes(s.pm) && pmChosen.current) return s;
      return s.pm === methods[0] ? s : { ...s, pm: methods[0] };
    });
  }, [methods]);

  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then(c => alive && setConfig(c))
      .catch(() => undefined); // no API: manual flow only
    return () => {
      alive = false;
    };
  }, []);

  /* draft --------------------------------------------------------------- */
  useEffect(() => {
    if (state.done) return;
    const { service, plan, pm, addons, details, ref, name, contact } = state;
    // the payment method is only remembered once the visitor has actually chosen one
    store.set(DRAFT_KEY, JSON.stringify({ service, plan, pm: pmChosen.current ? pm : undefined, addons, details, ref, name, contact }));
  }, [state]);

  const pricing = useMemo(() => state.order?.pricing ?? calcPrice(state.service, state.addons, state.plan), [state.order, state.service, state.addons, state.plan]);

  /* field changes ------------------------------------------------------- */
  const setService = useCallback((service: ServiceId) => setState(s => ({ ...s, service })), []);
  const setPlan = useCallback((plan: PlanId) => setState(s => ({ ...s, plan })), []);
  const setPm = useCallback((pm: PaymentMethod) => {
    pmChosen.current = true;
    setState(s => ({ ...s, pm }));
  }, []);
  const setAddon = useCallback((id: 'rush' | 'support', on: boolean) => setState(s => ({ ...s, addons: { ...s.addons, [id]: on } })), []);
  const stepLang = useCallback(
    (delta: number) => setState(s => ({ ...s, addons: { ...s.addons, lang: Math.min(LANG_ADDON_MAX, Math.max(0, s.addons.lang + delta)) } })),
    [],
  );
  const setField = useCallback(
    (field: TextField, value: string) =>
      setState(s => {
        const errors = field in s.errors ? { ...s.errors, [field]: false } : s.errors;
        return { ...s, [field]: value, errors };
      }),
    [],
  );

  /* steps --------------------------------------------------------------- */
  const validate = (s: OrderState, step: number): Partial<Record<FieldError, boolean>> => {
    if (step === 1) return detailsOk(s.details) ? {} : { details: true };
    if (step === 2) {
      const e: Partial<Record<FieldError, boolean>> = {};
      if (!nameOk(s.name)) e.name = true;
      if (!contactOk(s.contact)) e.contact = true;
      return e;
    }
    return {};
  };
  const focusField = (field: FieldError): void => {
    requestAnimationFrame(() => document.getElementById(`f-${field}`)?.focus());
  };
  const focusStep = (): void => {
    requestAnimationFrame(() => {
      const legend = document.querySelector<HTMLElement>('.wizard .step:not([hidden]) legend');
      legend?.focus({ preventScroll: true });
      const panel = document.querySelector('.order-panel');
      if (panel && panel.getBoundingClientRect().top < 70) scrollToTarget(panel as HTMLElement, 110);
    });
  };

  const next = useCallback(() => {
    const s = stateRef.current;
    const errors = validate(s, s.step);
    const first = (Object.keys(errors) as FieldError[])[0];
    if (first) {
      setState(v => ({ ...v, errors: { ...v.errors, ...errors } }));
      focusField(first === 'name' || first === 'contact' ? (errors.name ? 'name' : 'contact') : first);
      return;
    }
    setState(v => ({ ...v, step: Math.min(STEP_COUNT - 1, v.step + 1) }));
    focusStep();
  }, []);

  const prev = useCallback(() => {
    setState(v => ({ ...v, step: Math.max(0, v.step - 1) }));
    focusStep();
  }, []);

  /* submit -------------------------------------------------------------- */
  const finish = (patch: Partial<OrderState>): void => {
    setState(v => ({ ...v, ...patch, done: true, submitting: false }));
    emit('burst', 1);
    requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.order-panel');
      if (panel && panel.getBoundingClientRect().top < 70) scrollToTarget(panel, 110);
      document.querySelector<HTMLElement>('.done h3')?.focus({ preventScroll: true });
    });
  };

  const submit = useCallback(() => {
    const s = stateRef.current;
    if (s.submitting || s.done) return;
    // steps 2 and 3 can be skipped with a restored draft: check them again
    for (const step of [1, 2]) {
      const errors = validate(s, step);
      const keys = Object.keys(errors) as FieldError[];
      if (keys.length) {
        setState(v => ({ ...v, step, errors: { ...v.errors, ...errors } }));
        focusField(errors.details ? 'details' : errors.name ? 'name' : 'contact');
        return;
      }
    }
    setState(v => ({ ...v, submitting: true }));

    const addons: AddonSelection = { rush: s.addons.rush, support: s.addons.support, lang: addonApplies('lang', s.service) ? s.addons.lang : 0 };
    // honeypot: a field people never see; bots fill it in and the server rejects them
    const company = (document.getElementById('f-company') as HTMLInputElement | null)?.value || '';
    createOrder({ service: s.service, addons, plan: s.plan, pm: s.pm, details: s.details, ref: s.ref, name: s.name, contact: s.contact, lang, company })
      .then(({ order, token }) => {
        store.set(tokenKey(order.id), token);
        finish({ order, token, orderId: order.id, createdAt: order.createdAt });
      })
      .catch((err: unknown) => {
        const failure = err instanceof ApiFailure ? err : new ApiFailure(0, 'network');
        if (failure.status === 400 && failure.field) {
          const field = failure.field as FieldError;
          setState(v => ({ ...v, submitting: false, step: field === 'details' ? 1 : 2, errors: { ...v.errors, [field]: true } }));
          focusField(field);
          return;
        }
        if (failure.status === 429) {
          setState(v => ({ ...v, submitting: false }));
          toast(t('err.rate'));
          return;
        }
        if (s.pm === 'card') {
          // a card payment needs the server; do not pretend
          setState(v => ({ ...v, submitting: false }));
          toast(t(failure.code === 'card_unavailable' || failure.unreachable ? 'err.card' : 'err.order'));
          return;
        }
        if (failure.unreachable || failure.status >= 500 || failure.status === 404) {
          // no server: the original manual flow still works
          finish({ order: null, token: null, orderId: makeLocalId(), createdAt: new Date().toISOString() });
          return;
        }
        setState(v => ({ ...v, submitting: false }));
        toast(t('err.order'));
      });
  }, [lang, t, toast]);

  const reset = useCallback(() => {
    pmChosen.current = false;
    setState(v => ({
      ...v,
      done: false,
      orderId: null,
      order: null,
      token: null,
      createdAt: null,
      details: '',
      ref: '',
      step: 0,
      errors: {},
      paying: false,
      checking: false,
      lost: false,
      pm: methods[0],
    }));
    focusStep();
  }, [methods]);

  const pick = useCallback((id: ServiceId) => {
    if (!SERVICES[id]) return;
    setState(v => {
      const base = v.done ? { ...v, done: false, orderId: null, order: null, token: null, createdAt: null, details: '', ref: '', paying: false, checking: false, lost: false } : v;
      return { ...base, service: id, step: 0, errors: {} };
    });
  }, []);

  /* checkout ------------------------------------------------------------ */
  const pay = useCallback(() => {
    const s = stateRef.current;
    if (!s.order || !s.token || s.paying) return;
    setState(v => ({ ...v, paying: true }));
    startCheckout(s.order.id, s.token)
      .then(({ url }) => {
        // leave for the provider's hosted page
        window.location.assign(url);
      })
      .catch((err: unknown) => {
        const code = err instanceof ApiFailure ? err.code : 'network';
        setState(v => ({ ...v, paying: false }));
        if (code === 'already_paid' || code === 'payment_pending') {
          toast(t(code === 'already_paid' ? 'err.paid' : 'stm.checking'));
          refreshRef.current();
        } else if (code === 'rate_limited') toast(t('err.rate'));
        else toast(t('err.card'));
      });
  }, [t, toast]);

  const refreshRef = useRef<() => void>(() => undefined);
  const refresh = useCallback(() => {
    const s = stateRef.current;
    if (!s.order || !s.token) return;
    fetchOrder(s.order.id, { token: s.token })
      .then(order => setState(v => (v.order?.id === order.id ? { ...v, order } : v)))
      .catch(() => undefined);
  }, []);
  refreshRef.current = refresh;

  /* coming back from the payment page, or opening an order link ---------- */
  // read once, at mount: the effect below cleans the address bar, and must still
  // know what was in it if React runs the effect a second time (StrictMode)
  const [arrival] = useState(() => {
    const params = new URLSearchParams(location.search);
    return { id: params.get('order'), outcome: params.get('checkout'), sessionId: params.get('session_id') };
  });
  useEffect(() => {
    const { id, outcome, sessionId } = arrival;
    if (!id) return;
    const token = store.get(tokenKey(id));
    // the address bar should not keep payment parameters around
    history.replaceState(null, '', location.pathname + '#order');

    let alive = true;
    const apply = (order: PublicOrder, checking: boolean): void => {
      if (!alive) return;
      setState(v => ({
        ...v,
        done: true,
        step: STEP_COUNT - 1,
        order,
        token,
        orderId: order.id,
        createdAt: order.createdAt,
        service: order.service,
        plan: order.plan,
        pm: order.pm,
        addons: order.addons,
        details: order.details,
        ref: order.ref,
        name: order.name,
        contact: order.contact,
        checking,
        lost: false,
      }));
    };
    const waiting = (o: PublicOrder): boolean => outcome === 'success' && (o.status === 'awaiting_payment' || o.status === 'created');

    const load = async (): Promise<void> => {
      try {
        let order = await fetchOrder(id, { token, sessionId });
        if (outcome === 'cancelled' && token && order.status === 'awaiting_payment') order = await cancelCheckout(id, token);
        apply(order, waiting(order));
        if (order.status === 'paid') emit('burst', 1.4);
      } catch {
        if (alive) setState(v => ({ ...v, done: true, lost: true, orderId: id }));
      }
    };
    void load();
    const scroll = window.setTimeout(() => scrollToTarget('#order', 40), reducedMotion ? 0 : 500);
    return () => {
      alive = false;
      window.clearTimeout(scroll);
    };
  }, [arrival]);

  /* keep asking the server while a payment is being confirmed ------------ */
  const status = state.order?.status;
  const polling = !!state.order && !!state.token && (state.checking || status === 'pending');
  useEffect(() => {
    if (!polling) return;
    let tries = 0;
    let timer = 0;
    const tick = (): void => {
      const s = stateRef.current;
      if (!s.order || !s.token) return;
      tries++;
      fetchOrder(s.order.id, { token: s.token })
        .then(order => {
          const settled = order.status !== 'awaiting_payment' && order.status !== 'created' && order.status !== 'pending';
          setState(v => (v.order?.id === order.id ? { ...v, order, checking: v.checking && !settled && tries < 24 } : v));
          if (order.status === 'paid') emit('burst', 1.4);
        })
        .catch(() => undefined)
        .finally(() => {
          // quick at first, then patient
          timer = window.setTimeout(tick, tries < 12 ? 2500 : 10_000);
        });
    };
    timer = window.setTimeout(tick, 1500);
    return () => window.clearTimeout(timer);
  }, [polling]);

  const api = useMemo<OrderApi>(
    () => ({ state, config, bank, bankError, methods, pricing, setService, setPlan, setPm, setAddon, stepLang, setField, next, prev, submit, reset, pick, pay, refresh }),
    [state, config, bank, bankError, methods, pricing, setService, setPlan, setPm, setAddon, stepLang, setField, next, prev, submit, reset, pick, pay, refresh],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useOrder(): OrderApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOrder must be used inside <OrderProvider>');
  return ctx;
}

export const addonPriceLabel = (id: keyof typeof ADDONS): string => {
  const ad = ADDONS[id];
  return '+' + (ad.type === 'percent' ? ad.value + '%' : '$' + ad.value);
};
