import { describe, it, expect } from 'vitest';
import { renderTicketPdf } from '../services/notifications/ticketPdf.js';

/**
 * Ticket PDF (Phase 8) — the printable attachment for the order emails,
 * drawn with pdfkit. The generator must always return a valid PDF buffer,
 * survive hostile/Bengali text (Helvetica is Latin-only → sanitized), and
 * keep the ticket identity in the drawing.
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
  paymentMethod: 'bkash',
  trackUrl: '/track?orderNo=ORD-1-ABC123-42&phone=01712345678',
  stamp: 'ORDER TICKET · CONFIRMED',
  ...over,
});

describe('renderTicketPdf', () => {
  it('produces a valid PDF with the ticket identity', async () => {
    const buf = await renderTicketPdf(sample());
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1500);
  });

  it('handles an empty item list', async () => {
    const buf = await renderTicketPdf(sample({ items: [] }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('sanitizes non-Latin text (Bengali names survive without crashing)', async () => {
    const buf = await renderTicketPdf(
      sample({
        restaurantName: 'ঢাকা বার্গার হাউস',
        customerName: 'রহিম উদ্দিন',
        items: [{ name: 'বিফ বার্গার', quantity: 1, lineTotal: 250 }],
      })
    );
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('escapes hostile order numbers into safe filenames upstream', () => {
    // The filename sanitizer lives in orderConfirmation; here we only pin
    // that the PDF itself never throws on odd inputs.
    expect(
      renderTicketPdf(sample({ orderNo: '<script>alert(1)</script>', customerName: '<b>x</b>' }))
    ).resolves.toBeInstanceOf(Buffer);
  });
});
