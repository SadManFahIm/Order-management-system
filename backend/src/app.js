import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import sequelize from './config/db.js';
import { env, allowedOrigins } from './config/env.js';

// Register models (defines tables + associations before sync)
import './models/User.js';
import './models/Product.js';
import './models/Promotion.js';
import './models/PromotionSlab.js';
import './models/Order.js';
import './models/OrderItem.js';
import './models/RefreshToken.js';
import './models/AuthToken.js';
import './models/AuditLog.js';
import './models/Tenant.js';
import './models/UserTenant.js';
import './models/Plan.js';
import './models/Subscription.js';
import './models/FeatureFlag.js';
import './models/UsageCounter.js';
import './models/MenuCategory.js';
import './models/ItemVariant.js';
import './models/ItemAddon.js';
import './models/InventoryItem.js';
import './models/Table.js';
import './models/Payment.js';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import promotionRoutes from './routes/promotions.js';
import orderRoutes from './routes/orders.js';
import tenantRoutes from './routes/tenants.js';
import menuRoutes from './routes/menu.js';
import uploadRoutes from './routes/uploads.js';
import publicMenuRoutes from './routes/publicMenu.js';
import dashboardRoutes from './routes/dashboard.js';
import tableRoutes from './routes/tables.js';
import paymentRoutes from './routes/payments.js';

import { storageDriver, localStatic } from './config/storage.js';

import { apiLimiter } from './middleware/rateLimiter.js';
import { requestId } from './middleware/requestId.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { sameOriginGuard } from './middleware/csrf.js';

const app = express();

// Trust proxy when deployed behind a reverse proxy (affects rate-limit IPs)
if (env.TRUST_PROXY) app.set('trust proxy', 1);

app.use(requestId);

// Security headers (CSP, X-Frame-Options, HSTS, etc.)
app.use(helmet());

// CORS — restrict to configured origins instead of allowing everything
app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server calls (no Origin header) and configured origins
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Local object storage serves uploaded images from UPLOAD_DIR (dev/tests).
// In production STORAGE_DRIVER=s3 the images live in the bucket/CDN instead.
if (storageDriver === 'local') {
  const { root, setHeaders } = localStatic();
  app.use('/uploads', express.static(root, { setHeaders }));
}

// CSRF: verify Origin/Sec-Fetch-Site on state-changing requests that carry
// cookies (protects the httpOnly refresh-token flow). No-op otherwise.
app.use('/api', sameOriginGuard);

// Health / status
app.get('/', (req, res) => {
  res.json({ status: 'API running', version: '1.0.0' });
});

app.get('/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ status: 'ok', database: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', database: 'error' });
  }
});

// Routes
// Global API cap; the strict brute-force limiter is applied on /login itself.
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/products', apiLimiter, productRoutes);
app.use('/api/promotions', apiLimiter, promotionRoutes);
app.use('/api/orders', apiLimiter, orderRoutes);
app.use('/api/tenants', apiLimiter, tenantRoutes);
app.use('/api/menu', apiLimiter, menuRoutes);
app.use('/api/uploads', apiLimiter, uploadRoutes);
// Public storefront menu — read-only, no auth; use the standard API limiter
// but slightly relaxed per-IP budget is inherited from apiLimiter defaults.
app.use('/api/public', apiLimiter, publicMenuRoutes);
app.use('/api/dashboard', apiLimiter, dashboardRoutes);
app.use('/api/tables', apiLimiter, tableRoutes);
app.use('/api/payments', apiLimiter, paymentRoutes);

// 404 + centralized error handling
app.use(notFound);
app.use(errorHandler);

export default app;
