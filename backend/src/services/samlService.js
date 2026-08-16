import crypto from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import forge from 'node-forge';
import { parseStringPromise } from 'xml2js';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { SignedXml } from 'xml-crypto';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import {
  User,
  Tenant,
  UserTenant,
  TenantSamlConfig,
  SamlSpConfig,
  RefreshToken,
} from '../models/index.js';
import { audit } from './auditService.js';
import { issueSession, publicUser, sha256, REFRESH_COOKIE_NAME } from './authService.js';

/**
 * SAML 2.0 SSO (enterprise auth, Phase 3).
 *
 * Minimal-but-real SAML Web Browser SSO:
 *   - SP-initiated: GET /api/auth/saml/init builds an AuthnRequest
 *     (redirect binding — deflate + base64) and returns the IdP SSO URL.
 *   - IdP-initiated / response: POST /api/auth/saml/acs accepts a
 *     SAMLResponse (POST binding), inflates + parses it, verifies the XML
 *     signature against the tenant's CONFIGURED certificate (never the
 *     certificate embedded in the assertion — otherwise anyone could sign),
 *     checks the assertion's validity window, extracts the email/name, and
 *     provisions a workspace member (find-or-create user + membership).
 *
 * The XML-signature verification is handled by xml-crypto; the configured
 * cert is the only trust anchor. Everything else is deliberately small:
 * no IdP metadata import, no logout protocol — just the SSO round trip.
 */

const ACS_URL = () => `${env.APP_BASE_URL.replace(/\/$/, '')}/api/auth/saml/acs`;

/** PEM → the public-key object xml-crypto needs for verification. */
function publicKeyFromPem(pem) {
  const body = pem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const der = Buffer.from(body, 'base64');
  const info = new crypto.X509Certificate(der);
  // X509Certificate#publicKey is already a public KeyObject — passing it
  // through crypto.createPublicKey fails on newer Node versions.
  return info.publicKey;
}

/**
 * Builds the IdP redirect URL with a signed-in SP sense AuthnRequest
 * (redirect binding: deflate + base64url). Returns { url, relayState }.
 */
