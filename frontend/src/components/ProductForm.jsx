import { useState, useEffect, useRef } from 'react';
import api from '../api';
import { Field, Input, Textarea, Checkbox, Button } from './ui';

export default function ProductForm({ initial, onSave }) {
  const [form, setForm] = useState(
    initial || {
      name: '',
      description: '',
      price: 0,
      weight_gm: 500,
      enabled: true,
      inventory: { stock_qty: 0, low_stock_at: 0, unit: 'pcs' },
    }
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const change = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const toggleEnabled = (e) =>
    setForm((f) => ({ ...f, enabled: e.target.checked }));

  const onImageFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await api.post('/uploads/images', fd);
      setForm((f) => ({ ...f, image_url: res.data.url, thumb_url: res.data.thumbUrl }));
    } catch (err) {
      setUploadError(err?.response?.data?.error?.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      price: Number(form.price),
      weight_gm: Number(form.weight_gm),
      inventory: {
        stock_qty: Number(form.inventory?.stock_qty ?? 0),
        low_stock_at: Number(form.inventory?.low_stock_at ?? 0),
        unit: form.inventory?.unit || 'pcs',
      },
    });
  };

  const setInventory = (key, value) =>
    setForm((f) => ({ ...f, inventory: { ...(f.inventory || {}), [key]: value } }));

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
      <Field label="Photo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button
            variant="outline"
            size="sm"
            type="button"
            loading={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {form.image_url ? 'Replace photo' : 'Upload photo'}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={onImageFile}
          />
          {form.image_url && (
            <img
              src={form.thumb_url || form.image_url}
              alt=""
              style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--oms-border)' }}
            />
          )}
          {form.image_url && (
            <Button variant="ghost" size="sm" type="button" onClick={() => setForm((f) => ({ ...f, image_url: null, thumb_url: null }))}>
              Remove
            </Button>
          )}
        </div>
        {uploadError && <div style={{ color: 'var(--oms-danger, #dc2626)', fontSize: 13, marginTop: 6 }}>{uploadError}</div>}
      </Field>
      <Field>
        <Checkbox id={`enabled-${form.id ?? 'new'}`} label="Available for ordering" checked={!!form.enabled} onChange={toggleEnabled} />
      </Field>
      <Field label="Stock" hint="Quantity on hand and the low-stock alert threshold.">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 10 }}>
          <Input
            name="stock_qty"
            type="number"
            min="0"
            placeholder="50"
            value={form.inventory?.stock_qty ?? 0}
            onChange={(e) => setInventory('stock_qty', e.target.value)}
          />
          <Input
            name="low_stock_at"
            type="number"
            min="0"
            placeholder="10"
            value={form.inventory?.low_stock_at ?? 0}
            onChange={(e) => setInventory('low_stock_at', e.target.value)}
          />
          <Input
            name="unit"
            placeholder="pcs"
            value={form.inventory?.unit || 'pcs'}
            onChange={(e) => setInventory('unit', e.target.value)}
          />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Stock · Low alert at · Unit
        </div>
      </Field>
      <div className="oms-form-actions">
        <Button type="submit" variant="primary">
          {initial ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </form>
  );
}
