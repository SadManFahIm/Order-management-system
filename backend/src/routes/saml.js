import express from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  buildSsoInitUrl,
  handleAcs,
  buildSloInitUrl,
  buildSpMetadata,
  handleSlo,
} from '../services/samlService.js';
import { setRefreshCookie, clearRefreshCookie } from '../services/authService.js';
import { env } from '../config/env.js';

/**
 * Public SAML endpoints (enterprise SSO).
 *
 *   GET  /api/auth/saml/metadata          — SP metadata XML (entity ID, ACS +
 *        SLO locations, the SP signing certificate) for IdP registration.
 *   GET  /api/auth/saml/init?tenant=<slug> — SP-initiated SSO: returns the
 *        IdP SSO URL (AuthnRequest, redirect binding) the browser follows.
 *   POST /api/auth/saml/acs               — the IdP POSTs the SAMLResponse
 *        here (HTTP-POST binding, JSON accepted); on success the refresh
 *        cookie is set and the browser goes to /sso/success.
 *   GET  /api/auth/saml/slo?tenant=<slug>&nameId=<email> — SP-initiated
 *        logout: builds a signed LogoutRequest and redirects to the IdP's
 *        SLO endpoint.
 *   POST /api/auth/saml/slo               — the IdP POSTs a LogoutResponse
 *        (SP-initiated return) or a LogoutRequest (IdP-initiated). The
 *        signature is verified, the local session is revoked, and the
 *        browser is redirected back to the app (or the IdP for the reply).
 */
const router = express.Router();

router.use(express.urlencoded({ extended: false }));

router.get(
  '/metadata',
  asyncHandler(async (req, res) => {
    const xml = await buildSpMetadata();
    res.type('application/xml');
    res.send(xml);
  })
);

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

router.get(
  '/slo',
  asyncHandler(async (req, res) => {
    const tenant = req.query.tenant || req.query.slug;
    const nameId = req.query.nameId || req.query.nameid || '';
    if (!tenant || typeof tenant !== 'string') {
      throw new AppError(400, 'TENANT_REQUIRED', 'A workspace slug is required (?tenant=<slug>)');
    }
    const { url } = await buildSloInitUrl(tenant, String(nameId));
    res.json({ url });
  })
);

router.post(
  '/slo',
  asyncHandler(async (req, res) => {
    const samlRequest = req.body?.SAMLRequest || req.body?.samlRequest;
    const samlResponse = req.body?.SAMLResponse || req.body?.samlResponse;
    const relayState = req.body?.RelayState || req.body?.relayState || req.query?.RelayState || req.query?.relayState;
    const result = await handleSlo({ samlRequest, samlResponse, relayState }, req);

    // Session revoked — drop the refresh cookie in both cases.
    clearRefreshCookie(res);

    const wantsJson =
      String(req.get('accept') || '').includes('application/json') ||
      req.body?.samlResponse !== undefined ||
      req.body?.samlRequest !== undefined;
    if (wantsJson) {
      return res.json({ redirectTo: result.redirectTo, loggedOut: true });
    }
    return res.redirect(result.redirectTo);
  })
);

export default router;
