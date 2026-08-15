import { sendEmail } from './email.js';
import { renderTicketPdf } from './ticketPdf.js';

/**
 * Ticket-styled order confirmation email (Phase 5 storefront).
 *
 * The customer who leaves an email at checkout gets the same hand-held
 * ticket they tore off the menu, delivered to their inbox: a gold-foil
 * brand stub with the order number, the scalloped tear, the items as
 * dashed ticket rows, a chilli-red total and a big Track order button.
 * Sent fire-and-forget from the storefront route — never blocks order
 * creation — and rendered fully inline (no external assets) so it works
 * in every mail client.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmtTaka = (n) => `৳ ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Render the confirmation email body.
 *
 * @param {{
 *   restaurantName: string,
 *   orderNo: string,
 *   customerName: string,
 *   tableNo: number|null,
 *   items: Array<{name: string, quantity: number, lineTotal: number}>,
 *   grandTotal: number,
 *   paymentMethod: string|null,
 *   trackUrl: string,
 * }} data
 */
export function renderOrderConfirmationHtml(data) {
  const items = (data.items || [])
    .map(
      (i) => `<tr>
        <td>${esc(i.name)}<br><small>× ${Number(i.quantity || 0)}</small></td>
        <td class="num">${fmtTaka(i.lineTotal)}</td>
      </tr>`
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Order ${esc(data.orderNo)} — ${esc(data.restaurantName)}</title>
<style>
  :root{--ink:#18342b;--muted:#7d786a;--line:#e6dcc4;--line-strong:#d6c9a6;--chilli:#d2452f;--gold:#c9962e;--brand:#00b3a5;--stub:color-mix(in srgb,var(--brand) 82%,#0c2f23)}
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:#f6f1e5;font-family:'Segoe UI',Roboto,'Noto Sans Bengali',system-ui,sans-serif;color:var(--ink)}
  .wrap{max-width:560px;margin:0 auto;padding:28px 16px}
  .ticket{background:#fdfaf2;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08)}
  .stub{position:relative;background:var(--stub);color:#fff;padding:24px 24px 34px}
  .stub::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:12px;background:var(--stub);-webkit-mask-image:radial-gradient(circle at 10px -4px,transparent 10px,#000 10.5px);mask-image:radial-gradient(circle at 10px -4px,transparent 10px,#000 10.5px);-webkit-mask-size:20px 12px;mask-size:20px 12px;-webkit-mask-repeat:repeat-x;mask-repeat:repeat-x}
  .eyebrow{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.72);border:1px dashed rgba(255,255,255,.35);border-radius:999px;padding:5px 12px;background:rgba(0,0,0,.12)}
  h1{margin:12px 0 2px;font-size:26px;letter-spacing:-.02em}
  .order-no{display:inline-block;margin-top:10px;border:1px dashed rgba(247,213,113,.7);background:rgba(0,0,0,.16);box-shadow:0 0 0 3px rgba(0,0,0,.07),inset 0 0 22px rgba(247,213,113,.08);color:#f7e08b;border-radius:12px;padding:8px 16px;font-weight:800;font-size:16px;letter-spacing:.03em}
  .body{padding:24px}
  .greet{font-size:14px;margin:0 0 16px}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:18px 0 8px;display:flex;align-items:center;gap:12px}
  h2::after{content:'';flex:1;border-top:1px dashed var(--line-strong)}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  td{padding:7px 0;border-bottom:1px dashed var(--line);vertical-align:top}
  td small{color:var(--muted);font-size:11.5px}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
  .total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px dashed var(--line-strong);margin-top:10px;padding-top:12px;font-size:17px;font-weight:800;color:var(--chilli)}
  .meta{display:flex;justify-content:space-between;font-size:12.5px;margin:5px 0;color:var(--muted)}
  .btn{display:block;width:100%;margin:22px 0 0;padding:14px;border:none;border-radius:14px;background:var(--brand);color:#fff;font-weight:800;font-size:15px;text-align:center;text-decoration:none}
  .foot{margin-top:18px;text-align:center;color:var(--muted);font-size:11px;border-top:1px dashed var(--line);padding-top:12px}
  @media (prefers-color-scheme: dark){
    :root{--ink:#e8efe9;--muted:#8ba397;--line:#1e3129;--line-strong:#2b453b;--chilli:#ff6b4a;--gold:#e0b04e;--stub:color-mix(in srgb,var(--brand) 58%,#04100b)}
    body{background:#0b1210}
    .ticket{background:#101c18;border-color:var(--line);box-shadow:0 10px 30px rgba(0,0,0,.4)}
  }
</style></head><body>
<div class="wrap">
  <div class="ticket">
    <div class="stub">
      <span class="eyebrow">🧾 Order ticket · Confirmed</span>
      <h1>${esc(data.restaurantName)}</h1>
      <div class="order-no">🎟️ ${esc(data.orderNo)}</div>
    </div>
    <div class="body">
      <p class="greet">Thanks <b>${esc(data.customerName)}</b> — we received your order and will start preparing it soon.</p>
      ${data.tableNo ? `<div class="meta"><span>Table</span><span>🪑 ${esc(data.tableNo)}</span></div>` : ''}
      <h2>Items</h2>
      <table>
        <tbody>${items || '<tr><td>—</td></tr>'}</tbody>
      </table>
      <div class="total"><span>Total</span><span>${fmtTaka(data.grandTotal)}</span></div>
      ${data.paymentMethod ? `<div class="meta" style="margin-top:10px"><span>Payment</span><span>${esc(data.paymentMethod)}</span></div>` : ''}
      <a class="btn" href="${esc(data.trackUrl)}">🎟️ Track your order</a>
      <div class="foot">Orderly · The Table Ticket · ${esc(data.restaurantName)}</div>
    </div>
  </div>
</div>
</body></html>`;
}

/**
 * Send the confirmation (fire-and-forget from the checkout route).
 * Respects the MAIL_DRIVER adapter — the stub driver logs the ticket HTML
 * in dev/test, SMTP delivers it for real in production.
 *
 * The email carries the ticket as a printable PDF attachment too (Phase 8) —
 * generated with pdfkit, so the customer can save or print the ticket even
 * without opening the HTML. A PDF failure never blocks the email.
 */
export async function sendOrderConfirmationEmail({ tenant, order, items, trackUrl }) {
  const email = order.customer_email;
  if (!email) return null;
  const ticket = {
    restaurantName: tenant?.name || 'Restaurant',
    orderNo: order.order_no || order.id,
    customerName: order.customer_name || 'guest',
    tableNo: order.table_no ?? null,
    items: (items || []).map((i) => ({
      name: i.item_name || i.itemName || i.name,
      quantity: i.quantity,
      lineTotal: i.line_total ?? i.lineTotal,
    })),
    grandTotal: order.grand_total ?? order.grandTotal,
    paymentMethod: order.payment_method ?? null,
    trackUrl,
  };
  const html = renderOrderConfirmationHtml(ticket);
  return sendTicketEmail({
    email,
    subject: `Your order ${order.order_no || order.id} — ${tenant?.name || 'Restaurant'}`,
    html,
    attachments: await ticketPdfAttachment(ticket, 'ORDER TICKET · CONFIRMED'),
  });
}

/**
 * Customer status-update emails (Phase 5). When an order reaches a
 * customer-facing milestone (preparing / ready / out_for_delivery /
 * delivered), the customer who left an email gets the same hand-held ticket
 * with the new status stamped on the stub. Fire-and-forget from the status
 * route; the order's items are fetched here so the route stays light.
 */
const STATUS_EMAILS = {
  preparing: { label: '👨‍🍳 Preparing — we’re on it', bn: '👨‍🍳 তৈরি হচ্ছে — আমরা কাজ করছি' },
  ready: { label: '🛍️ Ready — please collect', bn: '🛍️ প্রস্তুত — সংগ্রহ করে নিন' },
  out_for_delivery: { label: '🛵 Out for delivery', bn: '🛵 ডেলিভারিতে পাঠানো হয়েছে' },
  delivered: { label: '✅ Delivered — enjoy your meal!', bn: '✅ ডেলিভারি সম্পন্ন — উপভোগ করুন!' },
};

export const STATUS_EMAIL_KEYS = Object.keys(STATUS_EMAILS);

export function renderOrderStatusEmailHtml(data) {
  const items = (data.items || [])
    .map(
      (i) => `<tr>
        <td>${esc(i.name)}<br><small>× ${Number(i.quantity || 0)}</small></td>
        <td class="num">${fmtTaka(i.lineTotal)}</td>
      </tr>`
    )
    .join('');
  const stamp = STATUS_EMAILS[data.status] || {
    label: `Order ${esc(data.status)}`,
    bn: `অর্ডার ${esc(data.status)}`,
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(stamp.label)} — ${esc(data.orderNo)}</title>
<style>
  :root{--ink:#18342b;--muted:#7d786a;--line:#e6dcc4;--line-strong:#d6c9a6;--chilli:#d2452f;--gold:#c9962e;--brand:#00b3a5;--stub:color-mix(in srgb,var(--brand) 82%,#0c2f23)}
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:#f6f1e5;font-family:'Segoe UI',Roboto,'Noto Sans Bengali',system-ui,sans-serif;color:var(--ink)}
  .wrap{max-width:560px;margin:0 auto;padding:28px 16px}
  .ticket{background:#fdfaf2;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08)}
  .stub{position:relative;background:var(--stub);color:#fff;padding:24px 24px 34px}
  .stub::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:12px;background:var(--stub);-webkit-mask-image:radial-gradient(circle at 10px -4px,transparent 10px,#000 10.5px);mask-image:radial-gradient(circle at 10px -4px,transparent 10px,#000 10.5px);-webkit-mask-size:20px 12px;mask-size:20px 12px;-webkit-mask-repeat:repeat-x;mask-repeat:repeat-x}
  .eyebrow{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.72);border:1px dashed rgba(255,255,255,.35);border-radius:999px;padding:5px 12px;background:rgba(0,0,0,.12)}
  h1{margin:12px 0 2px;font-size:24px;letter-spacing:-.02em}
  .stamp{display:inline-block;margin-top:12px;border:1px dashed rgba(247,213,113,.7);background:rgba(0,0,0,.16);box-shadow:0 0 0 3px rgba(0,0,0,.07),inset 0 0 22px rgba(247,213,113,.08);color:#f7e08b;border-radius:12px;padding:8px 16px;font-weight:800;font-size:15px;letter-spacing:.02em}
  .body{padding:24px}
  .greet{font-size:14px;margin:0 0 16px}
  h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:18px 0 8px;display:flex;align-items:center;gap:12px}
  h2::after{content:'';flex:1;border-top:1px dashed var(--line-strong)}
  table{width:100%;border-collapse:collapse;font-size:13.5px}
  td{padding:7px 0;border-bottom:1px dashed var(--line);vertical-align:top}
  td small{color:var(--muted);font-size:11.5px}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}
  .total{display:flex;justify-content:space-between;align-items:baseline;border-top:1px dashed var(--line-strong);margin-top:10px;padding-top:12px;font-size:17px;font-weight:800;color:var(--chilli)}
  .meta{display:flex;justify-content:space-between;font-size:12.5px;margin:5px 0;color:var(--muted)}
  .btn{display:block;width:100%;margin:22px 0 0;padding:14px;border:none;border-radius:14px;background:var(--brand);color:#fff;font-weight:800;font-size:15px;text-align:center;text-decoration:none}
  .foot{margin-top:18px;text-align:center;color:var(--muted);font-size:11px;border-top:1px dashed var(--line);padding-top:12px}
  @media (prefers-color-scheme: dark){
    :root{--ink:#e8efe9;--muted:#8ba397;--line:#1e3129;--line-strong:#2b453b;--chilli:#ff6b4a;--gold:#e0b04e;--stub:color-mix(in srgb,var(--brand) 58%,#04100b)}
    body{background:#0b1210}
    .ticket{background:#101c18;border-color:var(--line);box-shadow:0 10px 30px rgba(0,0,0,.4)}
  }
</style></head><body>
<div class="wrap">
  <div class="ticket">
    <div class="stub">
      <span class="eyebrow">🧾 Order ticket · Status update</span>
      <h1>${esc(data.restaurantName)}</h1>
      <div class="stamp">${esc(stamp.label)}</div>
      <div class="meta" style="color:rgba(255,255,255,.72);margin-top:10px"><span>Order</span><span>${esc(data.orderNo)}</span></div>
    </div>
    <div class="body">
      <p class="greet">Hi <b>${esc(data.customerName)}</b>, ${esc(stamp.label.toLowerCase())} — keep an eye on your phone and your ticket below.</p>
      ${data.tableNo ? `<div class="meta"><span>Table</span><span>🪑 ${esc(data.tableNo)}</span></div>` : ''}
      <h2>Items</h2>
      <table>
        <tbody>${items || '<tr><td>—</td></tr>'}</tbody>
      </table>
      <div class="total"><span>Total</span><span>${fmtTaka(data.grandTotal)}</span></div>
      <a class="btn" href="${esc(data.trackUrl)}">🎟️ Track your order</a>
      <div class="foot">Orderly · The Table Ticket · ${esc(data.restaurantName)}</div>
    </div>
  </div>
</div>
</body></html>`;
}

/** Send a status-update email (fire-and-forget) — fetches items internally. */
export async function sendOrderStatusEmail({ tenant, order, status }) {
  const email = order.customer_email;
  if (!email || !STATUS_EMAILS[status]) return null;
  try {
    let items = order.items || [];
    if (items.length === 0 && order.id) {
      const { default: OrderItem } = await import('../../models/OrderItem.js');
      items = await OrderItem.findAll({ where: { order_id: order.id } });
    }
    const trackUrl = order.customer_phone
      ? `/track?orderNo=${encodeURIComponent(
          order.order_no || order.id
        )}&phone=${encodeURIComponent(order.customer_phone)}`
      : '/track';
    const html = renderOrderStatusEmailHtml({
      restaurantName: tenant?.name || 'Restaurant',
      orderNo: order.order_no || order.id,
      customerName: order.customer_name || 'guest',
      tableNo: order.table_no ?? null,
      status,
      items: items.map((i) => ({
        name: i.item_name || i.itemName || i.name,
        quantity: i.quantity,
        lineTotal: i.line_total ?? i.lineTotal,
      })),
      grandTotal: order.grand_total ?? order.grandTotal,
      trackUrl,
    });
    return await sendTicketEmail({
      email,
      subject: `${STATUS_EMAILS[status].label} — ${order.order_no || order.id}`,
      html,
      attachments: await ticketPdfAttachment(
        {
          restaurantName: tenant?.name || 'Restaurant',
          orderNo: order.order_no || order.id,
          customerName: order.customer_name || 'guest',
          tableNo: order.table_no ?? null,
          items: items.map((i) => ({
            name: i.item_name || i.itemName || i.name,
            quantity: i.quantity,
            lineTotal: i.line_total ?? i.lineTotal,
          })),
          grandTotal: order.grand_total ?? order.grandTotal,
          paymentMethod: null,
          trackUrl,
        },
        `STATUS · ${STATUS_EMAILS[status].label.replace(/[^\x20-\x7E]/g, '').toUpperCase()}`
      ),
    });
  } catch {
    return null;
  }
}

/**
 * Builds the printable ticket PDF attachment (Phase 8). A PDF is a
 * nice-to-have — if generation fails we return no attachment so the email
 * still goes out with just the ticket HTML. Exported for tests.
 */
export async function ticketPdfAttachment(ticket, stamp) {
  try {
    const pdf = await renderTicketPdf({ ...ticket, stamp });
    return [
      {
        filename: `order-${String(ticket.orderNo).replace(/[^A-Za-z0-9._-]/g, '-') || 'ticket'}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      },
    ];
  } catch {
    return [];
  }
}

/** Shared best-effort send through the mail adapter. */
async function sendTicketEmail({ email, subject, html, attachments = [] }) {
  try {
    return await sendEmail({ to: email, subject, html, attachments });
  } catch {
    return null;
  }
}
