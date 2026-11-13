import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

interface ToastApi {
  toast: (message: string) => void;
  /** Copies text; must be called straight from a click handler. */
  copy: (text: string, okMessage?: string, fallbackEl?: HTMLElement | null) => Promise<void>;
}

const Ctx = createContext<ToastApi | null>(null);

function selectNode(el: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [visible, setVisible] = useState(false);
  const timer = useRef<number>(0);

  const toast = useCallback((msg: string) => {
    setMessage(msg);
    setVisible(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), 2800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string, okMessage?: string, fallbackEl?: HTMLElement | null) => {
      const fail = (): void => {
        toast(t('toast.fail'));
        if (fallbackEl) selectNode(fallbackEl);
      };
      try {
        await navigator.clipboard.writeText(text);
        toast(okMessage || t('toast.copied'));
      } catch {
        fail();
      }
    },
    [t, toast],
  );

  const api = useMemo(() => ({ toast, copy }), [toast, copy]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className={`toast ${visible ? 'is-on' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
