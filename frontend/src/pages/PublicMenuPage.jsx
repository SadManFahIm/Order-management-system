import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Skeleton } from '../components/ui';
import { useI18n, LANGUAGES } from '../i18n';

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

/** Item options modal — variant + add-ons + quantity. */
function ItemModal({ item, initial, onConfirm, onClose, t }) {
  const [variantId, setVariantId] = useState(initial?.variant_id ?? null);
  const [addonIds, setAddonIds] = useState(initial?.addon_ids ?? []);
  const [qty, setQty] = useState(initial?.quantity ?? 1);

  const toggleAddon = (id) =>
    setAddonIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

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
          background: '#fff', borderRadius: 20, padding: 24,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{item.name}</h3>
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
              {(item.variants || []).map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVariantId(v.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    border: `1.5px solid ${variantId === v.id ? 'var(--brand)' : 'var(--border-strong, #b9e0da)'}`,
                    background: variantId === v.id ? 'color-mix(in srgb, var(--brand) 8%, #fff)' : '#fff',
                    borderRadius: 12, padding: '10px 14px', cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{v.name}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>
                    {v.priceAdjustment > 0 ? `+${fmtMoney(v.priceAdjustment)}` : '—'}
                  </span>
                </button>
              ))}
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
            onClick={() => onConfirm({ variant_id: variantId, addon_ids: addonIds, quantity: qty })}
            style={{
              flex: 1, background: 'var(--brand)', color: '#fff', border: 'none',
              borderRadius: 999, padding: '12px 20px', fontSize: 15, fontWeight: 800, cursor: 'pointer',
            }}
          >
            {t('store.addToCart')} · {fmtMoney(linePrice(item, variantId, addonIds) * qty)}
          </button>
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
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [activeCat, setActiveCat] = useState(null);
  const [total, setTotal] = useState(0);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [cart, setCart] = useState(() => loadCart(slug));
  const [modalItem, setModalItem] = useState(null);
  const [modalInitial, setModalInitial] = useState(null);
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
    setTotal(0);
    loadPage(0, false).catch((err) => {
      if (!mounted.current) return;
      setState({
        loading: false,
        error: err?.response?.status === 404 ? 'notFound' : 'load',
        data: null,
      });
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
  const brand = restaurant.brand || {};
  const primary = brandColor(brand.primaryColor, '#00b3a5');
  const accent = brandColor(brand.accentColor, '#f5d300');
  const active = categories.find((c) => c.id === activeCat) || categories[0];
  const price = (n) => fmtMoney(n);
  const catCount = categories.filter((c) => c.items.length > 0).length;
  const cartCount = cart.reduce((s, l) => s + l.quantity, 0);
  const cartTotal = cart.reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f5fbfa)', '--brand': primary, '--brand-accent': accent }}>
      {/* Hero — themed by the tenant's brand settings */}
      <div
        style={{
          background: `linear-gradient(135deg, var(--brand) 0%, color-mix(in srgb, var(--brand) 58%, var(--brand-accent)) 100%)`,
          color: '#fff',
          padding: '52px 20px 40px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute', right: -60, top: -60, width: 260, height: 260, borderRadius: '50%',
            background: 'rgba(255,255,255,0.14)',
          }}
        />
        {/* Language toggle — customer-facing (English / বাংলা). */}
        <button
          onClick={toggleLang}
          aria-label={lang === 'en' ? 'বাংলায় দেখুন' : 'Switch to English'}
          title={lang === 'en' ? 'বাংলা' : 'English'}
          style={{
            position: 'absolute', top: 18, right: 18,
            background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.35)',
            color: '#fff', borderRadius: 999, padding: '7px 14px',
            fontSize: 12.5, fontWeight: 800, cursor: 'pointer', backdropFilter: 'blur(6px)',
            transition: 'background .15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.28)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.16)'; }}
        >
          {LANGUAGES.find((l) => l.code !== lang)?.short}
        </button>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', gap: 20, alignItems: 'center', position: 'relative' }}>
          {restaurant.logoUrl ? (
            <img
              src={restaurant.logoUrl}
              alt=""
              style={{ width: 76, height: 76, borderRadius: 20, objectFit: 'cover', background: '#fff2', boxShadow: '0 8px 20px rgba(0,0,0,0.18)' }}
            />
          ) : (
            <div
              style={{
                width: 76, height: 76, borderRadius: 20,
                background: 'rgba(255,255,255,0.2)', display: 'grid', placeItems: 'center', fontSize: 34,
                boxShadow: '0 8px 20px rgba(0,0,0,0.18)',
              }}
            >
              🏪
            </div>
          )}
          <div style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>{restaurant.name}</h1>
              {tableNo && (
                <span
                  title={t('store.scanToOrder')}
                  style={{
                    background: 'rgba(255,255,255,0.22)', border: '1px solid rgba(255,255,255,0.45)',
                    borderRadius: 999, padding: '5px 14px', fontSize: 13, fontWeight: 800,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  🪑 {t('store.table', tableNo)}
                </span>
              )}
            </div>
            {brand.tagline && (
              <div style={{ color: 'rgba(255,255,255,0.95)', fontSize: 15, fontWeight: 600 }}>
                {brand.tagline}
              </div>
            )}
            <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>
              {t('store.openLine', catCount)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px 120px' }}>
        {/* Category chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {categories
            .filter((c) => c.items.length > 0)
            .map((c) => (
              <button
                key={c.id ?? 'other'}
                onClick={() => setActiveCat(c.id)}
                style={{
                  border: `1px solid ${c.id === activeCat ? 'var(--brand)' : 'var(--border-strong, #b9e0da)'}`,
                  background: c.id === activeCat ? 'var(--brand)' : '#fff',
                  color: c.id === activeCat ? '#fff' : 'var(--text, #123b36)',
                  borderRadius: 999,
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: c.id === activeCat ? '0 4px 12px color-mix(in srgb, var(--brand) 35%, transparent)' : 'none',
                  transition: 'all .18s ease',
                }}
                onMouseEnter={(e) => {
                  if (c.id !== activeCat) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.borderColor = 'var(--brand)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.borderColor = 'var(--border-strong, #b9e0da)';
                }}
              >
                {c.name}
                <span style={{ opacity: 0.7, marginLeft: 6, fontWeight: 500 }}>{c.items.length}</span>
              </button>
            ))}
        </div>

        {/* Items */}
        {active ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ fontSize: 20, margin: '0 0 4px' }}>{active.name}</h2>
            {active.items.map((item) => (
              <div
                key={item.id}
                style={{
                  background: '#fff',
                  border: '1px solid var(--border, #d8eeea)',
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  gap: 16,
                  alignItems: 'center',
                  transition: 'transform .15s ease, box-shadow .15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(15,23,42,0.08)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    loading="lazy"
                    style={{ width: 76, height: 76, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }}
                  />
                ) : (
                  <div
                    style={{
                      width: 76, height: 76, borderRadius: 12,
                      background: 'var(--surface-3, #e2f5f2)', display: 'grid', placeItems: 'center', fontSize: 24, flexShrink: 0,
                    }}
                  >
                    🍔
                  </div>
                )}
                <div style={{ flex: 1, display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{item.name}</span>
                    {item.prepMinutes && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted, #7d9a95)' }}>
                        ⏱ {item.prepMinutes} min
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <div style={{ fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>{item.description}</div>
                  )}
                  {item.addons.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #7d9a95)' }}>
                      {t('store.options')}: {item.addons.map((a) => `${a.name} +${price(a.price)}`).join(' · ')}
                    </div>
                  )}
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{price(item.price)}</div>
                </div>
                <button
                  onClick={() => quickAdd(item)}
                  style={{
                    borderRadius: 999,
                    border: '1.5px solid var(--brand)',
                    padding: '8px 18px',
                    fontSize: 13.5,
                    fontWeight: 800,
                    color: 'var(--brand)',
                    background: 'color-mix(in srgb, var(--brand) 8%, #fff)',
                    cursor: 'pointer',
                    transition: 'all .15s ease',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--brand)';
                    e.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'color-mix(in srgb, var(--brand) 8%, #fff)';
                    e.currentTarget.style.color = 'var(--brand)';
                  }}
                >
                  + {t('store.addToCart')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted, #7d9a95)' }}>
            {t('store.noItems')}
          </div>
        )}

        {/* Load-more pagination — driven by the API's X-Total-Count header. */}
        {loadedCount(state.data) < total && (
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button
              onClick={showMore}
              disabled={fetchingMore}
              style={{
                border: '1px solid var(--brand)',
                background: 'var(--brand)',
                color: '#fff',
                borderRadius: 999,
                padding: '10px 26px',
                fontSize: 14,
                fontWeight: 700,
                cursor: fetchingMore ? 'wait' : 'pointer',
                boxShadow: '0 6px 16px color-mix(in srgb, var(--brand) 35%, transparent)',
                transition: 'transform .15s ease, box-shadow .15s ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 10px 22px color-mix(in srgb, var(--brand) 45%, transparent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 16px color-mix(in srgb, var(--brand) 35%, transparent)'; }}
            >
              {fetchingMore ? t('store.loading') : t('store.showMore', total - loadedCount(state.data))}
            </button>
          </div>
        )}

        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 13, color: 'var(--text-muted, #7d9a95)', display: 'grid', gap: 6 }}>
          <Link to="/track" style={{ color: 'var(--brand)', fontWeight: 700 }}>
            🛎️ {t('store.trackOrder')} →
          </Link>
          <div>
            <Link to="/login" style={{ color: 'inherit' }}>{t('store.merchantSignIn')}</Link> · {t('store.poweredBy')}
          </div>
        </div>
      </div>

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

      {/* Floating cart bar */}
      {cartCount > 0 && (
        <div
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50,
            padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
            background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.96) 30%)',
            display: 'flex', justifyContent: 'center', pointerEvents: 'none',
          }}
        >
          <button
            onClick={() => navigate(`/m/${slug}/checkout`)}
            style={{
              pointerEvents: 'auto',
              background: 'var(--brand)', color: '#fff', border: 'none',
              borderRadius: 999, padding: '14px 26px', fontSize: 15, fontWeight: 800,
              boxShadow: '0 10px 28px color-mix(in srgb, var(--brand) 45%, transparent)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              transition: 'transform .15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
          >
            🛒 {t('store.cart')} · {cartCount} {t('store.qty')} · {price(cartTotal)}
            <span style={{ background: 'rgba(255,255,255,0.22)', borderRadius: 999, padding: '4px 12px', fontSize: 13 }}>
              {t('store.checkout')} →
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
