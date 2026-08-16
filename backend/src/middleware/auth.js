import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the decoded
 * payload to `req.user`. Rejects missing/invalid/expired tokens with 401.
 */
export function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'No token' } });
  }

  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Token invalid/expired' },
    });
  }
}

/**
 * Same as authMiddleware but never rejects: a valid token attaches `req.user`,
 * a missing/invalid one simply leaves it unset. Used by public-ish endpoints
 * (invite acceptance) that work either logged-in or logged-out.
 */
export function optionalAuthMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (header) {
    const [type, token] = header.split(' ');
    if (type === 'Bearer' && token) {
      try {
        req.user = jwt.verify(token, env.JWT_SECRET);
      } catch {
        // Ignore invalid/expired tokens — the endpoint treats the caller as
        // logged-out and the client can re-authenticate.
      }
    }
  }
  next();
}
