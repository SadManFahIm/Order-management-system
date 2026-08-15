import { createContext, useContext, useEffect, useState } from 'react';

/**
 * Global "paper" theme context — the Table Ticket identity lives on paper,
 * and paper comes in two kinds: warm rice paper (light) and ink paper (dark).
 *
 * One provider at the app root makes the paper preference a single source of
 * truth: the storefront ticket (menu → checkout → confirmation → tracking),
 * the merchant ledger (dashboard) and the invoice all read the same choice,
 * so flipping the 🌓 toggle in one place follows you everywhere.
 *
 * `auto` (default) follows the device's `prefers-color-scheme`; `light` and
 * `dark` pin the choice. The preference persists in localStorage so it
 * survives reloads and is shared across pages.
 */
const KEY = 'oms.storefront.paper'; // 'auto' | 'light' | 'dark'

const PaperThemeContext = createContext(null);

export function PaperThemeProvider({ children }) {
  const [paperPref, setPaperPref] = useState(() => {
    try {
      const saved = window.localStorage.getItem(KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [systemDark, setSystemDark] = useState(
    () =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, paperPref);
    } catch {
      /* storage unavailable */
    }
  }, [paperPref]);

  const effectiveDark =
    paperPref === 'dark' || (paperPref === 'auto' && systemDark);

  const cyclePaper = () =>
    setPaperPref((p) => (p === 'auto' ? 'light' : p === 'light' ? 'dark' : 'auto'));

  return (
    <PaperThemeContext.Provider
      value={{ paperPref, effectiveDark, cyclePaper, setPaperPref }}
    >
      {children}
    </PaperThemeContext.Provider>
  );
}

/** Read the global paper theme. Must be used inside <PaperThemeProvider>. */
export function usePaper() {
  const ctx = useContext(PaperThemeContext);
  if (!ctx) {
    throw new Error('usePaper must be used within a PaperThemeProvider');
  }
  return ctx;
}
