import express from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import {
  buildCloseout,
  buildCloseoutCsv,
  buildVatReport,
  buildVatCsv,
  renderCloseoutHtml,
  sendCloseoutEmail,
  dhakaDate,
} from '../services/reportsService.js';

/**
 * Daily closeout report (Phase 5) — the cash-register reconciliation view.
 *
 * A single day's orders and payments (Dhaka local day, UTC+6): totals,
 * revenue by payment method, pending wallet amounts, refunds — plus a CSV
 * export, a print-ready PDF view, and email delivery so the cashier can
 * reconcile against the physical register / bKash app statement. The heavy
 * lifting lives in services/reportsService.js (shared with the nightly
 * scheduler).
 */
const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant, requirePermission('view:orders'));

/** GET /api/reports/closeout?date=YYYY-MM-DD — daily summary (JSON). */
router.get(
  '/closeout',
  asyncHandler(async (req, res) => {
    res.json(await buildCloseout(req.tenant.id, req.query.date || dhakaDate()));
  })
);

/** GET /api/reports/closeout.csv — the same day as a downloadable CSV. */
router.get(
  '/closeout.csv',
  asyncHandler(async (req, res) => {
    const data = await buildCloseout(req.tenant.id, req.query.date || dhakaDate());
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="closeout-${data.date}.csv"`);
    res.send(buildCloseoutCsv(data));
  })
);

/** GET /api/reports/closeout.pdf — print-ready HTML (browser → Save as PDF). */
router.get(
  '/closeout.pdf',
  asyncHandler(async (req, res) => {
    const data = await buildCloseout(req.tenant.id, req.query.date);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(renderCloseoutHtml(data, req.tenant.name || 'Restaurant'));
  })
);

/** GET /api/reports/vat?from=&to= — VAT compliance (per-item VAT split). */
router.get(
  '/vat',
  asyncHandler(async (req, res) => {
    res.json(await buildVatReport(req.tenant, req.query.from, req.query.to));
  })
);

/** GET /api/reports/vat.csv — the same VAT report as a downloadable CSV. */
router.get(
  '/vat.csv',
  asyncHandler(async (req, res) => {
    const data = await buildVatReport(req.tenant, req.query.from, req.query.to);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="vat-${data.from}-to-${data.to}.csv"`);
    res.send(buildVatCsv(data));
  })
);

/** POST /api/reports/closeout/email — email the day's closeout (HTML + CSV). */
router.post(
  '/closeout/email',
  asyncHandler(async (req, res) => {
    const { date, to } = req.body || {};
    const recipient = String(to || '').trim() || req.tenant.settings?.reports?.closeoutEmail || req.user?.email;
    if (!recipient) {
      throw new AppError(400, 'VALIDATION_ERROR', 'No recipient — set a closeout email in Settings or pass `to`');
    }
    const result = await sendCloseoutEmail({ tenant: req.tenant, date, to: recipient });
    res.json({ sent: true, to: recipient, messageId: result.messageId, orders: result.orders });
  })
);

export default router;
