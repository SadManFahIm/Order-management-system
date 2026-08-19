import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
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
  const [orderType, setOrderType] = useState('pickup');
  // Optional delivery tip (Phase 6): delivery orders only (server-enforced),
  // charged to the customer and reported separately from food revenue.
  const [tip, setTip] = useState(0);
  const [tables, setTables] = useState([]);
  const [tableNo, setTableNo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentRef, setPaymentRef] = useState('');
  // Split payments (Phase 6) — one order, multiple methods (e.g. bKash ৳300
  // + Cash ৳200). The backend validates parts against the grand total.
  const [splitMode, setSplitMode] = useState(false);
  const [splitParts, setSplitParts] = useState([]);
  const { tenants, activeTenantId } = useAuth();
  const active = tenants.find((tn) => Number(tn.id) === Number(activeTenantId));
  // Whitelisted by /api/auth/tenants: { cash, bkash, nagad, card } flags.
  const pmFlags = active?.paymentMethods || { cash: true };
  const pmOptions = [
    { key: 'cash', label: 'Cash' },
    { key: 'bkash', label: 'bKash' },
    { key: 'nagad', label: 'Nagad' },
    { key: 'card', label: 'Card' },
    { key: 'online', label: 'Online (SSLCommerz)' },
  ].filter((m) => pmFlags[m.key]);

  // If the workspace disabled the currently selected method, fall back to
  // the first enabled one.
  useEffect(() => {
    if (pmOptions.length > 0 && !pmOptions.some((m) => m.key === paymentMethod)) {
      setPaymentMethod(pmOptions[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pmFlags, paymentMethod]);

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
      order_type: orderType,
      items: cart.map((i) => ({
        product_id: i.product.id,
        quantity: i.quantity
      }))
    };
    if (orderType === 'delivery' && Number(tip) > 0) payload.tip = Math.min(Number(tip), 100000);
    if (splitMode && splitParts.length > 0) {
      // Split order: the backend creates one payment row per part (cash parts
      // paid on the spot, wallets pending) and validates the sum server-side.
      payload.payments = splitParts.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        reference: p.reference?.trim() || undefined
      }));
    } else {
      payload.payment_method = paymentMethod || 'cash';
      payload.payment_reference = paymentRef.trim() || undefined;
    }
    try {
      const res = await api.post('/orders', payload);
      // Online payment: the order is placed as pending and the customer is
      // sent to the hosted gateway (SSLCommerz/Stripe) to pay.
      if (res.data.paymentUrl) {
        window.location.href = res.data.paymentUrl;
        return;
      }
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
    } catch (e) {
      // Surface the backend's precise error (e.g. SPLIT_MISMATCH tells the
      // cashier exactly how much the parts are off by).
      const msg = e?.response?.data?.error?.message;
      toast.error(msg || 'Failed to create order');
    }
  };

  const onCustomerChange = (e) =>
    setCustomer((c) => ({ ...c, [e.target.name]: e.target.value }));

  // ── Split payment helpers ──────────────────────────────────────────────
  const splitMethods = pmOptions.filter((m) => m.key !== 'online');
  const cartTotal = cart.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);
  const splitSum = splitParts.reduce((s, p) => s + Number(p.amount || 0), 0);
  const splitRemaining = Math.round((cartTotal - splitSum) * 100) / 100;

  const startSplit = () => {
    const first = splitMethods[0]?.key || 'cash';
    const second = splitMethods[1]?.key || first;
    const half = Math.round((cartTotal / 2) * 100) / 100;
    setSplitParts([
      { method: first, amount: half, reference: '' },
      { method: second, amount: Math.round((cartTotal - half) * 100) / 100, reference: '' },
    ]);
    setSplitMode(true);
  };

  const updateSplitPart = (idx, patch) =>
    setSplitParts((parts) => parts.map((p, i) => (i === idx ? { ...p, ...patch } : p)));

  const addSplitPart = () => {
    if (splitParts.length >= splitMethods.length) return;
    const used = new Set(splitParts.map((p) => p.method));
    const nextMethod = splitMethods.find((m) => !used.has(m.key))?.key || 'cash';
    setSplitParts((parts) => [
      ...parts,
      { method: nextMethod, amount: Math.max(splitRemaining, 0), reference: '' },
    ]);
  };

  const removeSplitPart = (idx) =>
    setSplitParts((parts) => parts.filter((_, i) => i !== idx));

  const splitValid =
    splitParts.length >= 2 &&
    Math.abs(splitSum - cartTotal) <= 0.01 &&
    splitParts.every((p) => Number(p.amount) > 0);

  const canSubmit =
    customer.customer_name && cart.length > 0 && (!splitMode || splitValid);

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
            <Field label="Order type" hint="Pickup or delivery — delivery adds the workspace delivery fee.">
              <Select value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                <option value="pickup">Pickup</option>
                <option value="delivery">Delivery</option>
              </Select>
            </Field>
            {orderType === 'delivery' && (
              <Field label="Tip (optional)" hint="Goes to the delivery rider — reported separately from food revenue.">
                <Input
                  type="number"
                  min="0"
                  step="1"
                  max="100000"
                  placeholder="৳ 0"
                  value={tip || ''}
                  onChange={(e) => setTip(e.target.value)}
                />
              </Field>
            )}
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

            {!splitMode ? (
              <>
                <Field label="Payment method" hint="Cash is paid on the spot; bKash/Nagad are confirmed at the counter.">
                  <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                    {pmOptions.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                {(paymentMethod === 'bkash' || paymentMethod === 'nagad') && (
                  <Field label="Transaction ID (optional)" hint="bKash/Nagad trxID — capture at the counter.">
                    <Input value={paymentRef} maxLength={120} placeholder="e.g. 8A7B6C5D4E" onChange={(e) => setPaymentRef(e.target.value)} />
                  </Field>
                )}
              </>
            ) : (
              <Field
                label="Split payment"
                hint="Parts must sum to the order total — cash parts are paid now, wallets stay pending for the counter."
              >
                <div style={{ display: 'grid', gap: 10 }}>
                  {splitParts.map((part, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Select
                        style={{ flex: 1, minWidth: 0 }}
                        value={part.method}
                        onChange={(e) => updateSplitPart(idx, { method: e.target.value })}
                      >
                        {splitMethods.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.label}
                          </option>
                        ))}
                      </Select>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        style={{ width: 110 }}
                        placeholder="৳"
                        value={part.amount}
                        onChange={(e) => updateSplitPart(idx, { amount: e.target.value })}
                      />
                      <Input
                        style={{ flex: 1, minWidth: 0 }}
                        maxLength={120}
                        placeholder="trxID (optional)"
                        value={part.reference}
                        onChange={(e) => updateSplitPart(idx, { reference: e.target.value })}
                      />
                      {splitParts.length > 2 && (
                        <Button variant="ghost" size="sm" onClick={() => removeSplitPart(idx)}>
                          ✕
                        </Button>
                      )}
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontSize: 13, color: splitRemaining >= -0.01 ? 'var(--text-muted, #68707a)' : 'var(--danger, #dc2626)' }}>
                      {splitRemaining >= 0 ? `Remaining: ৳ ${splitRemaining.toFixed(2)}` : `Over by ৳ ${Math.abs(splitRemaining).toFixed(2)}`}
                    </div>
                    <Button variant="outline" size="sm" onClick={addSplitPart} disabled={splitParts.length >= splitMethods.length}>
                      + Add part
                    </Button>
                  </div>
                </div>
              </Field>
            )}
            <div style={{ marginTop: 2 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (splitMode ? setSplitMode(false) : startSplit())}
                disabled={splitMethods.length < 2 || cart.length === 0}
              >
                {splitMode ? '↩ Back to single payment' : '⇄ Split payment'}
              </Button>
            </div>
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
