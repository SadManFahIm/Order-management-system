import sharp from 'sharp';
import { env } from '../config/env.js';
import {
  buildObjectKey,
  putObject,
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
