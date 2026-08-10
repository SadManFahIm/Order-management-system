import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { PageHeader, Card, Skeleton, Badge } from '../components/ui';
import { TrendAreaChart } from '../components/charts';

const fmtTaka = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const STATUS_TONE = {
  active: 'success',
  trial: 'warning',
  suspended: 'danger',
  archived: 'neutral',
};

const METHOD_LABELS = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  online: 'Online',
  other: 'Other',
};

/**
 * Platform admin analytics (Phase 7) — the SaaS-wide view across every
 * workspace. Route is gated client-side by platform_role and server-side by
 * requireRole('platform_admin').
 */
export default function AdminAnalyticsPage() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(30);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    api
      .get('/admin/analytics', { params: { days } })
      .then((res) => {
        if (mounted.current) setData(res.data);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      });
    return () => {
      mounted.current = false;
    };
  }, [days]);

  if (error) {
    return (
      <div className="oms-page">
        <PageHeader title={t('pages.admin')} desc={t('pages.adminDesc')} />
        <Card>
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            Could not load platform analytics.
          </div>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="oms-page">
        <PageHeader title={t('pages.admin')} desc={t('pages.adminDesc')} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={110} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginTop: 16 }}>
          <Skeleton height={280} />
          <Skeleton height={280} />
        </div>
      </div>
    );
  }

  const { overview, trend, topRestaurants, methodMix, tenantStatusBreakdown } = data;
  const maxRest = Math.max(...topRestaurants.map((r) => r.revenue), 1);
  const stats = [
    { label: t('admin.tenants'), value: String(overview.tenants), tone: 'default' },
    { label: t('admin.activeTenants'), value: String(overview.activeTenants), tone: 'success' },
    { label: t('admin.revenueWindow'), value: fmtTaka(overview.revenueWindow), tone: 'success' },
    { label: t('admin.ordersWindow'), value: String(overview.ordersWindow) },
  ];

  return (
    <div className="oms-page">
      <PageHeader
        title={t('pages.admin')}
        desc={t('pages.adminDesc')}
        actions={
          <Badge tone="primary">Platform · {overview.allTimeOrders} {t('admin.allTimeOrders')}</Badge>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        {stats.map((s) => (
          <div key={s.label} className="oms-card">
            <div className="oms-card__body" style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>{s.label}</div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  marginTop: 6,
                  fontVariantNumeric: 'tabular-nums',
                  color: s.tone === 'success' ? 'var(--success)' : 'var(--text)',
                }}
              >
                {s.value}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Platform revenue trend */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
        <Card
          title={t('admin.platformTrend')}
          subtitle={`${t('admin.platformTrendSub')} · ${overview.days} ${t('dash.days')}`}
          actions={
            <div style={{ display: 'flex', gap: 6 }}>
              {[7, 30].map((n) => (
                <button
                  key={n}
                  onClick={() => setDays(n)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 700,
                    background: days === n ? 'var(--primary)' : 'var(--surface-2)',
                    color: days === n ? '#fff' : 'var(--text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {n} {t('dash.days')}
                </button>
              ))}
            </div>
          }
        >
          <TrendAreaChart data={trend} />
        </Card>

        <Card title={t('admin.tenantStatus')} subtitle={t('admin.tenantStatusSub')}>
          <div style={{ display: 'grid', gap: 12 }}>
            {tenantStatusBreakdown.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>{t('dash.noData')}</div>
            ) : (
              tenantStatusBreakdown.map((s) => (
                <div key={s.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Badge tone={STATUS_TONE[s.status] || 'neutral'}>{s.status}</Badge>
                  <span style={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Top restaurants + platform method mix */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginTop: 16 }}>
        <Card title={t('admin.topRestaurants')} subtitle={t('admin.topRestaurantsSub')}>
          {topRestaurants.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>{t('dash.noData')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {topRestaurants.map((r) => (
                <div key={r.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontWeight: 650 }}>{r.name}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {r.orders} · {fmtTaka(r.revenue)}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max((r.revenue / maxRest) * 100, 4)}%`,
                        borderRadius: 999,
                        background: 'linear-gradient(90deg, var(--primary), var(--accent))',
                        transition: 'width .5s var(--ease-out)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t('admin.methodMix')} subtitle={t('admin.methodMixSub')}>
          {methodMix.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>{t('dash.noData')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {methodMix.map((m) => (
                <div key={m.method} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Badge tone="neutral">{METHOD_LABELS[m.method] || m.method}</Badge>
                  <span style={{ fontSize: 13.5, color: 'var(--text-muted)' }}>
                    {m.count} · <strong style={{ color: 'var(--text)' }}>{fmtTaka(m.amount)}</strong>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
