import { useState, useEffect } from 'react';
import { Field, Input, Select, Button } from '../components/ui';

const COMMON_TIMEZONES = [
  'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai',
  'Asia/Singapore', 'Asia/Tokyo', 'Europe/London',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Etc/UTC',
];

const INITIAL = {
  name: '', code: '', slug: '', address: '', phone: '', email: '',
  timezone: 'Asia/Dhaka', status: 'active',
};

export default function OutletForm({ initial, onSave }) {
  const [form, setForm] = useState(initial || INITIAL);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const change = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const autoSlug = (name) => {
    if (initial) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    setForm((f) => ({ ...f, name, slug }));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.code.trim()) e.code = 'Code is required';
    if (!form.slug.trim()) e.slug = 'Slug is required';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const payload = { ...form };
      if (!initial) delete payload.id;
      await onSave(payload);
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      setErrors({ _form: msg || 'Something went wrong' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {errors._form && (
        <div style={{
          padding: '10px 14px', borderRadius: 'var(--radius-sm)',
          background: 'var(--danger-soft)', color: 'var(--danger)',
          fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)',
        }}>
          {errors._form}
        </div>
      )}

      {/* Section: Identity */}
      <div className="outlet-form-section">
        <div className="outlet-form-section__title">Identity</div>
        <Field label="Outlet Name" error={errors.name} hint="Displayed to staff and customers.">
          <Input
            name="name"
            value={form.name}
            onChange={(e) => autoSlug(e.target.value)}
            placeholder="e.g. Banani Flagship"
            aria-invalid={!!errors.name}
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Field label="Code" error={errors.code} hint="Short unique code.">
            <Input
              name="code"
              value={form.code}
              onChange={change}
              placeholder="e.g. BAN-01"
              disabled={!!initial}
              style={initial ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
              aria-invalid={!!errors.code}
            />
          </Field>
          <Field label="URL Slug" error={errors.slug} hint="Auto-generated from name.">
            <Input
              name="slug"
              value={form.slug}
              onChange={change}
              placeholder="e.g. banani-flagship"
              disabled={!!initial}
              style={initial ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
              aria-invalid={!!errors.slug}
            />
          </Field>
        </div>
      </div>

      {/* Section: Location & Contact */}
      <div className="outlet-form-section">
        <div className="outlet-form-section__title">Location & Contact</div>
        <Field label="Address" hint="Street address of this location.">
          <Input
            name="address"
            value={form.address}
            onChange={change}
            placeholder="e.g. House 45, Road 11, Banani"
          />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Field label="Phone" error={errors.phone}>
            <Input
              name="phone"
              value={form.phone}
              onChange={change}
              placeholder="+880 1XXX XXXXXX"
              aria-invalid={!!errors.phone}
            />
          </Field>
          <Field label="Email" error={errors.email}>
            <Input
              name="email"
              value={form.email}
              onChange={change}
              placeholder="banani@example.com"
              type="email"
              aria-invalid={!!errors.email}
            />
          </Field>
        </div>
      </div>

      {/* Section: Settings */}
      <div className="outlet-form-section">
        <div className="outlet-form-section__title">Settings</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <Field label="Timezone" hint="Used for scheduling and reports.">
            <Select name="timezone" value={form.timezone} onChange={change}>
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" value={form.status} onChange={change}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
      </div>

      <div className="oms-form-actions">
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="oms-btn__spinner" />
              Saving...
            </span>
          ) : initial ? 'Update Outlet' : 'Create Outlet'}
        </Button>
      </div>
    </form>
  );
}
