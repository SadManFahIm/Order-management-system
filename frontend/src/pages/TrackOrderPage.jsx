import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useI18n, LANGUAGES } from '../i18n';

/**
 * Public order tracking (Phase 5) — /track/:orderNo? and /track.
 *
 * The customer enters the order number + the phone they ordered with; the
 * public API verifies the phone and returns live status. Fully bilingual
 * (EN/বাংলা) with the same toggle the storefront uses.
 */
const STEPS = ['placed', 'preparing', 'ready', 'delivered'];
const fmtTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};
const fmtTaka = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function TrackOrderPage() {
  const { orderNo: orderNoParam } = useParams();
  const [searchParams] = useSearchParams();
  const { t, lang, toggleLang } = useI18n();
  // The storefront confirmation links to /track?orderNo=…&phone=… — prefer
  // those query params (real checkout flow) over the route param, so the
  // customer lands on the live status instead of an empty form.
  const [orderNo, setOrderNo] = useState(
    searchParams.get('orderNo') || orderNoParam || ''
  );
  const [phone, setPhone] = useState(searchParams.get('phone') || '');
  const [state, setState] = useState({ loading: false, error: null, data: null });

  // Pre-filled from the confirmation link → look up immediately.
  useEffect(() => {
    if (orderNo && phone) lookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lookup = async (e) => {
    e?.preventDefault();
    if (!orderNo.trim() || !phone.trim()) return;
    setState({ loading: true, error: null, data: null });
    try {
      const res = await axios.get('/api/public/track', {
        params: { orderNo: orderNo.trim(), phone: phone.trim() },
      });
      setState({ loading: false, error: null, data: res.data });
    } catch (err) {
      setState({
        loading: false,
        error: err?.response?.status === 404 ? 'notFound' : 'load',
        data: null,
      });
    }
  };

  const currentIndex = state.data ? STEPS.indexOf(state.data.status) : -1;
  const canceled = state.data?.status === 'canceled';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f5fbfa)', fontFamily: 'inherit' }}>
      {/* Slim top bar — brand + language toggle */}
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 20px', maxWidth: 720, margin: '0 auto',
        }}
      >
        <Link to="/" style={{ fontWeight: 800, fontSize: 16, color: 'var(--primary, #00b3a5)', textDecoration: 'none' }}>
          ⭘ Orderly
        </Link>
        <button
          onClick={toggleLang}
          title={lang === 'en' ? 'বাংলা' : 'English'}
          style={{
            background: 'var(--surface-2, #f0faf8)', border: '1px solid var(--border-strong, #b9e0da)',
            color: 'var(--text, #123b36)', borderRadius: 999, padding: '6px 12px',
            fontSize: 12, fontWeight: 800, cursor: 'pointer',
          }}
        >
          {LANGUAGES.find((l) => l.code !== lang)?.short}
        </button>
      </div>

      <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 20px 60px' }}>
        {/* Lookup form */}
        <div
          style={{
            background: '#fff', border: '1px solid var(--border, #d8eeea)', borderRadius: 20,
            padding: 28, boxShadow: '0 10px 30px rgba(15,23,42,0.05)',
          }}
        >
          <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 800 }}>{t('track.page')}</h1>
          <p style={{ margin: '0 0 20px', color: 'var(--text-muted, #7d9a95)', fontSize: 14 }}>{t('track.pageDesc')}</p>

          <form onSubmit={lookup} style={{ display: 'grid', gap: 14 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #7d9a95)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('track.orderNo')}
              </span>
              <input
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder={t('track.orderNoHint')}
                style={{
                  border: '1px solid var(--border-strong, #b9e0da)', borderRadius: 12, padding: '11px 14px',
                  fontSize: 14, outline: 'none', background: 'var(--surface-1, #fff)',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #7d9a95)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('track.phone')}
              </span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                inputMode="tel"
                style={{
                  border: '1px solid var(--border-strong, #b9e0da)', borderRadius: 12, padding: '11px 14px',
                  fontSize: 14, outline: 'none', background: 'var(--surface-1, #fff)',
                }}
              />
            </label>
            <button
              type="submit"
              disabled={state.loading || !orderNo.trim() || !phone.trim()}
              style={{
                background: 'var(--primary, #00b3a5)', color: '#fff', border: 'none', borderRadius: 12,
                padding: '12px 18px', fontSize: 14, fontWeight: 700, cursor: state.loading ? 'wait' : 'pointer',
                marginTop: 4,
              }}
            >
              {state.loading ? t('track.tracking') : t('track.track')}
            </button>
          </form>
        </div>

        {/* Error / empty states */}
        {state.error && (
          <div style={{ textAlign: 'center', marginTop: 28, display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 38 }}>{state.error === 'notFound' ? '🔍' : '⚠️'}</div>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {state.error === 'notFound' ? t('track.notFound') : t('track.error')}
            </h2>
            {state.error === 'notFound' && (
              <p style={{ margin: 0, color: 'var(--text-muted, #7d9a95)', fontSize: 14 }}>{t('track.notFoundDesc')}</p>
            )}
          </div>
        )}

        {/* Live status */}
        {state.data && !state.error && (
          <div
            style={{
              marginTop: 20, background: '#fff', border: '1px solid var(--border, #d8eeea)',
              borderRadius: 20, padding: 26, display: 'grid', gap: 22,
              boxShadow: '0 10px 30px rgba(15,23,42,0.05)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-muted, #7d9a95)', fontWeight: 600 }}>
                  {state.data.restaurant?.name || t('track.restaurant')}
                </div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{state.data.orderNo}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {state.data.tableNo && (
                  <div style={{ fontSize: 13, fontWeight: 700 }}>🪑 {t('track.table', state.data.tableNo)}</div>
                )}
                <Badge
                  status={state.data.paymentStatus}
                  label={
                    state.data.paymentStatus === 'paid'
                      ? t('track.paid')
                      : state.data.paymentStatus === 'partial'
                        ? t('track.partial')
                        : t('track.unpaid')
                  }
                />
              </div>
            </div>

            {/* 4-step progress */}
            {canceled ? (
              <div
                style={{
                  borderRadius: 14, padding: 16, textAlign: 'center', fontWeight: 800,
                  background: 'rgba(239,68,68,0.08)', color: '#dc2626', fontSize: 15,
                }}
              >
                ✕ {t('orders.canceled')}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {STEPS.map((step, i) => {
                  const done = i <= currentIndex;
                  const active = i === currentIndex;
                  return (
                    <div key={step} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'grid', justifyItems: 'center', gap: 6, flex: 1 }}>
                        <div
                          style={{
                            width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center',
                            fontSize: 14, fontWeight: 800,
                            background: done ? 'var(--primary, #00b3a5)' : 'var(--surface-2, #f0faf8)',
                            color: done ? '#fff' : 'var(--text-muted, #7d9a95)',
                            border: active && !done ? '2px solid var(--primary, #00b3a5)' : 'none',
                            boxShadow: active ? '0 0 0 5px color-mix(in srgb, var(--primary, #00b3a5) 18%, transparent)' : 'none',
                          }}
                        >
                          {done ? '✓' : i + 1}
                        </div>
                        <span
                          style={{
                            fontSize: 11.5, fontWeight: done ? 700 : 500, textAlign: 'center',
                            color: done ? 'var(--text, #123b36)' : 'var(--text-muted, #7d9a95)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {t(`track.step${step.charAt(0).toUpperCase()}${step.slice(1)}`)}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <div
                          style={{
                            height: 3, flex: 1, borderRadius: 999, marginBottom: 20,
                            background: i < currentIndex ? 'var(--primary, #00b3a5)' : 'var(--surface-2, #f0faf8)',
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Items */}
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted, #7d9a95)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('track.items')}
              </div>
              {(state.data.items || []).map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14 }}>
                  <span>{item.name} <span style={{ color: 'var(--text-muted, #7d9a95)' }}>×{item.quantity}</span></span>
                  <span style={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{fmtTaka(item.lineTotal)}</span>
                </div>
              ))}
              <div
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                  borderTop: '1px dashed var(--border-strong, #b9e0da)', paddingTop: 12, marginTop: 2,
                }}
              >
                <span style={{ fontWeight: 800 }}>{t('track.total')}</span>
                <span style={{ fontWeight: 800, fontSize: 17 }}>{fmtTaka(state.data.total)}</span>
              </div>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--text-muted, #7d9a95)', display: 'grid', gap: 3 }}>
              <span>{t('track.placedAt')}: {fmtTime(state.data.createdAt)}</span>
              <span>{t('track.updatedAt')}: {fmtTime(state.data.updatedAt)}</span>
            </div>

            <button
              onClick={() => {
                setState({ loading: false, error: null, data: null });
                setOrderNo('');
                setPhone('');
              }}
              style={{
                alignSelf: 'flex-start', background: 'none', border: '1px solid var(--border-strong, #b9e0da)',
                borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 700,
                color: 'var(--text, #123b36)', cursor: 'pointer',
              }}
            >
              ← {t('track.trackAnother')}
            </button>
          </div>
        )}

        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>
          <Link to="/login" style={{ color: 'inherit' }}>{t('store.merchantSignIn')}</Link> · {t('store.poweredBy')}
        </div>
      </div>
    </div>
  );
}

function Badge({ status, label }) {
  // paid → green ✓ · partial → amber ⏳ (part collected, part pending) ·
  // everything else → amber ⏳.
  const done = status === 'paid';
  return (
    <span
      style={{
        display: 'inline-block', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 800,
        background: done ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)',
        color: done ? '#059669' : '#d97706',
      }}
    >
      {done ? '✓' : '⏳'} {label}
    </span>
  );
}
