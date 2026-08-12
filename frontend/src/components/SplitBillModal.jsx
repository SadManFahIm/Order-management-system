import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { Modal, Button, Input, Select, Badge, useToast } from './ui';

/**
 * Cashier split-parts panel (dine-in split billing).
 *
 * Splits one dine-in order across diners — by item, equally, or by custom
 * amounts — with a payment method + trxID per diner. The frontend computes
 * a live PREVIEW only; the backend (splitService) is the single authority
 * for amounts, allocation, methods and the exact-sum invariant.
 */

const fmt = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const MODES = ['item', 'equal', 'custom'];

/** Integer paisa helpers — mirror the backend's rounding exactly. */
const toPaisa = (n) => Math.round((Number(n) || 0) * 100);
const fromPaisa = (p) => p / 100;

/** Largest-remainder rounding so parts sum EXACTLY to the total. */
function reconcile(fullPaisa, targetPaisa) {
  const out = fullPaisa.map((p) => Math.max(0, Math.floor(p)));
  let diff = targetPaisa - out.reduce((s, v) => s + v, 0);
  let i = 0;
  const guard = out.length * 1000;
  while (diff !== 0 && i < guard) {
    const idx = i % out.length;
    if (diff > 0) {
      out[idx] += 1;
      diff -= 1;
    } else if (out[idx] > 0) {
      out[idx] -= 1;
      diff += 1;
    }
    i += 1;
  }
  return out;
}

