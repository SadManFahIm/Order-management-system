import express from 'express';
import { literal } from 'sequelize';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import Product from '../models/Product.js';
import MenuCategory from '../models/MenuCategory.js';
import ItemVariant from '../models/ItemVariant.js';
import ItemAddon from '../models/ItemAddon.js';
import {
  createCategorySchema,
  updateCategorySchema,
  variantSchema,
  addonSchema,
} from '../validators/menu.js';
import { sortCategories } from '../services/menuService.js';

const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant);

// Menu mutations require menu-management rights (owner/manager/admin).
const canManageMenu = requirePermission('manage:menu');

// ── Categories ────────────────────────────────────────────────────────────

/** GET /api/menu/categories — flat list for the current tenant. */
router.get(
  '/categories',
  requirePermission('view:menu'),
  asyncHandler(async (req, res) => {
    const categories = await MenuCategory.findAll({
      where: { tenant_id: req.tenant.id },
      include: [
        { model: MenuCategory, as: 'parent', attributes: ['id', 'name'] },
      ],
      order: [
        ['sort_order', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    res.json(categories);
  })
);

/** POST /api/menu/categories/sort — persist a drag-and-drop category
 * order (Phase 4 follow-up). Placed before /:id so "sort" is not treated
 * as an id. */
router.post(
  '/categories/sort',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const updated = await sortCategories(req.tenant.id, req.user, req.body?.order, req);
    res.json({ updated });
  })
);

/** POST /api/menu/categories/sort — persist a drag-and-drop category
 * order (Phase 4 follow-up). Placed before /:id so "sort" is not treated
 * as an id. */
router.post(
  '/categories/sort',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const updated = await sortCategories(req.tenant.id, req.user, req.body?.order, req);
    res.json({ updated });
  })
);

/** POST /api/menu/categories */
router.post(
  '/categories',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const { name, parentId, sortOrder } = createCategorySchema.parse(req.body);

    // A parent, if given, must belong to the same tenant.
    if (parentId) {
      const parent = await MenuCategory.findOne({
        where: { id: parentId, tenant_id: req.tenant.id },
      });
      if (!parent) throw new AppError(400, 'INVALID_PARENT', 'Parent category not found');
    }

    const category = await MenuCategory.create({
      tenant_id: req.tenant.id,
      name,
      parent_id: parentId ?? null,
      sort_order: sortOrder ?? 0,
    });
    res.status(201).json(category);
  })
);

/** PUT /api/menu/categories/:id */
router.put(
  '/categories/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const category = await MenuCategory.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!category) throw new AppError(404, 'NOT_FOUND', 'Category not found');

    const { name, parentId, sortOrder } = updateCategorySchema.parse(req.body);
    if (parentId !== undefined) {
      if (Number(parentId) === category.id) {
        throw new AppError(400, 'INVALID_PARENT', 'A category cannot be its own parent');
      }
      if (parentId !== null) {
        const parent = await MenuCategory.findOne({
          where: { id: parentId, tenant_id: req.tenant.id },
        });
        if (!parent) throw new AppError(400, 'INVALID_PARENT', 'Parent category not found');
      }
      category.parent_id = parentId;
    }
    if (name !== undefined) category.name = name;
    if (sortOrder !== undefined) category.sort_order = sortOrder;
    await category.save();
    res.json(category);
  })
);

/** DELETE /api/menu/categories/:id — detaches products, deletes subcategories. */
router.delete(
  '/categories/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const category = await MenuCategory.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!category) throw new AppError(404, 'NOT_FOUND', 'Category not found');

    await Promise.all([
      // Bump version so any client edit based on a stale copy conflicts (409)
      // — the category detach is a server-side mutation of the product.
      Product.update(
        { category_id: null, version: literal('version + 1') },
        { where: { category_id: category.id, tenant_id: req.tenant.id } }
      ),
      MenuCategory.destroy({
        where: { parent_id: category.id, tenant_id: req.tenant.id },
      }),
    ]);
    await category.destroy();
    res.json({ message: 'Category deleted' });
  })
);

