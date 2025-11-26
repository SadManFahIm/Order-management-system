import React, { useEffect, useState } from 'react';
import api from '../api';
import Cart from '../components/Cart';

export default function NewOrderPage() {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [summary, setSummary] = useState(null);

  const [customer, setCustomer] = useState({
    customer_name: '',
    customer_phone: '',
    customer_address: ''
  });

  const loadProducts = async () => {
    const res = await api.get('/products');
    setProducts(res.data.filter((p) => p.enabled));
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
  };

  const onQtyChange = (pid, qty) => {
    if (qty <= 0) return;
    setCart((c) =>
      c.map((i) => (i.product.id === pid ? { ...i, quantity: qty } : i))
    );
  };

  const onRemove = (pid) =>
    setCart((c) => c.filter((i) => i.product.id !== pid));

  const handleCreateOrder = async () => {
    const payload = {
      ...customer,
      items: cart.map((i) => ({
        product_id: i.product.id,
        quantity: i.quantity
      }))
    };
    const res = await api.post('/orders', payload);
    alert(`Order created with id ${res.data.id}`);
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
  };

  const onCustomerChange = (e) =>
    setCustomer((c) => ({ ...c, [e.target.name]: e.target.value }));

  return (
    <div style={{ padding: 16 }}>
      <h2>New Order</h2>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>Customer</h3>
          <input
            name="customer_name"
            placeholder="Name"
            value={customer.customer_name}
            onChange={onCustomerChange}
          />
          <br />
          <input
            name="customer_phone"
            placeholder="Phone"
            value={customer.customer_phone}
            onChange={onCustomerChange}
          />
          <br />
          <textarea
            name="customer_address"
            placeholder="Address"
            value={customer.customer_address}
            onChange={onCustomerChange}
          />
          <h3>Products</h3>
          <ul>
            {products.map((p) => (
              <li key={p.id}>
                {p.name} ({p.weight_gm}gm) - {p.price} tk
                <button onClick={() => addToCart(p)} style={{ marginLeft: 8 }}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ flex: 2 }}>
          <Cart
            cart={cart}
            summary={summary}
            onQtyChange={onQtyChange}
            onRemove={onRemove}
          />
          <button
            onClick={handleCreateOrder}
            disabled={!customer.customer_name || cart.length === 0}
            style={{ marginTop: 8 }}
          >
            Create order
          </button>
        </div>
      </div>
    </div>
  );
}