export default function SplitBillModal({ open, order, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const { tenants, activeTenantId } = useAuth();
  const [data, setData] = useState(null); // GET /api/orders/:id/split
  const [mode, setMode] = useState('item');
  const [diners, setDiners] = useState([]); // [{ label, method, trxID, amount }]
  // allocation[orderItemId] = { dinerIndex: qty }
  const [alloc, setAlloc] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const methods = useMemo(() => {
    // Whitelisted flags from the auth context — same source as NewOrderPage.
    const active = tenants.find((tn) => Number(tn.id) === Number(activeTenantId));
    const flags = active?.paymentMethods || { cash: true };
    return ['cash', 'bkash', 'nagad', 'card'].filter((m) => flags[m]);
  }, [tenants, activeTenantId]);
  const nonWalletMethods = methods.filter((m) => m !== 'online');
  const methodList = nonWalletMethods.length > 0 ? nonWalletMethods : ['cash'];

  useEffect(() => {
    if (!open || !order) return undefined;
    let mounted = true;
    setError('');
    setMode('item');
    setDiners([]);
    setAlloc({});
    api
      .get(`/orders/${order.id}/split`)
      .then((res) => {
        if (!mounted) return;
        setData(res.data);
        // Prefill an existing split so the cashier can adjust it.
        if (res.data.isSplit && res.data.parts.length >= 2) {
          const d = res.data.parts.map((p) => ({
            label: p.dinerLabel || '',
            method: p.method,
            trxID: p.reference || '',
            amount: String(p.amount || ''),
          }));
          setDiners(d);
          const a = {};
          res.data.parts.forEach((p, di) => {
            (p.items || []).forEach((it) => {
              // Map back via item_name (menu_item_id may be stale after
              // soft-delete) — safer to match by name.
              const line = res.data.items.find((l) => l.item_name === it.item_name);
              const key = String(line ? line.orderItemId : `n:${it.item_name}`);
              a[key] = a[key] || {};
              a[key][di] = (a[key][di] || 0) + it.quantity;
            });
          });
          setAlloc(a);
        }
      })
      .catch(() => {
        if (mounted) {
          setError(t('split.couldNotLoad'));
          toast?.error(t('split.couldNotLoad'));
        }
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order?.id]);

  const items = useMemo(() => data?.items || [], [data]);
  const grandTotal = Number(data?.order?.grand_total ?? order?.grand_total ?? 0);
  const deliveryFee = Number(data?.order?.delivery_fee ?? 0);

  const addDiner = () =>
    setDiners((ds) => [...ds, { label: '', method: methodList[0] || 'cash', trxID: '', amount: '' }]);
  const updateDiner = (i, patch) =>
    setDiners((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const removeDiner = (i) => {
    setDiners((ds) => ds.filter((_, idx) => idx !== i));
    setAlloc((a) => {
      const next = {};
      Object.entries(a).forEach(([lineId, byDiner]) => {
        const filtered = {};
        Object.entries(byDiner).forEach(([di, qty]) => {
          const idx = Number(di);
          if (idx < i) filtered[di] = qty;
          else if (idx > i) filtered[idx - 1] = qty;
        });
        if (Object.keys(filtered).length > 0) next[lineId] = filtered;
      });
      return next;
    });
  };

  const setQty = (lineId, di, qty) => {
    const clean = Math.max(0, Math.min(999, Math.floor(Number(qty) || 0)));
    setAlloc((a) => {
      const next = { ...a, [lineId]: { ...(a[lineId] || {}) } };
      if (clean <= 0) delete next[lineId][di];
      else next[lineId][di] = clean;
      if (Object.keys(next[lineId]).length === 0) delete next[lineId];
      return next;
    });
  };

  // ── Server-mirroring preview math ─────────────────────────────────────
  // Item mode: per-diner share of each line (line_total × q/Q) + equal
  // delivery-fee share, then largest-remainder reconciled to the total —
  // the same algorithm the backend runs (integer paisa).
  const previewParts = useMemo(() => {
    const n = diners.length;
    if (mode === 'equal' && n >= 2) {
      const base = Math.floor(toPaisa(grandTotal) / n);
      const rem = toPaisa(grandTotal) - base * n;
      return diners.map((_, i) => fromPaisa(base + (i < rem ? 1 : 0)));
    }
    if (mode === 'custom' && n >= 2) {
      return diners.map((d) => Number(d.amount) || 0);
    }
    if (mode === 'item' && n >= 2) {
      const full = new Array(n).fill(0);
      for (const line of items) {
        const byDiner = alloc[String(line.orderItemId)];
        if (!byDiner) continue;
        const lineTotalP = toPaisa(line.line_total);
        for (const [di, qty] of Object.entries(byDiner)) {
          full[Number(di)] += Math.round((lineTotalP * qty) / line.quantity);
        }
      }
      const feeP = toPaisa(deliveryFee);
      const feeBase = Math.floor(feeP / n);
      const feeRem = feeP - feeBase * n;
      for (let i = 0; i < n; i += 1) full[i] += feeBase + (i < feeRem ? 1 : 0);
      return reconcile(full, toPaisa(grandTotal)).map(fromPaisa);
    }
    return [];
  }, [mode, diners, items, alloc, grandTotal, deliveryFee]);

  if (!open) return null;

  const sumOfParts = previewParts.reduce((s, v) => s + v, 0);
  const remaining = Math.round((grandTotal - sumOfParts) * 100) / 100;
  const reconciles = Math.abs(remaining) < 0.005;

  // Allocation completeness for item mode.
  const remainingByLine = items.map((line) => {
    const assigned = Object.values(alloc[String(line.orderItemId)] || {}).reduce(
      (s, q) => s + q,
      0
    );
    return { line, assigned, left: line.quantity - assigned };
  });
  const allAssigned = remainingByLine.every((r) => r.left === 0);

  const validate = () => {
    if (diners.length < 2) return t('split.minDiners');
    if (mode === 'item') {
      if (!allAssigned) return t('split.unassignedItems');
      if (remainingByLine.some((r) => r.left < 0)) return t('split.overAllocated');
    }
    if (mode === 'custom' && !previewParts.every((a) => a > 0)) {
      return t('split.customPositive');
    }
    if (!reconciles) return t('split.mismatch');
    if (diners.some((d) => !d.method)) return t('split.methodRequired');
    return '';
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = {
        mode,
        diners: diners.map((d) => ({
          label: d.label,
          method: d.method,
          trxID: d.trxID,
          ...(mode === 'custom' ? { amount: Number(d.amount) } : {}),
        })),
        allocations:
          mode === 'item'
            ? Object.entries(alloc).flatMap(([lineId, byDiner]) =>
                Object.entries(byDiner).map(([di, qty]) => ({
                  orderItemId: Number(lineId) || null,
                  dinerIndex: Number(di),
                  quantity: qty,
                }))
              )
            : undefined,
      };
      // orderItemId may be an item-name fallback key (soft-deleted product)
      // — filter those out; the server only accepts real order item ids.
      body.allocations = (body.allocations || []).filter(
        (a) => Number.isInteger(a.orderItemId) && a.orderItemId > 0
      );
      if (data?.locked) {
        setError(data.lockReason || t('split.locked'));
        return;
      }
      await api.post(`/orders/${order.id}/split`, body);
      toast.success(t('split.saved'));
      onSaved?.();
      onClose?.();
    } catch (err) {
      const msg = err?.response?.data?.error?.message || t('split.saveFailed');
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const methodsFor = methodList;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={860}
      title={t('split.title')}
      description={`#${order?.id} · ${t('split.table')} ${data?.order?.table_no ?? order?.table_no ?? '—'} · ${fmt(grandTotal)}`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone="neutral">
              {t('split.totalOrder')} {fmt(grandTotal)}
            </Badge>
            <Badge tone={reconciles ? 'success' : 'danger'}>
              {t('split.sumOfSplits')} {fmt(sumOfParts)}
              {!reconciles && ` (${t('split.remaining')} ${fmt(remaining)})`}
            </Badge>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit} disabled={saving || data?.locked}>
              {saving ? t('split.saving') : t('split.apply')}
            </Button>
          </div>
        </div>
      }
    >
      {!data ? (
        <div style={{ padding: 24, color: 'var(--text-muted)' }}>{t('split.loading')}</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Re-split guard — real money (gateway intent, refund, collected
              wallet part) already moved, so the panel is read-only here. */}
          {data.locked && (
            <div
              role="alert"
              aria-label="Split locked"
              style={{
                background: 'var(--warning-soft, #fff7e6)',
                color: 'var(--warning, #b45309)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <span>🔒</span>
              <div>
                <div>{t('split.locked')}</div>
                {data.lockReason && (
                  <div style={{ fontWeight: 500, marginTop: 2, opacity: 0.9 }}>{data.lockReason}</div>
                )}
              </div>
            </div>
          )}
          {error && (
            <div
              style={{
                background: 'var(--danger-soft, #fdeef1)',
                color: 'var(--danger, #e11d48)',
                borderRadius: 10,
                padding: '10px 12px',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 8 }}>
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  background: mode === m ? 'var(--primary)' : 'var(--surface-2)',
                  color: mode === m ? '#fff' : 'var(--text-muted)',
                }}
              >
                {t(`split.mode${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
              </button>
            ))}
          </div>

          {mode === 'item' && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('split.itemHint')}
            </div>
          )}
          {mode === 'equal' && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('split.equalHint')}
            </div>
          )}
          {mode === 'custom' && (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              {t('split.customHint')}
            </div>
          )}

          {/* Diner cards */}
          <div style={{ display: 'grid', gap: 12 }}>
            {diners.map((d, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '12px 14px',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Badge tone="primary">{t('split.diner', i + 1)}</Badge>
                  <Input
                    placeholder={t('split.dinerName')}
                    value={d.label}
                    onChange={(e) => updateDiner(i, { label: e.target.value })}
                    style={{ maxWidth: 180 }}
                  />
                  <Select
                    aria-label={`${t('split.diner', i + 1)} ${t('split.paymentMethod')}`}
                    value={d.method}
                    onChange={(e) => updateDiner(i, { method: e.target.value })}
                    style={{ maxWidth: 140 }}
                  >
                    {methodsFor.map((m) => (
                      <option key={m} value={m}>
                        {t(`orders.pay${m.charAt(0).toUpperCase()}${m.slice(1)}`)}
                      </option>
                    ))}
                  </Select>
                  {(d.method === 'bkash' || d.method === 'nagad') && (
                    <Input
                      placeholder={t('split.trxId')}
                      value={d.trxID}
                      onChange={(e) => updateDiner(i, { trxID: e.target.value })}
                      style={{ maxWidth: 170 }}
                    />
                  )}
                  {mode === 'custom' && (
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={fmt(grandTotal)}
                      value={d.amount}
                      onChange={(e) => updateDiner(i, { amount: e.target.value })}
                      style={{ maxWidth: 120, textAlign: 'right' }}
                    />
                  )}
                  <span style={{ marginLeft: 'auto', fontWeight: 800, fontSize: 15 }}>
                    {fmt(previewParts[i] ?? 0)}
                  </span>
                  {diners.length > 2 && (
                    <Button size="sm" variant="ghost" onClick={() => removeDiner(i)}>
                      ✕
                    </Button>
                  )}
                </div>
                {mode === 'item' && (
                  <div
                    style={{
                      display: 'grid',
                      gap: 6,
                      maxHeight: 190,
                      overflowY: 'auto',
                      paddingRight: 4,
                    }}
                  >
                    {items.map((line) => {
                      const q = alloc[String(line.orderItemId)]?.[i] || 0;
                      return (
                        <div
                          key={line.orderItemId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 13,
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {line.item_name}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                            {fmt(line.unit_price)}
                          </span>
                          <button
                            onClick={() => setQty(line.orderItemId, i, q - 1)}
                            aria-label={`${t('split.diner', i + 1)} · ${line.item_name} · −`}
                            style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontWeight: 700 }}
                          >
                            −
                          </button>
                          <span style={{ width: 26, textAlign: 'center', fontWeight: 700 }}>{q}</span>
                          <button
                            onClick={() => setQty(line.orderItemId, i, q + 1)}
                            aria-label={`${t('split.diner', i + 1)} · ${line.item_name} · +`}
                            style={{ width: 26, height: 26, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', fontWeight: 700 }}
                          >
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {diners.length < 8 && (
              <div>
                <Button size="sm" variant="ghost" onClick={addDiner}>
                  + {t('split.addDiner')}
                </Button>
              </div>
            )}
          </div>

          {/* Allocation completeness (item mode) */}
          {mode === 'item' && (
            <div style={{ display: 'grid', gap: 6 }}>
              {remainingByLine.map(({ line, assigned, left }) => (
                <div key={line.orderItemId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span>{line.item_name}</span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: left === 0 ? 'var(--success, #2e9e6b)' : left < 0 ? 'var(--danger, #e11d48)' : 'var(--text-muted)',
                    }}
                  >
                    {assigned}/{line.quantity} {left === 0 ? t('split.assigned') : `${left} ${t('split.left')}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Payment status hint */}
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
            {t('split.paymentHint')}
          </div>
        </div>
      )}
    </Modal>
  );
}
