#!/usr/bin/env node
/**
 * Gateway sandbox (Phase 5/6) — a dev-only mock of SSLCommerz + Stripe +
 * bKash that lets the FULL online-payment flow run locally with zero external
 * credentials:
 *
 *   backend/.env:
 *     PAYMENT_GATEWAY=stripe            # or sslcommerz / bkash
 *     SSLCOMMERZ_API_URL=http://localhost:4321   # session create → sandbox
 *     STRIPE_API_URL=http://localhost:4321       # session create → sandbox
 *     BKASH_API_URL=http://localhost:4321/tokenized   # → sandbox (bKash)
 *
 * The sandbox implements the exact wire contract each gateway uses:
 *   - SSLCommerz POST /gwprocess/v4/api.php  → SUCCESS + GatewayPageURL
 *   - Stripe     POST /v1/checkout/sessions  → { id, url }
 *   - bKash      POST /tokenized/checkout/{token/grant,create,execute}
 * and then completes the loop exactly like the live gateways would:
 *   - SSLCommerz/Stripe POST the **signed webhook** (md5 / HMAC-SHA256) to
 *     the real backend, with signatures computed from the same secrets the
 *     backend has in .env, so verification genuinely passes.
 *   - bKash redirects the customer's browser to the merchant's callback URL
 *     (the real flow has no server webhook); the backend then calls
 *     /tokenized/checkout/execute, which the sandbox answers as Completed.
 *
 * Usage:
 *   node scripts/gateway-sandbox.mjs [--port 4321] [--auto] [--api http://localhost:4000]
 *
 *   --auto  confirm every payment immediately (no human click) — used by the
 *           gateway-e2e script and CI-style smoke runs
 *   --api   the real backend base URL that receives webhooks (default
 *           http://localhost:4000)
 *
 * Without --auto it serves a tiny "Pay now" page per session so you can watch
 * the flow click-by-click in a browser.
 */
import http from 'node:http';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import 'dotenv/config';

const args = process.argv.slice(2);
const port = Number(args[args.indexOf('--port') + 1] || process.env.GATEWAY_SANDBOX_PORT || 4321);
const autoConfirm = args.includes('--auto');
const apiBase = args[args.indexOf('--api') + 1] || process.env.APP_API_URL || 'http://localhost:4000';

const storeId = process.env.SSLCOMMERZ_STORE_ID || 'sandbox-store';
const storePass = process.env.SSLCOMMERZ_STORE_PASSWORD || 'sandbox-store-pass';
const stripeSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_sandbox';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const hmac = (secret, payload) => createHmac('sha256', secret).update(payload).digest('hex');
const sanitizeLogLine = (v) => String(v).replace(/[\x00-\x1f\x7f]/g, ' ').trim();

/** Sessions the sandbox knows about. */
const sessions = new Map(); // key = tranId / cs_xxx

function sslcommerzSignature({ store_passwd, store_id, tran_id, amount, currency, status }) {
  return md5(`${store_passwd}${store_id}${tran_id}${amount}${currency}${status}`);
}

function stripeSignature(rawBody) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return { timestamp, signature: hmac(stripeSecret, `${timestamp}.${rawBody}`) };
}

/** POST the confirmation webhook to the real backend. */
async function confirmSslcommerz(session) {
  const body = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePass,
    tran_id: session.tranId,
    amount: session.amount.toFixed(2),
    currency: 'BDT',
    status: 'VALID',
    val_id: `VAL-${randomBytes(4).toString('hex').toUpperCase()}`,
  });
  body.set('verify_sign', sslcommerzSignature(Object.fromEntries(body)));
  const res = await fetch(`${apiBase}/api/webhooks/sslcommerz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  console.log(`  [sandbox] SSLCommerz webhook → ${res.status} applied=${data.applied}`);
  return data;
}

async function confirmStripe(session) {
  const rawBody = JSON.stringify({
    id: `evt_${randomBytes(6).toString('hex')}`,
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: session.id, payment_intent: `pi_${randomBytes(6).toString('hex')}` } },
  });
  const { timestamp, signature } = stripeSignature(rawBody);
  const res = await fetch(`${apiBase}/api/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': `t=${timestamp},v1=${signature}`,
    },
    body: rawBody,
  });
  const data = await res.json().catch(() => ({}));
  console.log(`  [sandbox] Stripe webhook → ${res.status} received=${data.received}`);
  return data;
}

