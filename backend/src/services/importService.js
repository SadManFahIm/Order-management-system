import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import sequelize from '../config/db.js';
import { env } from '../config/env.js';
import { assertQuota } from './planService.js';
import Product from '../models/Product.js';
import MenuCategory from '../models/MenuCategory.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Bulk menu import (Phase 4).
 *
 * Accepts CSV text (see `CSV_TEMPLATE`), validates every row, and inserts the
 * valid ones in small transactions. Behaviour is PARTIAL SUCCESS — a single
 * malformed row never blocks the rest of the file; every problem is reported
 * per row in the summary so the merchant can fix and re-import.
 *
 * Duplicate rules (configurable):
 *  - within the file: a later row with the same name (case-insensitive) as an
 *    earlier row in the same file is SKIPPED;
 *  - against the database: a row whose name already exists for the tenant is
 *    SKIPPED (`duplicates: 'skip'`, the default). Pass `duplicates: 'error'`
 *    to fail the whole import on any DB duplicate, or `'update'` to update
 *    the existing row instead of inserting a new one.
 *
 * Categories are matched by name within the tenant; unknown categories are
 * created automatically (normalised, idempotent by name).
 */

export const IMPORT_COLUMNS = [
  'name',
  'price',
  'weight_gm',
  'description',
  'enabled',
  'category',
  'prep_minutes',
  'image_url',
];

export const CSV_TEMPLATE = `name,price,weight_gm,description,enabled,category,prep_minutes,image_url
Beef Kebab 250gm,320,250,Charcoal-grilled beef kebab,true,Burgers,12,
Zinger Burger,260,280,Crispy chicken fillet burger,true,Burgers,8,
`;

// CSV cells are always strings — empty cells are common and must behave like
// "not provided", never as invalid values or coerced zeros.
const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Coerce a CSV cell to a number when it's a valid numeric string, keep junk
// as-is so the schema rejects it, and never coerce ''/null to 0.
const numericCell = (inner) =>
  z.preprocess(
    (v) => {
      const cleaned = emptyToNull(v);
      if (cleaned === null || cleaned === undefined) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : cleaned; // keep junk as-is → schema rejects it
    },
    inner
  );

const rowSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200),
  price: numericCell(
    z.number({ invalid_type_error: 'price is required' }).nonnegative('price must be ≥ 0')
  ),
  weight_gm: numericCell(
    z
      .number({ invalid_type_error: 'weight_gm is required' })
      .int()
      .positive('weight_gm must be a positive integer')
  ),
  description: z.preprocess(emptyToNull, z.string().nullable().optional()),
  enabled: z
    // XLSX cells arrive as real booleans; CSV cells arrive as strings.
    .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', ''])])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null || v === '') return true;
      if (typeof v === 'boolean') return v;
      return ['true', '1', 'yes'].includes(v);
    }),
  category: z.preprocess(emptyToNull, z.string().trim().nullable().optional()),
  prep_minutes: numericCell(
    z.coerce.number().int().nonnegative().nullable().optional()
  ),
  image_url: z.preprocess(emptyToNull, z.string().url('image_url must be a valid URL').nullable().optional()),
});

const BATCH_SIZE = 50;

/**
 * Parses an XLSX buffer into header-keyed row objects (same shape as the CSV
 * parser): rows[0] is the header, data rows follow. Numbers arrive as
 * numbers (Excel cells) — the shared rowSchema coerces them the same way it
 * coerces numeric CSV strings, so a workbook behaves identically to a CSV.
 *
 * @throws {AppError} MALFORMED_XLSX / EMPTY_IMPORT
 */
export async function parseXlsxBuffer(buffer) {
  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw new AppError(400, 'MALFORMED_XLSX', `Could not parse XLSX: ${error.message}`);
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError(400, 'EMPTY_IMPORT', 'Import workbook has no worksheets');

  // Reject oversized sheets before loading them into memory (row 1 = header).
  if (sheet.actualRowCount > env.MAX_IMPORT_ROWS + 1) {
    throw new AppError(
      400,
      'IMPORT_TOO_LARGE',
      `Import exceeds the ${env.MAX_IMPORT_ROWS} row limit`
    );
  }

  // row.values is 1-indexed (values[0] is always undefined) → slice(1).
  const rows = [];
  sheet.eachRow((row) => rows.push(row.values.slice(1)));
  if (rows.length < 2) {
    throw new AppError(400, 'EMPTY_IMPORT', 'Import file contains no data rows');
  }

  const header = rows[0].map((h) => String(h ?? '').trim());
  const records = rows.slice(1).map((cells) => {
    const record = {};
    header.forEach((h, i) => {
      if (!h) return;
      const value = cells[i];
      record[h] = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    });
    return record;
  });
  return records;
}

