import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { PageHeader, Card, Table, Button, Badge, Select, Skeleton, useToast } from '../components/ui';

const fmt = (n) => `৳ ${Number(n).toFixed(2)}`;

const STATUS_TONE = {
  placed: 'neutral',
  preparing: 'warning',
  ready: 'primary',
  delivered: 'success',
  canceled: 'danger',
};

const STATUS_ORDER = ['placed', 'preparing', 'ready', 'delivered', 'canceled'];

// Next step in the happy path, or null when terminal/canceled.
const NEXT_STATUS = {
  placed: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
  delivered: null,
  canceled: null,
};

const statusLabel = (t, status) => t(`orders.${status}`);

/** wa.me deep link with a pre-filled order alert (WhatsApp notifications). */
function whatsappLinkFor(number, order) {
  const digits = String(number || '').replace(/[^\d]/g, '');
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

export default function OrdersListPage() {
  const [orders, setOrders] = useState(null);
  const [tables, setTables] = useState([]);
  const [filters, setFilters] = useState({ status: '', tableNo: '', sort: 'open' });
  const toast = useToast();
  const { t } = useI18n();
  const { tenants, activeTenantId } = useAuth();

  const active = tenants.find((tn) => Number(tn.id) === Number(activeTenantId));
  // Whitelisted by /api/auth/tenants: { enabled, number } — never the secret.
  const waConfig = active?.whatsapp || {};
  // Mirror backend RBAC (backend/src/config/roles.js) so actions a role
  // cannot perform are never shown: cashier places orders + confirms
  // payment, kitchen fulfills (preparing/ready), delivery delivers,
  // owner/manager manage everything incl. cancel.
  const role = active?.role;
  const canPlace = ['owner', 'manager', 'cashier', 'platform_admin', 'staff'].includes(role);
  const canFulfill = ['owner', 'manager', 'kitchen', 'platform_admin', 'staff'].includes(role);
  const canDeliver = ['owner', 'manager', 'delivery', 'platform_admin', 'staff'].includes(role);
  const canManage = ['owner', 'manager', 'platform_admin', 'staff'].includes(role);
  const waNumber = waConfig.enabled ? waConfig.number : '';

  const mounted = useRef(true);
  useEffect(() => {
    // Reset on every mount — StrictMode remounts once in dev, and the
    // cleanup would otherwise leave the ref false forever.
    mounted.current = true;
    load();
    api.get('/tables').then((res) => { if (mounted.current) setTables(res.data || []); }).catch(() => {});
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.tableNo === 'none') params.table_no = 'none';
      else if (filters.tableNo !== '') params.table_no = Number(filters.tableNo);
      if (filters.sort === 'open') params.sort = 'open';
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

  const setStatus = async (o, status) => {
    try {
      await api.patch(`/orders/${o.id}/status`, { status });
      toast.success(`Order #${o.id} → ${statusLabel(t, status)}`);
      await load();
    } catch {
      toast.error(t('orders.couldNotUpdate'));
    }
  };

  // Confirms a pending bKash/Nagad payment (cashier action).
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

  const onAdvance = (o) => {
    const next = NEXT_STATUS[o.status];
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
        {waNumber && (
          <div className="oms-order-filters__wa">
            💬 WhatsApp alerts {waConfig.enabled ? 'on' : ''}
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
              { key: 'customer_name', label: 'Customer' },
              { key: 'table_no', label: t('orders.tableCol') },
              { key: 'subtotal', label: 'Subtotal', align: 'right' },
              { key: 'total_discount', label: 'Discount', align: 'right' },
              { key: 'grand_total', label: 'Total', align: 'right' },
              { key: 'payment', label: t('orders.paymentCol') },
              { key: 'items', label: 'Items', align: 'right' },
              { key: 'status', label: 'Status' },
              { key: 'actions', label: '', align: 'right' },
            ]}
            rows={orders}
            render={(o, key) => {
              if (key === 'id') return <Badge tone="primary">#{o.id}</Badge>;
              if (key === 'customer_name') return <span className="oms-table__cell-strong">{o.customer_name}</span>;
              if (key === 'table_no')
                return o.table_no ? (
                  <Badge tone="accent">🪑 {t('orders.table', o.table_no)}</Badge>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                );
              if (key === 'subtotal') return fmt(o.subtotal);
              if (key === 'total_discount')
                return Number(o.total_discount) > 0 ? (
                  <span style={{ color: 'var(--success)' }}>−{fmt(o.total_discount)}</span>
                ) : (
                  fmt(o.total_discount)
                );
              if (key === 'grand_total') return <span className="oms-table__cell-strong">{fmt(o.grand_total)}</span>;
              if (key === 'payment') {
                const method = ['cash', 'bkash', 'nagad', 'card'].includes(o.payment_method)
                  ? o.payment_method
                  : 'cash';
                const methodLabel = t(
                  `orders.pay${method.charAt(0).toUpperCase()}${method.slice(1)}`
                );
                const payment = (o.payments || [])[0];
                const statusTone =
                  o.payment_status === 'paid'
                    ? 'success'
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
                          : o.payment_status === 'refunded'
                          ? t('orders.refundedStatus')
                          : t('orders.unpaidStatus')}
                      </Badge>
                    </div>
                    {canPlace && o.payment_status !== 'paid' && payment && (
                      <Button size="sm" variant="ghost" onClick={() => markPaid(o)}>
                        ✓ {t('orders.markPaid')}
                      </Button>
                    )}
                  </div>
                );
              }
              if (key === 'items') return o.items?.length ?? 0;
              if (key === 'status')
                return (
                  <Badge tone={STATUS_TONE[o.status] || 'neutral'}>
                    {statusLabel(t, o.status) || o.status}
                  </Badge>
                );
              if (key === 'actions') {
                const next = NEXT_STATUS[o.status];
                const waLink = whatsappLinkFor(waNumber, o);
                return (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
                    {next && (next === 'delivered' ? canDeliver : canFulfill) && (
                      <Button size="sm" variant="primary" onClick={() => onAdvance(o)}>
                        {statusLabel(t, next)}
                      </Button>
                    )}
                    {canManage && o.status !== 'canceled' && o.status !== 'delivered' && (
                      <Button size="sm" variant="danger" onClick={() => onCancel(o)}>
                        {t('common.cancel')}
                      </Button>
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
    </div>
  );
}
