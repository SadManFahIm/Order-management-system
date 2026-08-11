import { createHash } from 'node:crypto';
import { AppError } from '../middleware/errorHandler.js';
import IdempotencyKey from '../models/IdempotencyKey.js';

/**
 * Idempotent request handling (migration 012) — retry-safe order creation.
 *
 * The client sends an `Idempotency-Key` header; the DB-level unique index
 * (tenant_id, user_id, key) is the real guarantee: concurrent requests with
 * the same key cannot both insert, so exactly one handler run can win —
 * even across application instances (no in-memory state involved).
 *
 * Lifecycle:
 *   1. The key row is inserted FIRST (status pending). A unique violation
 *      means another request owns the key → replay its stored response, or
 *      answer 409 REQUEST_IN_PROGRESS while it is still being processed.
 *   2. The wrapped handler runs.
 *   3. On success the row is stamped with the response (statusCode + body)
 *      so every later retry replays the identical result.
 *   4. On failure the row is deleted — the same key can be retried cleanly
 *      (a failed request must never poison a retry).
 *
 * Retention: rows expire after IDEMPOTENCY_TTL_MS and are swept opportunely
 * on each use (a bounded DELETE, never a table scan on the hot path beyond
 * the tenant scope).
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PENDING_TIMEOUT_MS = 2 * 60 * 1000; // reclaim stuck processing rows
const WAIT_FOR_COMPLETION_MS = 2000; // concurrent retry grace window
const WAIT_POLL_MS = 75;

/** Polls a processing row until it completes (or the grace window expires). */
async function waitForCompletion(id) {
  const deadline = Date.now() + WAIT_FOR_COMPLETION_MS;
  while (Date.now() < deadline) {
    const row = await IdempotencyKey.findByPk(id);
    if (row?.status_code != null) return row;
    if (!row) return null;
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
  }
  return null;
}

const hashRequest = (body) =>
  createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

/** Reclaims (deletes) an expired or stale-pending row so the key can retry. */
const reclaim = async (row) => {
  const stalePending =
    row.status_code == null &&
    Date.now() - new Date(row.createdAt ?? row.created_at).getTime() >
      PENDING_TIMEOUT_MS;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now() || stalePending) {
    await row.destroy();
    return true;
  }
  return false;
};

/**
 * Runs `handler` exactly once per (tenantId, userId, key). `handler` receives
 * no arguments and must return { statusCode, body } to be replayed verbatim.
 * When no key is supplied the handler runs without idempotency.
 */
export async function withIdempotency({ tenantId, userId, key, body, handler }) {
  const normalized = typeof key === 'string' ? key.trim().slice(0, 128) : '';
  if (!normalized) return handler();

  const scope = {
    tenant_id: tenantId,
    user_id: Number.isInteger(userId) && userId > 0 ? userId : 0,
  };

  // Opportunistic cleanup of this scope's expired rows (bounded, cheap).
  await IdempotencyKey.destroy({
    where: {
      tenant_id: scope.tenant_id,
      user_id: scope.user_id,
      expires_at: { [IdempotencyKey.sequelize.Sequelize.Op.lt]: new Date() },
    },
  });

  const requestHash = hashRequest(body);

  let row;
  try {
    row = await IdempotencyKey.create({
      ...scope,
      key: normalized,
      request_hash: requestHash,
      expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
  } catch (err) {
    // Unique violation → the key is already taken by a concurrent/earlier
    // request. Load it and decide: replay, in-progress, or reclaim.
    const existing = await IdempotencyKey.findOne({
      where: { ...scope, key: normalized },
    });
    if (!existing) throw err; // genuinely unexpected

    if (existing.request_hash !== requestHash) {
      throw new AppError(
        409,
        'IDEMPOTENCY_KEY_MISMATCH',
        'Idempotency-Key was already used with a different request'
      );
    }
    if (existing.status_code != null) {
      // Completed earlier — replay the stored result verbatim.
      const stored = existing.response || {};
      return { replayed: true, statusCode: stored.statusCode, body: stored.body };
    }
    if (await reclaim(existing)) {
      // Stuck processing row reclaimed — retry the insert once.
      row = await IdempotencyKey.create({
        ...scope,
        key: normalized,
        request_hash: requestHash,
        expires_at: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });
    } else {
      // Another request owns the key right now (e.g. a double-click). Wait a
      // moment for it to finish, then replay its result — both submissions
      // resolve to the SAME order. Falls back to a clear 409 if it stalls.
      const settled = await waitForCompletion(existing.id);
      if (settled && settled.status_code != null) {
        const stored = settled.response || {};
        return { replayed: true, statusCode: stored.statusCode, body: stored.body };
      }
      throw new AppError(
        409,
        'REQUEST_IN_PROGRESS',
        'A request with this Idempotency-Key is already being processed'
      );
    }
  }

  try {
    const result = await handler();
    row.status_code = result.statusCode ?? 200;
    row.response = { statusCode: result.statusCode ?? 200, body: result.body };
    await row.save();
    return result;
  } catch (err) {
    // Never leave a poison row — the same key stays retryable after a failure.
    await row.destroy().catch(() => {});
    throw err;
  }
}
