import { sendEmail } from './email.js';
import { ownerEmailsFor } from './quotaAlert.js';

/**
 * Trial-expiry upgrade nudge (Phase 3) — ticket-styled, sent when a
 * workspace's trial ends: the workspace is on Free now, and this email
 * shows exactly what the trial plan gave them versus what Free keeps.
 */

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export function renderUpgradeNudgeHtml({ tenantName, planName, trialEndedAt }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trial ended — ${esc(tenantName)}</title>
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
  .meta{display:flex;justify-content:space-between;font-size:12.5px;margin:5px 0;color:var(--muted)}
  .btn{display:block;width:100%;margin:22px 0 0;padding:14px;border:none;border-radius:14px;background:var(--gold);color:#fff;font-weight:800;font-size:15px;text-align:center;text-decoration:none}
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
      <span class="eyebrow">⏳ Trial ended</span>
      <h1>${esc(tenantName)}</h1>
      <div class="stamp">You're now on the Free plan</div>
    </div>
    <div class="body">
      <p class="greet">Your <b>${esc(planName || 'trial')}</b> trial ended${trialEndedAt ? ` on ${esc(new Date(trialEndedAt).toLocaleDateString())}` : ''}. Your workspace is still fully working — it just moved to the <b>Free</b> plan.</p>
      <h2>What changed</h2>
      <div class="meta"><span>Menu items</span><span>20 limit</span></div>
      <div class="meta"><span>Orders per day</span><span>50 limit</span></div>
      <div class="meta"><span>Team members</span><span>2 limit</span></div>
      <div class="meta"><span>Storage</span><span>100 MB</span></div>
      <p style="font-size:13px;color:var(--muted);margin-top:14px">Reaching a limit pauses new entries with a clear message. Upgrade any time to lift every limit instantly and keep your full menu, team and history.</p>
      <a class="btn" href="${esc(process.env.APP_BASE_URL || 'http://localhost:5173')}/settings">💳 Upgrade your plan</a>
      <div class="foot">Orderly · The Table Ticket · ${esc(tenantName)}</div>
    </div>
  </div>
</div>
</body></html>`;
}

/** Best-effort nudge to every owner. */
export async function sendUpgradeNudgeEmail({ tenant, planName, trialEndedAt }) {
  try {
    const [to] = await ownerEmailsFor(tenant.id);
    if (!to) return null;
    return await sendEmail({
      to,
      subject: `Your trial ended — ${tenant.name} is on Free now`,
      html: renderUpgradeNudgeHtml({ tenantName: tenant.name, planName, trialEndedAt }),
    });
  } catch {
    return null;
  }
}
