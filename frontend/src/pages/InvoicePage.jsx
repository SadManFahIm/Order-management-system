import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';
import { PageHeader, Card, Button, Skeleton, useToast } from '../components/ui';

/**
 * Order invoice (Phase 6) — VAT-aware, payment-linked invoice for one order.
 * Rendered from the JSON API (`GET /api/orders/:id/invoice`) so it always
 * matches the backend's NBR split; the 🖨️ button prints / saves as PDF.
 *
 * The sheet renders in the ticket's ink-paper form — the merchant's copy of
 * the same hand-held ticket the customer tore off the menu: a gold-foil
 * brand stub with the scalloped tear, then a deep ink-green sheet with sage
 * ink, dashed ticket dividers and chilli-red totals. Printing flips it to a
 * clean white ink-on-paper sheet so it reads like a classic invoice.
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

  const paid =
    invoice?.paymentStatus === 'paid' || invoice?.paymentStatus === 'partial';

  return (
    <div className="oms-page">
      <PageHeader
        title={invoice ? `Invoice ${invoice.invoiceNo}` : 'Invoice'}
        desc={invoice ? `${invoice.restaurantName} · ${invoice.orderNo}` : 'Loading…'}
        actions={
          invoice && (
            <Button variant="primary" className="invoice-print-btn" onClick={() => window.print()}>
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
          <div className="invoice-sheet">
            {/* Gold-foil stub — the merchant's copy of the ticket */}
            <div className="invoice-sheet__stub">
              <div className="invoice-sheet__stub-inner">
                <div>
                  <div className="invoice-sheet__brand">{invoice.restaurantName}</div>
                  <div className="invoice-sheet__meta">
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
                <span className={`invoice-sheet__badge${paid ? ' invoice-sheet__badge--ok' : ''}`}>
                  {invoice.paymentStatus === 'paid'
                    ? '✓ PAID'
                    : invoice.paymentStatus === 'partial'
                      ? '⏳ PARTIAL'
                      : invoice.paymentStatus === 'refunded'
                        ? '↩ REFUNDED'
                        : '⏳ UNPAID'}
                </span>
              </div>
              <div className="stub__tear" aria-hidden="true" />
            </div>

            <div className="invoice-sheet__body">
              {/* Customer / table — ticket fields */}
              <div className="invoice-sheet__grid">
                <div>
                  <div className="invoice-sheet__field-label">Customer</div>
                  <div className="invoice-sheet__field-value">
                    {invoice.customerName}
                    {invoice.customerPhone ? ` · ${invoice.customerPhone}` : ''}
                  </div>
                </div>
                <div>
                  <div className="invoice-sheet__field-label">Table</div>
                  <div className="invoice-sheet__field-value">
                    {invoice.tableNo ? `🪑 ${invoice.tableNo}` : '—'}
                  </div>
                </div>
              </div>

              <table className="invoice-sheet__table">
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

              <div className="invoice-sheet__totals">
                {[
                  ['Subtotal', fmt(invoice.totals.subtotal), false],
                  ['Discount', fmt(invoice.totals.discount), false],
                  ['VAT', fmt(invoice.totals.vat), false],
                  ['Grand total', fmt(invoice.totals.grandTotal), true],
                ].map(([label, value, grand]) => (
                  <div key={label} className={`invoice-sheet__total${grand ? ' invoice-sheet__total--grand' : ''}`}>
                    <div className="invoice-sheet__total-label">{label}</div>
                    <div className="invoice-sheet__total-value">{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24 }}>
                <div className="invoice-sheet__section-label">Payments</div>
                {invoice.payments.length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: 13.5 }}>No payment records.</div>
                ) : (
                  invoice.payments.map((p, idx) => (
                    <div key={idx} className="invoice-sheet__pay-row">
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
          </div>
        </Card>
      )}
    </div>
  );
}
