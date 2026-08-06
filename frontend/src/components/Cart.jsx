import { Card, Table, Button, EmptyState } from './ui';

const fmt = (n) => `৳ ${Number(n).toFixed(2)}`;

export default function Cart({ cart, summary, onQtyChange, onRemove }) {
  return (
    <Card
      title="Cart"
      subtitle={`${cart.reduce((s, i) => s + i.quantity, 0)} item(s)`}
      bodyPadding={cart.length > 0}
    >
      {cart.length === 0 ? (
        <EmptyState
          icon={<span style={{ fontSize: 22 }}>🛒</span>}
          title="Your cart is empty"
          description="Pick products from the menu to add them here."
        />
      ) : (
        <>
          <Table
            dense
            columns={[
              { key: 'name', label: 'Product' },
              { key: 'price', label: 'Unit', align: 'right' },
              { key: 'qty', label: 'Qty', align: 'right' },
              { key: 'base', label: 'Base', align: 'right' },
              { key: 'discount', label: 'Discount', align: 'right' },
              { key: 'line', label: 'Line total', align: 'right' },
              { key: 'actions', label: '', align: 'right' },
            ]}
            rows={cart.map((i) => ({ ...i, key: i.product.id }))}
            render={(item, key) => {
              if (key === 'name') return <span className="oms-table__cell-strong">{item.product.name}</span>;
              if (key === 'price') return fmt(item.product.price);
              if (key === 'qty')
                return (
                  <input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => onQtyChange(item.product.id, Number(e.target.value))}
                    style={{ width: 58, height: 30, textAlign: 'center' }}
                    className="oms-input"
                    aria-label="Quantity"
                  />
                );
              if (key === 'base') return fmt(item.baseTotal ?? item.product.price * item.quantity);
              if (key === 'discount')
                return item.discount != null ? (
                  <span style={{ color: 'var(--success)' }}>−{fmt(item.discount)}</span>
                ) : (
                  '—'
                );
              if (key === 'line')
                return <span className="oms-table__cell-strong">{fmt(item.lineTotal ?? item.product.price * item.quantity)}</span>;
              if (key === 'actions')
                return (
                  <Button variant="danger-ghost" size="sm" onClick={() => onRemove(item.product.id)} aria-label={`Remove ${item.product.name}`}>
                    Remove
                  </Button>
                );
              return null;
            }}
          />
          {summary && (
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
              <div className="oms-summary">
                <div className="oms-summary__row">
                  <span>Subtotal</span>
                  <span>{fmt(summary.subtotal)}</span>
                </div>
                <div className="oms-summary__row">
                  <span>Total discount</span>
                  <span style={{ color: 'var(--success)' }}>−{fmt(summary.totalDiscount)}</span>
                </div>
                <div className="oms-summary__row oms-summary__row--total">
                  <span>Grand total</span>
                  <span>{fmt(summary.grandTotal)}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