// ── Variants ──────────────────────────────────────────────────────────────

/** GET /api/menu/products/:productId/variants */
router.get(
  '/products/:productId/variants',
  requirePermission('view:menu'),
  asyncHandler(async (req, res) => {
    const variants = await ItemVariant.findAll({
      where: {
        product_id: req.params.productId,
        tenant_id: req.tenant.id,
      },
      order: [
        ['sort_order', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    res.json(variants);
  })
);

/** POST /api/menu/products/:productId/variants */
router.post(
  '/products/:productId/variants',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({
      where: { id: req.params.productId, tenant_id: req.tenant.id },
    });
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    const { name, priceAdjustment, sortOrder, stock, lowStockAt } = variantSchema.parse(req.body);
    const variant = await ItemVariant.create({
      tenant_id: req.tenant.id,
      product_id: product.id,
      name,
      price_adjustment: priceAdjustment ?? 0,
      sort_order: sortOrder ?? 0,
      stock: stock ?? null,
      low_stock_at: lowStockAt ?? null,
    });
    res.status(201).json(variant);
  })
);

/** PUT /api/menu/variants/:id */
router.put(
  '/variants/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const variant = await ItemVariant.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!variant) throw new AppError(404, 'NOT_FOUND', 'Variant not found');

    const { name, priceAdjustment, sortOrder, stock, lowStockAt } = variantSchema.partial().parse(req.body);
    if (name !== undefined) variant.name = name;
    if (priceAdjustment !== undefined) variant.price_adjustment = priceAdjustment;
    if (sortOrder !== undefined) variant.sort_order = sortOrder;
    if (stock !== undefined) variant.stock = stock;
    if (lowStockAt !== undefined) variant.low_stock_at = lowStockAt;
    await variant.save();
    res.json(variant);
  })
);

/** DELETE /api/menu/variants/:id */
router.delete(
  '/variants/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const variant = await ItemVariant.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!variant) throw new AppError(404, 'NOT_FOUND', 'Variant not found');
    await variant.destroy();
    res.json({ message: 'Variant deleted' });
  })
);

// ── Add-ons ───────────────────────────────────────────────────────────────

/** GET /api/menu/products/:productId/addons */
router.get(
  '/products/:productId/addons',
  requirePermission('view:menu'),
  asyncHandler(async (req, res) => {
    const addons = await ItemAddon.findAll({
      where: {
        product_id: req.params.productId,
        tenant_id: req.tenant.id,
      },
      order: [
        ['sort_order', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    res.json(addons);
  })
);

/** POST /api/menu/products/:productId/addons */
router.post(
  '/products/:productId/addons',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const product = await Product.findOne({
      where: { id: req.params.productId, tenant_id: req.tenant.id },
    });
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    const { name, price, sortOrder } = addonSchema.parse(req.body);
    const addon = await ItemAddon.create({
      tenant_id: req.tenant.id,
      product_id: product.id,
      name,
      price: price ?? 0,
      sort_order: sortOrder ?? 0,
    });
    res.status(201).json(addon);
  })
);

/** PUT /api/menu/addons/:id */
router.put(
  '/addons/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const addon = await ItemAddon.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!addon) throw new AppError(404, 'NOT_FOUND', 'Add-on not found');

    const { name, price, sortOrder } = addonSchema.partial().parse(req.body);
    if (name !== undefined) addon.name = name;
    if (price !== undefined) addon.price = price;
    if (sortOrder !== undefined) addon.sort_order = sortOrder;
    await addon.save();
    res.json(addon);
  })
);

/** DELETE /api/menu/addons/:id */
router.delete(
  '/addons/:id',
  canManageMenu,
  asyncHandler(async (req, res) => {
    const addon = await ItemAddon.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!addon) throw new AppError(404, 'NOT_FOUND', 'Add-on not found');
    await addon.destroy();
    res.json({ message: 'Add-on deleted' });
  })
);

export default router;