/**
 * Imports products for a tenant from XLSX bytes (same pipeline as CSV).
 *
 * @param {{ buffer: Buffer, tenantId: number, duplicates?: 'skip'|'error'|'update' }}
 */
export async function importProductsXlsx({ buffer, tenantId, duplicates = 'skip' }) {
  if (!buffer || buffer.length === 0) {
    throw new AppError(400, 'EMPTY_IMPORT', 'Import file is empty');
  }
  if (buffer.length > env.MAX_IMPORT_BYTES) {
    throw new AppError(
      400,
      'IMPORT_TOO_LARGE',
      `Import file exceeds the ${Math.round(env.MAX_IMPORT_BYTES / 1024 / 1024)} MB limit`
    );
  }
  const records = await parseXlsxBuffer(buffer);
  return importProductsRows({ rows: records, tenantId, duplicates });
}

/**
 * Imports products for a tenant from CSV text.
 *
 * @param {{ csv: string, tenantId: number, duplicates?: 'skip'|'error'|'update' }}
 * @returns {Promise<{ total, succeeded, failed, skipped, createdCategories, errors: Array<{ row, field?, message }> }>}
 */
export async function importProductsCsv({ csv, tenantId, duplicates = 'skip' }) {
  if (typeof csv !== 'string' || csv.trim().length === 0) {
    throw new AppError(400, 'EMPTY_IMPORT', 'Import file is empty');
  }
  if (csv.length > env.MAX_IMPORT_BYTES) {
    throw new AppError(
      400,
      'IMPORT_TOO_LARGE',
      `Import file exceeds the ${Math.round(env.MAX_IMPORT_BYTES / 1024 / 1024)} MB limit`
    );
  }

  let records;
  try {
    records = parse(csv, {
      // Strict column matching: a row with more/fewer columns than the header
      // throws instead of silently shifting values into the wrong fields.
      columns: (header) => header.map((h) => h.trim()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (error) {
    throw new AppError(400, 'MALFORMED_CSV', `Could not parse CSV: ${error.message}`);
  }

  return importProductsRows({ rows: records, tenantId, duplicates });
}

/**
 * Shared import core — validates, dedupes and writes rows (objects keyed by
 * header) regardless of whether they came from CSV or XLSX. Row numbers are
 * reported as the spreadsheet line (data starts at row 2).
 *
 * @param {{ rows: Array<object>, tenantId: number, duplicates?: 'skip'|'error'|'update' }}
 */
export async function importProductsRows({ rows, tenantId, duplicates = 'skip' }) {
  const records = rows;

  // Reject unknown columns up front with a clear message — better than
  // silently ignoring typos like "prcie".
  const unknownHeaders = records.length
    ? Object.keys(records[0]).filter((h) => h && !IMPORT_COLUMNS.includes(h))
    : [];
  if (unknownHeaders.length > 0) {
    throw new AppError(
      400,
      'UNKNOWN_COLUMNS',
      `Unknown column(s): ${unknownHeaders.join(', ')}. Expected: ${IMPORT_COLUMNS.join(', ')}`
    );
  }

  if (records.length === 0) {
    throw new AppError(400, 'EMPTY_IMPORT', 'Import file contains no data rows');
  }
  if (records.length > env.MAX_IMPORT_ROWS) {
    throw new AppError(
      400,
      'IMPORT_TOO_LARGE',
      `Import exceeds the ${env.MAX_IMPORT_ROWS} row limit`
    );
  }

  const summary = {
    total: records.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    createdCategories: 0,
    errors: [],
  };

  // Pass 1 — per-row validation + within-file duplicate detection.
  const seenNames = new Map(); // lowercase name → first row number
  let validRows = [];
  records.forEach((raw, index) => {
    const rowNumber = index + 2; // 1-based + header
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      summary.failed += 1;
      summary.errors.push({
        row: rowNumber,
        field: parsed.error.issues[0]?.path[0] || null,
        message: parsed.error.issues[0]?.message || 'Invalid row',
      });
      return;
    }
    const nameKey = parsed.data.name.toLowerCase();
    if (seenNames.has(nameKey)) {
      summary.skipped += 1;
      summary.errors.push({
        row: rowNumber,
        field: 'name',
        message: `Duplicate of row ${seenNames.get(nameKey)} in this file`,
      });
      return;
    }
    seenNames.set(nameKey, rowNumber);
    validRows.push({ data: parsed.data, rowNumber });
  });

  // Category name → id map for this tenant (created on demand).
  const categoryByName = new Map();
  const ensureCategory = async (name) => {
    if (!name) return null;
    const key = name.toLowerCase();
    if (categoryByName.has(key)) return categoryByName.get(key);
    let category = await MenuCategory.findOne({
      where: { tenant_id: tenantId, name },
    });
    if (!category) {
      category = await MenuCategory.create({ tenant_id: tenantId, name });
      summary.createdCategories += 1;
    }
    categoryByName.set(key, category.id);
    return category.id;
  };

  // DB duplicate handling. Fetching every product name once keeps the check
  // case-insensitive on BOTH dialects (a SQL `IN` with LOWER() is
  // dialect-specific); the tenant's product set is bounded by MAX_IMPORT_ROWS.
  // paranoid: false so soft-deleted items still count as "existing" — name
  // uniqueness is a per-tenant business rule whether or not the row is
  // currently visible. This prevents re-imports from spawning phantom
  // duplicates under a soft-deleted row.
  const existing = await Product.findAll({
    where: { tenant_id: tenantId },
    attributes: ['id', 'name', 'version', 'deletedAt'],
    paranoid: false,
  });
  const existingByName = new Map(existing.map((p) => [p.name.toLowerCase(), p]));

  if (duplicates === 'error') {
    const dupes = validRows.filter((r) => existingByName.has(r.data.name.toLowerCase()));
    if (dupes.length > 0) {
      throw new AppError(
        409,
        'DUPLICATE_PRODUCTS',
        `Import aborted: ${dupes.length} product(s) already exist (name: ${dupes[0].data.name})`
      );
    }
  } else if (duplicates === 'skip') {
    summary.skipped += validRows.filter((r) => existingByName.has(r.data.name.toLowerCase())).length;
    validRows = validRows.filter((r) => !existingByName.has(r.data.name.toLowerCase()));
  }
  // duplicates === 'update': existing rows are updated below instead.

  // Plan quota gate (Phase 3): block the whole import before any write when
  // the resulting product count would exceed the plan's limit.
  const inserts = validRows.filter((r) => !existingByName.has(r.data.name.toLowerCase()));
  await assertQuota(tenantId, 'products', { adding: inserts.length });

  // Pass 2 — batched writes in transactions (partial success: failures are
  // reported, not fatal). Existing rows are updated when duplicates='update'.
  for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
    const batch = validRows.slice(i, i + BATCH_SIZE);
    await sequelize.transaction(async (transaction) => {
      for (const { data, rowNumber } of batch) {
        try {
          const categoryId = await ensureCategory(data.category);
          const existingProduct =
            duplicates === 'update' ? existingByName.get(data.name.toLowerCase()) : null;
          const values = {
            name: data.name,
            description: data.description || null,
            price: data.price,
            weight_gm: data.weight_gm,
            enabled: data.enabled,
            category_id: categoryId,
            prep_minutes: data.prep_minutes ?? null,
            image_url: data.image_url || null,
          };
          if (existingProduct) {
            await Product.update(
              {
                ...values,
                version: (existingProduct.version ?? 1) + 1,
                // duplicates='update' on a soft-deleted item resurrects it
                // (clears deleted_at) instead of inserting a duplicate row.
                ...(existingProduct.deletedAt ? { deletedAt: null } : {}),
              },
              {
                where: { id: existingProduct.id },
                transaction,
                // Model.update injects `deleted_at IS NULL` when paranoid —
                // disable it so a resurrected row can be updated at all.
                paranoid: false,
              }
            );
          } else {
            await Product.create({ tenant_id: tenantId, ...values }, { transaction });
          }
          summary.succeeded += 1;
        } catch (error) {
          summary.failed += 1;
          summary.errors.push({
            row: rowNumber,
            field: null,
            message: `Write failed: ${error.message}`,
          });
        }
      }
    });
  }

  return summary;
}
