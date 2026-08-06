import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { PageHeader, Card, Table, Button, Badge, Skeleton, useToast } from '../components/ui';

const fmt = (n) => `৳ ${Number(n).toFixed(2)}`;

export default function OrdersListPage() {
  const [orders, setOrders] = useState(null);
  const toast = useToast();

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
        toast?.error('Failed to load orders');
      }
    }
  };

  return (
    <div className="oms-page">
      <PageHeader
        title="Orders"
        desc="Every order placed across your restaurant."
        actions={
          <Button to="/orders/new" variant="primary">
            + New order
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
              { key: 'subtotal', label: 'Subtotal', align: 'right' },
              { key: 'total_discount', label: 'Discount', align: 'right' },
              { key: 'grand_total', label: 'Total', align: 'right' },
              { key: 'items', label: 'Items', align: 'right' },
            ]}
            rows={orders}
            render={(o, key) => {
              if (key === 'id') return <Badge tone="primary">#{o.id}</Badge>;
              if (key === 'customer_name') return <span className="oms-table__cell-strong">{o.customer_name}</span>;
              if (key === 'subtotal') return fmt(o.subtotal);
              if (key === 'total_discount')
                return Number(o.total_discount) > 0 ? (
                  <span style={{ color: 'var(--success)' }}>−{fmt(o.total_discount)}</span>
                ) : (
                  fmt(o.total_discount)
                );
              if (key === 'grand_total') return <span className="oms-table__cell-strong">{fmt(o.grand_total)}</span>;
              if (key === 'items') return o.items?.length ?? 0;
              return o[key];
            }}
            empty={{
              icon: <span style={{ fontSize: 22 }}>📦</span>,
              title: 'No orders yet',
              description: 'Orders placed by customers will appear here.',
              action: (
                <Button to="/orders/new" variant="primary" size="sm">
                  Create the first order
                </Button>
              ),
            }}
          />
        )}
      </Card>
    </div>
  );
}
