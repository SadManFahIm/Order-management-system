import PDFDocument from 'pdfkit';

/**
 * Ticket PDF (Phase 8) — the same hand-held ticket the customer tore off the
 * menu, as a printable PDF attachment for the order emails. Drawn with
 * pdfkit (pure JS, no browser): a gold-foil brand stub with the order number
 * stamped on it, the scalloped tear, dashed ticket rows for the items and a
 * chilli-red total — identical in spirit to the inline email HTML.
 *
 * pdfkit ships the standard Helvetica family (Latin-1 only), so text is
 * sanitized to Latin characters and the taka sign becomes `BDT ` — the PDF
 * stays clean and glyph-safe in every mail client.
 */

const STUB_TOP = '#00b3a5';
const STUB_BOTTOM = '#0c6b5e';
const INK = '#18342b';
const MUTED = '#7d786a';
const LINE = '#e6dcc4';
const CHILLI = '#d2452f';
const GOLD = '#c9962e';
const PAPER = '#fdfaf2';

/** Keep only glyphs Helvetica can draw; fall back gracefully. */
const latin = (v, fallback = '—') => {
  const s = String(v ?? '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || fallback;
};

const fmtBdt = (n) =>
  `BDT ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * @param {{
 *   restaurantName: string,
 *   orderNo: string,
 *   customerName: string,
 *   tableNo?: number|null,
 *   items: Array<{name: string, quantity: number, lineTotal: number}>,
 *   grandTotal: number,
 *   paymentMethod?: string|null,
 *   trackUrl?: string,
 *   stamp?: string,        // e.g. 'ORDER TICKET · CONFIRMED'
 * }} data
 * @returns {Promise<Buffer>}
 */
export function renderTicketPdf(data) {
  return new Promise((resolve, reject) => {
    const items = data.items || [];
    const W = 380;
    const STUB_H = 92;
    const H = 306 + items.length * 24;
    const doc = new PDFDocument({ size: [W, H], margin: 0 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    /* ---- Gold-foil brand stub ---- */
    const stub = doc
      .linearGradient(0, 0, 0, STUB_H)
      .stop(0, STUB_TOP)
      .stop(1, STUB_BOTTOM);
    doc.rect(0, 0, W, STUB_H).fill(stub);

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#bfe8e2');
    doc.text(latin(data.stamp || 'ORDER TICKET', 'ORDER TICKET'), 24, 16, {
      characterSpacing: 1.2,
    });
    doc.font('Helvetica-Bold').fontSize(17).fillColor('#ffffff');
    doc.text(latin(data.restaurantName, 'Restaurant'), 24, 30);
    doc.font('Helvetica').fontSize(9).fillColor('#e6f4f0');
    doc.text(`Order ${latin(data.orderNo)}`, 24, 52);

    // Gold order-number stamp (dashed gold box).
    const stampText = latin(data.orderNo, '—');
    const stampW = doc.widthOfString(stampText) + 26;
    doc
      .roundedRect(W - 24 - stampW, 26, stampW, 40, 8)
      .dash(3, 2)
      .strokeColor(GOLD)
      .stroke();
    doc
      .fillColor('#f7e08b')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(stampText, W - 24 - stampW + 13, 39, { width: stampW - 26 });

    /* ---- Scalloped tear (white semicircles over the stub edge) ---- */
    for (let i = 0; i < W / 20; i += 1) {
      doc.circle(10 + i * 20, STUB_H, 10).fill(PAPER);
    }

    /* ---- Paper body ---- */
    doc.rect(0, STUB_H + 10, W, H - STUB_H - 10).fill(PAPER);
    doc
      .moveTo(24, STUB_H + 24)
      .lineTo(W - 24, STUB_H + 24)
      .dash(2, 3)
      .strokeColor(LINE)
      .stroke();

    let y = STUB_H + 40;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(
      `Thanks ${latin(data.customerName, 'guest')} — your ticket is below.`,
      24,
      y,
      { width: W - 48 }
    );
    y += 24;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    doc.text('ITEMS', 24, y, { characterSpacing: 1 });
    y += 16;

    for (const item of items) {
      doc.font('Helvetica').fontSize(10).fillColor(INK);
      doc.text(latin(item.name, 'Item'), 24, y, { width: W - 150 });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(MUTED)
        .text(`× ${Number(item.quantity) || 0}`, 24, y + 12);
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(INK)
        .text(fmtBdt(item.lineTotal), W - 96, y, { width: 72, align: 'right' });
      y += 24;
      doc
        .moveTo(24, y - 8)
        .lineTo(W - 24, y - 8)
        .dash(2, 3)
        .strokeColor(LINE)
        .stroke();
    }
    if (items.length === 0) {
      doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('—', 24, y);
      y += 24;
    }

    y += 6;
    doc.font('Helvetica-Bold').fontSize(14).fillColor(CHILLI);
    doc.text('Total', 24, y, { width: 120 });
    doc.text(fmtBdt(data.grandTotal), W - 96, y, { width: 72, align: 'right' });
    y += 26;

    if (data.paymentMethod) {
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(MUTED)
        .text(`Payment: ${latin(data.paymentMethod, '—')}`, 24, y);
      y += 18;
    }
    if (data.tableNo) {
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor(MUTED)
        .text(`Table: ${latin(data.tableNo)}`, 24, y);
      y += 18;
    }
    if (data.trackUrl) {
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(`Track your order: ${latin(data.trackUrl)}`, 24, y, {
          width: W - 48,
        });
    }

    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(
        `Orderly · The Table Ticket · ${latin(data.restaurantName, 'Restaurant')}`,
        0,
        H - 26,
        { align: 'center', width: W }
      );

    doc.end();
  });
}
