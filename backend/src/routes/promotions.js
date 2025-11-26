import express from 'express';
import Promotion from '../models/Promotion.js';
import PromotionSlab from '../models/PromotionSlab.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const promotions = await Promotion.findAll({
    include: [{ model: PromotionSlab, as: 'slabs' }],
    order: [['id', 'ASC']]
  });
  res.json(promotions);
});

router.post('/', async (req, res) => {
  try {
    const {
      title,
      type,
      percentage_value,
      fixed_value,
      start_date,
      end_date,
      enabled,
      slabs = []
    } = req.body;

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
                discount_per_500gm: s.discount_per_500gm
              }))
            : []
      },
      { include: [{ model: PromotionSlab, as: 'slabs' }] }
    );

    res.status(201).json(promo);
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: e.message });
  }
});

// Edit only title, dates, enabled
router.put('/:id', async (req, res) => {
  try {
    const promo = await Promotion.findByPk(req.params.id);
    if (!promo) return res.status(404).json({ message: 'Not found' });

    const { title, start_date, end_date, enabled } = req.body;
    if (title !== undefined) promo.title = title;
    if (start_date !== undefined) promo.start_date = start_date;
    if (end_date !== undefined) promo.end_date = end_date;
    if (enabled !== undefined) promo.enabled = enabled;
    await promo.save();

    const withSlabs = await Promotion.findByPk(promo.id, {
      include: [{ model: PromotionSlab, as: 'slabs' }]
    });

    res.json(withSlabs);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default router;
