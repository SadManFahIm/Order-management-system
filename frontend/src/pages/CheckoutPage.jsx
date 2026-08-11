import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Skeleton } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * Storefront checkout (Phase 5) — the customer journey's final step.
 *
 * Cart lives in localStorage (seeded by the menu page), prices shown here
 * are display-only (the API re-prices server-side), and the order is placed
 * with an Idempotency-Key so double-clicks / retries can never create two
 * orders. Supports pickup, delivery, scheduled pickup and scheduled delivery;
 * payment via the workspace's enabled methods (cash / wallets / online).
 */

const CART_KEY = (slug) => `oms.cart.${slug}`;
const IDEM_KEY = (slug) => `oms.idem.${slug}`;

const ORDER_TYPES = ['pickup', 'delivery', 'scheduled_pickup', 'scheduled_delivery'];
const TYPE_KEY = {
  pickup: 'typePickup',
  delivery: 'typeDelivery',
  scheduled_pickup: 'typeScheduledPickup',
  scheduled_delivery: 'typeScheduledDelivery',
};

const fmtMoney = (n) => `৳ ${Number(n).toFixed(2)}`;

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  border: '1.5px solid var(--border-strong, #b9e0da)', borderRadius: 12,
  padding: '11px 14px', fontSize: 14, background: '#fff',
  outline: 'none', transition: 'border-color .15s ease',
};
const labelStyle = { fontSize: 12.5, fontWeight: 800, color: 'var(--text-muted, #7d9a95)', marginBottom: 6, display: 'block' };

