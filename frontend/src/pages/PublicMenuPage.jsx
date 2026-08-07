import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { Skeleton } from '../components/ui';

/**
 * Public storefront menu (Phase 4) — consumes the read-only public API
 * (`/api/public/restaurants/:slug/menu`), no auth required. A taste of the
 * Wolt/Deliveroo-style customer experience for any active restaurant.
 */
export default function PublicMenuPage() {
  const { slug } = useParams();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [activeCat, setActiveCat] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setState({ loading: true, error: null, data: null });
    axios
      .get(`/api/public/restaurants/${slug}/menu`)
      .then((res) => {
        if (!mounted.current) return;
        setState({ loading: false, error: null, data: res.data });
        const first = res.data.categories.find((c) => c.items.length > 0);
        setActiveCat(first?.id ?? null);
      })
      .catch((err) => {
        if (!mounted.current) return;
        setState({
          loading: false,
          error: err?.response?.status === 404 ? 'Restaurant not found' : 'Could not load menu',
          data: null,
        });
      });
    return () => {
      mounted.current = false;
    };
  }, [slug]);

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
        <h1 style={{ fontSize: 22, margin: 0 }}>{state.error}</h1>
        <p style={{ color: 'var(--text-muted, #7d9a95)', margin: 0 }}>
          Check the link — the restaurant may not be accepting orders right now.
        </p>
        <div style={{ marginTop: 8 }}>
          <Link to="/login" style={{ color: 'var(--primary, #00b3a5)', fontWeight: 700 }}>
            Merchant sign in →
          </Link>
        </div>
      </div>
    );
  }

  const { restaurant, categories } = state.data;
  const active = categories.find((c) => c.id === activeCat) || categories[0];
  const price = (n) => `৳ ${Number(n).toFixed(2)}`;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #f5fbfa)' }}>
      {/* Hero — Deliveroo-style teal gradient */}
      <div
        style={{
          background: 'linear-gradient(135deg, #008a7f 0%, #00b3a5 55%, #00e0cf 100%)',
          color: '#fff',
          padding: '52px 20px 40px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute', right: -60, top: -60, width: 260, height: 260, borderRadius: '50%',
            background: 'rgba(245, 211, 0, 0.18)',
          }}
        />
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
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 800 }}>{restaurant.name}</h1>
            <div style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>
              Open · {categories.filter((c) => c.items.length > 0).length} categories · live from the public menu API
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 20px 60px' }}>
        {/* Category chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {categories
            .filter((c) => c.items.length > 0)
            .map((c) => (
              <button
                key={c.id ?? 'other'}
                onClick={() => setActiveCat(c.id)}
                style={{
                  border: '1px solid var(--border-strong, #b9e0da)',
                  background: c.id === activeCat ? 'var(--primary, #00b3a5)' : '#fff',
                  color: c.id === activeCat ? '#fff' : 'var(--text, #123b36)',
                  borderRadius: 999,
                  padding: '8px 18px',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: c.id === activeCat ? '0 4px 12px rgba(0,179,165,0.3)' : 'none',
                  transition: 'all .18s ease',
                }}
                onMouseEnter={(e) => {
                  if (c.id !== activeCat) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.borderColor = 'var(--primary, #00b3a5)';
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
                      Options: {item.addons.map((a) => `${a.name} +${price(a.price)}`).join(' · ')}
                    </div>
                  )}
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{price(item.price)}</div>
                </div>
                <div
                  style={{
                    borderRadius: 999,
                    border: '1px solid var(--border-strong, #b9e0da)',
                    padding: '7px 14px',
                    fontSize: 13,
                    fontWeight: 700,
                    color: 'var(--text, #123b36)',
                    background: 'var(--surface-2, #f0faf8)',
                    cursor: 'default',
                  }}
                >
                  {item.weightGm} gm
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted, #7d9a95)' }}>
            No menu items available right now.
          </div>
        )}

        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 13, color: 'var(--text-muted, #7d9a95)' }}>
          <Link to="/login" style={{ color: 'inherit' }}>Merchant sign in</Link> · powered by the public menu API
        </div>
      </div>
    </div>
  );
}
