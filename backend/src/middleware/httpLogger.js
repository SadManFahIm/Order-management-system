import { logger } from '../utils/logger.js';

/**
 * Per-request HTTP logging (Phase 1 foundation). Mounted immediately after
 * the request-ID middleware so every line carries the same `requestId` the
 * error handler and error responses echo — correlate a failing request from
 * log to client in one hop.
 *
 * Logs one line per request on `finish` (method, path, status, duration,
 * client ip + the request id). `finish` fires after the response is handed
 * off, so slow or never-finishing requests are visible as missing lines.
 */
export function httpLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Math.round((Number(process.hrtime.bigint() - started) / 1e6) * 10) / 10;
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
    });
  });
  next();
}
