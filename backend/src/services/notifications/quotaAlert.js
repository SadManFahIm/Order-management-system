import { sendEmail } from './email.js';
import { User, UserTenant } from '../../models/index.js';

/** Owner emails for a workspace (used by quota + trial alerts). */
export async function ownerEmailsFor(tenantId) {
  const memberships = await UserTenant.findAll({
    where: { tenant_id: tenantId, role: 'owner' },
    include: [{ model: User, attributes: ['id', 'email', 'name'] }],
  });
  return memberships.map((m) => m.User?.email).filter(Boolean);
}

/**
 * Plan-quota warning email (Phase 3) — ticket-styled, sent to the
 * workspace's owners when a plan limit crosses 80/90/100%. Fire-and-forget
 * from planService.notifyQuotaIfCrossed; never rejects.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const TICKET_CSS = `
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
  .meter{height:10px;border-radius:99px;background:var(--line);overflow:hidden;margin:8px 0 4px}
  .meter>div{height:100%;border-radius:99px;background:var(--chilli)}
  .meta{display:flex;justify-content:space-between;font-size:12.5px;margin:5px 0;color:var(--muted)}
  .btn{display:block;width:100%;margin:22px 0 0;padding:14px;border:none;border-radius:14px;background:var(--brand);color:#fff;font-weight:800;font-size:15px;text-align:center;text-decoration:none}
  .foot{margin-top:18px;text-align:center;color:var(--muted);font-size:11px;border-top:1px dashed var(--line);padding-top:12px}
  @media (prefers-color-scheme: dark){
    :root{--ink:#e8efe9;--muted:#8ba397;--line:#1e3129;--line-strong:#2b453b;--chilli:#ff6b4a;--gold:#e0b04e;--stub:color-mix(in srgb,var(--brand) 58%,#04100b)}
    body{background:#0b1210}
    .ticket{background:#101c18;border-color:var(--line);box-shadow:0 10px 30px rgba(0,0,0,.4)}
  }
`;

export function renderQuotaAlertHtml({ tenantName, planName, alert }) {
  const pct = Math.min(100, Number(alert.percent) || 0);
  const level =
    pct >= 100 ? 'Plan limit reached' : pct >= 90 ? 'Plan nearly full' : 'Plan getting full';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(level)} — ${esc(tenantName)}</title>
<style>${TICKET_CSS}</style></head><body>
<div class="wrap">
  <div class="ticket">
    <div class="stub">
      <span class="eyebrow">📊 Plan usage alert</span>
      <h1>${esc(tenantName)}</h1>
      <div class="stamp">${esc(level)} · ${esc(alert.label)}</div>
    </div>
    <div class="body">
      <p class="greet">You've used <b>${pct}%</b> of your ${esc(planName || 'current')} plan's ${esc(alert.label)} (${esc(alert.used)}/${esc(alert.limit)}).</p>
      <div class="meter"><div style="width:${pct}%"></div></div>
      <div class="meta"><span>${esc(alert.label)}</span><span>${esc(alert.used)} / ${esc(alert.limit)}</span></div>
      <p style="font-size:13px;color:var(--muted);margin-top:14px">When a limit is hit, new ${esc(alert.label)} are paused with a clear “plan limit reached” message. Upgrading lifts every limit instantly.</p>
      <a class="btn" href="${esc(process.env.APP_BASE_URL || 'http://localhost:5173')}/settings">💳 View plan &amp; usage</a>
      <div class="foot">Orderly · The Table Ticket · ${esc(tenantName)}</div>
    </div>
  </div>
</div>
</body></html>`;
}

/** Best-effort send to every owner of the workspace. */
export async function sendQuotaAlertEmail({ tenant, alert }) {
  try {
    const [to] = await ownerEmailsFor(tenant.id);
    if (!to) return null;
    return await sendEmail({
      to,
      subject: `Plan usage alert — ${alert.label} at ${alert.percent}% (${tenant.name})`,
      html: renderQuotaAlertHtml({
        tenantName: tenant.name,
        planName: alert.planName || null,
        alert,
      }),
    });
  } catch {
    return null;
  }
}
