import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import { PageHeader, Card, Button, Input, Table, Badge, Skeleton, useToast } from '../components/ui';

const fmt = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const todayLocal = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const STATUS_TONE = {
  placed: 'neutral',
  preparing: 'warning',
  ready: 'primary',
  delivered: 'success',
  canceled: 'danger',
};

const METHOD_LABEL_KEY = {
  cash: 'orders.payCash',
  bkash: 'orders.payBkash',
  nagad: 'orders.payNagad',
  card: 'orders.payCard',
  online: 'orders.payOnline',
  other: 'orders.payOnline',
};

/**
 * Daily closeout (Phase 5) — the cash-register reconciliation view: a single
 * day's orders, revenue by payment method, pending wallet amounts, refunds,
 * and a CSV export for the cashier to reconcile against bKash/Nagad.
 */
export default function ReportsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const [date, setDate] = useState(todayLocal());
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const mounted = useRef(true);

  // VAT compliance report (Phase 6) — per-item VAT split over a range.
  const [vatFrom, setVatFrom] = useState(todayLocal());
  const [vatTo, setVatTo] = useState(todayLocal());
  const [vatData, setVatData] = useState(null);
  const [vatError, setVatError] = useState(false);
  const [vatDownloading, setVatDownloading] = useState(false);

  useEffect(() => {
    mounted.current = true;
    setData(null);
    setError(false);
    api
      .get('/reports/closeout', { params: { date } })
      .then((res) => {
        if (mounted.current) setData(res.data);
      })
      .catch(() => {
        if (mounted.current) setError(true);
      });
    return () => {
      mounted.current = false;
    };
  }, [date]);

  useEffect(() => {
    mounted.current = true;
    setVatData(null);
    setVatError(false);
    api
      .get('/reports/vat', { params: { from: vatFrom, to: vatTo } })
      .then((res) => {
        if (mounted.current) setVatData(res.data);
      })
      .catch(() => {
        if (mounted.current) setVatError(true);
      });
    return () => {
      mounted.current = false;
    };
  }, [vatFrom, vatTo]);

  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const res = await api.get('/reports/closeout.csv', { params: { date }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `closeout-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('reports.couldNotLoad'));
    } finally {
      setDownloading(false);
    }
  };

  const openPdf = async () => {
    // The .pdf endpoint serves print-ready HTML — the browser's print dialog
    // (Save as PDF) makes the actual PDF, with perfect Bangla rendering.
    // Fetched through the authed client (a bare window.open would hit 401).
    try {
      const res = await api.get('/reports/closeout.pdf', { params: { date }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const win = window.open(url, '_blank', 'noopener');
      if (win) win.onload = () => win.print?.();
    } catch {
      toast.error(t('reports.couldNotLoad'));
    }
  };

  const downloadVatCsv = async () => {
    setVatDownloading(true);
    try {
      const res = await api.get('/reports/vat.csv', {
        params: { from: vatFrom, to: vatTo },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vat-${vatFrom}-to-${vatTo}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('reports.couldNotLoad'));
    } finally {
      setVatDownloading(false);
    }
  };

  const emailCloseout = async () => {
    setEmailing(true);
    try {
      await api.post('/reports/closeout/email', { date });
      toast.success(t('reports.emailSent'), t('reports.emailSentDesc'));
    } catch {
      toast.error(t('reports.emailFailed'));
    } finally {
      setEmailing(false);
    }
  };

  const stats = data
    ? [
        { label: t('reports.totalOrders'), value: String(data.totals.orders) },
        { label: t('reports.revenue'), value: fmt(data.totals.revenue), tone: 'success' },
        { label: t('reports.pending'), value: fmt(data.totals.pendingAmount), tone: 'warning' },
        { label: t('reports.refunded'), value: fmt(data.totals.refundedAmount) },
      ]
    : [];

  const maxAmount = Math.max(...(data?.byMethod || []).map((m) => m.amount + m.pendingAmount), 1);

  return (
    <div className="oms-page">
      <PageHeader
        title={t('reports.page')}
        desc={t('reports.pageDesc')}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="outline" onClick={emailCloseout} disabled={emailing || !data}>
              {emailing ? t('common.loading') : `📧 ${t('reports.emailCloseout')}`}
            </Button>
            <Button variant="outline" onClick={openPdf} disabled={!data}>
              🖨️ {t('reports.downloadPdf')}
            </Button>
            <Button variant="outline" onClick={downloadCsv} disabled={downloading || !data}>
              {downloading ? t('common.loading') : `⬇ ${t('reports.downloadCsv')}`}
            </Button>
          </div>
        }
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <Field label={t('reports.date')}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value || todayLocal())} style={{ width: 200 }} />
        </Field>
      </div>

      {error ? (
        <Card>
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            {t('reports.couldNotLoad')}
          </div>
        </Card>
      ) : !data ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={96} />
            ))}
          </div>
          <Skeleton height={280} style={{ marginTop: 16 }} />
        </>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            {stats.map((s) => (
              <div key={s.label} className="oms-card">
                <div className="oms-card__body" style={{ padding: '16px 18px' }}>
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)', fontWeight: 600 }}>{s.label}</div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      marginTop: 4,
                      fontVariantNumeric: 'tabular-nums',
                      color: s.tone === 'success' ? 'var(--success)' : s.tone === 'warning' ? 'var(--warning)' : 'var(--text)',
                    }}
                  >
                    {s.value}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Revenue by method */}
          <Card title={t('reports.byMethod')} subtitle={`${date}`} style={{ marginTop: 16 }}>
            {(data.byMethod || []).length === 0 ? (
              <div style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>{t('reports.noOrders')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 14 }}>
                {data.byMethod.map((m) => (
                  <div key={m.method}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                      <span style={{ fontWeight: 650 }}>{t(METHOD_LABEL_KEY[m.method] || 'orders.payOnline')}</span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {m.orders} · {fmt(m.amount)}
                        {m.pendingAmount > 0 ? ` (+${fmt(m.pendingAmount)} pending)` : ''}
                      </span>
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${Math.max(((m.amount + m.pendingAmount) / maxAmount) * 100, 3)}%`,
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

          {/* VAT compliance (Phase 6) */}
          <Card
            title={t('reports.vatTitle')}
            subtitle={t('reports.vatSub')}
            style={{ marginTop: 16 }}
            actions={
              <Button variant="outline" size="sm" onClick={downloadVatCsv} disabled={vatDownloading || !vatData}>
                {vatDownloading ? t('common.loading') : `⬇ ${t('reports.vatCsv')}`}
              </Button>
            }
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
              <Field label={t('reports.vatFrom')}>
                <Input type="date" value={vatFrom} onChange={(e) => setVatFrom(e.target.value || todayLocal())} style={{ width: 180 }} />
              </Field>
              <Field label={t('reports.vatTo')}>
                <Input type="date" value={vatTo} onChange={(e) => setVatTo(e.target.value || todayLocal())} style={{ width: 180 }} />
              </Field>
              <div style={{ display: 'flex', gap: 10, paddingBottom: 2 }}>
                <VatStat label={t('reports.vatGross')} value={fmt(vatData?.totals.gross || 0)} />
                <VatStat label={t('reports.vatVat')} value={fmt(vatData?.totals.vat || 0)} tone="warning" />
                <VatStat label={t('reports.vatNet')} value={fmt(vatData?.totals.net || 0)} tone="success" />
              </div>
            </div>
            {vatError ? (
              <div style={{ textAlign: 'center', padding: 28, color: 'var(--text-muted)' }}>{t('reports.couldNotLoad')}</div>
            ) : !vatData ? (
              <Skeleton height={120} />
            ) : (
              <Table
                columns={[
                  { key: 'itemName', label: t('reports.colItem') },
                  { key: 'vatRate', label: t('reports.colRate'), align: 'right' },
                  { key: 'quantity', label: t('reports.colQty'), align: 'right' },
                  { key: 'gross', label: t('reports.vatGross'), align: 'right' },
                  { key: 'vat', label: t('reports.vatVat'), align: 'right' },
                  { key: 'net', label: t('reports.vatNet'), align: 'right' },
                ]}
                rows={vatData.items}
                render={(row, key) => {
                  if (key === 'itemName') return <span className="oms-table__cell-strong">{row.itemName}</span>;
                  if (key === 'vatRate') return <Badge tone="neutral">{row.vatRate}%</Badge>;
                  if (['gross', 'vat', 'net'].includes(key)) return <span className="oms-table__cell-strong">{fmt(row[key])}</span>;
                  return row[key];
                }}
                empty={{
                  icon: <span style={{ fontSize: 22 }}>🧾</span>,
                  title: t('reports.vatEmpty'),
                  description: '',
                }}
              />
            )}
          </Card>

          {/* Orders table */}
          <Card title={t('reports.ordersList')} bodyPadding={false} style={{ marginTop: 16 }}>
            <Table
              columns={[
                { key: 'orderNo', label: t('reports.colOrder') },
                { key: 'time', label: t('reports.colTime') },
                { key: 'customerName', label: t('reports.colCustomer') },
                { key: 'tableNo', label: t('reports.colTable') },
                { key: 'status', label: t('reports.colStatus') },
                { key: 'payment', label: t('reports.colPayment') },
                { key: 'items', label: t('reports.colItems'), align: 'right' },
                { key: 'amount', label: t('reports.colAmount'), align: 'right' },
              ]}
              rows={data.orders}
              render={(o, key) => {
                if (key === 'orderNo') return <span className="oms-table__cell-strong">{o.orderNo}</span>;
                if (key === 'time') return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(o.time)}</span>;
                if (key === 'customerName') return o.customerName;
                if (key === 'tableNo') return o.tableNo ? <Badge tone="accent">🪑 {t('orders.table', o.tableNo)}</Badge> : <span style={{ color: 'var(--text-muted)' }}>—</span>;
                if (key === 'status') return <Badge tone={STATUS_TONE[o.status] || 'neutral'}>{t(`orders.${o.status}`) || o.status}</Badge>;
                if (key === 'payment') {
                  const label = t(METHOD_LABEL_KEY[o.paymentMethod] || 'orders.payOnline');
                  const tone = o.paymentStatus === 'paid' ? 'success' : o.paymentStatus === 'refunded' ? 'neutral' : 'warning';
                  return (
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      <Badge tone="neutral">{label}</Badge>
                      <Badge tone={tone}>
                        {o.paymentStatus === 'paid' ? t('orders.paidStatus') : o.paymentStatus === 'refunded' ? t('orders.refundedStatus') : t('orders.unpaidStatus')}
                      </Badge>
                    </span>
                  );
                }
                if (key === 'items') return o.items;
                if (key === 'amount') return <span className="oms-table__cell-strong">{fmt(o.amount)}</span>;
                return o[key];
              }}
              empty={{
                icon: <span style={{ fontSize: 22 }}>📄</span>,
                title: t('reports.noOrders'),
                description: '',
              }}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function VatStat({ label, value, tone }) {
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        borderRadius: 12,
        padding: '10px 14px',
        minWidth: 120,
      }}
    >
      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          marginTop: 3,
          fontVariantNumeric: 'tabular-nums',
          color: tone === 'success' ? 'var(--success)' : tone === 'warning' ? 'var(--warning)' : 'var(--text)',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </span>
      {children}
    </label>
  );
}
