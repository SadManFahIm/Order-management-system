import { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { Modal, Button, Select, Input, Textarea, Badge, useToast } from './ui';

/**
 * Order-edit-request panel (Phase 5 follow-up).
 *
 * Staff can request a change to a still-live order (add/remove/change items).
 * The request is parked as `pending` and the live order stays untouched until a
 * manager approves (which re-prices server-side and rewrites the order) or
 * rejects it. The backend enforces one pending request at a time (409).
 */

const fmt = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function OrderEditModal({ open, order, canManage, onClose, onSaved }) {
  const { t } = useI18n();
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [lines, setLines] = useState([]); // [{ product_id, name, price, quantity }]
  const [addPid, setAddPid] = useState('');
  const [addQty, setAddQty] = useState(1);
  const [reason, setReason] = useState('');
  const [requests, setRequests] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false); // approve/reject in-flight

  const editableStatuses = ['placed', 'accepted', 'preparing'];

  useEffect(() => {
    if (!open || !order) return undefined;
    let mounted = true;
    setError('');
    setReason('');
    setLines(
      (order.items || []).map((it) => ({
        product_id: it.product_id,
        name: it.item_name,
        price: Number(it.unit_price ?? it.base_total ?? 0),
        quantity: Number(it.quantity || 1),
      }))
    );
    api
      .get('/products')
      .then((res) => {
        if (mounted) setProducts((res.data || []).filter((p) => p.enabled !== false));
      })
      .catch(() => {});
    api
      .get(`/orders/${order.id}/edit-requests`)
      .then((res) => {
        if (mounted) setRequests(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [open, order]);

  const pendingReq = useMemo(
    () => requests.find((r) => r.status === 'pending'),
    [requests]
  );

  const setQty = (idx, delta) => {
    setLines((ls) =>
      ls.map((l, i) =>
        i === idx ? { ...l, quantity: Math.max(1, Math.min(99, l.quantity + delta)) } : l
      )
    );
  };

  const removeLine = (idx) => setLines((ls) => ls.filter((_, i) => i !== idx));

  const addProduct = () => {
    if (!addPid) return;
    const prod = products.find((p) => p.id === Number(addPid));
    if (!prod) return;
    const existing = lines.find((l) => l.product_id === prod.id);
    if (existing) {
      setLines((ls) =>
        ls.map((l) =>
          l.product_id === prod.id ? { ...l, quantity: l.quantity + addQty } : l
        )
      );
    } else {
      setLines((ls) => [
        ...ls,
        { product_id: prod.id, name: prod.name, price: Number(prod.price || 0), quantity: addQty },
      ]);
    }
    setAddPid('');
    setAddQty(1);
  };

  const submitRequest = async () => {
    if (!reason.trim()) {
      setError(t('orders.editReasonRequired'));
      return;
    }
    if (lines.length === 0) {
      setError(t('orders.editItemsRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post(`/orders/${order.id}/edit-request`, {
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
        reason: reason.trim(),
      });
      toast.success(t('orders.editRequested'));
      setReason('');
      const res = await api.get(`/orders/${order.id}/edit-requests`);
      setRequests(Array.isArray(res.data) ? res.data : []);
      onSaved?.();
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      if (code === 'EDIT_REQUEST_PENDING') {
        setError(t('orders.editPendingConflict'));
      } else {
        setError(err?.response?.data?.error?.message || t('orders.editRequestFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const decide = async (reqId, action) => {
    setBusy(true);
    setError('');
    try {
      if (action === 'approve') {
        await api.post(`/orders/${order.id}/edit-request/${reqId}/approve`);
        toast.success(t('orders.editApproved'));
      } else {
        const note = window.prompt(t('orders.editRejectPrompt')) || '';
        await api.post(`/orders/${order.id}/edit-request/${reqId}/reject`, { note });
        toast.success(t('orders.editRejected'));
      }
      const res = await api.get(`/orders/${order.id}/edit-requests`);
      setRequests(Array.isArray(res.data) ? res.data : []);
      onSaved?.();
    } catch {
      toast.error(t('orders.couldNotUpdate'));
    } finally {
      setBusy(false);
    }
  };

  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={720}
      title={t('orders.editRequest')}
      description={`#${order?.id} · ${order?.customer_name || ''} · ${fmt(order?.grand_total)}`}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 12 }}>
          <Badge tone="neutral">{t('orders.editPreview')} {fmt(total)}</Badge>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
            {editableStatuses.includes(order?.status) && (
              <Button variant="primary" onClick={submitRequest} disabled={saving || !!pendingReq}>
                {saving ? t('orders.editSaving') : t('orders.editRequestSubmit')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 16 }}>
        {pendingReq && (
          <div
            role="alert"
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
              padding: 12, borderRadius: 10, background: 'var(--warning-bg, #fff8e1)',
              border: '1px solid var(--warning, #f5a623)', flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Badge tone="warning">{t('orders.editPending')}</Badge>
              <span style={{ fontSize: 12.5, color: 'var(--text)' }}>
                {pendingReq.reason || t('orders.editPendingDesc')}
              </span>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="success" disabled={busy} onClick={() => decide(pendingReq.id, 'approve')}>
                  ✓ {t('orders.editApprove')}
                </Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => decide(pendingReq.id, 'reject')}>
                  ✕ {t('orders.editReject')}
                </Button>
              </div>
            )}
          </div>
        )}

        {!editableStatuses.includes(order?.status) && !pendingReq && (
          <div role="alert" style={{ padding: 12, borderRadius: 10, background: 'var(--neutral-bg, #f2f4f5)', fontSize: 13 }}>
            {t('orders.editNotEditable')}
          </div>
        )}

        {/* Current + requested line items, editable by staff. */}
        <div style={{ display: 'grid', gap: 8 }}>
          {lines.map((l, idx) => (
            <div
              key={`${l.product_id}-${idx}`}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 10 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{l.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmt(l.price)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button size="sm" variant="ghost" onClick={() => setQty(idx, -1)}>−</Button>
                <span style={{ minWidth: 28, textAlign: 'center', fontWeight: 700 }}>{l.quantity}</span>
                <Button size="sm" variant="ghost" onClick={() => setQty(idx, 1)}>+</Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => removeLine(idx)}>✕</Button>
            </div>
          ))}
        </div>

        {/* Add a product from the menu. */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select value={addPid} onChange={(e) => setAddPid(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
            <option value="">{t('orders.editAddProduct')}…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · {fmt(p.price)}</option>
            ))}
          </Select>
          <Input
            type="number"
            min={1}
            max={99}
            value={addQty}
            onChange={(e) => setAddQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
            style={{ width: 72 }}
          />
          <Button size="sm" variant="outline" onClick={addProduct} disabled={!addPid}>
            + {t('orders.editAdd')}
          </Button>
        </div>

        <Textarea
          placeholder={t('orders.editReasonPlaceholder')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />

        {error && (
          <div role="alert" style={{ color: 'var(--danger, #c62828)', fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}

        {/* Historical decisions on this order. */}
        {requests.filter((r) => r.status !== 'pending').length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            {requests
              .filter((r) => r.status !== 'pending')
              .map((r) => (
                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-muted)' }}>
                  <Badge tone={r.status === 'approved' ? 'success' : 'danger'}>{r.status}</Badge>
                  <span>{r.reason || '—'}</span>
                  {r.decision_note && <span>· {r.decision_note}</span>}
                </div>
              ))}
          </div>
        )}
      </div>
    </Modal>
  );
}