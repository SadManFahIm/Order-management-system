import express from 'express';
import { optionalAuthMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { acceptInvite, getInviteInfo } from '../services/tenantService.js';

/**
 * Public invite acceptance (Phase 3).
 *
 * The invite link carries a raw token; the token (hashed) is the only thing
 * that authorizes joining, so the accept endpoint works for logged-out
 * visitors (who create an account in the same call) and for logged-in users
 * (whose email must match the invite). `optionalAuthMiddleware` lets both
 * cases through.
 */
const router = express.Router();

/** GET /api/invites/:token — public-safe invite preview (email/tenant/role). */
router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.json(await getInviteInfo(req.params.token));
  })
);

router.post(
  '/accept',
  optionalAuthMiddleware,
  asyncHandler(async (req, res) => {
    const { token, name, password } = req.body || {};
    if (!token || typeof token !== 'string') {
      throw new AppError(400, 'INVALID_INVITE', 'Invite token is required');
    }
    const result = await acceptInvite(
      { token, user: req.user || null, name, password },
      req
    );
    res.json(result);
  })
);

export default router;
