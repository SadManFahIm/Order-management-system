import crypto from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { parseStringPromise } from 'xml2js';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { SignedXml } from 'xml-crypto';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import { User, Tenant, UserTenant, TenantSamlConfig } from '../models/index.js';
import { audit } from './auditService.js';
import { issueSession, publicUser } from './authService.js';

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
    attributeEmail: config.attribute_email,
    attributeName: config.attribute_name,
    defaultRole: config.default_role,
    hasCertificate: Boolean(config.idp_cert),
    updatedAt: config.updated_at,
  };
}