export default function CheckoutPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();

  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [orderType, setOrderType] = useState('pickup');
  const [form, setForm] = useState({ name: '', phone: '', address: '', scheduled_at: '' });
  const [paymentMethod, setPaymentMethod] = useState('cash');
  // Split payment (Phase 6): one order, multiple methods — e.g. part bKash
  // + part cash. Only shown when the workspace enables >= 2 non-online
  // methods; the server re-validates every part + the exact sum.
  const [useSplit, setUseSplit] = useState(false);
  const [splitParts, setSplitParts] = useState({});
  // Diner bill-split (QR table): group cart lines by diner, each diner
  // picks a method — amounts auto-computed (their items + an equal
  // delivery-fee share), each part tagged with the diner's name.
  const [splitMode, setSplitMode] = useState('amount'); // 'amount' | 'diner'
  const [diners, setDiners] = useState([]); // [{ name, method }]
  const [dinerAssign, setDinerAssign] = useState({}); // cartLineIdx -> dinerIdx
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [placed, setPlaced] = useState(null);
  const idemKeyRef = useRef(null);

  const tableNo = searchParams.get('table');

  // Restore / mint the Idempotency-Key for THIS checkout attempt. It is
  // reused across retries (same key → same order), and cleared on success.
  const idemKey = () => {
    if (!idemKeyRef.current) {
      try {
        idemKeyRef.current = window.sessionStorage.getItem(IDEM_KEY(slug)) ||
          (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        window.sessionStorage.setItem(IDEM_KEY(slug), idemKeyRef.current);
      } catch {
        idemKeyRef.current = idemKeyRef.current || `${Date.now()}-${Math.random()}`;
      }
    }
    return idemKeyRef.current;
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [infoRes] = await Promise.all([
          axios.get(`/api/public/restaurants/${slug}`),
        ]);
        if (!mounted) return;
        setRestaurant(infoRes.data);
        setCart(loadCart());
        const cfg = infoRes.data.checkout || {};
        if (cfg.paymentMethods?.length) setPaymentMethod(cfg.paymentMethods[0]);
      } catch (err) {
        if (mounted) setError(err?.response?.status === 404 ? 'notFound' : 'load');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const loadCart = () => {
    try {
      const raw = window.localStorage.getItem(CART_KEY(slug));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const clearCart = () => {
    try {
      window.localStorage.removeItem(CART_KEY(slug));
      window.sessionStorage.removeItem(IDEM_KEY(slug));
    } catch {
      /* storage unavailable */
    }
  };

  const checkoutConfig = restaurant?.checkout || { paymentMethods: ['cash'], deliveryEnabled: true, deliveryFee: 0 };
  const methods = checkoutConfig.paymentMethods || ['cash'];
  // Split is for wallet/cash parts only — online goes through the hosted
  // gateway and can never be a split part (mirrors the backend rule).
  const splitMethods = methods.filter((m) => m !== 'online');
  const deliveryFee = orderType === 'delivery' || orderType === 'scheduled_delivery' ? Number(checkoutConfig.deliveryFee || 0) : 0;

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0),
    [cart]
  );
  const total = Math.round((subtotal + deliveryFee) * 100) / 100;

  const splitTotal = Object.values(splitParts).reduce((s, v) => s + (Number(v) || 0), 0);
  const splitRemaining = Math.round((total - splitTotal) * 100) / 100;
  const splitValid =
    splitMethods.filter((m) => Number(splitParts[m]) > 0).length >= 2 &&
    Math.abs(splitRemaining) < 0.005;

  const toggleSplit = () => {
    setUseSplit((s) => {
      if (!s) {
        // Seed: first method carries the whole total, the rest empty — the
        // customer just edits the parts.
        const seed = {};
        splitMethods.forEach((m, i) => { seed[m] = i === 0 ? String(total) : ''; });
        setSplitParts(seed);
      } else {
        setSplitParts({});
      }
      return !s;
    });
  };
  const setSplitPart = (m, value) => {
    const sanitized = value.replace(/[^0-9.]/g, '');
    setSplitParts((p) => ({ ...p, [m]: sanitized }));
  };

  // ── Diner bill-split (QR table) ────────────────────────────────────────
  const dinerShareOf = (di) =>
    cart.reduce(
      (s, l, li) => s + (dinerAssign[li] === di ? Number(l.unit_price) * l.quantity : 0),
      0
    );
  const dinerCount = diners.length;
  const dinerShares = diners.map((d, di) => {
    const itemsTotal = dinerShareOf(di);
    // Delivery fee split equally; the last diner absorbs the rounding.
    let feeShare = 0;
    if (deliveryFee > 0 && dinerCount > 0) {
      const equal = Math.round((deliveryFee / dinerCount) * 100) / 100;
      feeShare = di === dinerCount - 1 ? deliveryFee - equal * (dinerCount - 1) : equal;
    }
    return Math.round((itemsTotal + feeShare) * 100) / 100;
  });
  const dinerParts = diners
    .map((d, di) => ({
      method: d.method,
      amount: dinerShares[di],
      note: d.name.trim() ? d.name.trim().slice(0, 80) : `Diner ${di + 1}`,
    }))
    .filter((p) => p.amount > 0);
  const dinerSplitValid = dinerParts.length >= 2;

  const switchSplitMode = (mode) => {
    setSplitMode(mode);
    if (mode === 'diner') {
      // Default: two diners, cart lines distributed round-robin.
      const d = Array.from({ length: 2 }, () => ({
        name: '',
        method: splitMethods[0] || 'cash',
      }));
      const assign = {};
      cart.forEach((_, li) => { assign[li] = li % 2; });
      setDiners(d);
      setDinerAssign(assign);
    }
  };
  const addDiner = () => {
    setDiners((ds) => [...ds, { name: '', method: splitMethods[0] || 'cash' }]);
  };
  const removeDiner = (di) => {
    setDiners((ds) => ds.filter((_, i) => i !== di));
    setDinerAssign((a) => {
      const next = {};
      Object.entries(a).forEach(([li, v]) => {
        if (v === di) next[li] = 0; // reassign to the first diner
        else next[li] = v > di ? v - 1 : v;
      });
      return next;
    });
  };

  const validate = () => {
    const digits = form.phone.replace(/\D/g, '');
    if (!form.name.trim()) return t('store.requiredField') + ': ' + t('store.fullName');
    if (digits.length < 10) return t('store.invalidPhone');
    if ((orderType === 'delivery' || orderType === 'scheduled_delivery') && !form.address.trim()) {
      return t('store.requiredField') + ': ' + t('store.address');
    }
    if (orderType === 'scheduled_pickup' || orderType === 'scheduled_delivery') {
      if (!form.scheduled_at) return t('store.requiredField') + ': ' + t('store.schedule');
      const at = new Date(form.scheduled_at);
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 5 * 60 * 1000) {
        return t('store.invalidSchedule');
      }
    }
    if (useSplit && splitMode === 'diner' && !dinerSplitValid) return t('store.dinerSplitMismatch');
    if (useSplit && splitMode === 'amount' && !splitValid) return t('store.splitMismatch');
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        order_type: orderType,
        customer_name: form.name.trim(),
        customer_phone: form.phone.trim(),
        customer_address: (orderType === 'delivery' || orderType === 'scheduled_delivery') ? form.address.trim() : undefined,
        scheduled_at:
          orderType === 'scheduled_pickup' || orderType === 'scheduled_delivery'
            ? new Date(form.scheduled_at).toISOString()
            : undefined,
        items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          variant_id: l.variant_id ?? undefined,
          addon_ids: l.addon_ids || [],
        })),
      };
      if (useSplit && splitMode === 'diner') {
        // Diner split: parts carry the diner's name as the note.
        body.payments = dinerParts.map((p) => ({
          method: p.method,
          amount: Math.round(p.amount * 100) / 100,
          note: p.note,
        }));
      } else if (useSplit) {
        // Amount split: send the parts (server re-validates method + sum).
        body.payments = splitMethods
          .filter((m) => Number(splitParts[m]) > 0)
          .map((m) => ({ method: m, amount: Math.round(Number(splitParts[m]) * 100) / 100 }));
      } else {
        body.payment_method = paymentMethod;
      }
      const res = await axios.post(
        `/api/public/restaurants/${slug}/checkout`,
        body,
        { headers: { 'Idempotency-Key': idemKey() } }
      );
      clearCart();
      idemKeyRef.current = null;
      setPlaced(res.data);
      window.scrollTo(0, 0);
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      const message = err?.response?.data?.error?.message;
      if (code === 'IDEMPOTENCY_KEY_MISMATCH') {
        // A stale key from a previous attempt — mint a fresh one and retry once.
        try { window.sessionStorage.removeItem(IDEM_KEY(slug)); } catch { /* noop */ }
        idemKeyRef.current = null;
      }
      setError(message || t('store.orderFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const updateQty = (idx, delta) => {
    setCart((c) =>
      c.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, Math.min(99, l.quantity + delta)) } : l))
    );
    try {
      window.localStorage.setItem(CART_KEY(slug), JSON.stringify(
        cart.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, Math.min(99, l.quantity + delta)) } : l))
      ));
    } catch { /* noop */ }
  };
  const removeLine = (idx) => {
    const next = cart.filter((_, i) => i !== idx);
    setCart(next);
    try { window.localStorage.setItem(CART_KEY(slug), JSON.stringify(next)); } catch { /* noop */ }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px', display: 'grid', gap: 16 }}>
        <Skeleton height={36} width={220} />
        <Skeleton height={120} />
        <Skeleton height={160} />
      </div>
    );
  }

  // ── Confirmation view (post-place) ────────────────────────────────────
  const primaryBtn = {
    display: 'block', width: '100%', textAlign: 'center', background: 'var(--primary, #00b3a5)',
    color: '#fff', border: 'none', borderRadius: 12, padding: '13px 18px',
    fontSize: 15, fontWeight: 800, cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box',
  };
  const ghostBtn = {
    display: 'block', width: '100%', textAlign: 'center', marginTop: 10,
    border: '1.5px solid var(--border-strong, #b9e0da)', borderRadius: 12, padding: '12px 18px',
    fontSize: 14, fontWeight: 700, color: 'var(--text, #123b36)', textDecoration: 'none', boxSizing: 'border-box',
  };

  if (placed) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg, #f5fbfa)', display: 'grid', placeItems: 'center', padding: 32 }}>
        <div style={{ maxWidth: 460, width: '100%', textAlign: 'center', background: '#fff', borderRadius: 24, padding: 40, boxShadow: '0 20px 60px rgba(15,23,42,0.10)' }}>
          <div style={{ fontSize: 54 }}>🎉</div>
          <h1 style={{ margin: '14px 0 6px', fontSize: 26, fontWeight: 800 }}>
            {t('store.orderPlaced')}
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted, #7d9a95)', fontSize: 14.5, lineHeight: 1.55 }}>
            {t('store.orderPlacedDesc', { name: placed.customer_name })}
          </p>
          <div style={{ margin: '24px 0', padding: 16, background: 'var(--surface-2, #f0faf8)', borderRadius: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted, #7d9a95)' }}>{t('store.yourOrderNo')}</div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.5px', marginTop: 4 }}>{placed.order_no}</div>
            <div style={{ marginTop: 8, fontSize: 15, fontWeight: 700 }}>{fmtMoney(placed.grand_total)}</div>
            {(placed.payments || []).length > 1 && (
              <div
                style={{
                  marginTop: 14, borderTop: '1px dashed var(--border-strong, #b9e0da)',
                  paddingTop: 12, display: 'grid', gap: 6, textAlign: 'left',
                }}
              >
                {(placed.payments || []).map((p) => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ textTransform: 'capitalize', fontWeight: 700 }}>
                      {p.method === 'cash' ? t('store.payAtCounter') : p.method}
                      {p.notes ? ` · ${p.notes}` : ''}
                    </span>
                    <span style={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {placed.paymentUrl && (
            <a
              href={placed.paymentUrl}
              target="_blank"
              rel="noreferrer"
              style={primaryBtn}
            >
              {t('store.payNow')} →
            </a>
          )}
          <Link to={placed.trackUrl || '/track'} style={ghostBtn}>
            🛎️ {t('store.trackIt')}
          </Link>
          <Link to={`/m/${slug}`} style={ghostBtn}>
            {t('store.continueShopping')}
          </Link>
        </div>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg, #f5fbfa)', display: 'grid', placeItems: 'center', padding: 32 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', background: '#fff', borderRadius: 24, padding: 40, boxShadow: '0 20px 60px rgba(15,23,42,0.10)' }}>
          <div style={{ fontSize: 44 }}>🛒</div>
          <h1 style={{ margin: '14px 0 6px', fontSize: 22, fontWeight: 800 }}>{t('store.cartEmpty')}</h1>
          <p style={{ margin: 0, color: 'var(--text-muted, #7d9a95)', fontSize: 14 }}>{t('store.cartEmptyDesc')}</p>
          <Link to={`/m/${slug}`} style={{ ...primaryBtn, marginTop: 22 }}>{t('store.backToMenu')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f5fbfa)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 20px 80px' }}>
        <Link to={`/m/${slug}`} style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-muted, #7d9a95)', textDecoration: 'none' }}>
          ← {t('store.backToMenu')}
        </Link>
        <h1 style={{ margin: '10px 0 4px', fontSize: 26, fontWeight: 800 }}>
          {restaurant.name} — {t('store.checkout')}
        </h1>
        {tableNo && (
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted, #7d9a95)' }}>
            🪑 {t('store.table', tableNo)}
          </span>
        )}

        <div style={{ display: 'grid', gap: 20, marginTop: 24 }}>
          {/* 1. Order type */}
          <section style={card}>
            <h2 style={sectionTitle}>{t('store.orderType')}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {ORDER_TYPES.map((type) => {
                const isDelivery = type === 'delivery' || type === 'scheduled_delivery';
                const disabled = isDelivery && !checkoutConfig.deliveryEnabled;
                return (
                  <button
                    key={type}
                    disabled={disabled}
                    onClick={() => setOrderType(type)}
                    style={{
                      border: `1.5px solid ${orderType === type ? 'var(--primary, #00b3a5)' : 'var(--border-strong, #b9e0da)'}`,
                      background: orderType === type ? 'color-mix(in srgb, var(--primary, #00b3a5) 8%, #fff)' : '#fff',
                      borderRadius: 14, padding: '14px 12px', cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.45 : 1, textAlign: 'left',
                      display: 'flex', gap: 8, alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{type === 'pickup' ? '🛍️' : type === 'delivery' ? '🛵' : type === 'scheduled_pickup' ? '📅' : '📦'}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                      {t(`store.${TYPE_KEY[type]}`)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Customer info */}
          <section style={card}>
            <h2 style={sectionTitle}>{t('store.fullName')}</h2>
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={labelStyle}>{t('store.fullName')}</label>
                <input
                  style={inputStyle}
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Rahim Uddin"
                />
              </div>
              <div>
                <label style={labelStyle}>{t('store.phone')}</label>
                <input
                  style={inputStyle}
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="017XXXXXXXX"
                  inputMode="tel"
                />
                <div style={{ fontSize: 11.5, color: 'var(--text-muted, #7d9a95)', marginTop: 4 }}>{t('store.phoneHint')}</div>
              </div>
              {(orderType === 'delivery' || orderType === 'scheduled_delivery') && (
                <div>
                  <label style={labelStyle}>{t('store.address')}</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 76, resize: 'vertical' }}
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    placeholder={t('store.addressHint')}
                  />
                </div>
              )}
              {(orderType === 'scheduled_pickup' || orderType === 'scheduled_delivery') && (
                <div>
                  <label style={labelStyle}>{t('store.schedule')}</label>
                  <input
                    type="datetime-local"
                    style={inputStyle}
                    value={form.scheduled_at}
                    onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                    min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
                  />
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted, #7d9a95)', marginTop: 4 }}>{t('store.scheduleHint')}</div>
                </div>
              )}
            </div>
          </section>

          {/* 3. Payment */}
          <section style={card}>
            <h2 style={sectionTitle}>{t('store.payWith')}</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {methods.map((m) => (
                <label
                  key={m}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    border: `1.5px solid ${paymentMethod === m ? 'var(--primary, #00b3a5)' : 'var(--border-strong, #b9e0da)'}`,
                    borderRadius: 14, padding: '13px 16px', cursor: 'pointer',
                    background: paymentMethod === m ? 'color-mix(in srgb, var(--primary, #00b3a5) 6%, #fff)' : '#fff',
                  }}
                >
                  <input
                    type="radio"
                    name="pay"
                    checked={paymentMethod === m}
                    onChange={() => setPaymentMethod(m)}
                    style={{ accentColor: 'var(--primary, #00b3a5)' }}
                  />
                  <span style={{ fontSize: 14, fontWeight: 700, textTransform: 'capitalize' }}>
                    {m === 'online' ? t('store.payOnline') : m}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted, #7d9a95)' }}>
                    {m === 'cash' ? t('store.payAtCounter') : m === 'online' ? t('store.onlineNote') : t('store.walletHint')}
                  </span>
                </label>
              ))}
            </div>

            {splitMethods.length >= 2 && (
              <div style={{ marginTop: 18, borderTop: '1px dashed var(--border-strong, #b9e0da)', paddingTop: 16 }}>
                <button
                  onClick={toggleSplit}
                  style={{
                    width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    fontSize: 14, fontWeight: 800, color: 'var(--text, #123b36)',
                  }}
                >
                  <span>⇄ {useSplit ? t('store.splitOff') : t('store.splitPay')}</span>
                  <span
                    style={{
                      width: 34, height: 20, borderRadius: 999, position: 'relative', transition: 'background .15s',
                      background: useSplit ? 'var(--primary, #00b3a5)' : 'var(--border-strong, #b9e0da)',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute', top: 2, width: 16, height: 16, borderRadius: '50%',
                        background: '#fff', transition: 'left .15s', left: useSplit ? 16 : 2,
                      }}
                    />
                  </span>
                </button>
                {useSplit && (
                  <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
                    {/* Mode switch: by amount (free-form) vs by diner (QR table) */}
                    <div
                      style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                        background: 'var(--surface-2, #f0faf8)', borderRadius: 12, padding: 4,
                      }}
                    >
                      {['amount', 'diner'].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => switchSplitMode(mode)}
                          style={{
                            border: 'none', borderRadius: 9, padding: '9px 8px', cursor: 'pointer',
                            fontSize: 13, fontWeight: 800,
                            background: splitMode === mode ? '#fff' : 'transparent',
                            color: splitMode === mode ? 'var(--text, #123b36)' : 'var(--text-muted, #7d9a95)',
                            boxShadow: splitMode === mode ? '0 2px 8px rgba(15,23,42,0.08)' : 'none',
                          }}
                        >
                          {mode === 'amount' ? t('store.splitByAmount') : t('store.splitByDiner')}
                        </button>
                      ))}
                    </div>

                    {splitMode === 'amount' ? (
                      <>
                        <div style={{ fontSize: 12.5, color: 'var(--text-muted, #7d9a95)' }}>{t('store.splitHint')}</div>
                        {splitMethods.map((m) => (
                          <label
                            key={m}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              border: '1.5px solid var(--border-strong, #b9e0da)', borderRadius: 14, padding: '11px 14px',
                            }}
                          >
                            <span style={{ fontSize: 13.5, fontWeight: 700, textTransform: 'capitalize', minWidth: 90 }}>
                              {m === 'cash' ? t('store.payAtCounter') : m}
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              value={splitParts[m] || ''}
                              onChange={(e) => setSplitPart(m, e.target.value)}
                              style={{ ...inputStyle, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                            />
                            <span style={{ fontSize: 12, color: 'var(--text-muted, #7d9a95)' }}>৳</span>
                          </label>
                        ))}
                        <div
                          style={{
                            display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700,
                            color: splitValid ? 'var(--primary, #00b3a5)' : '#d64541',
                          }}
                        >
                          <span>{t('store.splitRemaining')}</span>
                          <span>৳ {splitRemaining.toFixed(2)}</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 12.5, color: 'var(--text-muted, #7d9a95)' }}>{t('store.dinerSplitHint')}</div>
                        {diners.map((d, di) => (
                          <div
                            key={di}
                            style={{
                              display: 'grid', gridTemplateColumns: '1fr 96px auto', gap: 8, alignItems: 'center',
                              border: '1.5px solid var(--border-strong, #b9e0da)', borderRadius: 14, padding: '10px 12px',
                            }}
                          >
                            <input
                              placeholder={`${t('store.diner')} ${di + 1}`}
                              value={d.name}
                              onChange={(e) =>
                                setDiners((ds) => ds.map((x, i) => (i === di ? { ...x, name: e.target.value } : x)))
                              }
                              style={{ ...inputStyle, padding: '9px 11px' }}
                            />
                            <select
                              value={d.method}
                              aria-label={`${t('store.diner')} ${di + 1} method`}
                              onChange={(e) =>
                                setDiners((ds) => ds.map((x, i) => (i === di ? { ...x, method: e.target.value } : x)))
                              }
                              style={{ ...inputStyle, padding: '9px 8px', fontSize: 13 }}
                            >
                              {splitMethods.map((m) => (
                                <option key={m} value={m}>
                                  {m === 'cash' ? t('store.payAtCounter') : m}
                                </option>
                              ))}
                            </select>
                            <span
                              aria-label={`${t('store.diner')} ${di + 1} share`}
                              style={{ fontWeight: 800, fontSize: 13.5, fontVariantNumeric: 'tabular-nums', minWidth: 74, textAlign: 'right' }}
                            >
                              {fmtMoney(dinerShares[di])}
                            </span>
                            {diners.length > 2 && (
                              <button
                                onClick={() => removeDiner(di)}
                                aria-label={`${t('store.removeDiner')} ${di + 1}`}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#d64541', fontSize: 14, fontWeight: 800 }}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          onClick={addDiner}
                          style={{
                            border: '1.5px dashed var(--border-strong, #b9e0da)', background: 'none',
                            borderRadius: 12, padding: '10px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                            color: 'var(--text-muted, #7d9a95)',
                          }}
                        >
                          + {t('store.addDiner')}
                        </button>
                        <div
                          style={{
                            display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700,
                            color: dinerSplitValid ? 'var(--primary, #00b3a5)' : '#d64541',
                          }}
                        >
                          <span>{t('store.splitRemaining')}</span>
                          <span>৳ 0.00</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 4. Summary + submit */}
          <section style={card}>
            <h2 style={sectionTitle}>{t('store.cart')}</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              {cart.map((line, idx) => (
                <div key={`${line.product_id}-${line.variant_id}-${line.addon_ids?.join(',')}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{line.name}</div>
                    {line.options?.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted, #7d9a95)' }}>{line.options.join(' + ')}</div>
                    )}
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #7d9a95)' }}>{fmtMoney(line.unit_price)} each</div>
                  </div>
                  <button onClick={() => updateQty(idx, -1)} style={miniBtn}>−</button>
                  <span style={{ fontWeight: 800, minWidth: 26, textAlign: 'center' }}>{line.quantity}</span>
                  <button onClick={() => updateQty(idx, 1)} style={miniBtn}>+</button>
                  <span style={{ fontWeight: 800, minWidth: 70, textAlign: 'right' }}>{fmtMoney(line.unit_price * line.quantity)}</span>
                  {useSplit && splitMode === 'diner' && (
                    <select
                      value={dinerAssign[idx] ?? 0}
                      onChange={(e) => setDinerAssign((a) => ({ ...a, [idx]: Number(e.target.value) }))}
                      aria-label={`${t('store.dinerFor')} ${line.name}`}
                      style={{
                        border: '1.5px solid var(--border-strong, #b9e0da)', borderRadius: 10,
                        padding: '6px 6px', fontSize: 12, fontWeight: 700, background: '#fff', cursor: 'pointer',
                      }}
                    >
                      {diners.map((d, di) => (
                        <option key={di} value={di}>
                          {t('store.diner')} {di + 1}
                        </option>
                      ))}
                    </select>
                  )}
                  <button onClick={() => removeLine(idx)} style={{ ...miniBtn, color: '#d64541' }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--border, #d8eeea)', marginTop: 16, paddingTop: 14, display: 'grid', gap: 8, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted, #7d9a95)' }}>{t('store.subtotal')}</span>
                <span>{fmtMoney(subtotal)}</span>
              </div>
              {deliveryFee > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted, #7d9a95)' }}>{t('store.deliveryFee')}</span>
                  <span>{fmtMoney(deliveryFee)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 16, marginTop: 4 }}>
                <span>{t('store.total')}</span>
                <span>{fmtMoney(total)}</span>
              </div>
            </div>
            {error && (
              <div style={{ marginTop: 14, background: '#fdecec', color: '#c0392b', borderRadius: 12, padding: '12px 14px', fontSize: 13.5, fontWeight: 600 }}>
                {error}
              </div>
            )}
            <button
              onClick={submit}
              disabled={submitting}
              style={{
                width: '100%', marginTop: 18,
                background: submitting ? 'var(--text-muted, #7d9a95)' : 'var(--primary, #00b3a5)',
                color: '#fff', border: 'none', borderRadius: 14, padding: '15px 20px',
                fontSize: 15.5, fontWeight: 800, cursor: submitting ? 'wait' : 'pointer',
                boxShadow: submitting ? 'none' : '0 8px 22px color-mix(in srgb, var(--primary, #00b3a5) 35%, transparent)',
              }}
            >
              {submitting ? t('store.placingOrder') : `${t('store.placeOrder')} · ${fmtMoney(total)}`}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}

const card = {
  background: '#fff', border: '1px solid var(--border, #d8eeea)',
  borderRadius: 20, padding: '20px 20px 22px',
  boxShadow: '0 2px 10px rgba(15,23,42,0.04)',
};
const sectionTitle = { margin: '0 0 14px', fontSize: 16, fontWeight: 800 };
const miniBtn = {
  background: 'var(--surface-3, #e2f5f2)', border: 'none', width: 28, height: 28,
  borderRadius: '50%', cursor: 'pointer', fontWeight: 800, fontSize: 15, flexShrink: 0,
};
