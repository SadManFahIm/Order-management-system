/**
 * WhatsApp order alerts (Phase 5).
 *
 * Two complementary mechanisms, both zero-dependency:
 *
 * 1. **wa.me deep link** — `buildWhatsAppLink(number, text)` produces the
 *    standard `https://wa.me/<number>?text=<encoded>` URL merchants can tap
 *    to ping their own WhatsApp (the common manual workflow in Bangladesh).
 * 2. **Webhook** — when a tenant enables WhatsApp with a `webhookUrl`
 *    (Twilio, WATI, Infobip, Meta Cloud API or any gateway), every new order
 *    is POSTed to it as JSON. Fire-and-forget with a short timeout: a dead or
 *    slow gateway NEVER delays or breaks order creation, and failures are
 *    logged (without secrets) instead of swallowed silently.
 */

import { createHmac } from 'node:crypto';

const WEBHOOK_TIMEOUT_MS = 2500;

/** Builds a wa.me deep link for a phone number + pre-filled message. */
export function buildWhatsAppLink(number, text) {
  const digits = String(number || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Reads the tenant's WhatsApp config from settings (never throws). */
export function whatsappConfig(tenant) {
  const settings =
    tenant?.settings && typeof tenant.settings === 'object' ? tenant.settings : {};
  const wa = settings.whatsapp && typeof settings.whatsapp === 'object' ? settings.whatsapp : {};
  return {
    enabled: Boolean(wa.enabled),
    number: typeof wa.number === 'string' ? wa.number.trim() : '',
    webhookUrl: typeof wa.webhookUrl === 'string' ? wa.webhookUrl.trim() : '',
    secret: typeof wa.secret === 'string' ? wa.secret.trim() : '',
    notifyCustomer: Boolean(wa.notifyCustomer),
  };
}

/** Human-friendly WhatsApp message for an order. */
export function orderWhatsAppText(order, items = []) {
  const lines = [
    `🆕 New order #${order.order_no || order.id}`,
  ];
  if (order.table_no) lines.push(`🪑 Table ${order.table_no}`);
  if (order.customer_name) lines.push(`👤 ${order.customer_name}`);
  for (const item of items.slice(0, 8)) {
    lines.push(`• ${item.item_name || item.name || 'Item'} ×${item.quantity}`);
  }
  if (items.length > 8) lines.push(`… and ${items.length - 8} more`);
  lines.push(`💰 ${Number(order.grand_total ?? order.total_amount ?? 0).toFixed(2)} BDT`);
  lines.push(`📌 Status: ${order.status || 'placed'}`);
  return lines.join('\n');
}

/**
 * Sends a test alert to the configured webhook (Settings → WhatsApp → Send
 * test). Returns a plain result object — never throws.
 */
export async function sendTestAlert(tenant) {
  const config = whatsappConfig(tenant);
  const order = {
    order_no: 'ORD-TEST',
    id: 0,
    table_no: null,
    customer_name: 'Test customer',
    status: 'placed',
    grand_total: 0,
  };
  const text = orderWhatsAppText(order, [{ item_name: 'Sample item', quantity: 1 }]);
  const manual = buildWhatsAppLink(config.number, text);

  if (!config.enabled || !config.webhookUrl) {
    return {
      ok: true,
      sent: false,
      message: 'No webhook configured — here is the message to send manually',
      waLink: manual,
    };
  }
  const sent = await postWebhook(config, {
    event: 'order.test',
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    message: text,
  });
  return { ok: true, sent, waLink: manual };
}

/** Customer-facing status messages, bilingual (EN + BN). */
const CUSTOMER_STATUS_MESSAGES = {
  placed: {
    en: 'We have received your order',
    bn: 'আমরা আপনার অর্ডার পেয়েছি',
  },
  preparing: {
    en: 'Your order is being prepared',
    bn: 'আপনার অর্ডার তৈরি হচ্ছে',
  },
  ready: {
    en: 'Your order is ready — please collect it',
    bn: 'আপনার অর্ডার প্রস্তুত — সংগ্রহ করে নিন',
  },
  delivered: {
    en: 'Your order has been delivered — enjoy your meal!',
    bn: 'আপনার অর্ডার ডেলিভারি হয়েছে — খাবারটি উপভোগ করুন!',
  },
  canceled: {
    en: 'Your order was canceled',
    bn: 'আপনার অর্ডার বাতিল করা হয়েছে',
  },
};

/**
 * Customer-facing status notification (Phase 5).
 *
 * When an order moves status, POST an `order.status_changed` event to the
 * tenant's WhatsApp webhook carrying the customer's phone + a bilingual
 * message — the gateway (Twilio/WATI/Infobip/Meta Cloud API) sends it to the
 * customer. Gated on `whatsapp.notifyCustomer` AND the order having a
 * customer phone. Fire-and-forget, never rejects.
 */
export async function sendStatusNotification(tenant, order, status) {
  try {
    const config = whatsappConfig(tenant);
    if (!config.enabled || !config.webhookUrl || !config.notifyCustomer) {
      return { sent: false, reason: 'disabled' };
    }
    const phone = String(order.customer_phone || '').trim();
    if (!phone) return { sent: false, reason: 'no-phone' };

    const msg =
      CUSTOMER_STATUS_MESSAGES[status] || {
        en: `Your order is now: ${status}`,
        bn: `আপনার অর্ডারের অবস্থা: ${status}`,
      };
    const ref = order.order_no || String(order.id);
    const sent = await postWebhook(config, {
      event: 'order.status_changed',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      orderId: order.id,
      orderNo: ref,
      tableNo: order.table_no ?? null,
      customerName: order.customer_name ?? null,
      customerPhone: phone,
      status,
      message: `🛎️ ${msg.en} #${ref}`,
      messageBn: `🛎️ ${msg.bn} #${ref}`,
      total: Number(order.grand_total ?? order.total_amount ?? 0),
    });
    return { sent };
  } catch (err) {
    console.warn(
      `[whatsapp] status notification failed (${err?.name || 'error'}): ${err?.message || 'unknown'}`
    );
    return { sent: false, reason: 'error' };
  }
}

/**
 * Posts a new order to the tenant's WhatsApp webhook (if configured).
 * Fire-and-forget contract: resolves with {sent:boolean} and NEVER rejects —
 * callers can `void sendOrderAlert(...)` safely.
 */
export async function sendOrderAlert(tenant, order, items = []) {
  try {
    const config = whatsappConfig(tenant);
    if (!config.enabled || !config.webhookUrl) return { sent: false, reason: 'disabled' };

    const text = orderWhatsAppText(order, items);
    const sent = await postWebhook(config, {
      event: 'order.created',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      orderId: order.id,
      orderNo: order.order_no || String(order.id),
      tableNo: order.table_no ?? null,
      customerName: order.customer_name ?? null,
      status: order.status || 'placed',
      total: Number(order.grand_total ?? order.total_amount ?? 0),
      currency: 'BDT',
      items: items.slice(0, 20).map((it) => ({
        name: it.item_name || it.name || 'Item',
        quantity: it.quantity,
        lineTotal: Number(it.line_total ?? it.lineTotal ?? 0),
      })),
      message: text,
    });
    return { sent };
  } catch (err) {
    // Log the failure (URL host only — never credentials/secrets).
    console.warn(
      `[whatsapp] order alert failed (${err?.name || 'error'}): ${err?.message || 'unknown'}`
    );
    return { sent: false, reason: 'error' };
  }
}

/** POSTs a JSON payload to the webhook with a short timeout + optional secret. */
async function postWebhook(config, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const body = JSON.stringify(payload);
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[whatsapp] webhook responded ${res.status}`);
      return false;
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Nightly merchant digest push (Phase 6).
 *
 * Posts the day's top sellers + low-stock list to the tenant's WhatsApp
 * webhook as a `digest.daily` event — signed with HMAC-SHA256 of the body
 * (`X-Webhook-Signature`) when a secret is configured so the receiving
 * gateway can verify it came from us. Fire-and-forget, never rejects;
 * failures are logged without secrets.
 */
/**
 * Plan-quota alert push (Phase 3 hardening).
 *
 * Posts a `quota.warning` event to the tenant's WhatsApp webhook when usage
 * crosses a plan threshold (80/90/100%). Same contract as the digest push:
 * HMAC-SHA256 `X-Webhook-Signature` when a secret is configured, fire and
 * forget, never rejects.
 */
export async function sendQuotaWebhook(tenant, alert) {
  try {
    const config = whatsappConfig(tenant);
    if (!config.enabled || !config.webhookUrl) return { sent: false, reason: 'disabled' };

    const payload = {
      event: 'quota.warning',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      metric: alert.metric,
      used: alert.used,
      limit: alert.limit,
      percent: alert.percent,
      message: alert.message,
    };
    const body = JSON.stringify(payload);
    const signature = config.secret
      ? createHmac('sha256', config.secret).update(body).digest('hex')
      : null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
          ...(signature ? { 'X-Webhook-Signature': signature } : {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[whatsapp] quota webhook responded ${res.status}`);
        return { sent: false, reason: `http-${res.status}` };
      }
      return { sent: true, signature: Boolean(signature) };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(`[whatsapp] quota webhook failed: ${err?.message || 'unknown'}`);
    return { sent: false, reason: 'error' };
  }
}

