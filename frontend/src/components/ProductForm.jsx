import { useState, useEffect, useRef } from 'react';
import api from '../api';
import { Field, Input, Textarea, Checkbox, Button } from './ui';

const ITEM_TAGS = ['veg', 'spicy', 'new', 'bestseller'];

export default function ProductForm({ initial, onSave }) {
  const [form, setForm] = useState(
    initial || {
      name: '',
      description: '',
      price: 0,
      weight_gm: 500,
      enabled: true,
      tags: [],
      available_from: null,
      available_to: null,
      inventory: { stock_qty: 0, low_stock_at: 0, unit: 'pcs' },
    }
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [optimizing, setOptimizing] = useState(false);
  const [optOpen, setOptOpen] = useState(false);
  const [optMsg, setOptMsg] = useState(null);
  const [quality, setQuality] = useState(82);
  const [crop, setCrop] = useState({ x: '', y: '', width: '', height: '' });
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
      tags: form.tags || [],
      available_from: form.available_from || null,
      available_to: form.available_to || null,
      inventory: {
        stock_qty: Number(form.inventory?.stock_qty ?? 0),
        low_stock_at: Number(form.inventory?.low_stock_at ?? 0),
        unit: form.inventory?.unit || 'pcs',
      },
    });
  };

  const setInventory = (key, value) =>
    setForm((f) => ({ ...f, inventory: { ...(f.inventory || {}), [key]: value } }));

  const toggleTag = (tag) =>
    setForm((f) => ({
      ...f,
      tags: f.tags?.includes(tag) ? f.tags.filter((x) => x !== tag) : [...(f.tags || []), tag],
    }));

  const hasSchedule = !!(form.available_from || form.available_to);

  const runOptimize = async () => {
    if (!form.image_url) return;
    setOptimizing(true);
    setOptMsg(null);
    try {
      const key = (form.image_url.split('/').pop() || '').replace(/\.[^.]+$/, '');
      const body = { quality: Number(quality) };
      const c = {
        x: Number(crop.x),
        y: Number(crop.y),
        width: Number(crop.width),
        height: Number(crop.height),
      };
      if (Number.isFinite(c.width) && c.width > 0 && Number.isFinite(c.height) && c.height > 0) {
        body.crop = c;
      }
      const res = await api.post(`/uploads/images/${key}/optimize`, body);
      setOptMsg(
        `Optimized → ${res.data.width}×${res.data.height}, ${(res.data.bytes / 1024).toFixed(0)} KB`
      );
    } catch (err) {
      setOptMsg(err?.response?.data?.error?.message || 'Optimize failed');
    } finally {
      setOptimizing(false);
    }
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
            <>
              <Button variant="ghost" size="sm" type="button" onClick={() => setOptOpen((o) => !o)}>
                Optimize
              </Button>
              <Button variant="ghost" size="sm" type="button" onClick={() => setForm((f) => ({ ...f, image_url: null, thumb_url: null }))}>
                Remove
              </Button>
            </>
          )}
        </div>
        {optOpen && form.image_url && (
          <div
            style={{
              marginTop: 10,
              padding: 12,
              border: '1px dashed var(--oms-border)',
              borderRadius: 10,
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Quality (%)">
                <Input type="number" min="10" max="95" value={quality} onChange={(e) => setQuality(e.target.value)} />
              </Field>
              <Field label="Crop (px) — x · y · w · h">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                  {['x', 'y', 'width', 'height'].map((k) => (
                    <Input key={k} type="number" min="0" placeholder={k} value={crop[k]} onChange={(e) => setCrop((c) => ({ ...c, [k]: e.target.value }))} />
                  ))}
                </div>
              </Field>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Button variant="outline" size="sm" type="button" loading={optimizing} onClick={runOptimize}>
                Re-process & purge CDN
              </Button>
              {optMsg && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{optMsg}</span>}
            </div>
          </div>
        )}
        {uploadError && <div style={{ color: 'var(--oms-danger, #dc2626)', fontSize: 13, marginTop: 6 }}>{uploadError}</div>}
      </Field>
      <Field label="Availability schedule" hint="Leave both empty for all-day availability. Uses the restaurant's local clock (HH:MM, 24h).">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px', gap: 10, alignItems: 'center' }}>
          <Input
            type="time"
            value={form.available_from || ''}
            onChange={(e) => setForm((f) => ({ ...f, available_from: e.target.value || null }))}
            disabled={!hasSchedule}
          />
          <Input
            type="time"
            value={form.available_to || ''}
            onChange={(e) => setForm((f) => ({ ...f, available_to: e.target.value || null }))}
            disabled={!hasSchedule}
          />
          <Button variant={hasSchedule ? 'outline' : 'ghost'} size="sm" type="button" onClick={() => setForm((f) => ({ ...f, available_from: null, available_to: null }))}>
            {hasSchedule ? 'All-day' : 'Schedule…'}
          </Button>
        </div>
        {hasSchedule && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Orderable {form.available_from || '00:00'} – {form.available_to || '23:59'}
          </div>
        )}
      </Field>
      <Field label="Tags">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {ITEM_TAGS.map((tag) => (
            <Checkbox
              key={tag}
              id={`tag-${tag}-${form.id ?? 'new'}`}
              label={tag}
              checked={!!form.tags?.includes(tag)}
              onChange={() => toggleTag(tag)}
            />
          ))}
        </div>
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
