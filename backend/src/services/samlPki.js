import 'reflect-metadata';
import crypto from 'node:crypto';
import { X509CertificateGenerator } from '@peculiar/x509';

/**
 * Self-signed RSA-2048 / SHA-256 identity (replaces the archived node-forge
 * path): returns an X.509 certificate PEM plus a PKCS#1 private-key PEM.
 * Uses the native WebCrypto provider plus @peculiar/x509 so no key material
 * is shared across deployments — each call emits a fresh key pair.
 */
export async function generateSelfSignedCert({ commonName, notAfterDays }) {
  const keys = await crypto.webcrypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const now = Date.now();
  const cert = await X509CertificateGenerator.createSelfSigned({
    serialNumber: crypto.webcrypto
      .getRandomValues(new Uint8Array(8))
      .reduce((hex, b) => hex + b.toString(16).padStart(2, '0'), ''),
    name: `CN=${commonName}`,
    notBefore: new Date(now - 86400000),
    notAfter: new Date(now + notAfterDays * 86400000),
    signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    keys,
  });

  const privateKeyDer = Buffer.from(
    await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey)
  );
  const privateKey = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });
  return {
    certPem: cert.toString('pem'),
    keyPem: privateKey.export({ type: 'pkcs1', format: 'pem' }),
  };
}