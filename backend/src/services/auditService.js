import AuditLog from '../models/AuditLog.js';

/**
 * Writes an entry to the append-only audit trail.
 */
export async function audit({
  action,
  actorId = null,
  tenantId = null,
  entityType = null,
  entityId = null,
  metadata = null,
  req = null,
  transaction = null,
}) {
  try {
    await AuditLog.create(
      {
        action,
        actor_id: actorId,
        tenant_id: tenantId,
        entity_type: entityType,
        entity_id: entityId == null ? null : String(entityId),
        // migration 001 declares metadata NOT NULL DEFAULT '{}'.
        metadata: metadata ?? {},
        ip: req?.ip || null,
      },
      { transaction: transaction || null }
    );
  } catch (err) {
    // Auditing must never break the request that triggered it.
    console.error('[audit] failed to write entry:', err.message);
  }
}
