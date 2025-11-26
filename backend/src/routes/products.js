import express from 'express';
import Product from '../models/Product.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
router.use(authMiddleware);

router.get('/', async (req, res) => {
  const products = await Product.findAll({ order: [['id', 'ASC']] });
  res.json(products);
});

router.post('/', async (req, res) => {
  try {
    const { name, description, price, weight_gm, enabled } = req.body;
    const p = await Product.create({
      name,
      description,
      price,
      weight_gm,
      enabled: enabled ?? true
    });
    res.status(201).json(p);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const p = await Product.findByPk(req.params.id);
    if (!p) return res.status(404).json({ message: 'Not found' });

    const { name, description, price, weight_gm, enabled } = req.body;
    Object.assign(p, { name, description, price, weight_gm, enabled });
    await p.save();
    res.json(p);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

export default router;
