import { useEffect, useState } from 'react';
import api from '../api';
import ProductForm from '../components/ProductForm';

export default function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    const res = await api.get('/products');
    setProducts(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (data) => {
    await api.post('/products', data);
    await load();
  };

  const onUpdate = async (data) => {
    await api.put(`/products/${editing.id}`, data);
    setEditing(null);
    await load();
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Products</h2>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>{editing ? 'Edit product' : 'Create product'}</h3>
          <ProductForm initial={editing} onSave={editing ? onUpdate : onCreate} />
        </div>
        <div style={{ flex: 2 }}>
          <table width="100%" border="1" cellPadding="4">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Price</th>
                <th>Weight (gm)</th>
                <th>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.name}</td>
                  <td>{p.price}</td>
                  <td>{p.weight_gm}</td>
                  <td>{p.enabled ? 'Yes' : 'No'}</td>
                  <td>
                    <button onClick={() => setEditing(p)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
