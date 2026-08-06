import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { env } from '../config/env.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { authLimiter, apiLimiter } from '../middleware/rateLimiter.js';
import { loginSchema } from '../validators/auth.js';

const router = express.Router();

// Precomputed bcrypt hash used when an account does not exist, so that the
// login response time does not reveal whether an email is registered
// (timing-based account enumeration).
const DUMMY_PASSWORD_HASH =
  '$2a$10$RRKPx6ammuFaDceeFdeChu2aqLAiNhVERRXpzAMM48lwz4wYCk/K.';

/**
 * POST /api/auth/login — issue an access token.
 * Note: the old unauthenticated `/api/auth/seed-admin` endpoint has been
 * removed. Provision the first admin with `npm run seed:admin`.
 */
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const user = await User.findOne({ where: { email } });
    // Always run a bcrypt comparison (against a dummy hash when the account
    // is missing) so response timing does not leak account existence.
    const ok = await bcrypt.compare(
      password,
      user ? user.password : DUMMY_PASSWORD_HASH
    );

    if (!user || !ok) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email },
    });
  })
);

/**
 * GET /api/auth/me — validate the current token and return the user.
 * Used by the frontend to restore/validate sessions on page load.
 */
router.get(
  '/me',
  apiLimiter,
  authMiddleware,
  asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'name', 'email', 'createdAt'],
    });
    if (!user) {
      throw new AppError(401, 'USER_NOT_FOUND', 'User no longer exists');
    }
    res.json({ user });
  })
);

export default router;
