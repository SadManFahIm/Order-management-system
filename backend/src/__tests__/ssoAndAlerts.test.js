import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import forge from 'node-forge';
import crypto from 'node:crypto';
import app from '../app.js';
import sequelize from '../config/db.js';
import { resetTestDb } from '../test/resetDb.js';
import {
  User,
  Tenant,
  UserTenant,
  Plan,
  Subscription,
  TenantSamlConfig,
} from '../models/index.js';
import { SignedXml } from 'xml-crypto';
import {
  buildSsoInitUrl,
  handleAcs,
  serializeSamlConfig,
} from '../services/samlService.js';
import { runTrialExpirySweep } from '../services/trialService.js';
import { notifyQuotaIfCrossed, getPlanUsage } from '../services/planService.js';

/**
 * Phase 3 follow-ups — SAML SSO (signed-assertion round trip), quota
 * exceedance alerts (threshold stamping), and the trial-expiry sweep.
 */

const PASSWORD = 'Str0ngPass!42';

let tenant;
let ownerToken;
let samlConfig;
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

/** Build a signed SAMLResponse (IdP side) for the given email. */
function buildSignedSamlResponse({ email, name = 'SSO User', certPem, keyPem }) {
  const assertionId = `_${crypto.randomBytes(12).toString('hex')}`;
  const now = new Date();
  const notOnOrAfter = new Date(now.getTime() + 5 * 60000).toISOString();
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    ' xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
    ` ID="_resp${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${now.toISOString()}"`,
    ' Destination="http://localhost:4000/api/auth/saml/acs">',
    '  <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>',
    '  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>',
    `  <saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${now.toISOString()}">`,
    '    <saml:Issuer>https://idp.example.com/metadata</saml:Issuer>',
    `    <saml:Conditions NotBefore="${now.toISOString()}" NotOnOrAfter="${notOnOrAfter}">`,
    '      <saml:AudienceRestriction><saml:Audience>orderly.app</saml:Audience></saml:AudienceRestriction>',
    '    </saml:Conditions>',
    '    <saml:Subject>',
    `      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>`,
    '      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">',
    `        <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}"/>`,
    '      </saml:SubjectConfirmation>',
    '    </saml:Subject>',
    `    <saml:AuthnStatement AuthnInstant="${now.toISOString()}">`,
    '      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>',
    '    </saml:AuthnStatement>',
    '    <saml:AttributeStatement>',
    '      <saml:Attribute Name="email" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">',
    `        <saml:AttributeValue>${email}</saml:AttributeValue>`,
    '      </saml:Attribute>',
    '      <saml:Attribute Name="displayName" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">',
    `        <saml:AttributeValue>${name}</saml:AttributeValue>`,
    '      </saml:Attribute>',
    '    </saml:AttributeStatement>',
    '  </saml:Assertion>',
    '</samlp:Response>',
  ].join('');

  const sig = new SignedXml({
    privateKey: keyPem,
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  });
  sig.addReference({
    xpath: `//*[local-name(.)='Assertion' and namespace-uri(.)='urn:oasis:names:tc:SAML:2.0:assertion' and @ID='${assertionId}']`,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='Issuer']", action: 'after' },
    prefix: 'ds',
  });
  return sig.getSignedXml();
}

beforeAll(async () => {
  await resetTestDb();

  const [free] = await Plan.findOrCreate({
    where: { code: 'free' },
    defaults: { name: 'Free', price_mo: 0, max_products: 3, max_orders_per_day: 5, max_members: 10, storage_mb: 1 },
  });
  await free.update({ max_products: 3, max_orders_per_day: 5, max_members: 10, storage_mb: 1 });
  const [starter] = await Plan.findOrCreate({
    where: { code: 'starter' },
    defaults: { name: 'Starter', price_mo: 9, max_products: 100, max_orders_per_day: 300, max_members: 5, storage_mb: 500 },
  });
  await starter.update({ max_products: 100, max_orders_per_day: 300, max_members: 5, storage_mb: 500 });

  tenant = await Tenant.create({ name: 'SSO Diner', slug: 'sso-diner', plan_id: free.id });

  const owner = await User.create({
    name: 'SSO Owner',
    email: 'ssoowner@example.com',
    password: await bcrypt.hash(PASSWORD, 10),
    platform_role: 'member',
  });
  await UserTenant.create({ user_id: owner.id, tenant_id: tenant.id, role: 'owner' });

  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'ssoowner@example.com', password: PASSWORD });
  ownerToken = login.body.accessToken;

  const idp = makeIdpCert();
  idpCertPem = idp.certPem;
  idpKeyPem = idp.keyPem;
  samlConfig = await TenantSamlConfig.create({
    tenant_id: tenant.id,
    enabled: true,
    idp_entity_id: 'https://idp.example.com/metadata',
    idp_sso_url: 'https://idp.example.com/sso/post',
    idp_cert: idp.certPem,
    attribute_email: 'email',
    attribute_name: 'displayname',
    default_role: 'cashier',
  });
});

