import rateLimit from 'express-rate-limit';

const rateLimitMessage = (message) => ({
  error: { code: 'RATE_LIMITED', message },
});

/**
 * Global API limiter — protects every route from abuse.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120, // max 120 requests per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitMessage('Too many requests, please slow down.'),
});

/**
 * Stricter limiter for authentication endpoints (login, signup) to prevent
 * credential brute-forcing.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitMessage(
    'Too many authentication attempts, please try again later.'
  ),
});
