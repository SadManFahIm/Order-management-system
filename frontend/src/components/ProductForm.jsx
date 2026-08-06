import { useState, useEffect } from 'react';

export default function ProductForm({ initial, onSave }) {
  const [form, setForm] = useState(
    initial || { name: '', description: '', price: 0, weight_gm: 500, enabled: true }
  );

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const change = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const toggleEnabled = (e) =>
    setForm((f) => ({ ...f, enabled: e.target.checked }));

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      price: Number(form.price),
      weight_gm: Number(form.weight_gm)
    });
  };

  return (
    <form onSubmit={submit} style={{ border: '1px solid #e5e7eb', padding: 8 }}>
      <input
        name="name"
        placeholder="Name"
        value={form.name}
        onChange={change}
      />
      <br />
      <textarea
        name="description"
        placeholder="Description"
        value={form.description}
        onChange={change}
      />
      <br />
      <input
        name="price"
        type="number"
        step="0.01"
        placeholder="Price"
        value={form.price}
        onChange={change}
      />
      <br />
      <input
        name="weight_gm"
        type="number"
        placeholder="Weight (gm)"
        value={form.weight_gm}
        onChange={change}
      />
      <br />
      <label>
        <input
          type="checkbox"
          checked={!!form.enabled}
          onChange={toggleEnabled}
        />
        Enabled
      </label>
      <br />
      <button type="submit">Save</button>
    </form>
  );
}
