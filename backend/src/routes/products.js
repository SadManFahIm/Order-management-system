import express from 'express';
import Product from '../models/Product.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination } from '../utils/pagination.js';

const router = express.Router();
router.use(authMiddleware);

/** GET /api/products?limit=&offset= — paginated list (returns an array + X-Total-Count). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);

    const { rows, count } = await Product.findAndCountAll({
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
  asyncHandler(async (req, res) => {
    const { name, description, price, weight_gm, enabled } = req.body;

    if (!name || typeof name !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Product name is required');
    }
    if (typeof price !== 'number' || price < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A non-negative price is required');
    }
    if (!Number.isInteger(weight_gm) || weight_gm <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'weight_gm must be a positive integer');
    }

    const p = await Product.create({
      name,
      description,
      price,
      weight_gm,
      enabled: enabled ?? true,
    });
    res.status(201).json(p);
  })
);

/** PUT /api/products/:id */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const p = await Product.findByPk(req.params.id);
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Product not found');

    const { name, description, price, weight_gm, enabled } = req.body;
    Object.assign(p, { name, description, price, weight_gm, enabled });
    await p.save();
    res.json(p);
  })
);

export default router;
