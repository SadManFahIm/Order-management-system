import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { PageHeader, Card, Skeleton, Badge } from '../components/ui';
import { TrendAreaChart, OrdersBarChart, StatusDonut, CloseoutTrendChart } from '../components/charts';

const fmtTaka = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    api
      .get('/dashboard', { params: { days } })
      .then((res) => {
        if (mounted.current) setData(res.data);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [days]);

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

  const ts = data.trendStats || {};
  const dod = ts.dayOverDay || {};
  const dodTone = dod.delta > 0 ? 'success' : dod.delta < 0 ? 'danger' : 'neutral';
  const dodLabel =
    dod.pct !== null && dod.pct !== undefined
      ? `${dod.delta > 0 ? '▲' : dod.delta < 0 ? '▼' : '—'} ${fmtTaka(Math.abs(dod.delta))} (${dod.pct > 0 ? '+' : ''}${dod.pct}%)`
      : `${fmtTaka(Math.abs(dod.delta))}`;

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

      {/* Closeout trend — daily revenue by payment method (Phase 5) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card
          title={t('dash.closeoutTrend')}
          subtitle={`${t('dash.closeoutTrendSub')} · ${ts.days || days} ${t('dash.days')}`}
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
          {loading && !data ? (
            <Skeleton height={240} />
          ) : (
            <CloseoutTrendChart data={data.closeoutTrend || []} />
          )}
        </Card>

        <Card title={t('dash.trendStats')} subtitle={t('dash.trendStatsSub')}>
          <div style={{ display: 'grid', gap: 14 }}>
            <StatRow label={t('dash.totalRevenue')} value={fmtTaka(ts.totalRevenue || 0)} strong />
            <StatRow label={t('dash.avgPerDay')} value={fmtTaka(ts.avgPerDay || 0)} />
            <StatRow
              label={t('dash.bestDay')}
              value={ts.bestDay ? `${ts.bestDay.date} · ${fmtTaka(ts.bestDay.revenue)}` : '—'}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <span style={{ fontSize: 13.5, fontWeight: 650 }}>{t('dash.dayOverDay')}</span>
              <Badge tone={dodTone}>{dodLabel}</Badge>
            </div>
          </div>
        </Card>
      </div>

      {/* Revenue by payment method — bKash/Nagad/cash mix (Phase 5) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card title={t('dash.paymentBreakdown')} subtitle={t('dash.paymentBreakdownSub')}>
          {(data.paymentBreakdown || []).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
              {t('dash.noData')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {data.paymentBreakdown.map((m) => (
                <div key={m.method}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ fontWeight: 650 }}>{methodLabel(t, m.method)}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      {m.count} · {fmtTaka(m.amount)}
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
                        width: `${Math.max(
                          (m.amount / Math.max(...data.paymentBreakdown.map((x) => x.amount), 1)) * 100,
                          4
                        )}%`,
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
      </div>
    </div>
  );
}

const METHOD_LABELS = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  other: 'Other',
};

function StatRow({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <span style={{ fontSize: 13.5, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 650, fontSize: strong ? 17 : 14, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

function methodLabel(t, method) {
  const key = `orders.pay${String(method || 'other').charAt(0).toUpperCase()}${String(method || 'other').slice(1)}`;
  return t(key) !== key ? t(key) : METHOD_LABELS[method] || method || 'Other';
}
