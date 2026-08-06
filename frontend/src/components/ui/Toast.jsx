import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ToastContext = createContext(null);
let nextId = 1;

const ICONS = {
  success: '✓',
  error: '✕',
  info: 'i',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  // Clear any pending timers if the provider unmounts.
  useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.set(
      id,
      setTimeout(() => {
        setToasts((ts) => ts.filter((t) => t.id !== id));
        timers.current.delete(id);
      }, 200)
    );
  }, []);

  const push = useCallback(
    ({ title, description, variant = 'success', duration = 4000 } = {}) => {
      const id = nextId++;
      setToasts((ts) => [...ts, { id, title, description, variant, duration }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration + 200)
      );
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      success: (title, description) => push({ title, description, variant: 'success' }),
      error: (title, description) => push({ title, description, variant: 'error', duration: 6000 }),
      info: (title, description) => push({ title, description, variant: 'info' }),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="oms-toast-viewport">
          {toasts.map((t) => (
            <div key={t.id} className={`oms-toast oms-toast--${t.variant} ${t.leaving ? 'oms-toast--leaving' : ''}`} role="status">
              <span className="oms-toast__icon" aria-hidden="true">{ICONS[t.variant]}</span>
              <div className="oms-toast__body">
                <div className="oms-toast__title">{t.title}</div>
                {t.description && <div className="oms-toast__desc">{t.description}</div>}
              </div>
              <button className="oms-toast__close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
              <span
                className="oms-toast__bar"
                style={{ animationDuration: `${t.duration}ms` }}
              />
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
