import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { useRealtimeOrders } from '../hooks/useRealtimeOrders';
import { PageHeader, Card, Table, Button, Badge, Select, Skeleton, useToast } from '../components/ui';
import SplitBillModal from '../components/SplitBillModal';

const fmt = (n) => `৳ ${Number(n).toFixed(2)}`;

const STATUS_TONE = {
  placed: 'neutral',
  accepted: 'warning',
  preparing: 'warning',
  ready: 'primary',
  out_for_delivery: 'accent',
  delivered: 'success',
  rejected: 'danger',
  canceled: 'danger',
};

const STATUS_ORDER = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'rejected',
  'canceled',
];

const DELIVERY_TYPES = ['delivery', 'scheduled_delivery'];

// Next step in the happy path, or null when terminal/canceled.
// ready → out_for_delivery for delivery orders, delivered for pickup.
const NEXT_STATUS = (order) => {
  if (order.status === 'ready') return DELIVERY_TYPES.includes(order.type) ? 'out_for_delivery' : 'delivered';
  if (order.status === 'placed') return 'preparing';
  if (order.status === 'accepted') return 'preparing';
  if (order.status === 'out_for_delivery') return 'delivered';
  return null;
};

const statusLabel = (t, status) => t(`orders.${status}`);

/** wa.me deep link with a pre-filled order alert (WhatsApp notifications). */
function whatsappLinkFor(number, order) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return null;
  const lines = [
    `🆕 New order #${order.order_no || order.id}`,
  ];
  if (order.table_no) lines.push(`🪑 Table ${order.table_no}`);
  if (order.customer_name) lines.push(`👤 ${order.customer_name}`);
  (order.items || []).slice(0, 8).forEach((it) => lines.push(`• ${it.item_name} ×${it.quantity}`));
  lines.push(`💰 ${fmt(order.grand_total)}`);
  lines.push(`📌 Status: ${order.status}`);
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;
}

const typeLabel = (t, type) => t(`orders.type${type.charAt(0).toUpperCase()}${type.slice(1)}`) || type;

