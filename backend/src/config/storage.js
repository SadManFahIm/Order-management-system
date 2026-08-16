import fsp from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';

/**
 * Object-storage abstraction (Phase 4 image pipeline).
 *
 * Two drivers, selected by `STORAGE_DRIVER`:
 *
 *  - `local` (default): writes files under `UPLOAD_DIR` and serves them via
 *    the express `/uploads` static mount. Zero-config for development and
 *    tests — no external infrastructure required.
 *  - `s3`: any S3-compatible endpoint (AWS S3, MinIO, Cloudflare R2…) via
 *    the AWS SDK v3. Configured purely from environment variables.
 *
 * Public URLs are built through `CDN_BASE_URL` when set (production), so the
 * app never needs to know the storage backend — swap S3 vendors or add a CDN
 * without touching callers.
 *
 * Object keys are always server-generated (random UUID + sanitized basename)
 * — never user-controlled paths — so path traversal / key injection is
 * structurally impossible.
 */
export const storageDriver = env.STORAGE_DRIVER;

const safeBaseName = (original) => {
  const base = path.basename(original || 'image').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  return base || 'image';
};

/**
 * Generates a namespaced object key: {tenant}/{uuid}-{base}.{ext}.
 * Pass the same `id` for related variants (standard/thumb) so the thumb key
 * is derivable from the standard key (needed for deletes).
 */
export function buildObjectKey({ tenantId, originalName, ext, id }) {
  const uuid = id || crypto.randomUUID();
  const base = safeBaseName(originalName).replace(/\.[^.]+$/, '');
  return `tenants/${tenantId}/images/${uuid}-${base}.${ext}`;
}

/** Splits a public URL back into an object key (used for deletes). */
export function keyFromUrl(url) {
  if (!url) return null;
  for (const prefix of [env.CDN_BASE_URL, env.APP_BASE_URL]) {
    if (prefix && url.startsWith(prefix)) {
      return url.slice(prefix.length).replace(/^\//, '');
    }
  }
  return null;
}

const s3Client = (() => {
  if (storageDriver !== 's3') return null;
  const missing = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(
    (k) => !env[k]
  );
  if (missing.length > 0) {
    // Fail fast with a clear, actionable message instead of a confusing crash.
    throw new Error(
      `STORAGE_DRIVER=s3 requires: ${missing.join(', ')} (set in backend/.env)`
    );
  }
  return new S3Client({
    region: env.S3_REGION || 'us-east-1',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
})();

const localRoot = path.resolve(process.cwd(), env.UPLOAD_DIR);

async function putLocal(key, buffer, _contentType) {
  const filePath = path.join(localRoot, key);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, buffer);
}

async function getLocal(key) {
  const filePath = path.join(localRoot, key);
  return fsp.readFile(filePath);
}

async function removeLocal(key) {
  const filePath = path.join(localRoot, key);
  await fsp.rm(filePath, { force: true });
}

async function putS3(key, buffer, contentType) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
}

async function getS3(key) {
  const res = await s3Client.send(
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key })
  );
  // Stream → Buffer (body is a Readable in Node ≥18).
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function removeS3(key) {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key })
  );
}

/** Stores a buffer at `key`. Returns the public URL. */
export async function putObject({ key, buffer, contentType }) {
  if (storageDriver === 's3') {
    await putS3(key, buffer, contentType);
    return publicUrl(key);
  }
  await putLocal(key, buffer, contentType);
  return publicUrl(key);
}

/** Reads an object's bytes by key (throws if missing). */
export async function getObject(keyOrUrl) {
  const key = keyFromUrl(keyOrUrl) || keyOrUrl;
  if (storageDriver === 's3') return getS3(key);
  return getLocal(key);
}

// Strict allowlist for deletion targets — UUID + safe basename + webp only.
// Blocks path traversal (`..`), arbitrary extensions and anything outside the
// generated-image namespace, even if it somehow reaches the driver.
const SAFE_KEY = /^tenants\/\d+\/images\/[a-f0-9-]{36}-[a-z0-9._-]+\.webp$/;

/** Removes an object by key (or public URL). Never throws on already-gone. */
export async function removeObject(keyOrUrl) {
  const key = keyFromUrl(keyOrUrl) || keyOrUrl;
  if (!key || !SAFE_KEY.test(key)) return; // safety: never touch non-generated keys
  try {
    if (storageDriver === 's3') {
      await removeS3(key);
    } else {
      await removeLocal(key);
    }
  } catch (error) {
    // Deletion is best-effort cleanup — log, don't fail the request.
    console.error(`[storage] failed to remove ${key}:`, error.message);
  }
}

/** Builds the public URL for a key (CDN → bucket/API → local static). */
export function publicUrl(key) {
  if (env.CDN_BASE_URL) return `${env.CDN_BASE_URL.replace(/\/$/, '')}/${key}`;
  if (storageDriver === 's3') {
    const bucket = env.S3_BUCKET;
    const endpoint = env.S3_ENDPOINT || `https://s3.${env.S3_REGION || 'us-east-1'}.amazonaws.com`;
    const base = endpoint.replace(/\/$/, '');
    return env.S3_FORCE_PATH_STYLE ? `${base}/${bucket}/${key}` : `${base}/${key}`;
  }
  // Local driver: served by the express `/uploads` static mount.
  return `${env.APP_BASE_URL.replace(/\/$/, '')}/uploads/${key}`;
}

/** Express static mount config for the local driver (serves uploaded files). */
export function localStatic() {
  const MIME_BY_EXT = {
    webp: 'image/webp',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  };
  return {
    root: localRoot,
    setHeaders(res, filePath) {
      const ext = path.extname(filePath).replace('.', '').toLowerCase();
      if (MIME_BY_EXT[ext]) res.setHeader('Content-Type', MIME_BY_EXT[ext]);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  };
}
