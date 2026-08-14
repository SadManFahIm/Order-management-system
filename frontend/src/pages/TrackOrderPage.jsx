import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useI18n, LANGUAGES } from '../i18n';
import { usePaperTheme } from '../hooks/usePaperTheme';

/**
 * Public order tracking (Phase 5) — /track/:orderNo? and /track.
 *
 * The customer enters the order number + the phone they ordered with; the
 * public API verifies the phone and returns live status. Fully bilingual
 * (EN/বাংলা) with the same toggle the storefront uses.
 *
 * The page lives in "The Table Ticket" world like the menu and checkout:
 * an Orderly stub with scalloped tear and floating food orbs on top, then
 * the lookup form and live status as ticket cards on paper. The paper
 * theme (rice / ink) is shared with the storefront via usePaperTheme, so
 * a customer's choice follows them menu → checkout → tracking.
 */
const STEPS = ['placed', 'preparing', 'ready', 'delivered'];
const ORBS = [
  { emoji: '🍔', cls: 'stub__orb--1' },
  { emoji: '🍟', cls: 'stub__orb--2' },
  { emoji: '🍕', cls: 'stub__orb--3' },
  { emoji: '🍗', cls: 'stub__orb--4' },
  { emoji: '🥤', cls: 'stub__orb--5' },
];
const BRAND = '#00b3a5'; // Orderly teal — the track stub has no tenant theme.
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
  const { paperPref, effectiveDark, cyclePaper } = usePaperTheme();
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

  const paperClass = effectiveDark ? ' menu--dark' : '';
  const paperAttrs = { 'data-paper': paperPref, style: { '--brand': BRAND, '--brand-accent': '#f5d300' } };

  // Stub meta buttons — paper toggle + language toggle, shared language.
  const metaBtns = (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <button
        onClick={cyclePaper}
        aria-label={t(paperPref === 'auto' ? 'store.paperAuto' : paperPref === 'light' ? 'store.paperLight' : 'store.paperDark')}
        title={t(paperPref === 'auto' ? 'store.paperAuto' : paperPref === 'light' ? 'store.paperLight' : 'store.paperDark')}
        className="stub__lang"
      >
        {paperPref === 'light' ? '☀️' : paperPref === 'dark' ? '🌙' : '🌓'}
      </button>
      <button
        onClick={toggleLang}
        aria-label={lang === 'en' ? 'বাংলায় দেখুন' : 'Switch to English'}
        title={lang === 'en' ? 'বাংলা' : 'English'}
        className="stub__lang"
      >
        {LANGUAGES.find((l) => l.code !== lang)?.short}
      </button>
    </div>
  );

  return (
    <div className={`menu menu--track${paperClass}`} {...paperAttrs}>
      {/* Ticket-stub hero — the same hand-held ticket the customer tore off
          the menu, now stamped with their order number. */}
      <header className="stub">
        <div className="stub__orbs" aria-hidden="true">
          {ORBS.map((o) => (
            <span key={o.cls} className={`stub__orb ${o.cls}`}>{o.emoji}</span>
          ))}
        </div>
        <div className="stub__inner">
          <div className="stub__meta">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <Link to="/" className="track__home">⭘ Orderly</Link>
              {metaBtns}
            </div>
            {state.data && (
              <span className="stub__table" title={t('track.page')}>
                🎟️ {state.data.orderNo}
              </span>
            )}
          </div>
          <div className="stub__brand">
            <div className="stub__logo">🎟️</div>
            <div className="stub__copy">
              <h1 className="stub__name">
                {state.data ? state.data.restaurant?.name || t('track.page') : t('track.page')}
              </h1>
              <div className="stub__tagline">
                {state.data ? t('track.live') : t('track.pageDesc')}
              </div>
              <div className="stub__eyebrow">🧾 {t('track.ticket')}</div>
            </div>
          </div>
        </div>
        <div className="stub__tear" aria-hidden="true" />
      </header>

      <main className="menu__body checkout__body">
        {/* Lookup form — the ticket to fill in before it can be read.
            Stays visible above the live status so the customer can look
            up another order without scrolling back. */}
        <section className="ticket-card">
          <h2 className="ticket-card__title">{t('track.page')}</h2>
          <form onSubmit={lookup} style={{ display: 'grid', gap: 14 }}>
            <div className="ticket-field">
              <label className="ticket-label" htmlFor="track-order-no">{t('track.orderNo')}</label>
              <input
                id="track-order-no"
                className="ticket-input"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder={t('track.orderNoHint')}
              />
            </div>
            <div className="ticket-field">
              <label className="ticket-label" htmlFor="track-phone">{t('track.phone')}</label>
              <input
                id="track-phone"
                className="ticket-input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="01XXXXXXXXX"
                inputMode="tel"
              />
            </div>
            <button
              type="submit"
              className="ticket-cta"
              disabled={state.loading || !orderNo.trim() || !phone.trim()}
            >
              {state.loading ? t('track.tracking') : `🎟️ ${t('track.track')}`}
            </button>
          </form>
        </section>

        {/* Error / empty states */}
        {state.error && (
          <section className="ticket-empty" style={{ marginTop: 18 }}>
            <div className="ticket-empty__emoji">{state.error === 'notFound' ? '🔍' : '⚠️'}</div>
            <h2 className="ticket-empty__title">
              {state.error === 'notFound' ? t('track.notFound') : t('track.error')}
            </h2>
            {state.error === 'notFound' && (
              <p className="ticket-empty__desc">{t('track.notFoundDesc')}</p>
            )}
          </section>
        )}

        {/* Live status — the read ticket */}
        {state.data && !state.error && (
          <section className="ticket-card">
            <h2 className="ticket-card__title">🎟️ {state.data.orderNo}</h2>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              <div style={{ fontSize: 14 }}>
                <span style={{ color: 'var(--muted)' }}>{t('track.restaurant')}: </span>
                <b>{state.data.restaurant?.name || '—'}</b>
                {state.data.tableNo && (
                  <span style={{ marginLeft: 10 }}>🪑 {t('track.table', state.data.tableNo)}</span>
                )}
              </div>
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

            {/* 4-step progress */}
            {canceled ? (
              <div className="track-canceled">✕ {t('orders.canceled')}</div>
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
                            background: done ? 'var(--brand)' : 'var(--tile)',
                            color: done ? '#fff' : 'var(--muted)',
                            border: active && !done ? '2px solid var(--brand)' : 'none',
                            boxShadow: active ? '0 0 0 5px color-mix(in srgb, var(--brand) 18%, transparent)' : 'none',
                          }}
                        >
                          {done ? '✓' : i + 1}
                        </div>
                        <span
                          style={{
                            fontSize: 11.5, fontWeight: done ? 700 : 500, textAlign: 'center',
                            color: done ? 'var(--ink)' : 'var(--muted)',
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
                            background: i < currentIndex ? 'var(--brand)' : 'var(--tile)',
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Items */}
            <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
              <div className="ticket-label">{t('track.items')}</div>
              {(state.data.items || []).map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 14 }}>
                  <span>{item.name} <span style={{ color: 'var(--muted)' }}>×{item.quantity}</span></span>
                  <span style={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>{fmtTaka(item.lineTotal)}</span>
                </div>
              ))}
              <div className="ticket-row ticket-row--total" style={{ borderTop: '1px dashed var(--line-strong)' }}>
                <span className="ticket-row__label">{t('track.total')}</span>
                <span>{fmtTaka(state.data.total)}</span>
              </div>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--muted)', display: 'grid', gap: 3, marginTop: 14 }}>
              <span>{t('track.placedAt')}: {fmtTime(state.data.createdAt)}</span>
              <span>{t('track.updatedAt')}: {fmtTime(state.data.updatedAt)}</span>
            </div>

            <div className="ticket-actions">
              <button
                onClick={() => {
                  setState({ loading: false, error: null, data: null });
                  setOrderNo('');
                  setPhone('');
                }}
                className="ticket-btn ticket-btn--ghost"
              >
                ← {t('track.trackAnother')}
              </button>
            </div>
          </section>
        )}

        <div style={{ marginTop: 36, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>
          <Link to="/login" style={{ color: 'inherit' }}>{t('store.merchantSignIn')}</Link> · {t('store.poweredBy')}
        </div>
      </main>
    </div>
  );
}

function Badge({ status, label }) {
  // paid → green ✓ · partial → amber ⏳ (part collected, part pending) ·
  // everything else → amber ⏳. Light enough to read on both papers.
  const done = status === 'paid';
  return (
    <span
      style={{
        display: 'inline-block', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 800,
        background: done ? 'rgba(52,211,153,0.14)' : 'rgba(251,191,36,0.14)',
        color: done ? '#34d399' : '#fbbf24',
      }}
    >
      {done ? '✓' : '⏳'} {label}
    </span>
  );
}
