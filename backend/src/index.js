import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sequelize from './config/db.js';

import './models/User.js';
import './models/Product.js';
import './models/Promotion.js';
import './models/PromotionSlab.js';
import './models/Order.js';
import './models/OrderItem.js';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import promotionRoutes from './routes/promotions.js';
import orderRoutes from './routes/orders.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'API running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/orders', orderRoutes);

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await sequelize.sync({ alter: true });
    app.listen(PORT, () => console.log(`Backend on port ${PORT}`));
  } catch (e) {
    console.error('DB error', e);
  }
}

start();
