import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Skeleton } from '../components/ui';
import { useI18n, LANGUAGES } from '../i18n';
import { usePaperTheme } from '../hooks/usePaperTheme';

/**
 * Public storefront menu (Phase 4/5) — consumes the read-only public API
 * (`/api/public/restaurants/:slug/menu`), no auth required. Since Phase 4 R3
 * the page themes itself from the tenant's brand settings.
 *
 * Phase 5: the page is now the first step of the customer journey — items can
 * be added to a cart (with variant/add-on options where the menu has them),
 * the cart persists per restaurant in localStorage, and the floating cart bar
 * leads to the checkout flow at /m/:slug/checkout. Prices shown are for
 * display; the checkout re-prices everything server-side.
 */
const PAGE_SIZE = 50;
const CART_KEY = (slug) => `oms.cart.${slug}`;

/** Merges a paginated response into the already-fetched categories (by item id). */
const mergeCategories = (existing, incoming) => {
  if (!existing) return incoming;
  const map = new Map(existing.map((c) => [c.id, { ...c, items: [...c.items] }]));
  for (const cat of incoming) {
    const target = map.get(cat.id);
    if (!target) {
      map.set(cat.id, { ...cat, items: [...cat.items] });
      continue;
    }
    const known = new Set(target.items.map((i) => i.id));
    for (const item of cat.items) if (!known.has(item.id)) target.items.push(item);
  }
  return [...map.values()];
};

/** Safe hex or a sensible default — storefront never breaks on odd brand data. */
const brandColor = (value, fallback) =>
  /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;

