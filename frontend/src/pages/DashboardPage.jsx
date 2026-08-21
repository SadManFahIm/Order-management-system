import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { usePaper } from '../theme/PaperThemeContext';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Card, Skeleton, Badge, Button } from '../components/ui';
import { TrendAreaChart, OrdersBarChart, StatusDonut, CloseoutTrendChart, PeakHoursHeatmap, CategoryMixDonut, SplitMethodDonut, FunnelChart } from '../components/charts';
import AnalyticsFilterBar from '../components/AnalyticsFilterBar';
import ExportCsvButton from '../components/ExportCsvButton';

const fmtTaka = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const DEFAULT_FILTERS = { from: '', to: '', channel: 'all', orderType: 'all' };

export default function DashboardPage() {
  const { t } = useI18n();
  // The dashboard is the merchant ledger — it rides the global paper theme
  // (ink paper / rice paper), sharing the one toggle with the invoice and
  // the storefront ticket.
  const { effectiveDark, cyclePaper } = usePaper();
  const { tenants, activeTenantId } = useAuth();
  const workspaceName = tenants.find(
    (tn) => Number(tn.id) === Number(activeTenantId)
  )?.name;
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  // Phase 7: custom-range analytics (from/to/channel/order_type) served by
  // the /api/analytics/* endpoints. Null while loading or when the viewer
  // lacks view:analytics (cashiers see the legacy dashboard only).
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState(null);
  const hasRange = Boolean(filters.from && filters.to);
  const filterParams = hasRange
    ? {
        from: filters.from,
        to: filters.to,
        ...(filters.channel !== 'all' ? { channel: filters.channel } : {}),
        ...(filters.orderType !== 'all' ? { order_type: filters.orderType } : {}),
      }
    : {};

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

  // Analytics payload — refetched whenever the filter bar changes.
  useEffect(() => {
    mounted.current = true;
    setAnalyticsError(null);
    Promise.all([
      api.get('/analytics/summary', { params: filterParams }),
      api.get('/analytics/funnel', { params: filterParams }),
      api.get('/analytics/riders', { params: filterParams }),
      api.get('/analytics/anomalies'),
    ])
      .then(([summary, funnel, riders, anomalies]) => {
        if (!mounted.current) return;
        setAnalytics({
          summary: summary.data,
          funnel: funnel.data,
          riders: riders.data,
          anomalies: anomalies.data,
        });
      })
      .catch((err) => {
        if (!mounted.current) return;
        if (err?.response?.status === 403) {
          setAnalytics(null); // no view:analytics permission — hide sections
        } else {
          const msg = err?.response?.data?.error?.message;
          setAnalyticsError(msg || 'Could not load analytics for this range');
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.channel, filters.orderType]);

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

  // Phase 7: when a custom range is active, the historical charts render
  // from the filtered analytics API instead of the fixed ?days= dashboard.
  const summary = analytics?.summary;
  const trend = hasRange && summary ? summary.series : data.trend || [];
  const statusData = hasRange && summary ? summary.statusBreakdown : data.statusBreakdown || [];
  const methodData =
    hasRange && summary
      ? summary.methodMix.map((m) => ({ method: m.method, amount: m.amount, count: m.count }))
      : data.paymentBreakdown || [];
  const rangeKpis = summary?.summary;

  const ts = data.trendStats || {};
  const dod = ts.dayOverDay || {};
  const mom = data.monthOverMonth || {};
  const dodTone = dod.delta > 0 ? 'success' : dod.delta < 0 ? 'danger' : 'neutral';
  const dodLabel =
    dod.pct !== null && dod.pct !== undefined
      ? `${dod.delta > 0 ? '▲' : dod.delta < 0 ? '▼' : '—'} ${fmtTaka(Math.abs(dod.delta))} (${dod.pct > 0 ? '+' : ''}${dod.pct}%)`
      : `${fmtTaka(Math.abs(dod.delta))}`;

  return (
    <div className={`oms-page${effectiveDark ? ' dashboard-ink' : ''}`}>
      <PageHeader
        title={t('pages.dashboard')}
        desc={t('pages.dashboardDesc')}
        actions={
          <Button
            variant="outline"
            onClick={cyclePaper}
            title={effectiveDark ? 'Preview the ledger on rice paper' : 'Preview the ledger on ink paper'}
          >
            {effectiveDark ? '☀️ Rice paper' : '🌙 Ink paper'}
          </Button>
        }
      />

      {/* Gold-foil ledger stub — the merchant's copy of the ticket (ink only) */}
      {effectiveDark && (
        <div className="dashboard-ink__stub" aria-hidden="true">
          <div className="dashboard-ink__stub-inner">
            <div>
              <span className="dashboard-ink__eyebrow">🧾 Daily ledger</span>
              <div className="dashboard-ink__brand">{workspaceName || t('pages.dashboard')}</div>
            </div>
            <div className="dashboard-ink__date">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </div>
          </div>
          <div className="stub__tear" />
        </div>
      )}

      {/* Dashboard alerts (Phase 7) — low stock / cancellations / idle */}
      {(data.alerts || []).length > 0 && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {data.alerts.map((a) => (
            <AlertBanner key={a.code} alert={a} t={t} />
          ))}
        </div>
      )}

      {/* Phase 7: custom range + channel/order-type filters (analytics API) */}
      {analytics !== null && (
        <div style={{ marginBottom: 16 }}>
          <AnalyticsFilterBar
            filters={filters}
            onChange={setFilters}
            error={analyticsError}
          />
        </div>
      )}

      {/* Revenue anomaly alerts (Phase 7) — persisted, cooldown-deduped */}
      {(analytics?.anomalies?.alerts || []).length > 0 && (
        <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
          {analytics.anomalies.alerts.slice(0, 5).map((a) => (
            <AnomalyBanner key={a.id} alert={a} t={t} />
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
          subtitle={
            hasRange
              ? `${filters.from} → ${filters.to}${rangeKpis ? ` · ${fmtTaka(rangeKpis.totalRevenue)}` : ''}`
              : `${t('dash.last7Days')} · ${fmtTaka(weekRevenue)} ${t('dash.total')}`
          }
          actions={
            hasRange ? <ExportCsvButton type="revenue" params={filterParams} /> : null
          }
        >
          <TrendAreaChart data={trend} />
        </Card>
        <Card
          title={t('dash.orderVolume')}
          subtitle={
            hasRange
              ? `${filters.from} → ${filters.to} · ${rangeKpis?.totalOrders ?? 0} ${t('dash.ordersTotal')}`
              : `${t('dash.last7Days')} · ${weekOrders} ${t('dash.ordersTotal')}`
          }
        >
          <OrdersBarChart data={trend} />
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
        <Card
          title={t('dash.statusBreakdown')}
          subtitle={t('dash.statusSub')}
          actions={hasRange ? <ExportCsvButton type="status" params={filterParams} /> : null}
        >
          <StatusDonut data={statusData} />
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
        <Card
          title={t('dash.paymentBreakdown')}
          subtitle={t('dash.paymentBreakdownSub')}
          actions={hasRange ? <ExportCsvButton type="methods" params={filterParams} /> : null}
        >
          {methodData.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
              {t('dash.noData')}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {methodData.map((m) => (
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
                          (m.amount / Math.max(...methodData.map((x) => x.amount), 1)) * 100,
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
        <Card title={t('dash.splitBilling')} subtitle={t('dash.splitBillingSub')}>
          <SplitMethodDonut data={data.splitAnalytics || {}} />
          {(data.splitAnalytics?.splitOrders?.total || 0) > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--border)',
              }}
            >
              <div className="oms-mini-stat">
                <div className="oms-mini-stat__value">{data.splitAnalytics.avgDiners}</div>
                <div className="oms-mini-stat__label">{t('split.avgDiners')}</div>
              </div>
              <div className="oms-mini-stat">
                <div className="oms-mini-stat__value">{fmtTaka(data.splitAnalytics.avgPerDiner)}</div>
                <div className="oms-mini-stat__label">{t('split.avgPerDiner')}</div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Conversion funnel + rider performance (Phase 7 analytics) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: 16,
          marginTop: 16,
        }}
      >
        {analytics?.funnel && (
          <Card title={t('dash.funnel')} subtitle={t('dash.funnelSub')}>
            <FunnelChart
              stages={analytics.funnel.stages || []}
              conversions={analytics.funnel.conversions || {}}
            />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <ExportCsvButton type="funnel" params={filterParams} />
            </div>
          </Card>
        )}

        {analytics?.riders && (
          <Card
            title={t('dash.riders')}
            subtitle={`${t('dash.ridersSub')} · ${t('dash.sla')} ${analytics.riders.definitions?.slaMinutes ?? 60} ${t('dash.minutes')}`}
            actions={<ExportCsvButton type="riders" params={filterParams} />}
          >
            {(analytics.riders.riders || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                {t('dash.noRiders')}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 13,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>{t('dash.riderCol')}</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>{t('dash.deliveriesCol')}</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>{t('dash.avgTimeCol')}</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>{t('dash.onTimeRateCol')}</th>
                      <th style={{ padding: '6px 8px', fontWeight: 700 }}>{t('dash.lateCol')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.riders.riders.map((r) => (
                      <tr key={r.riderId} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px', fontWeight: 650 }}>{r.rider}</td>
                        <td style={{ padding: '8px' }}>{r.deliveries}</td>
                        <td style={{ padding: '8px' }}>
                          {r.avgDeliveryMinutes === null ? '—' : `${r.avgDeliveryMinutes} ${t('dash.minutes')}`}
                        </td>
                        <td style={{ padding: '8px' }}>
                          <Badge tone={r.onTimeRate === null ? 'neutral' : r.onTimeRate >= 90 ? 'success' : r.onTimeRate >= 70 ? 'warning' : 'danger'}>
                            {r.onTimeRate === null ? '—' : `${r.onTimeRate}%`}
                          </Badge>
                        </td>
                        <td style={{ padding: '8px' }}>{r.lateDeliveries}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* One-click CSV exports — every chart dataset (Phase 7) */}
      {analytics !== null && (
        <Card title={t('dash.exports')} subtitle={t('dash.exportsSub')} style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {['revenue', 'methods', 'categories', 'status', 'top-items', 'peak-hours', 'retention', 'funnel', 'riders', 'anomalies'].map((type) => (
              <ExportCsvButton key={type} type={type} params={filterParams} label={type} />
            ))}
          </div>
        </Card>
      )}

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

/** Persisted revenue-anomaly alert (Phase 7) — drop/spike vs baseline. */
function AnomalyBanner({ alert, t }) {
  const isDrop = alert.alertType === 'revenue_drop';
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
        borderLeft: `4px solid ${isDrop ? 'var(--danger)' : 'var(--success)'}`,
      }}
    >
      <span style={{ fontSize: 16 }}>{isDrop ? '📉' : '📈'}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>
          {isDrop ? t('dash.anomalyDrop') : t('dash.anomalySpike')}{' '}
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
            ({alert.segment})
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          {t('dash.anomalyDetail')
            .replace('{current}', fmtTaka(alert.currentValue ?? 0))
            .replace('{baseline}', fmtTaka(alert.baselineValue ?? 0))
            .replace('{dev}', `${alert.percentageDeviation > 0 ? '+' : ''}${alert.percentageDeviation}%`)}
          {alert.from ? ` · ${alert.from} → ${alert.to}` : ''}
        </div>
      </div>
    </div>
  );
}

function AlertBanner({ alert, t }) {  const danger = alert.severity === 'danger';
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
