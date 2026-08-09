import express from 'express';
import { Op } from 'sequelize';
import QRCode from 'qrcode';
import Table from '../models/Table.js';
import { authMiddleware } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { requirePermission } from '../middleware/rbac.js';
import { resolveTenant, requireTenant } from '../middleware/tenant.js';
import { env } from '../config/env.js';

/**
 * QR table menu (Phase 5 starter) — merchant-side management of physical
 * tables and their QR codes.
 *
 * Every active table encodes a storefront URL (`/m/:slug?table=N`) into a
 * scannable QR (SVG data URI, generated with the same `qrcode` package the
 * TOTP 2FA setup uses — no new dependency). URLs are built from
 * `APP_BASE_URL`, so production QR codes point at the real public domain.
 */
const router = express.Router();
router.use(authMiddleware, resolveTenant, requireTenant);

const canManageTables = requirePermission('manage:menu');

/** Validates and normalises a table payload. */
function normalizeTableInput(body, { partial = false } = {}) {
  const out = {};
  if (body.table_no !== undefined || !partial) {
    const tableNo = Number(body.table_no);
    if (!Number.isInteger(tableNo) || tableNo < 1) {
      throw new AppError(400, 'VALIDATION_ERROR', 'table_no must be a positive integer');
    }
    out.table_no = tableNo;
  }
  if (body.name !== undefined) {
    out.name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) || null : null;
  }
  if (body.capacity !== undefined) {
    if (body.capacity === null || body.capacity === '') {
      out.capacity = null;
    } else {
      const capacity = Number(body.capacity);
      if (!Number.isInteger(capacity) || capacity < 1) {
        throw new AppError(400, 'VALIDATION_ERROR', 'capacity must be a positive integer');
      }
      out.capacity = capacity;
    }
  }
  if (body.is_active !== undefined) {
    out.is_active = Boolean(body.is_active);
  }
  return out;
}

/** Encodes the storefront URL for a table into an SVG data URI. */
async function tableQrSvg(slug, tableNo) {
  const url = `${env.APP_BASE_URL.replace(/\/$/, '')}/m/${slug}?table=${tableNo}`;
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    width: 240,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });
  return {
    url,
    svg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
}

/** GET /api/tables — all tables in the active workspace. */
router.get(
  '/',
  requirePermission('view:menu'),
  asyncHandler(async (req, res) => {
    const rows = await Table.findAll({
      where: { tenant_id: req.tenant.id },
      order: [
        ['table_no', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    res.json(rows);
  })
);

/** GET /api/tables/qr — QR codes for every ACTIVE table. */
router.get(
  '/qr',
  requirePermission('view:menu'),
  asyncHandler(async (req, res) => {
    const rows = await Table.findAll({
      where: { tenant_id: req.tenant.id, is_active: true },
      order: [['table_no', 'ASC']],
    });
    const qrs = await Promise.all(
      rows.map(async (table) => ({
        id: table.id,
        tableNo: table.table_no,
        name: table.name,
        capacity: table.capacity,
        ...(await tableQrSvg(req.tenant.slug, table.table_no)),
      }))
    );
    res.json({ slug: req.tenant.slug, qrs });
  })
);

/** POST /api/tables — add a table (fails on duplicate table_no). */
router.post(
  '/',
  canManageTables,
  asyncHandler(async (req, res) => {
    const input = normalizeTableInput(req.body);
    const existing = await Table.findOne({
      where: { tenant_id: req.tenant.id, table_no: input.table_no },
    });
    if (existing) {
      throw new AppError(
        409,
        'TABLE_NO_TAKEN',
        `Table ${input.table_no} already exists in this workspace`
      );
    }
    const table = await Table.create({ tenant_id: req.tenant.id, ...input });
    res.status(201).json(table);
  })
);

/** PATCH /api/tables/:id — update name / capacity / active. */
router.patch(
  '/:id',
  canManageTables,
  asyncHandler(async (req, res) => {
    const table = await Table.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!table) throw new AppError(404, 'NOT_FOUND', 'Table not found');

    const input = normalizeTableInput(req.body, { partial: true });
    if (input.table_no !== undefined && input.table_no !== table.table_no) {
      const clash = await Table.findOne({
        where: { tenant_id: req.tenant.id, table_no: input.table_no, id: { [Op.ne]: table.id } },
      });
      if (clash) {
        throw new AppError(
          409,
          'TABLE_NO_TAKEN',
          `Table ${input.table_no} already exists in this workspace`
        );
      }
    }
    await table.update(input);
    res.json(table);
  })
);

/** DELETE /api/tables/:id — remove a table (hard delete). */
router.delete(
  '/:id',
  canManageTables,
  asyncHandler(async (req, res) => {
    const table = await Table.findOne({
      where: { id: req.params.id, tenant_id: req.tenant.id },
    });
    if (!table) throw new AppError(404, 'NOT_FOUND', 'Table not found');
    await table.destroy();
    res.json({ id: table.id, deleted: true });
  })
);

export default router;
