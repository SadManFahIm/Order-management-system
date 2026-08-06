import express from 'express';
import Promotion from '../models/Promotion.js';
import PromotionSlab from '../models/PromotionSlab.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { parsePagination } from '../utils/pagination.js';

const router = express.Router();
router.use(authMiddleware);

/** GET /api/promotions?limit=&offset= — paginated list (returns an array + X-Total-Count). */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);

    const { rows, count } = await Promotion.findAndCountAll({
      include: [{ model: PromotionSlab, as: 'slabs' }],
      order: [['id', 'ASC']],
      limit,
      offset,
    });

    res.set('X-Total-Count', String(count));
    res.json(rows);
  })
);

/** POST /api/promotions */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      title,
      type,
      percentage_value,
      fixed_value,
      start_date,
      end_date,
      enabled,
      slabs = [],
    } = req.body;

    if (!title || typeof title !== 'string') {
      throw new AppError(400, 'VALIDATION_ERROR', 'Promotion title is required');
    }
    if (!['percentage', 'fixed', 'weighted'].includes(type)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid promotion type');
    }
    if (!start_date || !end_date) {
      throw new AppError(400, 'VALIDATION_ERROR', 'start_date and end_date are required');
    }

    const promo = await Promotion.create(
      {
        title,
        type,
        percentage_value: type === 'percentage' ? percentage_value : null,
        fixed_value: type === 'fixed' ? fixed_value : null,
        start_date,
        end_date,
        enabled,
        slabs:
          type === 'weighted'
            ? slabs.map((s) => ({
                min_weight_gm: s.min_weight_gm,
                max_weight_gm: s.max_weight_gm,
                discount_per_500gm: s.discount_per_500gm,
              }))
            : [],
      },
      { include: [{ model: PromotionSlab, as: 'slabs' }] }
    );

    res.status(201).json(promo);
  })
);

/** PUT /api/promotions/:id — edit title, dates, enabled */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const promo = await Promotion.findByPk(req.params.id);
    if (!promo) throw new AppError(404, 'NOT_FOUND', 'Promotion not found');

    const { title, start_date, end_date, enabled } = req.body;
    if (title !== undefined) promo.title = title;
    if (start_date !== undefined) promo.start_date = start_date;
    if (end_date !== undefined) promo.end_date = end_date;
    if (enabled !== undefined) promo.enabled = enabled;
    await promo.save();

    const withSlabs = await Promotion.findByPk(promo.id, {
      include: [{ model: PromotionSlab, as: 'slabs' }],
    });

    res.json(withSlabs);
  })
);

export default router;
