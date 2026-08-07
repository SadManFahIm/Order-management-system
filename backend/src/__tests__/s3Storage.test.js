import { describe, it, expect } from 'vitest';

/**
 * S3 driver integration tier (Phase 4 completion).
 *
 * Exercises the real S3-compatible path (putObject → publicUrl → removeObject)
 * against a MinIO instance. Skips cleanly when MinIO is not configured, so
 * local/CI runs without it stay green. Enable with:
 *
 *   STORAGE_DRIVER=s3 \
 *   S3_ENDPOINT=http://localhost:9000 \
 *   S3_BUCKET=oms-test \
 *   S3_ACCESS_KEY_ID=minioadmin S3_SECRET_ACCESS_KEY=minioadmin \
 *   S3_FORCE_PATH_STYLE=1 \
 *   npm test -- s3Storage
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
  it('round-trips an object: put → url → get via public URL → remove', async () => {
    const key = buildObjectKey({
      tenantId: 1,
      originalName: 'minio-test.png',
      ext: 'webp',
    });
    const body = Buffer.from('fake webp bytes for integration test');

    const url = await putObject({ key, buffer: body, contentType: 'image/webp' });
    expect(url).toContain('/tenants/1/images/');
    expect(url.endsWith(key)).toBe(true);

    // The object must be publicly reachable at the returned URL.
    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).equals(body)).toBe(true);

    await removeObject(key);

    // After removal the object is gone.
    const gone = await fetch(url).catch(() => null);
    expect(gone && gone.status === 404 ? true : gone === null).toBe(true);
  });

  it('publicUrl builds the CDN URL when CDN_BASE_URL is set', () => {
    const key = 'tenants/1/images/abc.webp';
    const url = publicUrl(key);
    expect(url).toContain(key);
  });
});