export async function sendDigestWebhook(tenant, digest) {
  try {
    const config = whatsappConfig(tenant);
    if (!config.enabled || !config.webhookUrl) return { sent: false, reason: 'disabled' };

    const payload = {
      event: 'digest.daily',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      date: digest.date,
      topSellers: digest.topSellers,
      lowStock: digest.lowStock,
      message: digestToText(digest),
    };
    const body = JSON.stringify(payload);
    const signature = config.secret
      ? createHmac('sha256', config.secret).update(body).digest('hex')
      : null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
          ...(signature ? { 'X-Webhook-Signature': signature } : {}),
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        console.warn(`[whatsapp] digest webhook responded ${res.status}`);
        return { sent: false, reason: `http-${res.status}` };
      }
      return { sent: true, signature: Boolean(signature) };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn(
      `[whatsapp] digest push failed (${err?.name || 'error'}): ${err?.message || 'unknown'}`
    );
    return { sent: false, reason: 'error' };
  }
}

/** WhatsApp-friendly text form of the digest (top sellers + low stock). */
export function digestToText(digest) {
  const lines = [`📊 Daily digest — ${digest.date}`];
  if (digest.topSellers?.length) {
    lines.push('🏆 Top sellers:');
    for (const t of digest.topSellers.slice(0, 5)) {
      lines.push(`• ${t.itemName} ×${t.quantity} (৳${Number(t.revenue).toFixed(2)})`);
    }
  } else {
    lines.push('🏆 No sales recorded this day.');
  }
  if (digest.lowStock?.length) {
    lines.push('⚠️ Low stock:');
    for (const i of digest.lowStock.slice(0, 8)) {
      lines.push(`• ${i.itemName} — ${i.stockQty}/${i.lowStockAt} ${i.unit}`);
    }
  } else {
    lines.push('✅ Stock levels healthy.');
  }
  return lines.join('\n');
}
