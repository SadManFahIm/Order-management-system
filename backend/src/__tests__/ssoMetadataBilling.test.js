import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import forge from 'node-forge';
import crypto from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import {
  User,
  Tenant,
  UserTenant,
  Plan,
  TenantSamlConfig,
  SamlSpConfig,
  RefreshToken,
} from '../models/index.js';
import { SignedXml } from 'xml-crypto';
import {
  buildSpMetadata,
  ensureSpConfig,
  buildSloInitUrl,
  handleSlo,
} from '../services/samlService.js';
import {
  getBillingMeter,
  reportTenantMeter,
  reportAllTenantMeters,
} from '../services/billingService.js';
import { env } from '../config/env.js';

/**
 * Phase 3 follow-ups (round 2) — SP metadata + single logout, the usage
 * billing meter, and the platform-admin SSO overview.
 */

const PASSWORD = 'Str0ngPass!42';

let tenant;
let ownerToken;
let platformToken;
let idpCertPem;
let idpKeyPem;

/** Generate a self-signed IdP certificate (node-forge, PKCS#1 private key). */
function makeIdpCert(commonName = 'idp.example.com') {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: 'commonName', value: commonName }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey, { usePkcs8: false }),
  };
}

/** Signs a SAML message (LogoutRequest / LogoutResponse) with a key pair. */
function signSamlMessageXml(xml, keyPem) {
  const sig = new SignedXml({
    privateKey: keyPem,
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

/** Builds a signed LogoutResponse (as the IdP would) with a status value. */
function buildSignedLogoutResponse({ keyPem, issuer = 'https://idp.example.com/metadata', inResponseTo = '' }) {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
    ` ID="_resp${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${new Date().toISOString()}"`,
    `${inResponseTo ? ` InResponseTo="${inResponseTo}"` : ''} Destination="http://localhost:4000/api/auth/saml/slo">`,
    `<saml:Issuer>${issuer}</saml:Issuer>`,
    '<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
    '</samlp:LogoutResponse>',
  ].join('');
  return signSamlMessageXml(xml, keyPem);
}

beforeAll(async () => {
  await resetTestDb();

  const [free] = await Plan.findOrCreate({
    where: { code: 'free' },
    defaults: { name: 'Free', price_mo: 0, max_products: 3, max_orders_per_day: 5, max_members: 10, storage_mb: 1 },
  });
  await free.update({ max_products: 3, max_orders_per_day: 5, max_members: 10, storage_mb: 1 });

  tenant = await Tenant.create({ name: 'SSO2 Diner', slug: 'sso2-diner', plan_id: free.id });

  const owner = await User.create({
    name: 'SSO2 Owner',
    email: 'sso2owner@example.com',
    password: await bcrypt.hash(PASSWORD, 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });

  const platformAdmin = await User.create({
    name: 'SSO2 Admin',
    email: 'sso2admin@example.com',
    password: await bcrypt.hash(PASSWORD, 10),
    platform_role: 'platform_admin',
  });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'sso2owner@example.com', password: PASSWORD });
  ownerToken = login.body.accessToken;

  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'sso2admin@example.com', password: PASSWORD });
  platformToken = adminLogin.body.accessToken;

  const idp = makeIdpCert();
  idpCertPem = idp.certPem;
  idpKeyPem = idp.keyPem;
  await TenantSamlConfig.create({
    tenant_id: tenant.id,
    enabled: true,
    idp_entity_id: 'https://idp.example.com/metadata',
    idp_sso_url: 'https://idp.example.com/sso/post',
    idp_slo_url: 'https://idp.example.com/slo/post',
    idp_cert: idp.certPem,
    attribute_email: 'email',
    attribute_name: 'displayname',
    default_role: 'cashier',
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('SP metadata & identity', () => {
  it('generates the SP signing identity once (singleton)', async () => {
    const sp = await ensureSpConfig();
    expect(sp.id).toBe(1);
    expect(sp.entity_id).toBe('orderly.app');
    expect(sp.cert).toContain('BEGIN CERTIFICATE');
    expect(sp.private_key).toContain('BEGIN RSA PRIVATE KEY');

    const again = await ensureSpConfig();
    expect(again.id).toBe(sp.id);
    expect(await SamlSpConfig.count()).toBe(1);
  });

  it('serves SP metadata with ACS + SLO locations and the signing cert', async () => {
    const res = await request(app).get('/api/auth/saml/metadata');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    const xml = res.text;
    expect(xml).toContain('entityID="orderly.app"');
    expect(xml).toContain('AssertionConsumerService');
    expect(xml).toContain('/api/auth/saml/acs');
    expect(xml).toContain('SingleLogoutService');
    expect(xml).toContain('/api/auth/saml/slo');
    expect(xml).toContain('X509Certificate');
  });

  it('rejects SLO init for a workspace without an IdP SLO endpoint', async () => {
    const cfg = await TenantSamlConfig.findOne({ where: { tenant_id: tenant.id } });
    await cfg.update({ idp_slo_url: null });
    await expect(buildSloInitUrl('sso2-diner', 'user@example.com')).rejects.toMatchObject({
      status: 400,
      code: 'SAML_SLO_NOT_CONFIGURED',
    });
    await cfg.update({ idp_slo_url: 'https://idp.example.com/slo/post' });
  });

  it('builds an SP-initiated logout URL with a signed LogoutRequest', async () => {
    const { url, relayState } = await buildSloInitUrl('sso2-diner', 'user@example.com');
    expect(relayState).toBe('sso2-diner');
    expect(url).toContain('https://idp.example.com/slo/post');
    expect(url).toContain('SAMLRequest=');
    const encoded = decodeURIComponent(url.split('SAMLRequest=')[1].split('&')[0]);
    const xml = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
    expect(xml).toContain('samlp:LogoutRequest');
    expect(xml).toContain('<saml:Issuer>orderly.app</saml:Issuer>');
    expect(xml).toContain('<ds:Signature');
  });
});

describe('SLO round trip', () => {
  it('revokes the session on a valid LogoutResponse and redirects to login', async () => {
    // Log in to get a real refresh-token cookie/session.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sso2owner@example.com', password: PASSWORD });
    const cookie = login.headers['set-cookie']?.map((c) => c.split(';')[0]).join('; ');
    expect(cookie).toBeTruthy();
    const sessionsBefore = await RefreshToken.count({ where: { revoked_at: null } });

    const xml = buildSignedLogoutResponse({ keyPem: idpKeyPem });
    const res = await request(app)
      .post('/api/auth/saml/slo')
      .type('form')
      .set('Cookie', cookie)
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(xml).toString('base64'), RelayState: 'sso2-diner' });

    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
    expect(res.body.redirectTo).toContain('/login?logged_out=1');
    const sessionsAfter = await RefreshToken.count({ where: { revoked_at: null } });
    expect(sessionsAfter).toBeLessThan(sessionsBefore);
  });

  it('rejects a LogoutResponse signed with the wrong certificate', async () => {
    const evil = makeIdpCert('evil.example.com');
    const xml = buildSignedLogoutResponse({ keyPem: evil.keyPem });
    const res = await request(app)
      .post('/api/auth/saml/slo')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(xml).toString('base64'), RelayState: 'sso2-diner' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SAML_SIGNATURE_INVALID');
  });

  it('rejects a tampered LogoutResponse', async () => {
    const xml = buildSignedLogoutResponse({ keyPem: idpKeyPem });
    const tampered = xml.replace('Success', 'Requester');
    const res = await request(app)
      .post('/api/auth/saml/slo')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(tampered).toString('base64'), RelayState: 'sso2-diner' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SAML_SIGNATURE_INVALID');
  });

  it('answers an IdP-initiated LogoutRequest with a signed LogoutResponse', async () => {
    const requestId = `_${crypto.randomBytes(8).toString('hex')}`;
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
      ` ID="${requestId}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="http://localhost:4000/api/auth/saml/slo">`,
      '<saml:Issuer>https://idp.example.com/metadata</saml:Issuer>',
      '<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">sso2owner@example.com</saml:NameID>',
      '</samlp:LogoutRequest>',
    ].join('');
    const signed = signSamlMessageXml(xml, idpKeyPem);

    const res = await request(app)
      .post('/api/auth/saml/slo')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLRequest: Buffer.from(signed).toString('base64'), RelayState: 'sso2-diner' });

    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
    // Reply redirects back to the IdP's SLO endpoint with a SAMLResponse.
    expect(res.body.redirectTo).toContain('https://idp.example.com/slo/post');
    expect(res.body.redirectTo).toContain('SAMLResponse=');
    const encoded = decodeURIComponent(res.body.redirectTo.split('SAMLResponse=')[1].split('&')[0]);
    const replyXml = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
    expect(replyXml).toContain('samlp:LogoutResponse');
    expect(replyXml).toContain(`InResponseTo="${requestId}"`);
  });

  it('resolves the tenant by Issuer when RelayState is missing (IdP-initiated)', async () => {
    const requestId = `_${crypto.randomBytes(8).toString('hex')}`;
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
      ` ID="${requestId}" Version="2.0" IssueInstant="${new Date().toISOString()}" Destination="http://localhost:4000/api/auth/saml/slo">`,
      '<saml:Issuer>https://idp.example.com/metadata</saml:Issuer>',
      '<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">sso2owner@example.com</saml:NameID>',
      '</samlp:LogoutRequest>',
    ].join('');
    const signed = signSamlMessageXml(xml, idpKeyPem);

    // No RelayState — the service must match the response Issuer to the config.
    const res = await request(app)
      .post('/api/auth/saml/slo')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLRequest: Buffer.from(signed).toString('base64') });

    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
    expect(res.body.redirectTo).toContain('https://idp.example.com/slo/post');
  });

  it('rejects a SLO POST with neither message (400)', async () => {
    const res = await request(app)
      .post('/api/auth/saml/slo')
      .type('form')
      .set('Accept', 'application/json')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAML_MESSAGE_REQUIRED');
  });

  it('revokes nothing and still redirects when there is no local session', async () => {
    const xml = buildSignedLogoutResponse({ keyPem: idpKeyPem });
    const res = await request(app)
      .post('/api/auth/saml/slo')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(xml).toString('base64'), RelayState: 'sso2-diner' });
    expect(res.status).toBe(200);
    expect(res.body.loggedOut).toBe(true);
    expect(res.body.redirectTo).toContain('/login?logged_out=1');
  });
});

