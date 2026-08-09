import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { PageHeader, Card, Table, Button, Badge, Skeleton, useToast } from '../components/ui';

const fmt = (n) => `৳ ${Number(n).toFixed(2)}`;

const STATUS_TONE = {
  placed: 'neutral',
  preparing: 'warning',
  ready: 'primary',
  delivered: 'success',
  canceled: 'danger',
};

// Next step in the happy path, or null when terminal/canceled.
const NEXT_STATUS = {
  placed: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
  delivered: null,
  canceled: null,
};

const statusLabel = (t, status) => t(`orders.${status}`);

export default function OrdersListPage() {
  const [orders, setOrders] = useState(null);
  const toast = useToast();
  const { t } = useI18n();

  const mounted = useRef(true);
  useEffect(() => {
    // Reset on every mount — StrictMode remounts once in dev, and the
    // cleanup would otherwise leave the ref false forever.
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const res = await api.get('/orders');
      if (mounted.current) setOrders(res.data);
    } catch {
      if (mounted.current) {
        setOrders([]);
        toast?.error(t('orders.couldNotLoad'));
      }
    }
  };

  const setStatus = async (o, status) => {
    try {
      await api.patch(`/orders/${o.id}/status`, { status });
      toast.success(`Order #${o.id} → ${statusLabel(t, status)}`);
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
              if (key === 'items') return o.items?.length ?? 0;
              if (key === 'status')
                return (
                  <Badge tone={STATUS_TONE[o.status] || 'neutral'}>
                    {statusLabel(t, o.status) || o.status}
                  </Badge>
                );
              if (key === 'actions') {
                const next = NEXT_STATUS[o.status];
                return (
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {next && (
                      <Button size="sm" variant="primary" onClick={() => onAdvance(o)}>
                        {statusLabel(t, next)}
                      </Button>
                    )}
                    {o.status !== 'canceled' && o.status !== 'delivered' && (
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