const loadCart = (slug) => {
  try {
    const raw = window.localStorage.getItem(CART_KEY(slug));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveCart = (slug, cart) => {
  try {
    window.localStorage.setItem(CART_KEY(slug), JSON.stringify(cart));
  } catch {
    /* storage unavailable */
  }
};

const fmtMoney = (n) => `৳ ${Number(n).toFixed(2)}`;

/** Line display price = base + variant adjustment + add-ons (display only). */
const linePrice = (item, variantId, addonIds) => {
  let price = Number(item.price);
  if (variantId) {
    const v = (item.variants || []).find((x) => x.id === variantId);
    price += Number(v?.priceAdjustment || 0);
  }
  for (const id of addonIds || []) {
    const a = (item.addons || []).find((x) => x.id === id);
    price += Number(a?.price || 0);
  }
  return price;
};

/**
 * Storefront scarcity cue (Phase 4 follow-up). Product-level inventory is
 * informational (the backend enforces per-variant stock, not the product
 * snapshot): when a tracked quantity is low we show "Only N left" urgency;
 * at zero we show "Sold out" and block the add button so a merchant who
 * zeroed a dish's stock stops taking orders for it in the UI.
 */
function ScarcityCue({ stock, lowStockAt, t }) {
  if (stock === null || stock === undefined) return null;
  const qty = Number(stock);
  const low = Number(lowStockAt ?? 0);
  if (qty <= 0) return <div className="dish__stock dish__stock--out">{t('store.soldOut')}</div>;
  const scarce = low > 0 ? qty <= low : qty <= 5;
  if (!scarce) return null;
  return <div className="dish__stock dish__stock--low">{t('store.onlyLeft', qty)}</div>;
}

/** Is a variant sold out (tracked stock at zero)? */
const variantOut = (v) => v?.stock !== null && v?.stock !== undefined && Number(v.stock) <= 0;

/** Is a variant low on stock (tracked, at/below threshold or ≤5)? */
const variantLow = (v) => {
  if (v?.stock === null || v?.stock === undefined) return false;
  const qty = Number(v.stock);
  if (qty <= 0) return false;
  const low = Number(v.lowStockAt ?? 0);
  return low > 0 ? qty <= low : qty <= 5;
};

/** Item options modal — variant + add-ons + quantity. */
function ItemModal({ item, initial, onConfirm, onClose, t }) {
  const [variantId, setVariantId] = useState(initial?.variant_id ?? null);
  const [addonIds, setAddonIds] = useState(initial?.addon_ids ?? []);
  const [qty, setQty] = useState(initial?.quantity ?? 1);

  const toggleAddon = (id) =>
    setAddonIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const confirmDisabled =
    (item.variants?.length > 0 && !variantId) || (variantId ? variantOut(item.variants.find((v) => v.id === variantId)) : false);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(10,25,23,0.55)', backdropFilter: 'blur(3px)',
        display: 'grid', placeItems: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--card, #fdfaf3)', borderRadius: 20, padding: 24,
          boxShadow: '0 24px 60px rgba(20,16,6,0.28)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, fontFamily: "'Bricolage Grotesque', 'Plus Jakarta Sans', sans-serif" }}>{item.name}</h3>
            {item.description && (
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>{item.description}</p>
            )}
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        {item.variants?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>{t('store.chooseVariant')}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {(item.variants || []).map((v) => {
                const out = variantOut(v);
                const low = variantLow(v);
                return (
                  <button
                    key={v.id}
                    onClick={() => !out && setVariantId(v.id)}
                    disabled={out}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      border: `1.5px solid ${variantId === v.id ? 'var(--brand)' : 'var(--border-strong, #b9e0da)'}`,
                      background: variantId === v.id ? 'color-mix(in srgb, var(--brand) 8%, var(--card))' : 'var(--card)',
                      borderRadius: 12, padding: '10px 14px', cursor: out ? 'not-allowed' : 'pointer',
                      opacity: out ? 0.55 : 1,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 14 }}>
                      {v.name}
                      {out && <span className="vstock vstock--out"> {t('store.soldOut')}</span>}
                      {!out && low && <span className="vstock vstock--low"> {t('store.onlyLeft', v.stock)}</span>}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>
                      {v.priceAdjustment > 0 ? `+${fmtMoney(v.priceAdjustment)}` : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {item.addons?.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>{t('store.chooseAddons')}</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {(item.addons || []).map((a) => (
                <label
                  key={a.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    border: '1.5px solid var(--border-strong, #b9e0da)', borderRadius: 12,
                    background: 'var(--card)',
                    padding: '10px 14px', cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    <input
                      type="checkbox"
                      checked={addonIds.includes(a.id)}
                      onChange={() => toggleAddon(a.id)}
                      style={{ marginRight: 10, accentColor: 'var(--brand)' }}
                    />
                    {a.name}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{fmtMoney(a.price)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid var(--border-strong, #b9e0da)', borderRadius: 999 }}>
            <button onClick={() => setQty((q) => Math.max(1, q - 1))} style={{ ...qtyBtn, borderRadius: '999px 0 0 999px' }}>−</button>
            <span style={{ minWidth: 40, textAlign: 'center', fontWeight: 800 }}>{qty}</span>
            <button onClick={() => setQty((q) => Math.min(99, q + 1))} style={{ ...qtyBtn, borderRadius: '0 999px 999px 0' }}>+</button>
          </div>
          <button
            onClick={() => !confirmDisabled && onConfirm({ variant_id: variantId, addon_ids: addonIds, quantity: qty })}
            disabled={confirmDisabled}
            style={{
              flex: 1, background: 'var(--brand)', color: '#fff', border: 'none',
              borderRadius: 999, padding: '12px 20px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              opacity: confirmDisabled ? 0.5 : 1,
            }}
          >
            {t('store.addToCart')} · {fmtMoney(linePrice(item, variantId, addonIds) * qty)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Local date 'YYYY-MM-DD' for a Date (offset-safe). */
const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** Is the hour slot (0–23) inside any of the item's open segments? */
const slotOpen = (hour, windows) =>
  (windows || []).some((w) => {
    const from = toMin(w.from);
    const to = toMin(w.to) ?? 24 * 60;
    return from !== null && hour * 60 >= from && hour * 60 < to;
  });

/**
 * Per-dish availability calendar (Phase 5 follow-up): next 7 days as chips,
 * each day's effective open windows as an hourly slot grid — one read-only
 * request per day to the public availability API (windows mode). Customers
 * plan a scheduled pickup/delivery before adding anything to the cart.
 */
function AvailabilityModal({ item, slug, t, onClose }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return { date: localDate(d), day: d.getDay(), dateNo: d.getDate(), today: i === 0 };
  });
  const [active, setActive] = useState(0);
  const [windows, setWindows] = useState(null);
  const [restaurantClosed, setRestaurantClosed] = useState(false);
  const [loading, setLoading] = useState(true); // first fetch fires on mount

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    axios
      .get(`/api/public/restaurants/${slug}/availability`, {
        params: { date: days[active].date },
      })
      .then((res) => {
        if (!mounted) return;
        setRestaurantClosed(!!res.data.restaurantClosed);
        const found = (res.data.items || []).find((i) => i.id === item.id);
        setWindows(found?.windows || []);
      })
      .catch(() => {
        if (!mounted) return;
        setWindows([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, slug]);

  const allDay =
    windows?.length === 1 && windows[0].from === '00:00' && windows[0].to === '24:00';

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(10,25,23,0.55)', backdropFilter: 'blur(3px)',
        display: 'grid', placeItems: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, maxHeight: '85vh', overflowY: 'auto',
          background: 'var(--card, #fdfaf3)', borderRadius: 20, padding: 24,
          boxShadow: '0 24px 60px rgba(20,16,6,0.28)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, fontFamily: "'Bricolage Grotesque', 'Plus Jakarta Sans', sans-serif" }}>
              📅 {t('store.timesTitle')}
            </h3>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>
              {item.name} · {t('store.timesDesc')}
            </p>
          </div>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 18, flexWrap: 'wrap' }}>
          {days.map((d, i) => (
            <button
              key={d.date}
              onClick={() => setActive(i)}
              style={{
                border: `1.5px solid ${i === active ? 'var(--brand)' : 'var(--border-strong, #b9e0da)'}`,
                background: i === active ? 'color-mix(in srgb, var(--brand) 8%, var(--card))' : 'var(--card)',
                borderRadius: 999,
                padding: '7px 12px',
                fontSize: 12.5,
                fontWeight: 800,
                cursor: 'pointer',
                color: i === active ? 'var(--brand)' : 'inherit',
              }}
            >
              {t('store.daysShort')[d.day]} {d.today ? `· ${t('store.today')}` : d.dateNo}
            </button>
          ))}
        </div>

        <div style={{ marginTop: 16 }}>
          {loading || windows === null ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>{t('store.loading')}</div>
          ) : restaurantClosed ? (
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--chilli, #c3272b)', padding: '12px 0' }}>
              🔒 {t('store.timesRestaurantClosed')}
            </div>
          ) : windows.length === 0 ? (
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-muted, #7d9a95)', padding: '12px 0' }}>
              {t('store.timesNoWindows')}
            </div>
          ) : (
            <>
              {allDay ? (
                <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--brand)', padding: '12px 0' }}>
                  ✓ {t('store.timesAllDay')}
                </div>
              ) : (
                <>
                  <div className="times-legend" style={{ fontSize: 12, color: 'var(--text-muted, #7d9a95)', marginBottom: 8 }}>
                    {windows
                      .map((w) => `${w.from} – ${w.to === '24:00' ? '23:59' : w.to}`)
                      .join(' · ')}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        style={{
                          fontSize: 11,
                          fontWeight: 800,
                          textAlign: 'center',
                          padding: '6px 2px',
                          borderRadius: 8,
                          color: slotOpen(h, windows) ? '#fff' : 'var(--text-muted, #7d9a95)',
                          background: slotOpen(h, windows) ? 'var(--brand)' : 'var(--tile, #eef6f4)',
                        }}
                      >
                        {String(h).padStart(2, '0')}:00
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const closeBtn = {
  background: 'var(--surface-3, #e2f5f2)', border: 'none', width: 30, height: 30,
  borderRadius: '50%', cursor: 'pointer', fontSize: 13, flexShrink: 0,
};
const qtyBtn = {
  background: 'transparent', border: 'none', width: 38, height: 38,
  fontSize: 18, cursor: 'pointer', fontWeight: 800, color: 'var(--text, #123b36)',
};

export default function PublicMenuPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tableNo = searchParams.get('table');
  const { t, lang, toggleLang } = useI18n();
  const { paperPref, effectiveDark, cyclePaper } = usePaperTheme();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [activeCat, setActiveCat] = useState(null);
  const [total, setTotal] = useState(0);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [cart, setCart] = useState(() => loadCart(slug));
  const [modalItem, setModalItem] = useState(null);
  const [modalInitial, setModalInitial] = useState(null);
  // Per-dish availability calendar (Phase 5 follow-up): opened from the
  // "Check times" button, lets customers plan scheduled orders.
  const [timesItem, setTimesItem] = useState(null);
  // Print-coupon QR (Phase 5): fetched lazily, only used by @media print —
  // the tear-off "scan to order again" strip under the printed ticket.
  const [couponQr, setCouponQr] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    saveCart(slug, cart);
  }, [cart, slug]);

  const loadedCount = (data) =>
    data ? data.categories.reduce((n, c) => n + c.items.length, 0) : 0;

  const loadPage = async (offset, append) => {
    const res = await axios.get(`/api/public/restaurants/${slug}/menu`, {
      params: { limit: PAGE_SIZE, offset },
    });
    if (!mounted.current) return;
    const incoming = res.data;
    setState((prev) => ({
      loading: false,
      error: null,
      data: append && prev.data ? { ...incoming, categories: mergeCategories(prev.data, incoming.categories) } : incoming,
    }));
    setTotal(Number(res.headers['x-total-count']) || loadedCount(incoming));
    if (!append) {
      const first = incoming.categories.find((c) => c.items.length > 0);
      setActiveCat((prev) => prev ?? first?.id ?? null);
    }
  };

  useEffect(() => {
    mounted.current = true;
    setCart(loadCart(slug));
    setState({ loading: true, error: null, data: null });
    loadPage(0, false).catch((err) => {
      if (!mounted.current) return;
      setState({
        loading: false,
        error: err?.response?.status === 404 ? 'notFound' : 'load',
        data: null,
      });
    });
    // Print-coupon QR — best-effort, never blocks the menu.
    axios
      .get(`/api/public/restaurants/${slug}/qr${tableNo ? `?table=${tableNo}` : ''}`)
      .then((res) => {
        if (mounted.current) setCouponQr(res.data);
      })
      .catch(() => {
        /* no coupon in print — the ticket still prints */
      });
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const showMore = async () => {
    setFetchingMore(true);
    try {
      await loadPage(loadedCount(state.data), true);
    } catch {
      /* keep the current page — the button stays retryable */
    } finally {
      setFetchingMore(false);
    }
  };

  /** Adds a line to the cart, merging identical configurations. */
  const addLine = (item, { variant_id, addon_ids, quantity }) => {
    const variant = (item.variants || []).find((v) => v.id === variant_id);
    const addons = (item.addons || []).filter((a) => (addon_ids || []).includes(a.id));
    const line = {
      product_id: item.id,
      variant_id: variant_id ?? null,
      addon_ids: addon_ids ?? [],
      quantity,
      name: item.name,
      unit_price: linePrice(item, variant_id, addon_ids),
      imageUrl: item.imageUrl || null,
      options: [...(variant ? [variant.name] : []), ...addons.map((a) => a.name)],
    };
    setCart((c) => {
      const idx = c.findIndex(
        (l) =>
          l.product_id === line.product_id &&
          l.variant_id === line.variant_id &&
          JSON.stringify(l.addon_ids) === JSON.stringify(line.addon_ids)
      );
      if (idx === -1) return [...c, line];
      const next = [...c];
      next[idx] = { ...next[idx], quantity: Math.min(99, next[idx].quantity + line.quantity) };
      return next;
    });
    setModalItem(null);
  };

  const quickAdd = (item) => {
    const hasOptions = (item.variants?.length || 0) > 0 || (item.addons?.length || 0) > 0;
    if (hasOptions) {
      setModalInitial(null);
      setModalItem(item);
      return;
    }
    addLine(item, { variant_id: null, addon_ids: [], quantity: 1 });
  };

  if (state.loading) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 20px', display: 'grid', gap: 16 }}>
        <Skeleton height={40} width={260} />
        <Skeleton height={16} width={160} />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} height={90} />
        ))}
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div style={{ maxWidth: 480, margin: '120px auto', textAlign: 'center', display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 40 }}>🍽️</div>
        <h1 style={{ fontSize: 22, margin: 0 }}>
          {t(state.error === 'notFound' ? 'store.notFound' : 'store.couldNotLoad')}
        </h1>
        <p style={{ color: 'var(--text-muted, #7d9a95)', margin: 0 }}>
          {t('store.checkLink')}
        </p>
        <div style={{ marginTop: 8 }}>
          <Link to="/login" style={{ color: 'var(--primary, #00b3a5)', fontWeight: 700 }}>
            {t('store.merchantSignIn')} →
          </Link>
        </div>
      </div>
    );
  }

  const { restaurant, categories } = state.data;
  const closedToday = state.data.closedToday;
  const nextOpenAt = state.data.nextOpenAt;
  const brand = restaurant.brand || {};
  const primary = brandColor(brand.primaryColor, '#00b3a5');
  const accent = brandColor(brand.accentColor, '#f5d300');
  const active = categories.find((c) => c.id === activeCat) || categories[0];
  const price = (n) => fmtMoney(n);
  const catCount = categories.filter((c) => c.items.length > 0).length;
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const cartTotal = cart.reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0);

  return (
    <div
      className={`menu${effectiveDark ? ' menu--dark' : ''}`}
      style={{ '--brand': primary, '--brand-accent': accent }}
      data-paper={paperPref}
    >
      {/* Ticket-stub hero — the QR-scan first touch. The table number rides
          the stub like a real ticket; the scalloped tear is the perforation
          that separates "this table" from "the menu". Animated food orbs
          float behind it (reduced-motion aware). */}
      <header className="stub">
        <div className="stub__orbs" aria-hidden="true">
          <span className="stub__orb stub__orb--1">🍔</span>
          <span className="stub__orb stub__orb--2">🍟</span>
          <span className="stub__orb stub__orb--3">🍕</span>
          <span className="stub__orb stub__orb--4">🍗</span>
          <span className="stub__orb stub__orb--5">🥤</span>
        </div>
        <div className="stub__inner">
          <div className="stub__meta">
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
            {tableNo && (
              <span className="stub__table" title={t('store.scanToOrder')}>
                🪑 {t('store.table', tableNo)}
              </span>
            )}
          </div>
          <div className="stub__brand">
            {restaurant.logoUrl ? (
              <img src={restaurant.logoUrl} alt="" className="stub__logo" />
            ) : (
              <div className="stub__logo">🏪</div>
            )}
            <div className="stub__copy">
              <h1 className="stub__name">{restaurant.name}</h1>
              {brand.tagline && <div className="stub__tagline">{brand.tagline}</div>}
              <div className="stub__open">{t('store.openLine', catCount)}</div>
            </div>
          </div>
        </div>
        <div className="stub__tear" aria-hidden="true" />
      </header>

      <main className="menu__body">
        {/* Restaurant-wide closed state (Phase 5): closure date or weekday
            closure — the whole storefront is dark. The menu payload is
            already filtered, so this banner + the add-button gate are the
            customer-facing story. */}
        {closedToday && (
          <div className="closed-banner">
            <div className="closed-banner__icon">🔒</div>
            <div>
              <div className="closed-banner__title">{t('store.closedToday')}</div>
              <div className="closed-banner__desc">{t('store.closedTodayDesc')}</div>
              {nextOpenAt && (
                <div className="closed-banner__next">
                  {(() => {
                    const d = new Date(nextOpenAt);
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    return `🕐 ${t('store.backOpen', t('store.daysShort')[d.getDay()], `${hh}:${mm}`)}`;
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Category chips — paper tickets, the active one in the tenant brand */}
        <div className="chip-row">
          {categories
            .filter((c) => c.items.length > 0)
            .map((c) => (
              <button
                key={c.id ?? 'other'}
                onClick={() => setActiveCat(c.id)}
                className={`chip${c.id === activeCat ? ' chip--on' : ''}`}
              >
                {c.name}
                <span className="chip__count">{c.items.length}</span>
              </button>
            ))}
        </div>

        {/* Items — quiet paper rows under the ticket hero. Keying by category
            re-triggers the staggered reveal on every switch. */}
        {active ? (
          <section key={active.id} className="dish-list">
            <div className="section-head">
              <h2 className="section-head__title">
                {active.name}
                <span className="section-head__count">{active.items.length}</span>
              </h2>
            </div>
            {active.items.map((item, i) => (
              <div key={item.id} className="dish" style={{ '--i': i }}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} loading="lazy" className="dish__img" />
                ) : (
                  <div className="dish__img">🍔</div>
                )}
                <div className="dish__info">
                  <div className="dish__name">
                    <span>{item.name}</span>
                    {item.prepMinutes && (
                      <span className="dish__prep">⏱ {item.prepMinutes} min</span>
                    )}
                    <button
                      onClick={() => setTimesItem(item)}
                      className="dish__times"
                      aria-label={`${t('store.checkTimes')} · ${item.name}`}
                      title={t('store.checkTimes')}
                    >
                      📅 {t('store.checkTimes')}
                    </button>
                  </div>
                  {item.description && <div className="dish__desc">{item.description}</div>}
                  {item.addons.length > 0 && (
                    <div className="dish__opts">
                      {t('store.options')}: {item.addons.map((a) => `${a.name} +${price(a.price)}`).join(' · ')}
                    </div>
                  )}
                  <ScarcityCue stock={item.stock} lowStockAt={item.lowStockAt} t={t} />
                  <div className="dish__price">{price(item.price)}</div>
                </div>
                {closedToday || (item.stock !== null && Number(item.stock) <= 0) ? (
                  <button disabled className="dish__add dish__add--disabled">
                    {closedToday ? '—' : t('store.soldOut')}
                  </button>
                ) : (
                  <button onClick={() => quickAdd(item)} className="dish__add">
                    + {t('store.addToCart')}
                  </button>
                )}
              </div>
            ))}
          </section>
        ) : (
          <div className="menu__empty">{t('store.noItems')}</div>
        )}

        {/* Load-more pagination — driven by the API's X-Total-Count header. */}
        {loadedCount(state.data) < total && (
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button onClick={showMore} disabled={fetchingMore} className="more-btn">
              {fetchingMore ? t('store.loading') : t('store.showMore', total - loadedCount(state.data))}
            </button>
          </div>
        )}

        <footer className="menu__foot">
          <Link to="/track" className="menu__track">
            🛎️ {t('store.trackOrder')} →
          </Link>
          <div>
            <Link to="/login" style={{ color: 'inherit' }}>{t('store.merchantSignIn')}</Link> · {t('store.poweredBy')}
          </div>
        </footer>

        {/* Tear-off print coupon — hidden on screen, printed under the
            ticket so customers can scan and order again next visit. */}
        {couponQr && (
          <div className="stub__coupon" aria-hidden="true">
            <div className="stub__coupon-body">
              <div className="stub__coupon-copy">
                <div className="stub__coupon-title">{t('store.couponTitle')}</div>
                <div className="stub__coupon-sub">{restaurant.name}</div>
                {tableNo && <div className="stub__coupon-table">🪑 {t('store.table', tableNo)}</div>}
                <div className="stub__coupon-url">{couponQr.url}</div>
              </div>
              <img className="stub__coupon-qr" src={couponQr.svg} alt="" />
            </div>
          </div>
        )}
      </main>

      {/* Item options modal */}
      {modalItem && (
        <ItemModal
          item={modalItem}
          initial={modalInitial}
          t={t}
          onClose={() => setModalItem(null)}
          onConfirm={(sel) => addLine(modalItem, sel)}
        />
      )}

      {/* Per-dish availability calendar modal */}
      {timesItem && (
        <AvailabilityModal
          item={timesItem}
          slug={slug}
          t={t}
          onClose={() => setTimesItem(null)}
        />
      )}

      {/* Floating cart bar — pops in like a stamped ticket */}
      {cartCount > 0 && !closedToday && (
        <div className="cartbar">
          <button onClick={() => navigate(`/m/${slug}/checkout`)} className="cartbar__pill">
            🛒 {t('store.cart')} · {cartCount} {t('store.qty')} · {price(cartTotal)}
            <span className="cartbar__go">{t('store.checkout')} →</span>
          </button>
        </div>
      )}
    </div>
  );
}
