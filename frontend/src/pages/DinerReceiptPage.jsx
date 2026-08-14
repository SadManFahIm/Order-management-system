import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { PageHeader, Card, Button, Badge, Skeleton, useToast } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * Per-diner receipt (dine-in split billing) — one diner's assigned items,
 * VAT allocation and payable, rendered from the JSON API
 * (`GET /api/orders/:id/split/receipts/:paymentId`) so it always matches the
 * backend's stored allocation. The 🖨️ button prints / saves as PDF — the
 * sheet is narrow (thermal-friendly) and scales to A4.
 */
const fmt = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const SPLIT_METHOD_LABEL = { equal: 'Equal', item: 'Item', custom: 'Custom' };

export default function DinerReceiptPage() {
  const { id, paymentId } = useParams();
  const { t } = useI18n();
  const [receipt, setReceipt] = useState(null);
  const [kot, setKot] = useState(null);
  const [view, setView] = useState('receipt'); // 'receipt' | 'kot'
  const toast = useToast();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [r, k] = await Promise.all([
          api.get(`/orders/${id}/split/receipts/${paymentId}`),
          api.get(`/orders/${id}/split/receipts/${paymentId}/kot`),
        ]);
        if (mounted) {
          setReceipt(r.data);
          setKot(k.data);
        }
      } catch {
        if (mounted) toast?.error(t('split.couldNotLoad'));
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, paymentId]);

  // Print the backend's standalone sheet (nav-free, thermal-friendly) via the
  // authed client — a bare window.open would 401.
  const printSheet = async () => {
    const base = `/orders/${id}/split/receipts/${paymentId}`;
    const url = view === 'kot' ? `${base}/kot?print=1` : `${base}?print=1`;
    try {
      const res = await api.get(url, { responseType: 'blob' });
      const blobUrl = URL.createObjectURL(res.data);
      const win = window.open(blobUrl, '_blank', 'noopener');
      if (win) win.onload = () => win.print?.();
    } catch {
      toast?.error(t('split.couldNotLoad'));
    }
  };

  return (
    <div className="oms-page">
      <PageHeader
        title={receipt ? t('split.receiptTitle') : t('split.receiptTitle')}
        desc={
          receipt
            ? `${receipt.restaurantName} · ${receipt.dinerLabel} · ${receipt.orderNo}`
            : t('split.loading')
        }
        actions={
          receipt && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant={view === 'receipt' ? 'primary' : 'outline'} size="sm" onClick={() => setView('receipt')}>
                🧾 {t('split.receiptTitle')}
              </Button>
              <Button variant={view === 'kot' ? 'primary' : 'outline'} size="sm" onClick={() => setView('kot')}>
                🍳 {t('split.kot')}
              </Button>
              <Button variant="primary" onClick={printSheet}>
                🖨️ {view === 'kot' ? t('split.kotPrint') : t('split.print')}
              </Button>
            </div>
          )
        }
      />

      {!receipt || !kot ? (
        <Card>
          <div style={{ display: 'grid', gap: 12, padding: 8 }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} height={30} />
            ))}
          </div>
        </Card>
      ) : view === 'kot' ? (
        <KotCard kot={kot} t={t} />
      ) : (
        <Card bodyPadding={false}>
          <div
            id="diner-receipt"
            className="ink-sheet"
            style={{
              maxWidth: 380,
              margin: '0 auto',
              fontFamily: "system-ui, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif",
            }}
          >
            {/* Brand — gold-foil stub torn off the ink-paper sheet */}
            <div className="ink-sheet__stub">
              <div className="ink-sheet__stub-name">{receipt.restaurantName}</div>
              <div className="ink-sheet__stub-sub">{receipt.receiptNo}</div>
              <div className="ink-sheet__stub-sub">
                {receipt.createdAt
                  ? new Date(receipt.createdAt).toLocaleString('en-GB', {
                      timeZone: 'Asia/Dhaka',
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''}
              </div>
            </div>

            <div className="ink-sheet__body">

            {/* Meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, margin: '4px 0' }}>
              <span style={{ fontWeight: 700 }}>{t('split.orderNo')}</span>
              <span>{receipt.orderNo || receipt.orderId}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, margin: '4px 0' }}>
              <span style={{ fontWeight: 700 }}>{t('split.table')}</span>
              <span>{receipt.tableNo ? `🪑 ${receipt.tableNo}` : '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, margin: '4px 0' }}>
              <span style={{ fontWeight: 700 }}>{t('split.modeLabel')}</span>
              <span>{SPLIT_METHOD_LABEL[receipt.splitMethod] || receipt.splitMethod || '—'}</span>
            </div>

            {/* Diner */}
            <div
              style={{
                textAlign: 'center',
                background: 'var(--primary-soft, #eef7f6)',
                color: 'var(--primary)',
                fontWeight: 800,
                borderRadius: 999,
                padding: '6px 14px',
                fontSize: 14,
                margin: '12px 0',
              }}
            >
              {receipt.dinerLabel}
            </div>

            {/* Items */}
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '14px 0 6px' }}>
              {t('split.items')}
            </div>
            {receipt.items.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>—</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {receipt.items.map((i, idx) => (
                    <tr key={idx}>
                      <td style={{ padding: '5px 0', borderBottom: '1px dashed var(--border)', verticalAlign: 'top' }}>
                        {i.itemName}
                        <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                          {i.quantity} × {fmt(i.unitPrice)}
                        </div>
                      </td>
                      <td style={{ padding: '5px 0', borderBottom: '1px dashed var(--border)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {fmt(i.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Totals */}
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{t('split.subtotal')}</span>
                <span>{fmt(receipt.totals.subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{t('split.discount')}</span>
                <span>{receipt.totals.discount ? `−${fmt(receipt.totals.discount)}` : '—'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{t('split.vat')}</span>
                <span>{fmt(receipt.totals.vat)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{t('split.net')}</span>
                <span>{fmt(receipt.totals.net)}</span>
              </div>
              {Math.abs(receipt.totals.rounding) > 0.005 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                  <span>{t('split.rounding')}</span>
                  <span>{fmt(receipt.totals.rounding)}</span>
                </div>
              )}
              <div
                className="ink-sheet__payable"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderTop: '2px solid var(--chilli)',
                  marginTop: 6,
                  paddingTop: 8,
                  fontSize: 16,
                  fontWeight: 800,
                }}
              >
                <span>{t('split.payable')}</span>
                <span>{fmt(receipt.totals.payable)}</span>
              </div>
            </div>

            {/* Payment */}
            <div
              style={{
                marginTop: 14,
                background: 'var(--surface-2, #fafbfc)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '10px 12px',
                fontSize: 12.5,
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{t('split.paymentMethod')}</span>
                <span>
                  {receipt.payment.methodLabel} ·{' '}
                  <Badge tone={receipt.payment.status === 'paid' ? 'success' : 'warning'}>
                    {receipt.payment.status}
                  </Badge>
                </span>
              </div>
              {receipt.payment.reference && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t('split.trxId')}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{receipt.payment.reference}</span>
                </div>
              )}
              {receipt.payment.paidAt && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t('split.paidAt')}</span>
                  <span>
                    {new Date(receipt.payment.paidAt).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}
                  </span>
                </div>
              )}
            </div>

            <div
              className="ink-sheet__foot"
              style={{
                marginTop: 16,
                textAlign: 'center',
                fontSize: 10.5,
                borderTop: '1px dashed var(--border)',
                paddingTop: 10,
              }}
            >
              Thank you! · VAT per item (NBR: line × rate/(100+rate))
            </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/**
 * Kitchen order ticket sheet — the diner's assigned items with quantities,
 * no prices/VAT/payment (a KOT is not a bill). Mirrors the backend's
 * print-ready HTML so the on-screen and printed views match.
 */
function KotCard({ kot, t }) {
  return (
    <Card bodyPadding={false}>
      <div
        id="diner-kot"
        className="ink-sheet"
        style={{
          maxWidth: 380,
          margin: '0 auto',
          fontFamily: "system-ui, 'Segoe UI', Roboto, 'Noto Sans Bengali', sans-serif",
        }}
      >
        <div className="ink-sheet__stub">
          <span className="ink-sheet__kot-badge">KITCHEN</span>
          <div className="ink-sheet__stub-name" style={{ marginTop: 6 }}>{kot.restaurantName}</div>
          <div className="ink-sheet__stub-sub">{kot.kotNo}</div>
          <div className="ink-sheet__stub-sub">
            {kot.createdAt
              ? new Date(kot.createdAt).toLocaleString('en-GB', {
                  timeZone: 'Asia/Dhaka',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </div>
        </div>

        <div className="ink-sheet__body">

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, margin: '4px 0' }}>
          <span style={{ fontWeight: 700 }}>{t('split.orderNo')}</span>
          <span>{kot.orderNo || kot.orderId}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, margin: '4px 0' }}>
          <span style={{ fontWeight: 700 }}>{t('split.table')}</span>
          <span>{kot.tableNo ? `🪑 ${kot.tableNo}` : '—'}</span>
        </div>

        <div
          style={{
            textAlign: 'center',
            background: 'var(--primary-soft, #eef7f6)',
            color: 'var(--primary)',
            fontWeight: 800,
            borderRadius: 999,
            padding: '6px 14px',
            fontSize: 14,
            margin: '12px 0',
          }}
        >
          {kot.dinerLabel}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '14px 0 6px' }}>
          {t('split.items')}
        </div>
        {kot.items.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>—</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {kot.items.map((i, idx) => (
                <tr key={idx}>
                  <td style={{ padding: '7px 0', borderBottom: '1px dashed var(--border)', fontWeight: 600 }}>
                    {i.itemName}
                  </td>
                  <td style={{ padding: '7px 0', borderBottom: '1px dashed var(--border)', textAlign: 'right', fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap' }}>
                    × {i.quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="ink-sheet__foot" style={{ marginTop: 16, textAlign: 'center', fontSize: 10.5, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
          {t('split.kotFooter')}
        </div>
        </div>
      </div>
    </Card>
  );
}
