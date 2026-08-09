import { useEffect, useState } from 'react';
import api from '../api';
import Cart from '../components/Cart';
import { PageHeader, Card, Field, Input, Textarea, Select, Button, Skeleton, useToast } from '../components/ui';

export default function NewOrderPage() {
  const [products, setProducts] = useState(null);
  const [cart, setCart] = useState([]);
  const [summary, setSummary] = useState(null);
  const toast = useToast();

  const [customer, setCustomer] = useState({
    customer_name: '',
    customer_phone: '',
    customer_address: ''
  });
  const [tables, setTables] = useState([]);
  const [tableNo, setTableNo] = useState('');

  const loadProducts = async () => {
    try {
      const [prodRes, tableRes] = await Promise.all([
        api.get('/products'),
        api.get('/tables'),
      ]);
      setProducts(prodRes.data.filter((p) => p.enabled));
      // QR table menu — dine-in orders can be tagged with a physical table
      // so kitchen/delivery see where the order belongs.
      setTables((tableRes.data || []).filter((tb) => tb.is_active));
    } catch {
      setProducts([]);
    }
  };

  useEffect(() => {
    loadProducts();
  }, []);

  const addToCart = (p) => {
    setCart((c) => {
      const found = c.find((i) => i.product.id === p.id);
      if (found)
        return c.map((i) =>
          i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      return [...c, { product: p, quantity: 1 }];
    });
    setSummary(null);
  };

  const onQtyChange = (pid, qty) => {
    if (qty <= 0) return;
    setCart((c) =>
      c.map((i) => (i.product.id === pid ? { ...i, quantity: qty } : i))
    );
  };

  const onRemove = (pid) => setCart((c) => c.filter((i) => i.product.id !== pid));

  const handleCreateOrder = async () => {
    const payload = {
      ...customer,
      table_no: tableNo ? Number(tableNo) : null,
      items: cart.map((i) => ({
        product_id: i.product.id,
        quantity: i.quantity
      }))
    };
    try {
      const res = await api.post('/orders', payload);
      toast.success(`Order #${res.data.id} created`);
      const s = {
        subtotal: res.data.subtotal,
        totalDiscount: res.data.total_discount,
        grandTotal: res.data.grand_total
      };
      const enrichedCart = res.data.items.map((it) => ({
        product: it.Product,
        quantity: it.quantity,
        baseTotal: it.unit_price * it.quantity,
        discount: it.discount,
        lineTotal: it.line_total
      }));
      setCart(enrichedCart);
      setSummary(s);
    } catch {
      toast.error('Failed to create order');
    }
  };

  const onCustomerChange = (e) =>
    setCustomer((c) => ({ ...c, [e.target.name]: e.target.value }));

  const canSubmit = customer.customer_name && cart.length > 0;

  return (
    <div className="oms-page">
      <PageHeader
        title="New order"
        desc="Build an order from your menu and check out."
      />

      <div className="oms-grid oms-grid--2col">
        <div style={{ display: 'grid', gap: 16 }}>
          <Card title="Customer" subtitle="Who is this order for?">
            <Field label="Name">
              <Input name="customer_name" placeholder="Customer name" value={customer.customer_name} onChange={onCustomerChange} />
            </Field>
            <Field label="Phone">
              <Input name="customer_phone" placeholder="01XXXXXXXXX" value={customer.customer_phone} onChange={onCustomerChange} />
            </Field>
            <Field label="Delivery address" hint="Leave blank for pickup.">
              <Textarea name="customer_address" placeholder="House, road, area…" value={customer.customer_address} onChange={onCustomerChange} />
            </Field>
            <Field label="Table" hint="Dine-in? Pick the physical table (QR table menu).">
              <Select value={tableNo} onChange={(e) => setTableNo(e.target.value)}>
                <option value="">— No table (delivery / takeaway)</option>
                {tables.map((tb) => (
                  <option key={tb.id} value={tb.table_no}>
                    {tb.name ? `${tb.name} (${tb.table_no})` : `Table ${tb.table_no}`}
                  </option>
                ))}
              </Select>
            </Field>
          </Card>

          <Card title="Menu" subtitle="Click to add items" bodyPadding={false}>
            {products === null ? (
              <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} height={52} />
                ))}
              </div>
            ) : (
              <ul className="oms-product-picker" style={{ padding: 12 }}>
                {products.map((p) => (
                  <li key={p.id}>
                    <div className="oms-product-picker__info">
                      <div className="oms-product-picker__name">{p.name}</div>
                      <div className="oms-product-picker__meta">
                        {p.weight_gm} gm · ৳ {Number(p.price).toFixed(2)}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => addToCart(p)}>
                      + Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <Cart cart={cart} summary={summary} onQtyChange={onQtyChange} onRemove={onRemove} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="primary"
              size="lg"
              onClick={handleCreateOrder}
              disabled={!canSubmit}
              style={{ minWidth: 200 }}
            >
              Create order
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
