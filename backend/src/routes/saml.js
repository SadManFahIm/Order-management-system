import express from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { buildSsoInitUrl, handleAcs } from '../services/samlService.js';
import { setRefreshCookie } from '../services/authService.js';
import { env } from '../config/env.js';

/**
 * Public SAML endpoints (enterprise SSO, Phase 3).
 *
 *   GET  /api/auth/saml/init?tenant=<slug> — SP-initiated: returns the IdP
 *        SSO URL (AuthnRequest, redirect binding) the browser should follow.
 *   POST /api/auth/saml/acs               — the IdP POSTs the SAMLResponse
 *        here (form-encoded per the SAML HTTP-POST binding, JSON accepted
 *        for programmatic clients); on success the refresh cookie is set
 *        and the browser is redirected to /sso/success, or a JSON session
 *        is returned for JSON clients.
 */
const router = express.Router();

router.use(express.urlencoded({ extended: false }));

router.get(
  '/init',
  asyncHandler(async (req, res) => {
    const tenant = req.query.tenant || req.query.slug;
    if (!tenant || typeof tenant !== 'string') {
      throw new AppError(400, 'TENANT_REQUIRED', 'A workspace slug is required (?tenant=<slug>)');
    }
    const { url, relayState } = await buildSsoInitUrl(tenant);
    res.json({ url, relayState });
  })
);

router.post(
  '/acs',
  asyncHandler(async (req, res) => {
    const samlResponse = req.body?.SAMLResponse || req.body?.samlResponse;
    const relayState = req.body?.RelayState || req.body?.relayState || req.query?.RelayState || req.query?.relayState;
    const result = await handleAcs({ samlResponse, relayState }, req);

    const wantsJson =
      String(req.get('accept') || '').includes('application/json') ||
      req.body?.samlResponse !== undefined;
    if (!wantsJson) {
      setRefreshCookie(res, result.refreshToken);
      return res.redirect(`${env.APP_BASE_URL.replace(/\/$/, '')}/sso/success`);
    }
    setRefreshCookie(res, result.refreshToken);
    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      tenant: result.tenant,
    });
  })
);

export default router;
