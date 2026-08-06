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
