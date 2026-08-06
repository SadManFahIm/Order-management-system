import { allowedOrigins } from '../config/env.js';

/**
 * CSRF protection for cookie-authenticated requests (e.g. the httpOnly
 * refresh-token cookie). Uses the Origin / Sec-Fetch-Site verification
 * pattern — no token needed, works alongside SameSite=Lax cookies:
 *
 *  - Safe methods (GET/HEAD/OPTIONS) are always allowed.
 *  - Requests WITHOUT cookies carry no session to protect → allowed.
 *  - If an `Origin` header is present (any browser request), it must be in
 *    the configured allowlist — otherwise reject (covers <form> CSRF and
 *    cross-site fetch with credentials).
 *  - If no Origin but a `Sec-Fetch-Site` header exists, it must be
 *    same-origin/same-site/none (browser-initiated same-site request).
 *  - No Origin AND no Sec-Fetch-Site → non-browser client (curl, tests,
 *    server-to-server) → allowed.
 *
 * Mount globally AFTER cookie parsing; it is a no-op for the common case
 * (Bearer-token clients without cookies).
 */
export function sameOriginGuard(req, res, next) {
  const method = (req.method || '').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const hasCookies = Boolean(req.headers.cookie);
  if (!hasCookies) return next();

  const origin = req.headers.origin;
  const secFetchSite = req.headers['sec-fetch-site'];

  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({
      error: {
        code: 'CSRF_REJECTED',
        message: 'Cross-origin requests are not allowed',
      },
    });
  }

  if (
    !origin &&
    secFetchSite &&
    !['same-origin', 'same-site', 'none'].includes(secFetchSite)
  ) {
    return res.status(403).json({
      error: {
        code: 'CSRF_REJECTED',
        message: 'Cross-site requests are not allowed',
      },
    });
  }

  return next();
}
