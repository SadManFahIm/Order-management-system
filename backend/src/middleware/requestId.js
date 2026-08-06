import { randomUUID } from 'node:crypto';

/**
 * Assigns a UUID to every request and echoes it as an `X-Request-Id` header so
 * logs and error responses can be correlated across the stack.
 */
export function requestId(req, res, next) {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
