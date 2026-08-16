import express from 'express';
import multer from 'multer';
import sequelize from '../config/db.js';
import Product from '../models/Product.js';
import MenuCategory from '../models/MenuCategory.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import InventoryItem from '../models/InventoryItem.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { parsePagination } from '../utils/pagination.js';
import {
  importProductsCsv,
  importProductsXlsx,
  CSV_TEMPLATE,
  IMPORT_COLUMNS,
} from '../services/importService.js';
import { env } from '../config/env.js';
import { assertQuota, notifyQuotaIfCrossed } from '../services/planService.js';
import { normalizeTags, bulkUpdateItems, duplicateCategory, sortItems } from '../services/menuService.js';

// Rich menu includes (Phase 4).
const MENU_INCLUDE = [
  { model: MenuCategory, as: 'category', attributes: ['id', 'name'] },
  { model: ItemVariant, as: 'variants' },
  { model: ItemAddon, as: 'addons' },
  { model: InventoryItem, as: 'inventory' },
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
    const { name, description, price, weight_gm, enabled, category_id, prep_minutes, image_url, vat_rate } =
      req.body;
    const tags = normalizeTags(req.body.tags);
    const { available_from, available_to, sort_order } = req.body;

    if (!name || typeof name !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Product name is required');
    }
    if (typeof price !== 'number' || price < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-negative price is required');
    }
    if (!Number.isInteger(weight_gm) || weight_gm <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'weight_gm must be a positive integer');
    }
    if (vat_rate !== undefined && (typeof vat_rate !== 'number' || vat_rate < 0 || vat_rate > 100)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'vat_rate must be between 0 and 100');
    }

    // Plan quota gate (Phase 3) — menu size is limited per plan.
    await assertQuota(req.tenant.id, 'products');

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
      vat_rate: vat_rate ?? 5,
      tags,
      available_from: available_from ?? null,
      available_to: available_to ?? null,
      sort_order: sort_order ?? 0,
    });

    // Optional inventory snapshot rides on the create payload.
    await upsertInventory(req.tenant.id, p.id, name, req.body.inventory);

    // Quota alerting (Phase 3): nudge the owner near the menu limit.
    void notifyQuotaIfCrossed(req.tenant.id);

    const withMenu = await Product.findByPk(p.id, { include: MENU_INCLUDE });
    res.status(201).json(withMenu);
  })
);

/** POST /api/products/bulk — bulk price / stock / enabled / tags edit (Phase 4). */
router.post(
  '/bulk',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const updated = await bulkUpdateItems(req.tenant.id, req.user, req.body, req);
    res.json({ updated });
  })
);

/** POST /api/products/categories/:id/duplicate — deep-copy a category (Phase 4). */
router.post(
  '/categories/:id/duplicate',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const copy = await duplicateCategory(req.tenant.id, req.user, Number(req.params.id), req);
    res.status(201).json(copy);
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

/** POST /api/products/sort — persist a drag-and-drop item order (Phase 4). */
router.post(
  '/sort',
  asyncHandler(async (req, res) => {
    const updated = await sortItems(req.tenant.id, req.user, req.body?.order, req);
    res.json({ updated });
  })
);

/** POST /api/products/import — bulk CSV **or XLSX** import (partial success). */
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
      throw new AppError(400, 'IMPORT_FILE_REQUIRED', 'Attach a CSV or XLSX as a multipart field named "file"');
    }
    const duplicates = ['skip', 'error', 'update'].includes(req.body.duplicates)
      ? req.body.duplicates
      : 'skip';

    // Route by filename/mime — .xlsx goes through the Excel path; everything
    // else is treated as CSV (matching the pre-existing behaviour).
    const filename = (req.file.originalname || '').toLowerCase();
    const isXlsx =
      filename.endsWith('.xlsx') || req.file.mimetype.includes('spreadsheetml');

    const summary = isXlsx
      ? await importProductsXlsx({ buffer: req.file.buffer, tenantId: req.tenant.id, duplicates })
      : await importProductsCsv({ csv: req.file.buffer.toString('utf8'), tenantId: req.tenant.id, duplicates });

    res.status(201).json({ ...summary, columns: IMPORT_COLUMNS });
  })
);

