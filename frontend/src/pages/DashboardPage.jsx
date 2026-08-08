import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { PageHeader, Card, Skeleton, Badge } from '../components/ui';
import { TrendAreaChart, OrdersBarChart, StatusDonut } from '../components/charts';

const fmtTaka = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api
      .get('/dashboard')
      .then((res) => {
        if (mounted.current) setData(res.data);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  if (error) {
    return (
      <div className="oms-page">
        <PageHeader title={t('pages.dashboard')} desc={t('pages.dashboardDesc')} />
        <Card>
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            Could not load the dashboard.
          </div>
        </Card>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="oms-page">
        <PageHeader title={t('pages.dashboard')} desc={t('pages.dashboardDesc')} />
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

  const maxQty = Math.max(...data.topItems.map((x) => x.quantity), 1);
  const stats = [
    { label: t('dash.todayRevenue'), value: fmtTaka(data.today.revenue), tone: 'success' },
    { label: t('dash.todayOrders'), value: String(data.today.orders) },
    { label: t('dash.openOrders'), value: String(data.openOrders), tone: 'warning' },
    { label: t('dash.menuItems'), value: String(data.totalProducts) },
  ];

  const weekRevenue = (data.trend || []).reduce((s, d) => s + (Number(d.revenue) || 0), 0);
  const weekOrders = (data.trend || []).reduce((s, d) => s + (Number(d.orders) || 0), 0);

  return (
    <div className="oms-page">
      <PageHeader title={t('pages.dashboard')} desc={t('pages.dashboardDesc')} />

      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        {stats.map((s) => (
          <div key={s.label} className="oms-card">
            <div className="oms-card__body" style={{ padding: '18px 20px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                {s.label}
              </div>
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

      {/* 7-day analytics — revenue trend + order volume */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card
          title={t('dash.revenueTrend')}
          subtitle={`${t('dash.last7Days')} · ${fmtTaka(weekRevenue)} ${t('dash.total')}`}
        >
          <TrendAreaChart data={data.trend || []} />
        </Card>
        <Card
          title={t('dash.orderVolume')}
          subtitle={`${t('dash.last7Days')} · ${weekOrders} ${t('dash.ordersTotal')}`}
        >
          <OrdersBarChart data={data.trend || []} />
        </Card>
      </div>

      {/* Status breakdown + top items */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card title={t('dash.statusBreakdown')} subtitle={t('dash.statusSub')}>
          <StatusDonut data={data.statusBreakdown || []} />
        </Card>

        <Card title={t('dash.topItems')} subtitle={t('dash.topItemsSub')}>
          {data.topItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
              {t('dash.noData')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {data.topItems.map((item) => (
                <div key={item.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontWeight: 650 }}>{item.name}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {item.quantity} sold · {fmtTaka(item.revenue)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 999,
                      background: 'var(--surface-2)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max((item.quantity / maxQty) * 100, 4)}%`,
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
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <Badge tone="neutral">Phase 7: full analytics</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}
