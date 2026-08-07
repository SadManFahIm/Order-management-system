import { describe, it, expect } from 'vitest';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * S3 driver integration tier (Phase 4 completion).
 *
 * Exercises the real S3-compatible path (putObject → publicUrl → read back
 * via the SDK → removeObject) against a MinIO instance. Skips cleanly when
 * MinIO is not configured, so local/CI runs without it stay green. Enable
 * with:
 *
 *   STORAGE_DRIVER=s3 \
 *   S3_ENDPOINT=http://localhost:9000 \
 *   S3_BUCKET=oms-test \
 *   S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin \
 *   S3_FORCE_PATH_STYLE=1 \
 *   npm test -- s3Storage
 *
 * Note: read-back uses the AWS SDK (signed request) because buckets are
 * private by default — an anonymous HTTP GET would 403.
 */

const configured =
  process.env.STORAGE_DRIVER === 's3' &&
  !!process.env.S3_ENDPOINT &&
  !!process.env.S3_BUCKET &&
  !!process.env.S3_ACCESS_KEY_ID &&
  !!process.env.S3_SECRET_ACCESS_KEY;

const { putObject, removeObject, publicUrl, buildObjectKey } = configured
  ? await import('../config/storage.js')
  : {};

const maybe = configured ? describe : describe.skip;
maybe('S3-compatible storage driver (MinIO)', () => {
  const s3 = configured
    ? new S3Client({
        region: process.env.S3_REGION || 'us-east-1',
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1' || process.env.S3_FORCE_PATH_STYLE === 'true',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      })
    : null;

  it('round-trips an object: put → url → read back → remove', async () => {
    const key = buildObjectKey({
      tenantId: 1,
      originalName: 'minio-test.png',
      ext: 'webp',
    });
    const body = Buffer.from('fake webp bytes for integration test');

    const url = await putObject({ key, buffer: body, contentType: 'image/webp' });
    expect(url).toContain('/tenants/1/images/');
    expect(url.endsWith(key)).toBe(true);

    // Read back with the SDK (buckets are private — anonymous GET would 403).
    const got = await s3.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key })
    );
    const readBack = Buffer.from(await got.Body.transformToByteArray());
    expect(readBack.equals(body)).toBe(true);

    await removeObject(key);

    // After removal the object is gone (GetObject 404s).
    await expect(
      s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }))
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 404 } });
  });

  it('publicUrl builds a URL that includes the object key', () => {
    const key = 'tenants/1/images/abc.webp';
    const url = publicUrl(key);
    expect(url).toContain(key);
  });
});
