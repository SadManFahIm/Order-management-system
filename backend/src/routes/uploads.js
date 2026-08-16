import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { processAndStoreImage, removeImageObjects, optimizeImageObject } from '../services/imageService.js';
import { env } from '../config/env.js';
import { assertQuota, incrementUsage, notifyQuotaIfCrossed, LIFETIME_PERIOD } from '../services/planService.js';

/**
 * Image upload endpoints (Phase 4).
 *
 * - POST /api/uploads/images  — multipart `image` field → processed WebP +
 *   thumbnail stored via the configured driver; returns public URLs.
 * - DELETE /api/uploads/images/:key — remove an object (and its thumbnail).
 *
 * Both are authenticated, tenant-scoped and gated to `manage:menu`. The
 * storage layer generates object keys server-side (never from user input),
 * and the local driver needs no external infrastructure in dev.
 */
const router = express.Router();

// In-memory upload (we process with sharp immediately; nothing touches disk
// before validation). The size cap is an extra guard beyond MAX_IMAGE_BYTES.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    return cb(new AppError(400, 'INVALID_IMAGE_TYPE', 'Only JPEG, PNG or WebP images are allowed'));
  },
});

router.use(authMiddleware, resolveTenant, requireTenant);
const canManageMenu = requirePermission('manage:menu');

/** POST /api/uploads/images — upload + process + store. */
router.post(
  '/images',
  canManageMenu,
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(400, 'IMAGE_TOO_LARGE', `Image exceeds the ${Math.round(env.MAX_IMAGE_BYTES / 1024 / 1024)} MB limit`)
        );
      }
      if (err) return next(err);
      return next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'INVALID_IMAGE', 'No image file received (field name: image)');
    }
    // Plan quota gate (Phase 3) — storage is limited per plan; the check
    // covers the *resulting* footprint, and only the raw bytes are counted
    // (the processed WebP + thumb are roughly equal in size).
    await assertQuota(req.tenant.id, 'storage_bytes', { adding: req.file.size });
    const result = await processAndStoreImage({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      tenantId: req.tenant.id,
    });
    await incrementUsage(req.tenant.id, 'storage_bytes', req.file.size, LIFETIME_PERIOD);
    void notifyQuotaIfCrossed(req.tenant.id);
    res.status(201).json({
      url: result.url,
      thumbUrl: result.thumbUrl,
      key: result.key,
      thumbKey: result.thumbKey,
      width: result.width,
      height: result.height,
    });
  })
);

/** POST /api/uploads/images/:key/optimize — crop/compress an existing
 * image in place (Phase 4 image-optimization UI). Body:
 * { quality?: 10-95, crop?: { x, y, width, height } }. Re-uploads to the
 * same key and invalidates the CDN edge copy. */
router.post(
  '/images/:key/optimize',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const KEY_PATTERN = /^[a-f0-9-]{36}-[a-z0-9._-]+\.webp$/;
    if (!KEY_PATTERN.test(req.params.key)) {
      throw new AppError(400, 'INVALID_IMAGE_KEY', 'Invalid image key');
    }
    const key = `tenants/${req.tenant.id}/images/${req.params.key}`;
    const result = await optimizeImageObject({
      url: key,
      quality: req.body?.quality,
      crop: req.body?.crop,
    });
    res.json({ message: 'Image optimized', ...result });
  })
);

/** DELETE /api/uploads/images/:key — remove an object + thumbnail. */
router.delete(
  '/images/:key',
  canManageMenu,
  asyncHandler(async (req, res) => {
    // Strict pattern: UUID-base.webp only. Blocks `..`, slashes, and any
    // other input from reaching the storage driver (path traversal).
    const KEY_PATTERN = /^[a-f0-9-]{36}-[a-z0-9._-]+\.webp$/;
    if (!KEY_PATTERN.test(req.params.key)) {
      throw new AppError(400, 'INVALID_IMAGE_KEY', 'Invalid image key');
    }
    const key = `tenants/${req.tenant.id}/images/${req.params.key}`;
    await removeImageObjects({
      url: key,
      thumbUrl: key.replace(/standard\.webp$/, 'thumb.webp'),
    });
    res.json({ message: 'Image removed' });
  })
);

export default router;
