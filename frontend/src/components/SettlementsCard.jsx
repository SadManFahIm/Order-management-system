import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { Card, Button, Input, Select, Badge, Field, useToast } from './ui';

const fmt = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const STATUS_TONE = {
  pending: 'neutral',
  processing: 'warning',
  completed: 'success',
  failed: 'danger',
  reversed: 'neutral',
};

/**
 * Settlements / wallet balance (Phase 6, Feature 4).
 *
 * A settlement moves money from the merchant's gateway wallet to their bank
 * account — it is NEVER revenue. The wallet balance is computed live from the
 * ledger (collected online payments − refunds − settlements), and managers can
 * record + track settlement requests against it.
 */
export default function SettlementsCard() {
  const { t } = useI18n();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [balance, setBalance] = useState(null);
  const [gateway, setGateway] = useState('bkash');
  const [requestedAmount, setRequestedAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get('/settlements').then((res) => setRows(res.data || [])).catch(() => {});
    api.get('/settlements/balance').then((res) => setBalance(res.data || null)).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const canRequest = useMemo(() => {
    const amt = Number(requestedAmount);
    return Number.isFinite(amt) && amt > 0;
  }, [requestedAmount]);

  const request = async () => {
    setSaving(true);
    try {
      await api.post('/settlements', { gateway, requestedAmount: Number(requestedAmount) });
      toast.success(t('settings.settlementCreated'));
      setRequestedAmount('');
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || t('settings.settlementFailed'));
    } finally {
      setSaving(false);
    }
  };

  const advance = async (row, status) => {
    try {
      await api.patch(`/settlements/${row.id}`, { status });
      toast.success(t('settings.settlementUpdated'));
      load();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || t('settings.settlementFailed'));
    }
  };

  return (
    <Card
      title={t('settings.settlementsTitle')}
      subtitle={t('settings.settlementsDesc')}
      style={{ marginTop: 16 }}
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {/* Wallet balance — live from the ledger */}
        {balance && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
            }}
          >
            {[
              [t('settings.settlementCollected'), balance.gross_collected],
              [t('settings.settlementRefunded'), balance.refunded],
              [t('settings.settlementSettled'), balance.settled],
              [t('settings.settlementBalance'), balance.balance],
            ].map(([label, value]) => (
              <div key={label} style={{ borderRadius: 12, padding: '12px 14px', background: 'var(--surface-2, #f5f5f7)' }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 17, fontWeight: 800 }}>{fmt(value)}</div>
              </div>
            ))}
          </div>
        )}

        {/* New settlement request */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 150 }}>
            <Field label={t('settings.settlementGateway')} hint="">
              <Select value={gateway} onChange={(e) => setGateway(e.target.value)}>
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
                <option value="stripe">Stripe</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>
          <div style={{ minWidth: 150 }}>
            <Field label={t('settings.settlementAmount')} hint="">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="৳"
                value={requestedAmount}
                onChange={(e) => setRequestedAmount(e.target.value)}
              />
            </Field>
          </div>
          <Button variant="primary" onClick={request} disabled={saving || !canRequest}>
            {saving ? t('common.loading') : t('settings.settlementRequest')}
          </Button>
        </div>

        {/* History */}
        <div>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
            {t('settings.settlementsHistory')}
          </div>
          {rows.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('settings.settlementsEmpty')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
              {rows.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    fontSize: 13,
                    borderRadius: 10,
                    padding: '8px 10px',
                    background: 'var(--surface-2, #f5f5f7)',
                  }}
                >
                  <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{r.status}</Badge>
                  <span style={{ fontWeight: 700 }}>{fmt(r.settled_amount ?? r.requested_amount)}</span>
                  <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{r.gateway}</span>
                  {r.bank_ref && <span style={{ color: 'var(--text-muted)' }}>{r.bank_ref}</span>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12 }}>
                    {new Date(r.requested_at || r.created_at || r.createdAt).toLocaleDateString()}
                  </span>
                  {r.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" variant="outline" onClick={() => advance(r, 'processing')}>
                        {t('settings.settlementProcessing')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => advance(r, 'completed')}>
                        {t('settings.settlementCompleted')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}