describe('usage billing meter', () => {
  it('builds a meter snapshot with usage + limits + plan', async () => {
    const meter = await getBillingMeter(tenant.id);
    expect(meter.tenantId).toBe(tenant.id);
    expect(meter.tenantSlug).toBe('sso2-diner');
    expect(meter.plan).toBe('free');
    expect(meter.usage).toHaveProperty('products');
    expect(meter.usage).toHaveProperty('ordersToday');
    expect(meter.usage).toHaveProperty('members');
    expect(meter.usage).toHaveProperty('storageMb');
    expect(meter.limits.products).toBe(3);
    expect(meter.period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meter.reportedAt).toBeTruthy();
  });

  it('is a no-op when the billing webhook is unset', async () => {
    const before = env.BILLING_WEBHOOK_URL;
    process.env.BILLING_WEBHOOK_URL = '';
    const { getBillingMeter: gm } = await import('../services/billingService.js');
    const result = await reportTenantMeter(tenant.id);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('disabled');
    process.env.BILLING_WEBHOOK_URL = before;
  });

  it('POSTs snapshots to a local webhook and signs them when a secret is set', async () => {
    // A tiny local HTTP server stands in for the billing consumer.
    const http = await import('node:http');
    const { createHmac } = await import('node:crypto');
    let received = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received = { url: req.url, headers: req.headers, body: JSON.parse(body) };
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/billing`;
    const secret = 'test-billing-secret';
    const before = { url: env.BILLING_WEBHOOK_URL, secret: env.BILLING_WEBHOOK_SECRET };
    process.env.BILLING_WEBHOOK_URL = url;
    process.env.BILLING_WEBHOOK_SECRET = secret;

    try {
      const result = await reportAllTenantMeters();
      expect(result.some((r) => r.sent === true)).toBe(true);
      expect(received).toBeTruthy();
      expect(received.body.event).toBe('billing.usage_snapshot');
      expect(received.body.tenantSlug).toBe('sso2-diner');
      const expectedSig = createHmac('sha256', secret)
        .update(JSON.stringify(received.body))
        .digest('hex');
      expect(received.headers['x-billing-signature']).toBe(expectedSig);
    } finally {
      server.close();
      process.env.BILLING_WEBHOOK_URL = before.url;
      process.env.BILLING_WEBHOOK_SECRET = before.secret;
    }
  });

  it('exposes the meter through the API to owners, not cashiers', async () => {
    const ownerRes = await request(app)
      .get(`/api/tenants/${tenant.id}/billing/meter`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenant.id));
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.plan).toBe('free');

    // A cashier member cannot read the meter.
    const cashier = await User.create({
      name: 'Cashier',
      email: 'sso2cashier@example.com',
      password: await bcrypt.hash(PASSWORD, 10),
      platform_role: 'member',
    });
    await UserTenant.create({ user_id: cashier.id, tenant_id: tenant.id, role: 'cashier' });
    const cashierLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'sso2cashier@example.com', password: PASSWORD });
    const cashierRes = await request(app)
      .get(`/api/tenants/${tenant.id}/billing/meter`)
      .set('Authorization', `Bearer ${cashierLogin.body.accessToken}`)
      .set('X-Tenant', String(tenant.id));
    expect(cashierRes.status).toBe(403);
  });
});

describe('platform admin SSO overview', () => {
  it('lists every workspace with its SAML config status', async () => {
    const res = await request(app)
      .get('/api/admin/sso')
      .set('Authorization', `Bearer ${platformToken}`)
      .set('X-Tenant', String(tenant.id));
    expect(res.status).toBe(200);
    expect(res.body.totals.tenants).toBeGreaterThanOrEqual(1);
    const ws = res.body.workspaces.find((w) => w.slug === 'sso2-diner');
    expect(ws).toBeTruthy();
    expect(ws.sso.enabled).toBe(true);
    expect(ws.sso.idpEntityId).toBe('https://idp.example.com/metadata');
    expect(ws.sso.idpSloUrl).toBe('https://idp.example.com/slo/post');
    // No certificate anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('BEGIN CERTIFICATE');
    expect(ws.sso).not.toHaveProperty('idpCert');
  });

  it('is gated to platform admins', async () => {
    const res = await request(app)
      .get('/api/admin/sso')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Tenant', String(tenant.id));
    expect(res.status).toBe(403);
  });

  it('reports recent SSO sign-ins with actor details', async () => {
    // The auth.saml_login audit rows may be empty here; the shape still holds.
    const res = await request(app)
      .get('/api/admin/sso?limit=5')
      .set('Authorization', `Bearer ${platformToken}`)
      .set('X-Tenant', String(tenant.id));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.recentLogins)).toBe(true);
    expect(res.body.recentLogins.length).toBeLessThanOrEqual(5);
  });
});
