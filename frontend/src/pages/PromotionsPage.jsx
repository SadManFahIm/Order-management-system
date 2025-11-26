import React, { useEffect, useState } from 'react';
import api from '../api';
import PromotionForm from '../components/PromotionForm';

export default function PromotionsPage() {
  const [promos, setPromos] = useState([]);

  const load = async () => {
    const res = await api.get('/promotions');
    setPromos(res.data);
  };

  useEffect(() => {
    load();
  }, []);

  const onCreate = async (payload) => {
    await api.post('/promotions', payload);
    await load();
  };

  const onToggle = async (p) => {
    await api.put(`/promotions/${p.id}`, { enabled: !p.enabled });
    await load();
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Promotions</h2>
      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3>Create</h3>
          <PromotionForm onCreate={onCreate} />
        </div>
        <div style={{ flex: 2 }}>
          <table width="100%" border="1" cellPadding="4">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Type</th>
                <th>Start</th>
                <th>End</th>
                <th>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.title}</td>
                  <td>{p.type}</td>
                  <td>{p.start_date}</td>
                  <td>{p.end_date}</td>
                  <td>{p.enabled ? 'Yes' : 'No'}</td>
                  <td>
                    <button onClick={() => onToggle(p)}>
                      {p.enabled ? 'Disable' : 'Enable'}
                    </button>
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