afterAll(async () => {
  await sequelize.close();
});

describe('SAML SSO', () => {
  it('builds an SP-initiated redirect URL with an AuthnRequest', async () => {
    const { url, relayState } = await buildSsoInitUrl('sso-diner');
    expect(relayState).toBe('sso-diner');
    expect(url).toContain('https://idp.example.com/sso/post');
    expect(url).toContain('SAMLRequest=');
    // Deflated + base64 payload decodes back to a SAML AuthnRequest.
    const encoded = decodeURIComponent(url.split('SAMLRequest=')[1].split('&')[0]);
    const inflate = await import('node:zlib').then((z) => z.inflateRawSync);
    const xml = inflate(Buffer.from(encoded, 'base64')).toString('utf8');
    expect(xml).toContain('samlp:AuthnRequest');
    expect(xml).toContain('AssertionConsumerServiceURL');
    expect(xml).toContain('urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST');
  });

  it('rejects init for an unknown tenant', async () => {
    const res = await request(app).get('/api/auth/saml/init?tenant=nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it('rejects a SAML response with no signature', async () => {
    const { handleAcs } = await import('../services/samlService.js');
    await expect(
      handleAcs({ samlResponse: Buffer.from('<Response/>').toString('base64'), relayState: 'sso-diner' }, {})
    ).rejects.toMatchObject({ status: 401, code: 'SAML_SIGNATURE_MISSING' });
  });

  it('provisions a user and issues a session on a valid signed response', async () => {
    const xml = buildSignedSamlResponse({
      email: 'sso.user@example.com',
      name: 'SSO User',
      certPem: idpCertPem,
      keyPem: idpKeyPem,
    });
    const res = await request(app)
      .post('/api/auth/saml/acs')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(xml).toString('base64'), RelayState: 'sso-diner' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('sso.user@example.com');
    expect(res.body.tenant.slug).toBe('sso-diner');

    const user = await User.findOne({ where: { email: 'sso.user@example.com' } });
    expect(user).toBeTruthy();
    // SSO users are provisioned with a verified email and an unusable password.
    expect(user.email_verified_at).toBeTruthy();
    const membership = await UserTenant.findOne({
      where: { user_id: user.id, tenant_id: tenant.id },
    });
    expect(membership.role).toBe('cashier');
  });

  it('reuses an existing user and does not duplicate memberships', async () => {
    const xml = buildSignedSamlResponse({
      email: 'sso.user@example.com',
      certPem: idpCertPem,
      keyPem: idpKeyPem,
    });
    const res = await request(app)
      .post('/api/auth/saml/acs')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(xml).toString('base64'), RelayState: 'sso-diner' });
    expect(res.status).toBe(200);

    const memberships = await UserTenant.findAll({
      where: { tenant_id: tenant.id },
      include: [{ model: User, where: { email: 'sso.user@example.com' } }],
    });
    expect(memberships.length).toBe(1);
  });

  it('rejects a response signed with the wrong certificate (key confusion)', async () => {
    const evil = makeIdpCert('evil.example.com');
    const xml = buildSignedSamlResponse({
      email: 'evil@example.com',
      certPem: evil.certPem,
      keyPem: evil.keyPem,
    });
    const res = await request(app)
      .post('/api/auth/saml/acs')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(xml).toString('base64'), RelayState: 'sso-diner' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SAML_SIGNATURE_INVALID');
  });

  it('rejects a tampered assertion body', async () => {
    const xml = buildSignedSamlResponse({
      email: 'sso.user@example.com',
      certPem: idpCertPem,
      keyPem: idpKeyPem,
    });
    const tampered = xml.replace('sso.user@example.com', 'attacker@example.com');
    const res = await request(app)
      .post('/api/auth/saml/acs')
      .type('form')
      .set('Accept', 'application/json')
      .send({ SAMLResponse: Buffer.from(tampered).toString('base64'), RelayState: 'sso-diner' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SAML_SIGNATURE_INVALID');
  });

  it('serializes the config without exposing the certificate', () => {
    const view = serializeSamlConfig(samlConfig);
    expect(view.id).toBe(samlConfig.id);
    expect(view.hasCertificate).toBe(true);
    expect(view.idpCert).toBeUndefined();
  });
});

describe('quota exceedance alerts', () => {
  it('stamps a threshold once per day and never rejects', async () => {
    // The free plan has max_products = 3; add real products to push usage
    // to 100% (countUsage counts Product rows, not the usage counter).
    const { Product } = await import('../models/index.js');
    const existing = await Product.count({ where: { tenant_id: tenant.id } });
    for (let i = existing; i < 3; i += 1) {
      await Product.create({
        tenant_id: tenant.id,
        name: `Alert Item ${i}`,
        price: 100 + i,
        weight_gm: 200 + i,
        vat_rate: 5,
        version: 1,
      });
    }

    const alerts = await notifyQuotaIfCrossed(tenant.id);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const productAlert = alerts.find((a) => a.metric === 'products');
    expect(productAlert).toBeTruthy();
    expect(productAlert.percent).toBeGreaterThanOrEqual(80);

    // Second call the same day: no re-alert (stamped).
    const again = await notifyQuotaIfCrossed(tenant.id);
    expect(again.length).toBe(0);
  });

  it('does not alert when limits are zero (unlimited plans)', async () => {
    const [growth] = await Plan.findOrCreate({
      where: { code: 'growth' },
      defaults: { name: 'Growth', price_mo: 79, max_products: 0, max_orders_per_day: 0, max_members: 0, storage_mb: 0 },
    });
    const gTenant = await Tenant.create({
      name: 'Growth Diner',
      slug: 'growth-diner',
      plan_id: growth.id,
      status: 'active',
    });
    const alerts = await notifyQuotaIfCrossed(gTenant.id);
    expect(alerts.length).toBe(0);
  });
});

describe('trial expiry', () => {
  it('downgrades an expired trial to Free and logs the audit event', async () => {
    const [starter] = await Plan.findAll({ where: { code: 'starter' } });
    const [free] = await Plan.findAll({ where: { code: 'free' } });

    const tTenant = await Tenant.create({
      name: 'Trial Diner',
      slug: 'trial-diner',
      plan_id: starter.id,
      status: 'active',
    });
    const sub = await Subscription.create({
      tenant_id: tTenant.id,
      plan_id: starter.id,
      status: 'trialing',
      trial_ends_at: new Date(Date.now() - 60 * 60 * 1000), // expired an hour ago
      renews_at: new Date(Date.now() - 60 * 60 * 1000),
      current_period_start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      current_period_end: new Date(Date.now() - 60 * 60 * 1000),
    });

    const downgraded = await runTrialExpirySweep();
    expect(downgraded).toBeGreaterThanOrEqual(1);

    await sub.reload();
    expect(sub.status).toBe('expired');
    expect(sub.plan_id).toBe(free.id);
    await tTenant.reload();
    expect(tTenant.plan_id).toBe(free.id);
  });

  it('is idempotent — a second sweep does nothing', async () => {
    const before = await Subscription.count({ where: { status: 'expired' } });
    const again = await runTrialExpirySweep();
    expect(again).toBe(0);
    const after = await Subscription.count({ where: { status: 'expired' } });
    expect(after).toBe(before);
  });

  it('leaves non-expired trials alone', async () => {
    const [starter] = await Plan.findAll({ where: { code: 'starter' } });
    const [free] = await Plan.findAll({ where: { code: 'free' } });

    const fresh = await Tenant.create({
      name: 'Fresh Trial',
      slug: 'fresh-trial',
      plan_id: starter.id,
      status: 'active',
    });
    const sub = await Subscription.create({
      tenant_id: fresh.id,
      plan_id: starter.id,
      status: 'trialing',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      renews_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      current_period_start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const downgraded = await runTrialExpirySweep();
    expect(downgraded).toBe(0);
    await sub.reload();
    expect(sub.status).toBe('trialing');
    await fresh.reload();
    expect(fresh.plan_id).toBe(starter.id);
    expect(fresh.plan_id).not.toBe(free.id);
  });
});