export default function OrdersListPage() {
  const [orders, setOrders] = useState(null);
  const [splitFor, setSplitFor] = useState(null); // dine-in order to split
  const [tables, setTables] = useState([]);
  const [members, setMembers] = useState([]);
  const [filters, setFilters] = useState({ status: '', tableNo: '', sort: 'open', assignedToMe: false });
  const toast = useToast();
  const { t } = useI18n();
  const { tenants, activeTenantId } = useAuth();

  const active = tenants.find((tn) => Number(tn.id) === Number(activeTenantId));
  const waConfig = active?.whatsapp || {};
  // Mirror backend RBAC (backend/src/config/roles.js) so actions a role
  // cannot perform are never shown.
  const role = active?.role;
  const canPlace = ['owner', 'manager', 'cashier', 'platform_admin', 'staff'].includes(role);
  const canFulfill = ['owner', 'manager', 'kitchen', 'platform_admin', 'staff'].includes(role);
  const canDeliver = ['owner', 'manager', 'delivery', 'platform_admin', 'staff'].includes(role);
  const canManage = ['owner', 'manager', 'platform_admin', 'staff'].includes(role);
  const isDeliveryRole = role === 'delivery';
  const waNumber = waConfig.enabled ? waConfig.number : '';

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    load();
    api.get('/tables').then((res) => { if (mounted.current) setTables(res.data || []); }).catch(() => {});
    // Delivery riders for the manager's assign dropdown (delivery role).
    if (canManage && activeTenantId) {
      api
        .get(`/tenants/${activeTenantId}/members`)
        .then((res) => {
          if (mounted.current) setMembers((res.data || []).filter((m) => m.role === 'delivery'));
        })
        .catch(() => {});
    }
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId]);

  const load = async () => {
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.tableNo === 'none') params.table_no = 'none';
      else if (filters.tableNo !== '') params.table_no = Number(filters.tableNo);
      if (filters.sort === 'open') params.sort = 'open';
      if (filters.assignedToMe) params.assigned_to = 'me';
      const res = await api.get('/orders', { params });
      if (mounted.current) setOrders(res.data);
    } catch {
      if (mounted.current) {
        setOrders([]);
        toast?.error(t('orders.couldNotLoad'));
      }
    }
  };

  // Refetch whenever a filter changes (skip the initial mount fetch above).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Real-time kitchen/delivery queue (Phase 5): live order events refetch the
  // list; the 30s polling stays on as a fallback whenever the socket is down.
  const wsConnected = useRealtimeOrders({
    enabled: !!activeTenantId,
    tenantId: activeTenantId,
    onEvent: (msg) => {
      if (['order.created', 'order.status_changed', 'order.assigned'].includes(msg.event)) load();
    },
    // Resync after a reconnect: events emitted while the socket was down
    // (and the fallback poll was paused) are picked up by refetching.
    onConnect: () => {
      load();
    },
  });
  useEffect(() => {
    if (wsConnected) return undefined;
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected]);

  const setStatus = async (o, status, extra = {}) => {
    try {
      await api.patch(`/orders/${o.id}/status`, { status, ...extra });
      toast.success(`Order #${o.id} → ${statusLabel(t, status)}`);
      await load();
    } catch {
      toast.error(t('orders.couldNotUpdate'));
    }
  };

  const markPaid = async (o) => {
    const payment = (o.payments || [])[0];
    if (!payment) return;
    try {
      await api.patch(`/payments/${payment.id}`, { status: 'paid' });
      toast.success(t('orders.markedPaid'));
      await load();
    } catch {
      toast.error(t('orders.couldNotUpdate'));
    }
  };

  const removeSplit = async (o) => {
    if (!window.confirm(t('split.removeConfirm'))) return;
    try {
      await api.delete(`/orders/${o.id}/split`);
      toast.success(t('split.removed'));
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || t('orders.couldNotUpdate'));
    }
  };

  const refundPayment = async (o) => {
    const payment = (o.payments || [])[0];
    if (!payment) return;
    const amount = window.prompt(
      `Refund amount in ৳ (blank = full ${Number(payment.amount).toFixed(2)})?`,
      String(Number(payment.amount).toFixed(2))
    );
    if (amount === null) return;
    const reason = window.prompt('Reason (optional)?') || undefined;
    try {
      const body = { status: 'refunded', reason };
      const amt = Number(amount);
      if (Number.isFinite(amt) && amt >= 0 && amt !== Number(payment.amount)) body.amount = amt;
      await api.patch(`/payments/${payment.id}`, body);
      toast.success(t('orders.refunded'));
      await load();
    } catch {
      toast.error(t('orders.couldNotUpdate'));
    }
  };

  const onAccept = (o) => setStatus(o, 'accepted');
  const onReject = (o) => {
    const reason = window.prompt(t('orders.rejectReasonPrompt'));
    if (reason === null) return;
    setStatus(o, 'rejected', { reason: reason.trim() });
  };

  const onAssign = async (o, userId) => {
    try {
      await api.patch(`/orders/${o.id}/assign`, { delivery_user_id: userId || null });
      toast.success(`Order #${o.id} → ${userId ? t('orders.assignedTo') : t('orders.unassign')}`);
      await load();
    } catch {
      toast.error(t('orders.couldNotUpdate'));
    }
  };

  const onAdvance = (o) => {
    const next = NEXT_STATUS(o);
    if (next) setStatus(o, next);
  };

  const onCancel = (o) => {
    if (!window.confirm(t('orders.cancelConfirm', o.id))) return;
    setStatus(o, 'canceled');
  };

  return (
    <div className="oms-page">
      <PageHeader
        title={t('pages.orders')}
        desc={t('pages.ordersDesc')}
        actions={
          <Button to="/orders/new" variant="primary">
            + {t('nav.newOrder')}
          </Button>
        }
      />

      {/* Filter bar — kitchen/delivery view: open orders surface first. */}
      <div className="oms-order-filters">
        <label className="oms-order-filters__field">
          <span>{t('orders.filterStatus')}</span>
          <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">{t('orders.allStatuses')}</option>
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{statusLabel(t, s)}</option>
            ))}
          </Select>
        </label>
        <label className="oms-order-filters__field">
          <span>{t('orders.filterTable')}</span>
          <Select value={filters.tableNo} onChange={(e) => setFilters((f) => ({ ...f, tableNo: e.target.value }))}>
            <option value="">{t('orders.allTables')}</option>
            <option value="none">{t('orders.noTable')}</option>
            {tables.filter((tb) => tb.is_active).map((tb) => (
              <option key={tb.id} value={tb.table_no}>
                {tb.name ? `${tb.name} (${tb.table_no})` : t('orders.table', tb.table_no)}
              </option>
            ))}
          </Select>
        </label>
        <label className="oms-order-filters__field">
          <span>{t('orders.filterSort')}</span>
          <Select value={filters.sort} onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value }))}>
            <option value="open">{t('orders.sortOpen')}</option>
            <option value="newest">{t('orders.sortNewest')}</option>
          </Select>
        </label>
        {isDeliveryRole && (
          <label className="oms-order-filters__field">
            <span>{t('orders.assignedTo')}</span>
            <Select
              value={filters.assignedToMe ? 'me' : ''}
              onChange={(e) => setFilters((f) => ({ ...f, assignedToMe: e.target.value === 'me' }))}
            >
              <option value="">{t('orders.allStatuses')}</option>
              <option value="me">{t('orders.myOrders')}</option>
            </Select>
          </label>
        )}
        {wsConnected ? (
          <div className="oms-order-filters__wa" title={t('orders.liveQueue')}>
            <span style={{ color: 'var(--success, #2e9e6b)' }}>●</span> {t('orders.liveQueue')}
          </div>
        ) : (
          <div className="oms-order-filters__wa" title={t('orders.reconnecting')}>
            <span style={{ color: 'var(--text-muted, #7d9a95)' }}>○</span> {t('orders.reconnecting')}
          </div>
        )}
      </div>

      <Card bodyPadding={false}>
        {orders === null ? (
          <div style={{ padding: 24, display: 'grid', gap: 12 }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} height={34} />
            ))}
          </div>
        ) : (
          <Table
            columns={[
              { key: 'id', label: 'Order' },
              { key: 'type', label: t('orders.typeCol') },
              { key: 'customer_name', label: 'Customer' },
              { key: 'table_no', label: t('orders.tableCol') },
              { key: 'rider', label: t('orders.deliveryCol') },
              { key: 'subtotal', label: 'Subtotal', align: 'right' },
              { key: 'grand_total', label: 'Total', align: 'right' },
              { key: 'payment', label: t('orders.paymentCol') },
              { key: 'items', label: 'Items', align: 'right' },
              { key: 'status', label: 'Status' },
              { key: 'actions', label: '', align: 'right' },
            ]}
            rows={orders}
            render={(o, key) => {
              if (key === 'id') return <Badge tone="primary">#{o.id}</Badge>;
              if (key === 'type')
                return (
                  <Badge tone={DELIVERY_TYPES.includes(o.type) ? 'accent' : 'neutral'}>
                    {typeLabel(t, o.type)}
                  </Badge>
                );
              if (key === 'customer_name') return <span className="oms-table__cell-strong">{o.customer_name}</span>;
              if (key === 'table_no')
                return o.table_no ? (
                  <Badge tone="accent">🪑 {t('orders.table', o.table_no)}</Badge>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                );
              if (key === 'rider') {
                const rider = members.find((m) => m.userId === o.assigned_to);
                return o.assigned_to ? (
                  <Badge tone="primary">{rider?.name || `#${o.assigned_to}`}</Badge>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                );
              }
              if (key === 'subtotal') return fmt(o.subtotal);
              if (key === 'grand_total')
                return (
                  <span className="oms-table__cell-strong">
                    {fmt(o.grand_total)}
                    {Number(o.delivery_fee) > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                        + {t('store.deliveryFee')} {fmt(o.delivery_fee)}
                      </div>
                    )}
                  </span>
                );
              if (key === 'payment') {
                const method = ['cash', 'bkash', 'nagad', 'card', 'split'].includes(o.payment_method)
                  ? o.payment_method
                  : 'cash';
                const methodLabel = t(
                  `orders.pay${method.charAt(0).toUpperCase()}${method.slice(1)}`
                );
                const payment = (o.payments || [])[0];
                const splitParts = (o.payments || []).filter((p) => p.split_method);
                const statusTone =
                  o.payment_status === 'paid'
                    ? 'success'
                    : o.payment_status === 'partial'
                    ? 'warning'
                    : o.payment_status === 'refunded'
                    ? 'neutral'
                    : 'warning';
                return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge tone="neutral">{methodLabel}</Badge>
                      <Badge tone={statusTone}>
                        {o.payment_status === 'paid'
                          ? t('orders.paidStatus')
                          : o.payment_status === 'partial'
                          ? t('orders.partialStatus')
                          : o.payment_status === 'refunded'
                          ? t('orders.refundedStatus')
                          : t('orders.unpaidStatus')}
                      </Badge>
                    </div>
                    {/* Per-diner split parts (dine-in split billing) */}
                    {splitParts.length > 0 && (
                      <div style={{ display: 'grid', gap: 4, width: '100%' }}>
                        {splitParts.map((p) => (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Badge tone="primary">
                              {p.notes || t('split.diner', p.diner_index || 1)} · {fmt(p.amount)}
                            </Badge>
                            <Badge tone={p.status === 'paid' ? 'success' : 'warning'}>{p.status}</Badge>
                            <Button
                              size="sm"
                              variant="ghost"
                              to={`/orders/${o.id}/split/receipts/${p.id}`}
                              title={`${t('split.receiptTitle')} — ${p.notes || p.id}`}
                            >
                              🧾 {t('split.receipt')}
                            </Button>
                          </div>
                        ))}
                        {canPlace && (
                          <Button size="sm" variant="ghost" onClick={() => removeSplit(o)} style={{ justifySelf: 'start' }}>
                            ✕ {t('split.removeSplit')}
                          </Button>
                        )}
                      </div>
                    )}
                    {!splitParts.length && canPlace && o.payment_status !== 'paid' && payment && (
                      <Button size="sm" variant="ghost" onClick={() => markPaid(o)}>
                        ✓ {t('orders.markPaid')}
                      </Button>
                    )}
                    {!splitParts.length && canPlace && o.payment_status === 'paid' && payment && payment.status === 'paid' && (
                      <Button size="sm" variant="ghost" onClick={() => refundPayment(o)}>
                        ↩ {t('orders.refund')}
                      </Button>
                    )}
                  </div>
                );
              }
              if (key === 'items') return o.items?.length ?? 0;
              if (key === 'status')
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <Badge tone={STATUS_TONE[o.status] || 'neutral'}>
                      {statusLabel(t, o.status) || o.status}
                    </Badge>
                    {o.status === 'rejected' && o.rejected_reason && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }} title={o.rejected_reason}>
                        {o.rejected_reason.slice(0, 40)}{o.rejected_reason.length > 40 ? '…' : ''}
                      </span>
                    )}
                    {o.scheduled_at && (
                      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                        🕒 {t('orders.scheduledAt')}: {new Date(o.scheduled_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                );
              if (key === 'actions') {
                const next = NEXT_STATUS(o);
                const waLink = whatsappLinkFor(waNumber, o);
                const isDelivery = DELIVERY_TYPES.includes(o.type);
                const assignable = canManage && isDelivery && !['delivered', 'canceled', 'rejected'].includes(o.status);
                const canAcceptOrder = canFulfill && o.status === 'placed';
                const canRejectOrder = canFulfill && ['placed', 'accepted'].includes(o.status);
                // Dine-in orders on a physical table can be split at the counter.
                const canSplit = canPlace && !!o.table_no && !['canceled', 'rejected'].includes(o.status);
                return (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', maxWidth: 320 }}>
                    {canSplit && (
                      <Button size="sm" variant="primary" onClick={() => setSplitFor(o)} title={t('split.splitBill')}>
                        ⇄ {t('split.splitBill')}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" to={`/orders/${o.id}/invoice`} title={`Invoice ${o.order_no || o.id}`}>
                      🧾 Invoice
                    </Button>
                    {waLink && (
                      <Button
                        size="sm"
                        variant="ghost"
                        to={waLink}
                        target="_blank"
                        rel="noreferrer"
                        title={`WhatsApp #${o.order_no || o.id}`}
                      >
                        💬 {t('orders.notifyWa')}
                      </Button>
                    )}
                    {canAcceptOrder && (
                      <Button size="sm" variant="primary" onClick={() => onAccept(o)}>
                        ✓ {t('orders.accept')}
                      </Button>
                    )}
                    {canRejectOrder && (
                      <Button size="sm" variant="danger" onClick={() => onReject(o)}>
                        ✕ {t('orders.reject')}
                      </Button>
                    )}
                    {next && (next === 'delivered' || next === 'out_for_delivery' ? canDeliver : canFulfill) && (
                      <Button size="sm" variant="primary" onClick={() => onAdvance(o)}>
                        {statusLabel(t, next)}
                      </Button>
                    )}
                    {canManage && o.status !== 'canceled' && o.status !== 'delivered' && o.status !== 'rejected' && (
                      <Button size="sm" variant="danger" onClick={() => onCancel(o)}>
                        {t('common.cancel')}
                      </Button>
                    )}
                    {assignable && (
                      <Select
                        value={o.assigned_to ? String(o.assigned_to) : ''}
                        onChange={(e) => onAssign(o, e.target.value ? Number(e.target.value) : null)}
                        style={{ maxWidth: 130, minHeight: 30, fontSize: 12 }}
                      >
                        <option value="">{t('orders.assign')}…</option>
                        {members.length === 0 && <option value="" disabled>{t('orders.noDeliveryMembers')}</option>}
                        {members.map((m) => (
                          <option key={m.userId} value={m.userId}>{m.name || m.email}</option>
                        ))}
                      </Select>
                    )}
                  </div>
                );
              }
              return o[key];
            }}
            empty={{
              icon: <span style={{ fontSize: 22 }}>📦</span>,
              title: t('pages.noOrders'),
              description: t('pages.noOrdersDesc'),
              action: (
                <Button to="/orders/new" variant="primary" size="sm">
                  {t('pages.createFirstOrder')}
                </Button>
              ),
            }}
          />
        )}
      </Card>

      <SplitBillModal
        open={!!splitFor}
        order={splitFor}
        onClose={() => setSplitFor(null)}
        onSaved={() => load()}
      />
    </div>
  );
}
