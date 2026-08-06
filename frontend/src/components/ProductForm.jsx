import { useState, useEffect } from 'react';
import { Field, Input, Textarea, Checkbox, Button } from './ui';

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
    <form onSubmit={submit}>
      <Field label="Name">
        <Input name="name" placeholder="e.g. Beef Kebab 250gm" value={form.name} onChange={change} required />
      </Field>
      <Field label="Description">
        <Textarea name="description" placeholder="A short description…" value={form.description} onChange={change} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Price (Tk)">
          <Input name="price" type="number" step="0.01" min="0" placeholder="0.00" value={form.price} onChange={change} required />
        </Field>
        <Field label="Weight (gm)">
          <Input name="weight_gm" type="number" min="1" placeholder="500" value={form.weight_gm} onChange={change} required />
        </Field>
      </div>
      <Field>
        <Checkbox id={`enabled-${form.id ?? 'new'}`} label="Available for ordering" checked={!!form.enabled} onChange={toggleEnabled} />
      </Field>
      <div className="oms-form-actions">
        <Button type="submit" variant="primary">
          {initial ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </form>
  );
}
