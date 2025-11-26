import React, { useEffect, useState } from 'react';
import api from '../api';

export default function OrdersListPage() {
  const [orders, setOrders] = useState([]);

  const load = async () => {
    const res = await api.get('/orders');
    setOrders(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <h2>Orders</h2>
      <table width="100%" border="1" cellPadding="4">
        <thead>
          <tr>
            <th>ID</th>
            <th>Customer</th>
            <th>Subtotal</th>
            <th>Discount</th>
            <th>Grand total</th>
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.customer_name}</td>
              <td>{o.subtotal}</td>
              <td>{o.total_discount}</td>
              <td>{o.grand_total}</td>
              <td>{o.items?.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
