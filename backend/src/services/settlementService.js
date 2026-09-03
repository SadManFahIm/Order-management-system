import { Op } from 'sequelize';
import { AppError } from '../middleware/errorHandler.js';
import Settlement from '../models/Settlement.js';
import Payment from '../models/Payment.js';

/**
 * Settlement / withdrawal tracking (Phase 6, Feature 4).
 *
 * A settlement is movement of money FROM the merchant's gateway wallet TO
 * their bank account — it is NEVER revenue. This service keeps the smallest
 * compatible data model: there is no separate "wallet" table; the gateway
 * balance is computed from the actual ledger — every collected online payment
 * adds to the wallet, every refunded amount returns money to the customer,
 * and every settlement moves money to the bank.
 */

export const SETTLEMENT_STATUSES = ['pending', 'processing', 'completed', 'failed', 'reversed'];

/** Validates + normalises a settlement payload (create + update paths). */
export function normalizeSettlementInput(body, { partial = false } = {}) {
  const out = {};
  if (body.gateway !== undefined || !partial) {
    const gateway = String(body.gateway || 'other').trim().slice(0, 16);
    out.gateway = gateway || 'other';
  }
  if (body.requestedAmount !== undefined || !partial) {
    const amount = Number(body.requestedAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'requestedAmount must be a positive number');
    }
    out.requested_amount = amount;
  }
  if (body.settlementId !== undefined) {
    out.settlement_id = body.settlementId == null ? null : String(body.settlementId).trim().slice(0, 120) || null;
  }
  if (body.settledAmount !== undefined) {
    if (body.settledAmount === null) {
      out.settled_amount = null;
    } else {
      const n = Number(body.settledAmount);
      if (!Number.isFinite(n) || n < 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'settledAmount must be a non-negative number');
      }
      out.settled_amount = n;
    }
  }
  if (body.fees !== undefined) {
    const n = Number(body.fees || 0);
    if (!Number.isFinite(n) || n < 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'fees must be a non-negative number');
    }
    out.fees = n;
  }
  if (body.currency !== undefined) {
    const c = String(body.currency || 'BDT').trim().slice(0, 8);
    if (!c) throw new AppError(400, 'VALIDATION_ERROR', 'currency cannot be empty');
    out.currency = c;
  }
  if (body.bankRef !== undefined) {
    out.bank_ref = body.bankRef == null ? null : String(body.bankRef).trim().slice(0, 120) || null;
  }
  if (body.status !== undefined) {
    if (!SETTLEMENT_STATUSES.includes(body.status)) {
      throw new AppError(400, 'VALIDATION_ERROR', `status must be one of: ${SETTLEMENT_STATUSES.join(', ')}`);
    }
    out.status = body.status;
  }
  return out;
}

/** Lists settlements for a tenant (newest first), optional status filter. */
export async function listSettlements(tenantId, { status } = {}) {
  const where = { tenant_id: tenantId };
  if (status) {
    if (!SETTLEMENT_STATUSES.includes(status)) {
      throw new AppError(400, 'VALIDATION_ERROR', `status must be one of: ${SETTLEMENT_STATUSES.join(', ')}`);
    }
    where.status = status;
  }
  return Settlement.findAll({ where, order: [['id', 'DESC']] });
}

/** Creates a settlement request (money leaving the gateway wallet). */
export async function createSettlement(tenantId, input, actorId) {
  const data = normalizeSettlementInput(input);
  const netAmount = data.settled_amount != null ? data.settled_amount - (data.fees ?? 0) : null;
  return Settlement.create({
    tenant_id: tenantId,
    gateway: data.gateway,
    settlement_id: data.settlement_id || null,
    requested_amount: data.requested_amount,
    settled_amount: data.settled_amount ?? null,
    fees: data.fees ?? 0,
    net_amount: netAmount != null && netAmount >= 0 ? netAmount : null,
    currency: data.currency || 'BDT',
    status: data.status || 'pending',
    bank_ref: data.bank_ref || null,
    requested_at: new Date(),
    created_by: actorId || null,
  });
}

/** Updates a settlement's progress (status, settled amounts, bank ref). */
export async function updateSettlement(tenantId, id, input, _actorId) {
  const settlement = await Settlement.findOne({ where: { id, tenant_id: tenantId } });
  if (!settlement) throw new AppError(404, 'NOT_FOUND', 'Settlement not found');

  const data = normalizeSettlementInput(input, { partial: true });
  const patch = { ...data, updated_at: new Date() };
  if (patch.status === 'completed') {
    patch.processed_at = settlement.processed_at || new Date();
  }
  if (patch.settled_amount != null || patch.fees != null) {
    const settled = patch.settled_amount ?? settlement.settled_amount;
    const fees = patch.fees ?? settlement.fees;
    if (settled != null && Number.isFinite(settled) && Number.isFinite(fees)) {
      const net = settled - fees;
      patch.net_amount = net >= 0 ? Math.round(net * 100) / 100 : null;
    }
  }
  await settlement.update(patch);
  return settlement;
}

/**
 * Gateway wallet balance — the merchant's collected-but-not-yet-settled money.
 * Computed from the real ledger, never a separate counter:
 *   wallet = Σ(paid online payments) − Σ(refunds of those payments) − Σ(settlements).
 * Non-online methods (cash, cashier-confirmed bKash/Nagad, card) are excluded —
 * they go straight to the till, not through a gateway wallet.
 */
export async function gatewayWalletBalance(tenantId) {
  const [collected, settlements] = await Promise.all([
    Payment.findAll({
      where: { tenant_id: tenantId, method: 'online', status: 'paid' },
      attributes: ['amount', 'refunded_amount'],
    }),
    Settlement.findAll({
      where: { tenant_id: tenantId, status: { [Op.not]: 'reversed' } },
      attributes: ['requested_amount', 'settled_amount'],
    }),
  ]);

  let gross = 0;
  let refunded = 0;
  for (const p of collected) {
    gross += Number(p.amount || 0);
    refunded += p.refunded_amount != null ? Number(p.refunded_amount) : 0;
  }
  let settled = 0;
  for (const s of settlements) {
    settled += Number(s.settled_amount ?? s.requested_amount ?? 0);
  }

  const balance = Math.round((gross - refunded - settled) * 100) / 100;
  return {
    gateway: 'all',
    currency: 'BDT',
    gross_collected: Math.round(gross * 100) / 100,
    refunded: Math.round(refunded * 100) / 100,
    settled: Math.round(settled * 100) / 100,
    balance: Math.round(balance * 100) / 100,
  };
}

/** Total amount settled (completed + processing) for reporting. */
export async function totalSettled(tenantId) {
  const rows = await Settlement.findAll({
    where: { tenant_id: tenantId, status: { [Op.in]: ['completed', 'processing'] } },
    attributes: ['settled_amount'],
  });
  return Math.round(rows.reduce((s, r) => s + Number(r.settled_amount || 0), 0) * 100) / 100;
}