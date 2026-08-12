import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const rateLimitMessage = (message) => ({
  error: { code: 'RATE_LIMITED', message },
});

/**
 * Global API limiter — protects every route from abuse. The budget is
 * configurable via RATE_LIMIT_MAX (default 120/min) so the e2e harness can
 * raise it for full browser suites; production keeps the default.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: env.RATE_LIMIT_MAX || 120, // max requests per minute per IP
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
