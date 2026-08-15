/**
 * Storefront "paper" theme hook — delegates to the global paper theme
 * context (PaperThemeProvider) so the preference is one source of truth
 * across the storefront ticket (menu → checkout → confirmation → tracking),
 * the merchant ledger and the invoice.
 *
 * Returns { paperPref, effectiveDark, cyclePaper, setPaperPref }.
 */
export { usePaper as usePaperTheme } from '../theme/PaperThemeContext';
