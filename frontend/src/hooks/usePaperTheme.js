import { useEffect, useState } from 'react';

/**
 * Storefront "paper" theme — the Table Ticket identity lives on paper, and
 * paper comes in two kinds: warm rice paper (light) and ink paper (dark).
 *
 * `auto` (default) follows the device's `prefers-color-scheme`; light and
 * dark pin the choice. The preference persists per browser so the customer's
 * ticket keeps its paper across menu → checkout → confirmation.
 *
 * Used by PublicMenuPage and CheckoutPage so both share one toggle + storage.
 */
const KEY = 'oms.storefront.paper'; // 'auto' | 'light' | 'dark'

export function usePaperTheme() {
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

  return { paperPref, effectiveDark, cyclePaper };
}