const html = (title, body) => `
<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f6f7f9;display:grid;place-items:center;min-height:100vh;margin:0;color:#1a1d21}
  .card{background:#fff;border-radius:16px;padding:40px;max-width:420px;width:90%;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center}
  h1{font-size:20px;margin:0 0 6px}.sub{color:#68707a;margin:0 0 24px;font-size:14px}
  .amt{font-size:34px;font-weight:800;margin:0 0 24px}
  .badge{display:inline-block;background:#eef2ff;color:#4f46e5;font-size:12px;font-weight:700;border-radius:999px;padding:4px 12px;margin-bottom:18px}
  button{background:#4f46e5;color:#fff;border:0;border-radius:12px;padding:12px 28px;font-size:15px;font-weight:700;cursor:pointer}
  button:hover{background:#4338ca}.note{color:#8a929c;font-size:12px;margin-top:18px}
</style></head><body><div class="card">${body}</div></body></html>`;

const payPage = (gateway, session) => {
  const auto = autoConfirm
    ? `<script>fetch('/confirm/${gateway}/${encodeURIComponent(session.key)}').then(() => location.reload());</script>`
    : '';
  const confirmed = session.confirmed
    ? '<div class="badge">✓ Confirmed — webhook sent to backend</div><p class="sub">Check the Orders page — the payment is now <b>paid</b>.</p>'
    : '';
  return html(
    `Sandbox payment · ${session.key}`,
    `${auto}
     <div class="badge">${gateway === 'stripe' ? 'Stripe test mode' : 'SSLCommerz sandbox'}</div>
     <h1>${session.key}</h1>
     <p class="sub">This is a fake checkout page served by the local gateway sandbox.</p>
     <p class="amt">৳ ${session.amount.toFixed(2)}</p>
     ${confirmed || `<button onclick="fetch('/confirm/${gateway}/${encodeURIComponent(session.key)}').then(() => location.reload())">Pay now</button>`}
     <p class="note">Clicking Pay sends the signed webhook to ${apiBase}</p>`
  );
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  await new Promise((r) => req.on('end', r));

  const send = (code, contentType, body) => {
    res.writeHead(code, { 'Content-Type': contentType });
    res.end(body);
  };

  try {
    // ── SSLCommerz: session creation ─────────────────────────────────────
    if (url.pathname === '/gwprocess/v4/api.php' && req.method === 'POST') {
      const params = new URLSearchParams(Buffer.concat(chunks).toString());
      const tranId = params.get('tran_id') || `TXN-SANDBOX-${Date.now()}`;
      const amount = Number(params.get('total_amount') || 0);
      sessions.set(tranId, { key: tranId, tranId, amount, gateway: 'sslcommerz', confirmed: false });
      console.log(`  [sandbox] SSLCommerz session created: ${sanitizeLogLine(tranId)} (৳${amount})`);
      if (autoConfirm) confirmSslcommerz(sessions.get(tranId)).catch((e) => console.error('  [sandbox] auto-confirm failed:', e.message));
      return send(200, 'application/json', JSON.stringify({
        status: 'SUCCESS',
        GatewayPageURL: `http://localhost:${port}/pay/sslcommerz/${tranId}`,
        StoreID: storeId,
        TranID: tranId,
      }));
    }

    // ── bKash: token grant ───────────────────────────────────────────────
    if (url.pathname === '/tokenized/checkout/token/grant' && req.method === 'POST') {
      console.log('  [sandbox] bKash token granted');
      return send(200, 'application/json', JSON.stringify({
        id_token: `id_token_${randomBytes(8).toString('hex')}`,
        refresh_token: `refresh_${randomBytes(8).toString('hex')}`,
        expires_in: 3600,
      }));
    }

    // ── bKash: create payment ────────────────────────────────────────────
    if (url.pathname === '/tokenized/checkout/create' && req.method === 'POST') {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const paymentID = `TR00${randomBytes(8).toString('hex').toUpperCase()}`;
      const amount = Number(body.amount || 0);
      sessions.set(paymentID, {
        key: paymentID,
        paymentID,
        amount,
        gateway: 'bkash',
        callbackURL: body.callbackURL,
        confirmed: false,
      });
      console.log(`  [sandbox] bKash payment created: ${paymentID} (৳${amount})`);
      return send(200, 'application/json', JSON.stringify({
        paymentID,
        bkashURL: `http://localhost:${port}/pay/bkash/${paymentID}`,
        status: 'Initiated',
      }));
    }

    // ── bKash: execute payment (called by the backend after the callback) ─
    if (url.pathname === '/tokenized/checkout/execute' && req.method === 'POST') {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const session = sessions.get(body.paymentID);
      if (!session) {
        return send(400, 'application/json', JSON.stringify({ statusMessage: 'Payment not found' }));
      }
      session.confirmed = true;
      return send(200, 'application/json', JSON.stringify({
        paymentID: session.paymentID,
        trxID: `TRX${randomBytes(5).toString('hex').toUpperCase()}`,
        transactionStatus: 'Completed',
        amount: session.amount.toFixed(2),
        currency: 'BDT',
      }));
    }

    // ── Stripe: session creation ─────────────────────────────────────────
    if (url.pathname === '/v1/checkout/sessions' && req.method === 'POST') {
      const params = new URLSearchParams(Buffer.concat(chunks).toString());
      const id = `cs_sandbox_${randomBytes(6).toString('hex')}`;
      const amount = Number(params.get('line_items[0][price_data][unit_amount]') || 0) / 100;
      sessions.set(id, { key: id, id, amount, gateway: 'stripe', confirmed: false });
      console.log(`  [sandbox] Stripe session created: ${id} (৳${amount})`);
      if (autoConfirm) confirmStripe(sessions.get(id)).catch((e) => console.error('  [sandbox] auto-confirm failed:', e.message));
      return send(200, 'application/json', JSON.stringify({
        id,
        object: 'checkout.session',
        url: `http://localhost:${port}/pay/stripe/${id}`,
        payment_status: 'unpaid',
      }));
    }

    // ── Payment page + confirm action ────────────────────────────────────
    const pay = url.pathname.match(/^\/pay\/(sslcommerz|stripe|bkash)\/([^/]+)$/);
    if (pay) {
      const [, gateway, key] = pay;
      const session = sessions.get(decodeURIComponent(key));
      if (!session) return send(404, 'text/html', html('Unknown session', '<h1>Session not found</h1><p class="sub">This sandbox payment session does not exist.</p>'));
      if (gateway === 'bkash') {
        // bKash has no server webhook — after "paying", the customer's
        // browser is redirected to the merchant callback URL, which the
        // backend turns into the execute round-trip. In --auto mode that
        // redirect happens server-side so headless fetches complete the loop.
        const target = `${session.callbackURL}?paymentID=${encodeURIComponent(session.paymentID)}&status=success`;
        if (autoConfirm) {
          res.writeHead(302, { Location: target });
          return res.end();
        }
        return send(
          200,
          'text/html',
          html(
            `Sandbox payment · ${session.paymentID}`,
            `<div class="badge">bKash sandbox</div>
             <h1>${session.paymentID}</h1>
             <p class="sub">This is a fake bKash page served by the local gateway sandbox.</p>
             <p class="amt">৳ ${session.amount.toFixed(2)}</p>
             <a href="${target}" style="display:inline-block;background:#e2136e;color:#fff;border-radius:12px;padding:12px 28px;font-size:15px;font-weight:700;text-decoration:none">Pay now</a>
             <p class="note">Paying redirects to the merchant callback → execute → paid</p>`
          )
        );
      }
      return send(200, 'text/html', payPage(gateway, session));
    }

    const confirm = url.pathname.match(/^\/confirm\/(sslcommerz|stripe)\/([^/]+)$/);
    if (confirm) {
      const [, gateway, key] = confirm;
      const session = sessions.get(decodeURIComponent(key));
      if (!session) return send(404, 'application/json', JSON.stringify({ error: 'unknown session' }));
      if (session.confirmed) return send(200, 'application/json', JSON.stringify({ already: true }));
      session.confirmed = true;
      const result = gateway === 'stripe' ? await confirmStripe(session) : await confirmSslcommerz(session);
      return send(200, 'application/json', JSON.stringify(result));
    }

    if (url.pathname === '/health') return send(200, 'application/json', JSON.stringify({ ok: true, auto: autoConfirm }));
    send(404, 'application/json', JSON.stringify({ error: 'not found' }));
  } catch (e) {
    console.error('  [sandbox] error:', e.message);
    send(500, 'application/json', JSON.stringify({ error: e.message }));
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`🧪 Gateway sandbox listening on http://localhost:${port}`);
  console.log(`   API base (webhooks →): ${apiBase}`);
  console.log(`   Auto-confirm: ${autoConfirm ? 'ON (every payment is confirmed instantly)' : 'OFF (serve a clickable Pay page)'}`);
  console.log(`   Point your backend at it with SSLCOMMERZ_API_URL / STRIPE_API_URL = http://localhost:${port}`);
});