/** DELETE /api/products/:id — SOFT delete (Phase 4 completion): the row keeps
 * its deleted_at timestamp so order history and analytics stay intact. Child
 * variants/add-ons are hard-removed in the same transaction (they are menu
 * artefacts, not history). */
router.delete(
  '/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const p = await Product.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    await sequelize.transaction(async (transaction) => {
      await ItemVariant.destroy({ where: { product_id: p.id }, transaction });
      await ItemAddon.destroy({ where: { product_id: p.id }, transaction });
      await p.destroy({ transaction }); // paranoid → sets deleted_at
    });
    res.status(200).json({ id: p.id, deleted: true });
  })
);

/** PUT /api/products/:id — optimistic locking: send the `version` you based
 * the edit on; a stale write gets 409 and the version bumps on success. */
router.put(
  '/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const p = await Product.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    const { name, description, price, weight_gm, enabled, category_id, prep_minutes, image_url, vat_rate } =
      req.body;
    const tags = req.body.tags !== undefined ? normalizeTags(req.body.tags) : undefined;
    const { available_from, available_to, sort_order } = req.body;

    if (
      vat_rate !== undefined &&
      (typeof vat_rate !== 'number' || vat_rate < 0 || vat_rate > 100)
    ) {
      throw new AppError(400, 'VALIDATION_ERROR', 'vat_rate must be between 0 and 100');
    }

    // Optimistic lock — only enforced when the client supplies a version
    // (legacy callers that never send one keep working).
    if (req.body.version !== undefined) {
      const sentVersion = Number(req.body.version);
      if (!Number.isInteger(sentVersion) || sentVersion !== p.version) {
        throw new AppError(
          409,
          'VERSION_CONFLICT',
          `Product was modified by someone else (expected version ${p.version}, got ${req.body.version}). Reload and retry.`
        );
      }
    }

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
    if (vat_rate !== undefined) p.vat_rate = vat_rate;
    if (tags !== undefined) p.tags = tags;
    if (available_from !== undefined) p.available_from = available_from ?? null;
    if (available_to !== undefined) p.available_to = available_to ?? null;
    if (sort_order !== undefined) p.sort_order = sort_order ?? 0;
    p.version = (p.version ?? 1) + 1;
    await p.save();

    await upsertInventory(req.tenant.id, p.id, p.name, req.body.inventory);

    const withMenu = await Product.findByPk(p.id, { include: MENU_INCLUDE });
    res.json(withMenu);
  })
);

/** PATCH /api/products/:id/inventory — quick stock adjustment (no version). */
router.patch(
  '/:id/inventory',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const p = await Product.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    const inventory = await upsertInventory(req.tenant.id, p.id, p.name, req.body);
    res.json(inventory);
  })
);

/**
 * Upserts the inventory snapshot for a menu item (tenant + item unique).
 * Partial payloads (e.g. a quick stock PATCH) update only the given fields.
 * Returns the stored row, or null when no inventory data was provided.
 */
async function upsertInventory(tenantId, productId, productName, inventory) {
  if (!inventory || typeof inventory !== 'object') return null;

  const [row] = await InventoryItem.findOrCreate({
    where: { tenant_id: tenantId, menu_item_id: productId },
    defaults: {
      tenant_id: tenantId,
      menu_item_id: productId,
      name: productName,
      stock_qty: Number(inventory.stock_qty) || 0,
      low_stock_at: Number(inventory.low_stock_at) || 0,
      unit: inventory.unit || 'pcs',
    },
  });

  if (inventory.stock_qty !== undefined) row.stock_qty = Number(inventory.stock_qty) || 0;
  if (inventory.low_stock_at !== undefined) row.low_stock_at = Number(inventory.low_stock_at) || 0;
  if (inventory.unit !== undefined) row.unit = inventory.unit || 'pcs';
  if (productName) row.name = productName;
  await row.save();
  return row;
}

export default router;
