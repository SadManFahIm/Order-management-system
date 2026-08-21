import api from '../api';

/**
 * Storefront funnel tracking (Phase 7 analytics).
 *
 * A "session" is an anonymous id minted per restaurant and kept in
 * localStorage — no cookies, no personal data. The same id rides the
 * checkout payload (analytics_session) so a paid order can be tied back to
 * its Browse → Cart → Checkout journey without ever identifying the guest.
 *
 * track() is fire-and-forget: analytics must never break or slow the
 * shopping experience, so failures are swallowed silently.
 */

const KEY_PREFIX = 'analytics_session:';

export function getSessionId(slug) {
  const key = `${KEY_PREFIX}${slug}`;
  let id = null;
  try {
    id = localStorage.getItem(key);
  } catch {
    id = null;
  }
  if (!id) {
    id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    try {
      localStorage.setItem(key, id);
    } catch {
      /* private mode — session lives for this page view only */
    }
  }
  return id;
}

/** menu_view | add_to_cart | checkout_start */
export function track(slug, type, productId = null) {
  api
    .post(`/public/restaurants/${slug}/events`, {
      type,
      session_id: getSessionId(slug),
      ...(productId ? { product_id: productId } : {}),
    })
    .catch(() => {});
}
