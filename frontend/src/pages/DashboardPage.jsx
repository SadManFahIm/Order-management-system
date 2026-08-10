import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { PageHeader, Card, Skeleton, Badge } from '../components/ui';
import { TrendAreaChart, OrdersBarChart, StatusDonut, CloseoutTrendChart, PeakHoursHeatmap, CategoryMixDonut } from '../components/charts';

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
    let timer;
    const load = (silent) => {
      if (!silent) setLoading(true);
      api
        .get('/dashboard', { params: { days } })
        .then((res) => {
          if (mounted.current) setData(res.data);
        })
        .catch(() => {
          if (mounted.current && !silent) setError(true);
        })
        .finally(() => {
          if (mounted.current && !silent) setLoading(false);
        });
    };
    load(false);
    // Live refresh — keeps the open-orders queue + alerts current (Phase 7).
    timer = setInterval(() => load(true), 30000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
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
  const mom = data.monthOverMonth || {};
  const dodTone = dod.delta > 0 ? 'success' : dod.delta < 0 ? 'danger' : 'neutral';
  const dodLabel =
    dod.pct !== null && dod.pct !== undefined
      ? `${dod.delta > 0 ? '▲' : dod.delta < 0 ? '▼' : '—'} ${fmtTaka(Math.abs(dod.delta))} (${dod.pct > 0 ? '+' : ''}${dod.pct}%)`
      : `${fmtTaka(Math.abs(dod.delta))}`;

  return (
    <div className="oms-page">
      <PageHeader title={t('pages.dashboard')} desc={t('pages.dashboardDesc')} />

      {/* Dashboard alerts (Phase 7) — low stock / cancellations / idle */}
      {(data.alerts || []).length > 0 && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {data.alerts.map((a) => (
            <AlertBanner key={a.code} alert={a} t={t} />
          ))}
        </div>
      )}

      {/* Live fulfillment queue (Phase 7) — auto-refreshes every 30s */}
      <Card
        title={t('dash.livePanel')}
        subtitle={t('dash.livePanelSub')}
        style={{ marginBottom: 16 }}
      >
        {(data.livePanel || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>
            {t('dash.liveEmpty')}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {data.livePanel.map((o) => (
              <div
                key={o.order_no}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  borderRadius: 12,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                }}
              >
                <span style={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
                  {o.order_no}
                </span>
                <Badge tone={o.status === 'placed' ? 'neutral' : o.status === 'preparing' ? 'warning' : 'success'}>
                  {o.status}
                </Badge>
                {o.table_no ? <Badge tone="neutral">🪑 {o.table_no}</Badge> : null}
                <span style={{ flex: 1, color: 'var(--text-muted)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {o.customer_name}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {o.itemQty} {t('dash.itemsTotal')} · {fmtTaka(o.total)}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {o.minutesOpen} {t('dash.minutesAgo')}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

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
            <CloseoutTrendChart data={data.closeoutTrend || []} forecast={data.forecast} />
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-muted)', fontWeight: 600 }}>{t('dash.monthOverMonth')}</span>
              <span style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                {fmtTaka(mom.currentRevenue || 0)}
                {mom.pct !== null && mom.pct !== undefined ? (
                  <Badge tone={mom.pct >= 0 ? 'success' : 'danger'} style={{ marginLeft: 8 }}>
                    {mom.pct >= 0 ? '▲' : '▼'} {Math.abs(mom.pct)}%
                  </Badge>
                ) : null}
              </span>
            </div>
          </div>
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--border)',
              fontSize: 12.5,
              color: 'var(--text-muted)',
            }}
          >
            {t('dash.forecastHint')}{' '}
            {(data.forecast?.projection || [])
              .map((p) => fmtTaka(p.revenue))
              .join(' · ')}
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

      {/* Peak hours heatmap + category mix (Phase 7) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card title={t('dash.peakHours')} subtitle={t('dash.peakHoursSub')}>
          <PeakHoursHeatmap
            grid={data.peakHours?.grid || []}
            days={data.peakHours?.days || []}
            hours={data.peakHours?.hours || []}
            maxRevenue={data.peakHours?.maxRevenue || 0}
          />
          {data.peakHours?.busiest ? (
            <Badge tone="warning" style={{ marginTop: 12 }}>
              {t('dash.busiestHour')}: {data.peakHours.days[data.peakHours.busiest.day]}{' '}
              {String(data.peakHours.busiest.hour).padStart(2, '0')}:00 ·{' '}
              {fmtTaka(data.peakHours.busiest.revenue)}
            </Badge>
          ) : null}
        </Card>
        <Card title={t('dash.categoryMix')} subtitle={t('dash.categoryMixSub')}>
          <CategoryMixDonut data={data.categoryMix || []} />
        </Card>
      </div>

      {/* Customer retention + fulfillment time (Phase 7) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        <Card title={t('dash.retention')} subtitle={t('dash.retentionSub')}>
          {(data.retention?.totalCustomers || 0) === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
              {t('dash.noCustomers')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="oms-mini-stat">
                  <div className="oms-mini-stat__value">
                    {data.retention.repeatRate}%
                  </div>
                  <div className="oms-mini-stat__label">{t('dash.repeatRate')}</div>
                  <div className="oms-mini-stat__hint">
                    {data.retention.repeatCustomers}/{data.retention.totalCustomers}{' '}
                    {t('dash.repeatCustomers')}
                  </div>
                </div>
                <div className="oms-mini-stat">
                  <div className="oms-mini-stat__value">{fmtTaka(data.retention.avgOrderValue)}</div>
                  <div className="oms-mini-stat__label">{t('dash.avgOrderValue')}</div>
                  <div className="oms-mini-stat__hint">30 {t('dash.days')}</div>
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                  {t('dash.topCustomers')}
                </div>
                {data.retention.topCustomers.map((c) => (
                  <div
                    key={c.phone}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      padding: '5px 0',
                      fontSize: 13.5,
                    }}
                  >
                    <span style={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                      {c.phone}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {c.orders} × · {fmtTaka(c.revenue)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card title={t('dash.fulfillment')} subtitle={t('dash.fulfillmentSub')}>
          {(data.fulfillment?.types || []).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
              {t('dash.noData')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              <div className="oms-mini-stat">
                <div className="oms-mini-stat__value">
                  {data.fulfillment.overallAvgMinutes} {t('dash.minutes')}
                </div>
                <div className="oms-mini-stat__label">{t('dash.overallAvg')}</div>
              </div>
              {data.fulfillment.types.map((ft) => {
                const maxMin = Math.max(
                  ...data.fulfillment.types.map((x) => x.avgMinutes),
                  1
                );
                return (
                  <div key={ft.type}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontWeight: 650, textTransform: 'capitalize' }}>
                        {ft.type}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {ft.avgMinutes} {t('dash.minutes')} · {ft.orders}{' '}
                        {t('dash.ordersTotal')}
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
                          width: `${Math.max((ft.avgMinutes / maxMin) * 100, 4)}%`,
                          borderRadius: 999,
                          background: 'linear-gradient(90deg, var(--primary), var(--accent))',
                          transition: 'width .5s var(--ease-out)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
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

function AlertBanner({ alert, t }) {
  const danger = alert.severity === 'danger';
  const title =
    alert.code === 'LOW_STOCK'
      ? t('dash.alertLowStock')
      : alert.code === 'HIGH_CANCELLATION'
        ? t('dash.alertCancellation')
        : t('dash.alertIdle');
  const detail =
    alert.code === 'LOW_STOCK'
      ? t('dash.alertLowStockDetail').replace('{count}', String(alert.count))
      : alert.code === 'HIGH_CANCELLATION'
        ? t('dash.alertCancellationDetail')
            .replace('{rate}', String(alert.rate))
            .replace('{window}', String(alert.windowOrders))
        : t('dash.alertIdleDetail').replace('{hours}', String(alert.hours));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 14,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${danger ? 'var(--danger)' : 'var(--accent)'}`,
      }}
    >
      <span style={{ fontSize: 16 }}>{danger ? '⚠️' : '🔔'}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{detail}</div>
        {alert.items && (
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {alert.items.map((i) => (
              <span
                key={i.name}
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                {i.name} · {i.stock_qty}/{i.low_stock_at}
              </span>
            ))}
            {alert.count > 5 ? (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>+{alert.count - 5}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function methodLabel(t, method) {
  const key = `orders.pay${String(method || 'other').charAt(0).toUpperCase()}${String(method || 'other').slice(1)}`;
  return t(key) !== key ? t(key) : METHOD_LABELS[method] || method || 'Other';
}
