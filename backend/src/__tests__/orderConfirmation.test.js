import { describe, it, expect } from 'vitest';
import {
  renderOrderConfirmationHtml,
  renderOrderStatusEmailHtml,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
  STATUS_EMAIL_KEYS,
} from '../services/notifications/orderConfirmation.js';

/**
 * Ticket-styled order confirmation email (Phase 5) — the renderer is pure
 * (no I/O), so the suite pins the ticket markup: gold stub + order number,
 * dashed item rows, chilli total, track button — plus escaping so a hostile
 * item name can never inject markup into the customer's inbox.
 */

const sample = (over = {}) => ({
  restaurantName: 'Split Diner',
  orderNo: 'ORD-1-ABC123-42',
  customerName: 'Rahim Uddin',
  tableNo: 7,
  items: [
    { name: 'Burger', quantity: 1, lineTotal: 200 },
    { name: 'Fries', quantity: 2, lineTotal: 100 },
  ],
  grandTotal: 300,
  paymentMethod: 'cash',
  trackUrl: '/track?orderNo=ORD-1-ABC123-42&phone=01712345678',
  ...over,
});

describe('renderOrderConfirmationHtml', () => {
  it('renders the ticket: stub, order number, items, total and track button', () => {
    const html = renderOrderConfirmationHtml(sample());
    expect(html).toContain('Order ticket · Confirmed');
    expect(html).toContain('Split Diner');
    expect(html).toContain('🎟️ ORD-1-ABC123-42');
    expect(html).toContain('Burger');
    expect(html).toContain('৳ 300');
    expect(html).toContain('Track your order');
    // The track button href carries the order + phone, properly escaped.
    expect(html).toContain('href="/track?orderNo=ORD-1-ABC123-42&amp;phone=01712345678"');
  });

  it('renders table + payment meta when present', () => {
    const html = renderOrderConfirmationHtml(sample());
    expect(html).toContain('🪑 7');
    expect(html).toContain('cash');
  });

  it('escapes customer + item input (no HTML injection)', () => {
    const html = renderOrderConfirmationHtml(
      sample({
        customerName: '<script>alert(1)</script>',
        items: [{ name: '<img src=x onerror=alert(1)>', quantity: 1, lineTotal: 5 }],
      })
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('handles an empty item list and a missing order number gracefully', () => {
    const html = renderOrderConfirmationHtml({ ...sample(), items: [], orderNo: '' });
    expect(html).toContain('—');
  });
});

describe('renderOrderStatusEmailHtml', () => {
  it('stamps the new status on the ticket stub', () => {
    const html = renderOrderStatusEmailHtml({ ...sample(), status: 'ready' });
    expect(html).toContain('🛍️ Ready — please collect');
    expect(html).toContain('Status update');
    expect(html).toContain('Track your order');
    expect(html).toContain('৳ 300');
  });

  it('covers every emailable status', () => {
    expect(STATUS_EMAIL_KEYS.sort()).toEqual([
      'delivered',
      'out_for_delivery',
      'preparing',
      'ready',
    ]);
    for (const status of STATUS_EMAIL_KEYS) {
      const html = renderOrderStatusEmailHtml({ ...sample(), status });
      expect(html).toContain('Order ticket');
    }
  });

  it('escapes the status stamp and order number', () => {
    const html = renderOrderStatusEmailHtml({
      ...sample(),
      orderNo: '<img src=x onerror=alert(1)>',
      status: 'ready',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('sendOrderConfirmationEmail', () => {
  it('sends nothing when the order has no email', async () => {
    const result = await sendOrderConfirmationEmail({
      tenant: { name: 'Split Diner' },
      order: { order_no: 'ORD-1', customer_name: 'Rahim', customer_email: null, grand_total: 10 },
      items: [],
      trackUrl: '/track?x=1',
    });
    expect(result).toBeNull();
  });

  it('sends through the mail adapter with a ticket body (stub driver logs)', async () => {
    const result = await sendOrderConfirmationEmail({
      tenant: { name: 'Split Diner' },
      order: {
        order_no: 'ORD-1-ABC123-42',
        customer_name: 'Rahim',
        customer_email: 'rahim@example.com',
        table_no: 3,
        grand_total: 300,
        payment_method: 'bkash',
      },
      items: [{ item_name: 'Burger', quantity: 1, line_total: 200 }],
      trackUrl: '/track?orderNo=ORD-1-ABC123-42&phone=01712345678',
    });
    expect(result).not.toBeNull();
    expect(result.messageId).toMatch(/^stub-/);
    expect(result.attachments).toBe(0);
  });
});

describe('sendOrderStatusEmail', () => {
  it('sends nothing for non-emailable statuses or missing email', async () => {
    expect(
      await sendOrderStatusEmail({
        tenant: { name: 'Split Diner' },
        order: { id: 1, customer_email: null, status: 'ready' },
        status: 'ready',
      })
    ).toBeNull();
    expect(
      await sendOrderStatusEmail({
        tenant: { name: 'Split Diner' },
        order: { id: 1, customer_email: 'a@b.co' },
        status: 'placed',
      })
    ).toBeNull();
  });

  it('sends a status-update ticket through the stub mailer', async () => {
    const result = await sendOrderStatusEmail({
      tenant: { name: 'Split Diner' },
      order: {
        id: 1,
        order_no: 'ORD-1-ABC123-42',
        customer_name: 'Rahim',
        customer_email: 'rahim@example.com',
        customer_phone: '01712345678',
        table_no: 3,
        grand_total: 300,
        items: [{ item_name: 'Burger', quantity: 1, line_total: 200 }],
      },
      status: 'ready',
    });
    expect(result).not.toBeNull();
    expect(result.messageId).toMatch(/^stub-/);
  });
});