export async function buildSsoInitUrl(tenantSlug) {
  const tenant = await Tenant.findOne({ where: { slug: tenantSlug } });
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Workspace not found');
  const config = await TenantSamlConfig.findOne({ where: { tenant_id: tenant.id } });
  if (!config || !config.enabled) {
    throw new AppError(404, 'SAML_NOT_CONFIGURED', 'SSO is not configured for this workspace');
  }

  const requestId = `_${crypto.randomBytes(16).toString('hex')}`;
  const issueInstant = new Date().toISOString();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"`,
    ` xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"`,
    ` ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}"`,
    ` Destination="${config.idp_sso_url}"`,
    ` AssertionConsumerServiceURL="${ACS_URL()}"`,
    ` ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">`,
    `<saml:Issuer>orderly.app</saml:Issuer>`,
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>`,
    `</samlp:AuthnRequest>`,
  ].join('');

  const samlRequest = Buffer.from(deflateRawSync(Buffer.from(xml, 'utf8'))).toString('base64');
  const sep = config.idp_sso_url.includes('?') ? '&' : '?';
  const url = `${config.idp_sso_url}${sep}SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${encodeURIComponent(tenantSlug)}`;
  return { url, relayState: tenantSlug };
}

/** Base64 (optionally deflate) → decoded XML text. */
function decodeSamlResponse(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  let xml = raw.toString('utf8');
  if (!xml.trimStart().startsWith('<')) {
    // Redirect-binding responses are deflate(base64) — inflate the raw bytes.
    xml = inflateRawSync(raw).toString('utf8');
  }
  return xml;
}

/**
 * Parses the SAMLResponse, verifies the signature against the configured
 * cert and returns { email, name, notOnOrAfter }.
 */
async function verifyAndExtract({ xml, config }) {
  const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true });
  const response = parsed['samlp:Response'] || parsed.Response || {};
  const assertion = response['saml:Assertion'] || response.Assertion;

  // Signature check happens against the configured certificate only. We
  // override getCertFromKeyInfo to ALWAYS return the configured key, so a
  // certificate embedded in the assertion's KeyInfo is never trusted (key
  // confusion — otherwise anyone who could mint a response could self-sign).
  const doc = new DOMParser().parseFromString(xml);
  const signatureNodes = xpath.select(
    "//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']",
    doc
  );
  if (!signatureNodes || signatureNodes.length === 0) {
    throw new AppError(401, 'SAML_SIGNATURE_MISSING', 'No XML signature found in the SAML response');
  }
  const signed = new SignedXml();
  signed.getCertFromKeyInfo = () => publicKeyFromPem(config.idp_cert);
  try {
    signed.loadSignature(signatureNodes[0]);
    const valid = signed.checkSignature(xml);
    if (!valid) {
      throw new AppError(401, 'SAML_SIGNATURE_INVALID', 'SAML response signature could not be verified');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'SAML_SIGNATURE_INVALID', `SAML response signature verification failed: ${err.message}`);
  }

  if (!assertion) {
    throw new AppError(401, 'SAML_INVALID_RESPONSE', 'No SAML assertion found in the response');
  }

  // Validity window (NotOnOrAfter) — reject stale responses.
  const conditions = assertion['saml:Conditions'] || assertion.Conditions || {};
  const notOnOrAfter = conditions.NotOnOrAfter;
  if (notOnOrAfter && new Date(notOnOrAfter).getTime() < Date.now()) {
    throw new AppError(401, 'SAML_EXPIRED', 'The SAML assertion has expired');
  }

  // Email — NameID (email format) or the configured attribute.
  let email = null;
  let name = null;
  const subject = assertion['saml:Subject'] || assertion.Subject || {};
  const nameId = (subject['saml:NameID'] || subject.NameID || {});
  const nameIdText = typeof nameId === 'string' ? nameId : nameId._ || nameId['#text'] || '';
  const attrStatement = assertion['saml:AttributeStatement'] || assertion.AttributeStatement;
  const attributes = Array.isArray(attrStatement?.['saml:Attribute'])
    ? attrStatement['saml:Attribute']
    : attrStatement?.['saml:Attribute']
      ? [attrStatement['saml:Attribute']]
      : [];

  const getAttr = (attrName) => {
    const attr = attributes.find(
      (a) => (a.$.Name || '').toLowerCase() === String(attrName).toLowerCase()
    );
    if (!attr) return null;
    const value = attr['saml:AttributeValue'] ?? attr.AttributeValue;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value[0] ?? null;
    return value?._ ?? value?.['#text'] ?? null;
  };

  if (config.attribute_email === 'nameid') {
    email = nameIdText || getAttr('email') || getAttr('mail');
  } else {
    email = getAttr(config.attribute_email) || nameIdText;
  }
  name = getAttr(config.attribute_name) || getAttr('displayName') || getAttr('name') || null;

  email = String(email || '').trim().toLowerCase();
  if (!email.includes('@')) {
    throw new AppError(401, 'SAML_NO_EMAIL', 'SAML assertion did not carry an email address');
  }
  return { email, name, notOnOrAfter: notOnOrAfter ?? null };
}

/**
 * Handles the ACS round trip: verifies, provisions, issues a session.
 * Returns the same shape as login() so the client treats SSO as a sign-in.
 */
export async function handleAcs({ samlResponse, relayState }, req) {
  if (!samlResponse || typeof samlResponse !== 'string') {
    throw new AppError(400, 'SAML_RESPONSE_REQUIRED', 'Missing SAMLResponse');
  }
  const xml = decodeSamlResponse(samlResponse.trim());

  // Resolve the tenant: RelayState slug (SP-initiated) or by config match on
  // the response Issuer (IdP-initiated).
  let tenant = null;
  let config = null;
  if (relayState && typeof relayState === 'string') {
    tenant = await Tenant.findOne({ where: { slug: relayState.trim().toLowerCase() } });
  }
  if (!tenant) {
    // IdP-initiated: find the config whose entity ID matches the response Issuer.
    const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true }).catch(() => null);
    const issuer =
      parsed?.['samlp:Response']?.['saml:Issuer'] ||
      parsed?.Response?.Issuer ||
      parsed?.['samlp:Response']?.['saml:Issuer']?._ ||
      null;
    const configs = await TenantSamlConfig.findAll({ where: { enabled: true } });
    config = configs.find((c) => String(issuer ?? '').trim() === String(c.idp_entity_id).trim()) || null;
    if (config) tenant = await Tenant.findByPk(config.tenant_id);
  }
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Could not resolve the workspace for this SSO response');

  if (!config) config = await TenantSamlConfig.findOne({ where: { tenant_id: tenant.id } });
  if (!config || !config.enabled) {
    throw new AppError(404, 'SAML_NOT_CONFIGURED', 'SSO is not enabled for this workspace');
  }

  const { email, name } = await verifyAndExtract({ xml, config });

  let user = await User.findOne({ where: { email } });
  if (!user) {
    user = await User.create({
      name: name || email.split('@')[0],
      email,
      password: crypto.randomBytes(32).toString('hex'), // unusable password — SSO only
      platform_role: 'member',
      email_verified_at: new Date(), // SSO is strong auth — no email gate
    });
  }

  const [membership] = await UserTenant.findOrCreate({
    where: { user_id: user.id, tenant_id: tenant.id },
    defaults: { role: config.default_role || 'cashier' },
  });

  await audit({
    action: 'auth.saml_login',
    actorId: user.id,
    tenantId: tenant.id,
    entityType: 'User',
    entityId: user.id,
    metadata: { email, role: membership.role, idp: config.idp_entity_id },
    req,
  });

  const session = await issueSession(user, req);
  return { ...session, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } };
}

/** Public-safe config view for owners/platform admins (no cert). */
export function serializeSamlConfig(config) {
  if (!config) return null;
  return {
    id: config.id,
    tenantId: config.tenant_id,
    enabled: Boolean(config.enabled),
    idpEntityId: config.idp_entity_id,
    idpSsoUrl: config.idp_sso_url,
    idpSloUrl: config.idp_slo_url || null,
    attributeEmail: config.attribute_email,
    attributeName: config.attribute_name,
    defaultRole: config.default_role,
    hasCertificate: Boolean(config.idp_cert),
    updatedAt: config.updated_at,
  };
}

// ── SP identity, metadata & single logout (SLO) ──────────────────────────

const SP_ENTITY_ID = 'orderly.app';
const SLO_URL = () => `${env.APP_BASE_URL.replace(/\/$/, '')}/api/auth/saml/slo`;

/**
 * Ensures the SP signing identity exists (singleton `saml_sp_config`).
 * Generates a self-signed 2048-bit RSA key + cert once, at first use, with
 * node-forge. The private key is stored only in the DB row — it never
 * leaves the server — and is what signs LogoutRequests.
 */
export async function ensureSpConfig() {
  const existing = await SamlSpConfig.findByPk(1);
  if (existing) return existing;

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 3650 * 86400000); // 10 years
  const attrs = [{ name: 'commonName', value: SP_ENTITY_ID }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return SamlSpConfig.findOrCreate({
    where: { id: 1 },
    defaults: {
      id: 1,
      entity_id: SP_ENTITY_ID,
      cert: forge.pki.certificateToPem(cert),
      private_key: forge.pki.privateKeyToPem(keys.privateKey, { usePkcs8: false }),
    },
  }).then(([row]) => row);
}

/** Signs a SAML message element (LogoutRequest / LogoutResponse) with the SP key. */
async function signSamlMessage(xml) {
  const sp = await ensureSpConfig();
  const sig = new SignedXml({
    privateKey: sp.private_key,
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });
  sig.addReference({
    xpath: "//*[local-name(.)='LogoutRequest'] | //*[local-name(.)='LogoutResponse']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
    prefix: 'ds',
  });
  return sig.getSignedXml();
}

/**
 * Builds the IdP redirect URL for an SP-initiated logout (redirect binding:
 * signed LogoutRequest, deflate + base64url). `nameId` is the user's email
 * (the NameID the IdP issued at login); RelayState carries the tenant slug
 * so the SLO response can be attributed back to the workspace.
 * Returns { url, relayState }.
 */
export async function buildSloInitUrl(tenantSlug, nameId = '') {
  const tenant = await Tenant.findOne({ where: { slug: tenantSlug } });
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Workspace not found');
  const config = await TenantSamlConfig.findOne({ where: { tenant_id: tenant.id } });
  if (!config || !config.enabled) {
    throw new AppError(404, 'SAML_NOT_CONFIGURED', 'SSO is not configured for this workspace');
  }
  const sloUrl = config.idp_slo_url;
  if (!sloUrl) {
    throw new AppError(400, 'SAML_SLO_NOT_CONFIGURED', 'The IdP has no single-logout endpoint configured');
  }

  const requestId = `_${crypto.randomBytes(16).toString('hex')}`;
  const issueInstant = new Date().toISOString();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    ` ID="${requestId}" Version="2.0" IssueInstant="${issueInstant}"`,
    ` Destination="${sloUrl}"`,
    '>',
    `<saml:Issuer>${SP_ENTITY_ID}</saml:Issuer>`,
    `<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>`,
    '</samlp:LogoutRequest>',
  ].join('');

  // Sign, then deflate + base64url for the redirect binding.
  const signedXml = await signSamlMessage(xml);
  const samlRequest = Buffer.from(deflateRawSync(Buffer.from(signedXml, 'utf8'))).toString('base64');
  const sep = sloUrl.includes('?') ? '&' : '?';
  const url = `${sloUrl}${sep}SAMLRequest=${encodeURIComponent(samlRequest)}&RelayState=${encodeURIComponent(tenantSlug)}`;
  return { url, relayState: tenantSlug };
}

/** SAML SP metadata XML — advertised so the IdP can register the SP. */
export async function buildSpMetadata() {
  const sp = await ensureSpConfig();
  const certBody = sp.cert
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  const base = env.APP_BASE_URL.replace(/\/$/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${SP_ENTITY_ID}">
  <md:SPSSODescriptor AuthnRequestsSigned="true" WantAssertionsSigned="false"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${certBody}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect"
      Location="${base}/api/auth/saml/slo"/>
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${base}/api/auth/saml/slo"/>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${base}/api/auth/saml/acs" index="0" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

/** Verifies a LogoutResponse/LogoutRequest XML signature against the IdP cert. */
function verifySamlSignature(xml, certPem) {
  const doc = new DOMParser().parseFromString(xml);
  const signatureNodes = xpath.select(
    "//*[local-name(.)='Signature' and namespace-uri(.)='http://www.w3.org/2000/09/xmldsig#']",
    doc
  );
  if (!signatureNodes || signatureNodes.length === 0) {
    throw new AppError(401, 'SAML_SIGNATURE_MISSING', 'No XML signature found in the SAML message');
  }
  const signed = new SignedXml();
  signed.getCertFromKeyInfo = () => publicKeyFromPem(certPem);
  try {
    signed.loadSignature(signatureNodes[0]);
    // checkSignature returns false on a bad signature (or throws) — both reject.
    if (!signed.checkSignature(xml)) {
      throw new AppError(401, 'SAML_SIGNATURE_INVALID', 'SAML signature could not be verified');
    }
    return true;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'SAML_SIGNATURE_INVALID', `SAML signature verification failed: ${err.message}`);
  }
}

/**
 * Handles the SLO endpoint round trip.
 *
 *   - SP-initiated return: the IdP POSTs a LogoutResponse — we verify the
 *     signature against the configured IdP cert, revoke the session behind
 *     the refresh cookie, and redirect the browser to /login?logged_out=1.
 *   - IdP-initiated: the IdP POSTs a LogoutRequest — we verify it, revoke
 *     the local session, and reply with a signed LogoutResponse (redirect
 *     binding) back to the IdP's SLO URL.
 *
 * Returns { redirectTo } for the route to send the browser to.
 */
export async function handleSlo({ samlRequest, samlResponse, relayState }, req) {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];

  // The refresh cookie's user is the one we revoke on logout.
  const tokenRecord = rawToken
    ? await RefreshToken.findOne({ where: { token_hash: sha256(rawToken) } })
    : null;
  const userId = tokenRecord?.user_id ?? null;

  if (samlResponse) {
    // SP-initiated return: LogoutResponse from the IdP.
    const xml = decodeSamlResponse(String(samlResponse).trim());
    const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true }).catch(() => null);
    const config = await findConfigForMessage(xml, parsed, relayState);
    verifySamlSignature(xml, config.idp_cert);
    if (userId && tokenRecord && !tokenRecord.revoked_at) {
      await tokenRecord.update({ revoked_at: new Date() });
      await audit({
        action: 'auth.slo_logout',
        actorId: userId,
        tenantId: config.tenant_id,
        entityType: 'RefreshToken',
        entityId: tokenRecord.id,
        metadata: { via: 'saml_logout_response' },
        req,
      });
    }
    return { redirectTo: `${env.APP_BASE_URL.replace(/\/$/, '')}/login?logged_out=1` };
  }

  if (samlRequest) {
    // IdP-initiated: LogoutRequest from the IdP — verify, revoke, reply.
    const xml = decodeSamlResponse(String(samlRequest).trim());
    const parsed = await parseStringPromise(xml, { explicitArray: false, trim: true }).catch(() => null);
    const config = await findConfigForMessage(xml, parsed, relayState);
    verifySamlSignature(xml, config.idp_cert);

    if (userId && tokenRecord && !tokenRecord.revoked_at) {
      await tokenRecord.update({ revoked_at: new Date() });
      await audit({
        action: 'auth.slo_logout',
        actorId: userId,
        tenantId: config.tenant_id,
        entityType: 'RefreshToken',
        entityId: tokenRecord.id,
        metadata: { via: 'saml_logout_request' },
        req,
      });
    }

    // Build a signed LogoutResponse (redirect binding) back to the IdP.
    if (!config.idp_slo_url) {
      return { redirectTo: `${env.APP_BASE_URL.replace(/\/$/, '')}/login?logged_out=1` };
    }
    const sp = await ensureSpConfig();
    const responseId = `_${crypto.randomBytes(16).toString('hex')}`;
    const inResponseTo = parsed?.['samlp:LogoutRequest']?.$?.ID || parsed?.LogoutRequest?.$?.ID || '';
    const xmlOut = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      ` ID="${responseId}" Version="2.0" IssueInstant="${new Date().toISOString()}"`,
      ` InResponseTo="${inResponseTo}" Destination="${config.idp_slo_url}"`,
      '>',
      `<saml:Issuer>${SP_ENTITY_ID}</saml:Issuer>`,
      '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
      '</samlp:LogoutResponse>',
    ].join('');
    const signedOut = await signSamlMessage(xmlOut);
    const encoded = Buffer.from(deflateRawSync(Buffer.from(signedOut, 'utf8'))).toString('base64');
    const sep = config.idp_slo_url.includes('?') ? '&' : '?';
    return {
      redirectTo: `${config.idp_slo_url}${sep}SAMLResponse=${encodeURIComponent(encoded)}`,
    };
  }

  throw new AppError(400, 'SAML_MESSAGE_REQUIRED', 'A SAMLRequest or SAMLResponse is required');
}

/** Resolves the tenant config for a SLO message (RelayState slug or Issuer). */
async function findConfigForMessage(xml, parsed, relayState) {
  let tenant = null;
  let config = null;
  if (relayState && typeof relayState === 'string') {
    tenant = await Tenant.findOne({ where: { slug: relayState.trim().toLowerCase() } });
  }
  if (!tenant) {
    const issuer =
      parsed?.['samlp:LogoutResponse']?.['saml:Issuer'] ||
      parsed?.['samlp:LogoutRequest']?.['saml:Issuer'] ||
      parsed?.LogoutResponse?.Issuer ||
      parsed?.LogoutRequest?.Issuer ||
      null;
    const issuerText = typeof issuer === 'string' ? issuer : issuer?._ || issuer?.['#text'] || '';
    const configs = await TenantSamlConfig.findAll({ where: { enabled: true } });
    config =
      configs.find(
        (c) => String(issuerText).trim() === String(c.idp_entity_id).trim()
      ) || null;
    if (config) tenant = await Tenant.findByPk(config.tenant_id);
  }
  if (!tenant) throw new AppError(404, 'TENANT_NOT_FOUND', 'Could not resolve the workspace for this SAML message');
  if (!config) config = await TenantSamlConfig.findOne({ where: { tenant_id: tenant.id } });
  if (!config || !config.enabled) {
    throw new AppError(404, 'SAML_NOT_CONFIGURED', 'SSO is not enabled for this workspace');
  }
  return config;
}

