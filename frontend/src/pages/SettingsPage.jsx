import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { PageHeader, Card, Button, Field, Input, Textarea, Switch, Skeleton, useToast } from '../components/ui';

const PRESETS = [
  { name: 'KFC red', primary: '#e4002b', accent: '#ffd400' },
  { name: 'Chillox orange', primary: '#f26522', accent: '#ffc800' },
  { name: 'Deliveroo teal', primary: '#00b3a5', accent: '#f5d300' },
  { name: 'Pizza Hut red', primary: '#d3112a', accent: '#f5b81b' },
  { name: 'Midnight', primary: '#111827', accent: '#22d3c2' },
];

const DEFAULT_BRAND = { primaryColor: '#00b3a5', accentColor: '#f5d300', tagline: '', announcement: '' };

export default function SettingsPage() {
  const { t } = useI18n();
  const { activeTenantId, tenants } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [wa, setWa] = useState({ enabled: false, number: '', webhookUrl: '', secret: '' });
  const [waSaving, setWaSaving] = useState(false);
  const [waTesting, setWaTesting] = useState(false);
  const [waManualLink, setWaManualLink] = useState(null);
  const mounted = useRef(true);

  const active = tenants.find((x) => Number(x.id) === Number(activeTenantId));

  useEffect(() => {
    mounted.current = true;
    if (!activeTenantId) {
      setLoading(false);
      return undefined;
    }
    api
      .get(`/tenants/${activeTenantId}`)
      .then((res) => {
        if (!mounted.current) return;
        setTenant(res.data);
        setBrand({
          ...DEFAULT_BRAND,
          ...(res.data.brand || {}),
          logoUrl: res.data.logoUrl || '',
        });
        setWa({
          enabled: Boolean(res.data.settings?.whatsapp?.enabled),
          number: res.data.settings?.whatsapp?.number || '',
          webhookUrl: res.data.settings?.whatsapp?.webhookUrl || '',
          secret: res.data.settings?.whatsapp?.secret || '',
        });
        setLoading(false);
      })
      .catch(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [activeTenantId]);

  const set = (key, value) => setBrand((b) => ({ ...b, [key]: value }));
  const updateWa = (key, value) => setWa((w) => ({ ...w, [key]: value }));

  const saveWhatsApp = async () => {
    setWaSaving(true);
    try {
      await api.patch(`/tenants/${activeTenantId}`, {
        whatsapp: {
          enabled: wa.enabled,
          number: wa.number.trim(),
          webhookUrl: wa.webhookUrl.trim(),
          secret: wa.secret.trim(),
        },
      });
      toast.success(t('settings.waSaved'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not save WhatsApp settings');
    } finally {
      setWaSaving(false);
    }
  };

  const testWhatsApp = async () => {
    setWaTesting(true);
    setWaManualLink(null);
    try {
      const res = await api.post(`/tenants/${activeTenantId}/whatsapp/test`);
      if (res.data.sent) {
        toast.success(t('settings.waTestOk'));
      } else {
        setWaManualLink(res.data.waLink || null);
        toast.success(t('settings.waTestManual'));
      }
    } catch {
      toast.error('Test alert failed');
    } finally {
      setWaTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { logoUrl, ...brandFields } = brand;
      const res = await api.patch(`/tenants/${activeTenantId}`, {
        brand: brandFields,
        logoUrl: logoUrl || null,
      });
      setTenant(res.data);
      setBrand({ ...DEFAULT_BRAND, ...(res.data.brand || {}), logoUrl: res.data.logoUrl || '' });
      toast.success(t('settings.saved'), t('settings.savedDesc'));
    } catch {
      toast.error('Save failed', 'Could not save branding. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="oms-page">
        <PageHeader title={t('settings.page')} desc={t('settings.pageDesc')} />
        <Skeleton height={320} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="oms-page">
        <PageHeader title={t('settings.page')} desc={t('settings.pageDesc')} />
        <Card>
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            No workspace selected.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="oms-page">
      <PageHeader title={t('settings.page')} desc={t('settings.pageDesc')} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 380px', gap: 16, alignItems: 'start' }}>
        {/* Editor */}
        <Card title={t('settings.brand')} subtitle={t('settings.brandDesc')}>
          <div style={{ display: 'grid', gap: 16 }}>
            {/* Presets */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('settings.presets')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="oms-brand-preset"
                    onClick={() => setBrand((b) => ({ ...b, primaryColor: p.primary, accentColor: p.accent }))}
                    title={p.name}
                  >
                    <span style={{ background: p.primary }} />
                    <span style={{ background: p.accent }} />
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ColorField label={t('settings.primaryColor')} value={brand.primaryColor} onChange={(v) => set('primaryColor', v)} />
              <ColorField label={t('settings.accentColor')} value={brand.accentColor} onChange={(v) => set('accentColor', v)} />
            </div>

            <Field label={t('settings.tagline')} hint={t('settings.taglineHint')}>
              <Input value={brand.tagline} maxLength={120} onChange={(e) => set('tagline', e.target.value)} placeholder="It’s finger lickin’ good" />
            </Field>

            <Field label={t('settings.announcement')} hint={t('settings.announcementHint')}>
              <Textarea value={brand.announcement} maxLength={160} rows={2} onChange={(e) => set('announcement', e.target.value)} placeholder="Free delivery on orders over ৳500" />
            </Field>

            <Field label={t('settings.logoUrl')}>
              <Input value={brand.logoUrl || ''} maxLength={500} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…" />
            </Field>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? t('common.loading') : t('settings.save')}
              </Button>
              {active?.slug && (
                <Link to={`/m/${active.slug}`} target="_blank" rel="noreferrer">
                  <Button variant="outline">{t('settings.viewStorefront')} ↗</Button>
                </Link>
              )}
            </div>
          </div>
        </Card>

        {/* Live preview */}
        <Card title={t('settings.preview')} subtitle={t('settings.previewHint')}>
          <StorefrontPreview brand={brand} name={tenant.name} logoUrl={tenant.logoUrl} />
        </Card>
      </div>

      {/* WhatsApp order alerts (Phase 5) */}
      <Card title={t('settings.waTitle')} subtitle={t('settings.waDesc')}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Switch
            id="wa-enabled"
            label={t('settings.waEnabled')}
            checked={wa.enabled}
            onChange={(e) => updateWa('enabled', e.target.checked)}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label={t('settings.waNumber')} hint={t('settings.waNumberHint')}>
              <Input value={wa.number} maxLength={20} onChange={(e) => updateWa('number', e.target.value)} placeholder="+8801712345678" />
            </Field>
            <Field label={t('settings.waWebhook')} hint={t('settings.waWebhookHint')}>
              <Input value={wa.webhookUrl} maxLength={500} onChange={(e) => updateWa('webhookUrl', e.target.value)} placeholder="https://gateway.example.com/hook" />
            </Field>
          </div>
          <Field label={t('settings.waSecret')} hint={t('settings.waSecretHint')}>
            <Input value={wa.secret} maxLength={200} onChange={(e) => updateWa('secret', e.target.value)} placeholder="shared-secret" />
          </Field>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" onClick={saveWhatsApp} disabled={waSaving}>
              {waSaving ? t('common.loading') : t('settings.waSave')}
            </Button>
            <Button variant="outline" onClick={testWhatsApp} disabled={waTesting}>
              {waTesting ? t('common.loading') : t('settings.waTest')}
            </Button>
            {waManualLink && (
              <a href={waManualLink} target="_blank" rel="noreferrer">
                <Button variant="ghost">{t('settings.waSendLink')} ↗</Button>
              </a>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div className="oms-brand-color">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#00b3a5'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          value={value || ''}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          className="oms-brand-color__hex"
        />
      </div>
    </div>
  );
}

/** Mini storefront preview driven by the current brand draft. */
function StorefrontPreview({ brand, name, logoUrl }) {
  const primary = /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor || '') ? brand.primaryColor : '#00b3a5';
  const accent = /^#[0-9a-fA-F]{6}$/.test(brand.accentColor || '') ? brand.accentColor : '#f5d300';

  return (
    <div className="oms-brand-preview" style={{ '--preview-primary': primary, '--preview-accent': accent }}>
      <div className="oms-brand-preview__hero">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="oms-brand-preview__logo" />
        ) : (
          <span className="oms-brand-preview__logo">🏪</span>
        )}
        <div>
          <div className="oms-brand-preview__name">{name}</div>
          <div className="oms-brand-preview__tagline">{brand.tagline || 'Your tagline appears here'}</div>
        </div>
      </div>
      {brand.announcement && (
        <div className="oms-brand-preview__banner">📢 {brand.announcement}</div>
      )}
      <div className="oms-brand-preview__chips">
        <span className="is-on">Popular</span>
        <span>Burgers</span>
        <span>Drinks</span>
      </div>
      <div className="oms-brand-preview__item">
        <span>🍔 Signature Burger</span>
        <b>৳ 320</b>
      </div>
      <div className="oms-brand-preview__item">
        <span>🍟 Classic Fries</span>
        <b>৳ 150</b>
      </div>
    </div>
  );
}
