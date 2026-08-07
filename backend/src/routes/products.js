import express from 'express';
import multer from 'multer';
import Product from '../models/Product.js';
import MenuCategory from '../models/MenuCategory.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { parsePagination } from '../utils/pagination.js';
import { importProductsCsv, CSV_TEMPLATE, IMPORT_COLUMNS } from '../services/importService.js';
import { env } from '../config/env.js';

// Rich menu includes (Phase 4).
const MENU_INCLUDE = [
  { model: MenuCategory, as: 'category', attributes: ['id', 'name'] },
  { model: ItemVariant, as: 'variants' },
  { model: ItemAddon, as: 'addons' },
];

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant);

// Product mutations require menu management rights (owner/manager/admin).
const canManageMenu = requirePermission('manage:menu');

/** GET /api/products?limit=&offset= — paginated list (returns an array + X-Total-Count). */
router.get(
  '/',
  requirePermission('view:menu'),
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);

    const { rows, count } = await Product.findAndCountAll({
      where: { tenant_id: req.tenant.id },
      include: MENU_INCLUDE,
      order: [['id', 'ASC']],
      limit,
      offset,
    });

    res.set('X-Total-Count', String(count));
    res.json(rows);
  })
);

/** POST /api/products */
router.post(
  '/',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const { name, description, price, weight_gm, enabled, category_id, prep_minutes, image_url } =
      req.body;

    if (!name || typeof name !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Product name is required');
    }
    if (typeof price !== 'number' || price < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-negative price is required');
    }
    if (!Number.isInteger(weight_gm) || weight_gm <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'weight_gm must be a positive integer');
    }

    // The category must belong to the same tenant (fail-closed).
    if (category_id) {
      const category = await MenuCategory.findOne({
        where: { id: category_id, tenant_id: req.tenant.id },
      });
      if (!category) {
        throw new AppError(400, 'INVALID_CATEGORY', 'Category not found in this workspace');
      }
    }

    const p = await Product.create({
      tenant_id: req.tenant.id,
      name,
      description,
      price,
      weight_gm,
      enabled: enabled ?? true,
      category_id: category_id ?? null,
      prep_minutes: prep_minutes ?? null,
      image_url: image_url ?? null,
    });
    const withMenu = await Product.findByPk(p.id, { include: MENU_INCLUDE });
    res.status(201).json(withMenu);
  })
);

/** GET /api/products/import/template — CSV template + column reference. */
router.get(
  '/import/template',
  canManageMenu,
  (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="menu-import-template.csv"');
    res.send(CSV_TEMPLATE);
  }
);

/** POST /api/products/import — bulk CSV import (partial success). */
router.post(
  '/import',
  canManageMenu,
  (req, res, next) => {
    multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_IMPORT_BYTES } }).single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError(400, 'IMPORT_TOO_LARGE', `Import file exceeds the ${Math.round(env.MAX_IMPORT_BYTES / 1024 / 1024)} MB limit`));
      }
      if (err) return next(err);
      return next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'IMPORT_FILE_REQUIRED', 'Attach the CSV as a multipart field named "file"');
    }
    const csv = req.file.buffer.toString('utf8');
    const duplicates = ['skip', 'error', 'update'].includes(req.body.duplicates)
      ? req.body.duplicates
      : 'skip';
    const summary = await importProductsCsv({ csv, tenantId: req.tenant.id, duplicates });
    res.status(201).json({ ...summary, columns: IMPORT_COLUMNS });
  })
);

/** PUT /api/products/:id */
router.put(
  '/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const p = await Product.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    const { name, description, price, weight_gm, enabled, category_id, prep_minutes, image_url } =
      req.body;

    if (category_id !== undefined && category_id !== null) {
      const category = await MenuCategory.findOne({
        where: { id: category_id, tenant_id: req.tenant.id },
      });
      if (!category) {
        throw new AppError(400, 'INVALID_CATEGORY', 'Category not found in this workspace');
      }
      p.category_id = category_id;
    } else if (category_id === null) {
      p.category_id = null;
    }

    if (name !== undefined) p.name = name;
    if (description !== undefined) p.description = description;
    if (price !== undefined) p.price = price;
    if (weight_gm !== undefined) p.weight_gm = weight_gm;
    if (enabled !== undefined) p.enabled = enabled;
    if (prep_minutes !== undefined) p.prep_minutes = prep_minutes;
    if (image_url !== undefined) p.image_url = image_url;
    await p.save();

    const withMenu = await Product.findByPk(p.id, { include: MENU_INCLUDE });
    res.json(withMenu);
  })
);

export default router;
