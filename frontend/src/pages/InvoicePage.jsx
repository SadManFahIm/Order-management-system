import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { PageHeader, Card, Button, Badge, Skeleton, useToast } from '../components/ui';

/**
 * Order invoice (Phase 6) — VAT-aware, payment-linked invoice for one order.
 * Rendered from the JSON API (`GET /api/orders/:id/invoice`) so it always
 * matches the backend's NBR split; the 🖨️ button prints / saves as PDF.
 */
const fmt = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function InvoicePage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const toast = useToast();

  useEffect(() => {
    let mounted = true;
    api
      .get(`/orders/${id}/invoice`)
      .then((res) => {
        if (mounted) setInvoice(res.data);
      })
      .catch(() => {
        if (mounted) toast?.error('Could not load the invoice');
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="oms-page">
      <PageHeader
        title={invoice ? `Invoice ${invoice.invoiceNo}` : 'Invoice'}
        desc={invoice ? `${invoice.restaurantName} · ${invoice.orderNo}` : 'Loading…'}
        actions={
          invoice && (
            <Button variant="primary" onClick={() => window.print()}>
              🖨️ Print / PDF
            </Button>
          )
        }
      />

      {!invoice ? (
        <Card>
          <div style={{ display: 'grid', gap: 12, padding: 8 }}>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} height={30} />
            ))}
          </div>
        </Card>
      ) : (
        <Card bodyPadding={false}>
          <div style={{ padding: 28 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 20,
              }}
            >
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{invoice.restaurantName}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {invoice.invoiceNo} ·{' '}
                  {invoice.createdAt
                    ? new Date(invoice.createdAt).toLocaleString('en-GB', {
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
              <Badge tone={invoice.paymentStatus === 'paid' ? 'success' : invoice.paymentStatus === 'refunded' ? 'neutral' : 'warning'}>
                {invoice.paymentStatus}
              </Badge>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px 24px',
                background: 'var(--surface-2, #fafbfc)',
                border: '1px solid var(--border, #e6e8ec)',
                borderRadius: 12,
                padding: '14px 16px',
                fontSize: 13.5,
                marginBottom: 22,
              }}
            >
              <div>
                <b style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Customer</b>
                {invoice.customerName}
                {invoice.customerPhone ? ` · ${invoice.customerPhone}` : ''}
              </div>
              <div>
                <b style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Table</b>
                {invoice.tableNo ? `🪑 ${invoice.tableNo}` : '—'}
              </div>
            </div>

            <table className="oms-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Item</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit</th>
                  <th style={{ textAlign: 'right' }}>Disc</th>
                  <th style={{ textAlign: 'right' }}>VAT %</th>
                  <th style={{ textAlign: 'right' }}>VAT</th>
                  <th style={{ textAlign: 'right' }}>Line</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((i, idx) => (
                  <tr key={idx}>
                    <td style={{ textAlign: 'left' }}>{i.itemName}</td>
                    <td style={{ textAlign: 'right' }}>{i.quantity}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(i.unitPrice)}</td>
                    <td style={{ textAlign: 'right' }}>{i.discount ? `−${fmt(i.discount)}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{i.vatRate}%</td>
                    <td style={{ textAlign: 'right' }}>{fmt(i.vat)}</td>
                    <td style={{ textAlign: 'right' }}>{fmt(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 12,
                marginTop: 16,
              }}
            >
              {[
                ['Subtotal', fmt(invoice.totals.subtotal)],
                ['Discount', fmt(invoice.totals.discount)],
                ['VAT', fmt(invoice.totals.vat)],
                ['Grand total', fmt(invoice.totals.grandTotal)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  style={{
                    background: 'var(--surface-2, #fafbfc)',
                    border: '1px solid var(--border, #e6e8ec)',
                    borderRadius: 12,
                    padding: '12px 14px',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, marginTop: 3 }}>{value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 22 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                Payments
              </div>
              {invoice.payments.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>No payment records.</div>
              ) : (
                invoice.payments.map((p, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '9px 0',
                      borderBottom: '1px dashed var(--border, #e6e8ec)',
                      fontSize: 14,
                    }}
                  >
                    <span>
                      {p.methodLabel}
                      {p.refundedAmount != null ? ` (refunded ${fmt(p.refundedAmount)})` : ''}{' '}
                      {p.reference ? <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{p.reference}</span> : null}
                    </span>
                    <span>
                      {fmt(p.amount)} · {p.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
