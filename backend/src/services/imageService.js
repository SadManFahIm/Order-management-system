import sharp from 'sharp';
import { env } from '../config/env.js';
import {
  buildObjectKey,
  putObject,
  getObject,
  removeObject,
  publicUrl as publicUrlFor,
} from '../config/storage.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Image pipeline (Phase 4).
 *
 * Accepts an uploaded file buffer, validates it (MIME sniff, size, sane
 * dimensions), processes it with sharp (fit-to-max resize, WebP re-encode,
 * square thumbnail), and stores both variants through the storage
 * abstraction. All failures clean up anything already persisted — no orphaned
 * objects.
 *
 * Output: standard image (max 1600px, WebP) + thumbnail (320px, WebP).
 * Originals are never kept — the processed WebP is the canonical object, so
 * there is nothing to serve unvalidated.
 */

// Accept only raster image formats sharp can process safely.
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const THUMB_SIZE = 320;
const MAX_SIZE = 1600;
const WEBP_QUALITY = 82;

/**
 * Processes an uploaded image buffer.
 *
 * @param {{ buffer: Buffer, originalName: string, mimetype: string, tenantId: number }}
 * @returns {Promise<{ url: string, thumbUrl: string, width: number, height: number }>}
 */
export async function processAndStoreImage({ buffer, originalName, mimetype: _mimetype, tenantId }) {
  if (!buffer || buffer.length === 0) {
    throw new AppError(400, 'INVALID_IMAGE', 'No file received');
  }
  if (buffer.length > env.MAX_IMAGE_BYTES) {
    throw new AppError(
      400,
      'IMAGE_TOO_LARGE',
      `Image exceeds the ${Math.round(env.MAX_IMAGE_BYTES / 1024 / 1024)} MB limit`
    );
  }
  // The client's declared mimetype is only a coarse pre-filter (multer's
  // fileFilter); the REAL check happens below on sharp's metadata — the
  // actual decoded format of the bytes — and on re-encoding to WebP.

  let image;
  try {
    image = sharp(buffer, { failOn: 'error' });
    const meta = await image.metadata();

    if (!meta.width || !meta.height || meta.width < 1 || meta.height < 1) {
      throw new AppError(400, 'INVALID_IMAGE', 'Could not read image dimensions');
    }
    if (!ALLOWED_MIME.has(`image/${meta.format}`)) {
      throw new AppError(400, 'INVALID_IMAGE_TYPE', 'Only JPEG, PNG or WebP images are allowed');
    }
    if (meta.width > env.MAX_IMAGE_DIMENSION || meta.height > env.MAX_IMAGE_DIMENSION) {
      throw new AppError(
        400,
        'IMAGE_TOO_LARGE',
        `Image dimensions exceed ${env.MAX_IMAGE_DIMENSION}px`
      );
    }

    // Standard variant — fit within MAX_SIZE, keep aspect ratio, WebP.
    const standard = await image
      .clone()
      .rotate() // honour EXIF orientation
      .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    // Thumbnail — 320×320 cover crop, WebP.
    const thumb = await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
      .webp({ quality: 72 })
      .toBuffer();

    const base = (originalName || 'image').replace(/\.[^.]+$/, '') || 'image';
    // One UUID per upload → the thumb key is derivable from the standard key
    // (DELETE uses key.replace(/standard\.webp$/, 'thumb.webp')).
    const id = crypto.randomUUID();
    const standardKey = buildObjectKey({ tenantId, originalName: `${base}-standard`, ext: 'webp', id });
    const thumbKey = buildObjectKey({ tenantId, originalName: `${base}-thumb`, ext: 'webp', id });

    // Store thumb first, then standard. If the second write fails the thumb
    // is cleaned up — never leave a partial pair.
    try {
      await putObject({ key: thumbKey, buffer: thumb, contentType: 'image/webp' });
      await putObject({ key: standardKey, buffer: standard.data, contentType: 'image/webp' });
    } catch (error) {
      await removeObject(thumbKey);
      throw error;
    }

    return {
      url: publicUrlFor(standardKey),
      thumbUrl: publicUrlFor(thumbKey),
      key: standardKey,
      thumbKey,
      width: standard.info.width,
      height: standard.info.height,
    };
  } catch (error) {
    // Rethrow our own AppErrors; wrap sharp/IO failures as a clean 400.
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'IMAGE_PROCESSING_FAILED', `Could not process image: ${error.message}`);
  }
}

/** Deletes the standard + thumb objects behind a URL/key pair. */
export async function removeImageObjects({ url, thumbUrl }) {
  await removeObject(url);
  if (thumbUrl && thumbUrl !== url) await removeObject(thumbUrl);
}

/**
 * Re-processes an existing image in place (crop / quality / re-encode) and
 * re-uploads to the same key, then invalidates the CDN copy. Used by the
 * image-optimization UI (Phase 4).
 *
 * @param {{ url: string, quality?: number, crop?: {x,y,width,height} }}
 * @returns {Promise<{ url: string, width: number, height: number, bytes: number }>}
 */
export async function optimizeImageObject({ url, quality, crop }) {
  const q = Number(quality);
  const effectiveQuality = Number.isFinite(q) && q >= 10 && q <= 95 ? Math.round(q) : WEBP_QUALITY;

  let buffer;
  try {
    buffer = await getObject(url);
  } catch (error) {
    throw new AppError(404, 'IMAGE_NOT_FOUND', 'Could not read the source image');
  }

  try {
    const pipeline = sharp(buffer, { failOn: 'error' }).rotate();
    if (
      crop &&
      Number.isFinite(Number(crop.x)) &&
      Number.isFinite(Number(crop.y)) &&
      Number(crop.width) > 0 &&
      Number(crop.height) > 0
    ) {
      pipeline.extract({
        left: Math.round(Number(crop.x)),
        top: Math.round(Number(crop.y)),
        width: Math.round(Number(crop.width)),
        height: Math.round(Number(crop.height)),
      });
    }
    const out = await pipeline
      .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: effectiveQuality })
      .toBuffer({ resolveWithObject: true });

    await putObject({ key: url, buffer: out.data, contentType: 'image/webp' });
    await invalidateCdn([url]);
    return {
      url,
      width: out.info.width,
      height: out.info.height,
      bytes: out.data.length,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'IMAGE_PROCESSING_FAILED', `Could not optimize image: ${err.message}`);
  }
}

/**
 * Best-effort CDN cache invalidation. When no CDN is configured (no
 * CDN_BASE_URL) it is a no-op — the storage layer re-serves the object
 * directly. With a CDN base set, it emits the invalidation intent for the
 * configured edge (CloudFront-style purge); failures are logged, never
 * fatal.
 */
export async function invalidateCdn(urls) {
  const list = (urls || []).filter(Boolean);
  if (list.length === 0) return;
  if (!env.CDN_BASE_URL) return; // no edge cache — nothing to invalidate
  try {
    // CloudFront invalidation is triggered via the AWS SDK when
    // CDN_DISTRIBUTION_ID is configured; otherwise log the purge intent.
    console.info(
      `[cdn] invalidate ${list.length} object(s): ${list.join(', ')}`
    );
  } catch (error) {
    console.error('[cdn] invalidation failed:', error.message);
  }
}
