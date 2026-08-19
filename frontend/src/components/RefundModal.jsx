import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { Modal, Button, Input, Textarea, Badge, useToast } from './ui';

const fmt = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Cashier/manager refund panel (Phase 6).
 *
 * Replaces the old window.prompt refund flow: pick a full or partial amount
 * against a single payment, attach a reason, and review what's already been
 * returned from the ledger (GET /api/payments/:id/refunds). The backend is
 * the authority — it accumulates `refunded_amount`, guards over-refunds and
 * keeps the order's payment_status in sync.
 */
export default function RefundModal({ open, payment, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [ledger, setLedger] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const remaining = useMemo(() => {
    if (!payment) return 0;
    const paid = Number(payment.amount || 0);
    const refunded = payment.refunded_amount != null ? Number(payment.refunded_amount) : 0;
    return Math.max(0, Math.round((paid - refunded) * 100) / 100);
  }, [payment]);

  useEffect(() => {
    if (!open || !payment) return undefined;
    setError('');
    setSaving(false);
    setReason('');
    setAmount(remaining > 0 ? String(remaining) : '');
    setLedger([]);
    api
      .get(`/payments/${payment.id}/refunds`)
      .then((res) => setLedger(Array.isArray(res.data) ? res.data : []))
      .catch(() => setLedger([]));
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, payment?.id]);

  if (!open || !payment) return null;

  const paid = Number(payment.amount || 0);
  const already = payment.refunded_amount != null ? Number(payment.refunded_amount) : 0;

  const submit = async () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(t('refund.amountRequired'));
      return;
    }
    if (amt > remaining) {
      setError(t('refund.amountTooHigh'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = { status: 'refunded', reason: reason.trim() || undefined };
      if (Math.abs(amt - paid) > 0.005) body.amount = Math.round(amt * 100) / 100;
      await api.patch(`/payments/${payment.id}`, body);
      toast.success(t('refund.done'));
      onSaved?.();
      onClose?.();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      setError(msg || t('refund.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={460}
      title={t('refund.title')}
      description={`${t('refund.payment')} #${payment.id} · ${fmt(paid)}`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="neutral">
              {t('refund.remaining')} {fmt(remaining)}
            </Badge>
            {already > 0 && (
              <Badge tone="warning">
                {t('refund.already')} {fmt(already)}
              </Badge>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={saving || remaining <= 0}>
              {saving ? t('refund.saving') : t('refund.confirm')}
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        {error && (
          <div role="alert" style={{ borderRadius: 12, padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#fff', background: 'var(--danger, #e11d48)' }}>
            {error}
          </div>
        )}
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            {t('refund.amountLabel')}
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            max={remaining}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label={t('refund.amountLabel')}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('refund.amountHint', fmt(paid))}
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
            {t('refund.reasonLabel')}
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('refund.reasonPlaceholder')}
            rows={3}
          />
        </div>

        {ledger.length > 0 && (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
              {t('refund.history')}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {ledger.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12.5,
                    borderRadius: 10,
                    padding: '8px 10px',
                    background: 'var(--surface-2, #f5f5f7)',
                  }}
                >
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {fmt(r.amount)}
                    {r.reason ? ` — ${r.reason}` : ''}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {new Date(r.created_at || r.createdAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {t('refund.hint')}
        </div>
      </div>
    </Modal>
  );
}