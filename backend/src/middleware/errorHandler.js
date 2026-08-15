import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Operational error with an HTTP status and a stable machine-readable code.
 */
export class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    // Optional structured details (e.g. retryAfterSeconds for lockouts)
    // surfaced to clients under error.details.
    this.details = details;
  }
}

/** 404 handler for unknown routes. */
export function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Central error handler. Every response uses the same envelope:
 *   { error: { code, message, requestId, details? } }
 *
 * Internal (500) errors never leak implementation details to clients; they are
 * logged server-side with the request ID for correlation.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // Validation errors from zod schema parsing
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request payload',
        details: err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
        requestId: req.id,
      },
    });
  }

  const status = err.status || 500;
  const isInternal = status >= 500;

  if (isInternal) {
    logger.error('request failed', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      error: err.stack || err.message,
    });
  }

  res.status(status).json({
    error: {
      code: err.code || (isInternal ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
      message: isInternal ? 'Internal server error' : err.message,
      requestId: req.id,
      // Structured details (lockout retry-after, etc.) ride along when set.
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
