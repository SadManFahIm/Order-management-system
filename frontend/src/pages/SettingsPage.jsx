import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { PageHeader, Card, Button, Field, Input, Textarea, Switch, Badge, Skeleton, useToast } from '../components/ui';
import DeliveryZonesCard from '../components/DeliveryZonesCard';
import SettlementsCard from '../components/SettlementsCard';

const PRESETS = [
  { name: 'KFC red', primary: '#e4002b', accent: '#ffd400' },
  { name: 'Chillox orange', primary: '#f26522', accent: '#ffc800' },
  { name: 'Deliveroo teal', primary: '#00b3a5', accent: '#f5d300' },
  { name: 'Pizza Hut red', primary: '#d3112a', accent: '#f5b81b' },
  { name: 'Midnight', primary: '#111827', accent: '#22d3c2' },
];

const DEFAULT_BRAND = { primaryColor: '#00b3a5', accentColor: '#f5d300', tagline: '', announcement: '' };

// Phase 3: the plan catalogue + inviteable team roles.
const PLANS = [
  { code: 'free', label: 'Free' },
  { code: 'starter', label: 'Starter' },
  { code: 'pro', label: 'Pro' },
  { code: 'growth', label: 'Growth' },
];

const TEAM_ROLES = ['owner', 'manager', 'cashier', 'kitchen', 'delivery', 'staff'];

export default function SettingsPage() {
  const { t } = useI18n();
  const { activeTenantId, tenants, user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tenant, setTenant] = useState(null);
  const [brand, setBrand] = useState(DEFAULT_BRAND);
  const [wa, setWa] = useState({ enabled: false, number: '', webhookUrl: '', secret: '', notifyCustomer: false });
  const [waSaving, setWaSaving] = useState(false);
  const [pm, setPm] = useState({
    cash: { enabled: true },
    bkash: { enabled: false, number: '' },
    nagad: { enabled: false, number: '' },
    card: { enabled: false },
    online: { enabled: false },
  });
  const [pmSaving, setPmSaving] = useState(false);
  const [waTesting, setWaTesting] = useState(false);
  const [waManualLink, setWaManualLink] = useState(null);
  const [reports, setReports] = useState({ closeoutEmail: '', autoSend: false, hour: 23 });
  const [reportsSaving, setReportsSaving] = useState(false);
  // Invoice/NBR supplier block (Phase 6): registered name, address, 13-digit
  // BIN + default VAT % — printed on every invoice (Mushak-6.3).
  const [inv, setInv] = useState({ registeredName: '', address: '', bin: '', vatRate: '' });
  const [invSaving, setInvSaving] = useState(false);
  // Delivery settings (Phase 6): the fee charged to delivery orders.
  const [delFee, setDelFee] = useState('');
  const [delSaving, setDelSaving] = useState(false);
  // Restaurant-wide closure days + recurring weekday closures (Phase 5):
  // one-off closed dates (holidays/events) and "closed every <weekday>"
  // toggles — the whole storefront is hidden + checkout rejected those days.
  const [closures, setClosures] = useState([]);
  const [closuresLoaded, setClosuresLoaded] = useState(false);
  const [closuresSaving, setClosuresSaving] = useState(false);
  const [weekdayClosures, setWeekdayClosures] = useState([]);
  const [weekdayClosuresLoaded, setWeekdayClosuresLoaded] = useState(false);
  const [closuresError, setClosuresError] = useState('');
  // Bulk import (round 7): paste one closure per line as 'YYYY-MM-DD' or
  // 'YYYY-MM-DD Holiday name' — parsed into { date, label } entries.
  const [closureImport, setClosureImport] = useState('');
  const [closureImportMsg, setClosureImportMsg] = useState(null);
  // Closure-conflict scan (Phase 5 follow-up): items whose windowed override
  // / weekday rule opens them on a day the restaurant is closed.
  const [closureConflicts, setClosureConflicts] = useState(null);
  // Wall-clock timezone (Phase 5 follow-up): availability windows, closure
  // dates and scheduled-order previews resolve in the tenant's IANA timezone.
  const [tz, setTz] = useState('');
  const [tzSaving, setTzSaving] = useState(false);
  // Merchant closure calendar (Phase 5 follow-up): one month grid with
  // closure dates, restaurant-wide weekday closures and per-day override
  // counts — the whole month's availability posture at a glance.
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [calData, setCalData] = useState(null);
  const [calError, setCalError] = useState('');

  // ── Phase 3: plan & usage, invites, ownership, workspace activity ──
  const [planData, setPlanData] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [newPlanCode, setNewPlanCode] = useState('');
  const [invites, setInvites] = useState(null);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'cashier', days: 7 });
  const [inviting, setInviting] = useState(false);
  const [tenantAudit, setTenantAudit] = useState(null);
  const [transferEmail, setTransferEmail] = useState('');
  const lastCreatedInviteRef = useRef(null);

  // ── Phase 2 hardening: security, sessions, audit, team & access ──
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const [sessions, setSessions] = useState(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [audit, setAudit] = useState(null);
  const [members, setMembers] = useState(null);
  const [membersBusy, setMembersBusy] = useState(false);
  const mounted = useRef(true);

  const canManageUsers =
    user?.platformRole === 'platform_admin' ||
    ['owner', 'manager'].includes(user?.tenantRole);

  const loadSecurity = () => {
    api.get('/auth/sessions').then((res) => mounted.current && setSessions(res.data.sessions));
    api.get('/auth/audit').then((res) => mounted.current && setAudit(res.data.events));
  };

  const loadPlan = () => {
    if (!activeTenantId) return;
    api
      .get(`/tenants/${activeTenantId}/plan`)
      .then((res) => mounted.current && setPlanData(res.data))
      .catch(() => mounted.current && setPlanData(null));
  };

  const loadInvites = () => {
    if (!canManageUsers || !activeTenantId) return;
    api
      .get(`/tenants/${activeTenantId}/invites`)
      .then((res) => mounted.current && setInvites(res.data))
      .catch(() => mounted.current && setInvites([]));
  };

  const loadTenantAudit = () => {
    if (!canManageUsers || !activeTenantId) return;
    api
      .get(`/tenants/${activeTenantId}/audit?limit=30`)
      .then((res) => mounted.current && setTenantAudit(res.data.events))
      .catch(() => mounted.current && setTenantAudit([]));
  };

  const loadClosureCalendar = (month) => {
    if (!activeTenantId) return;
    setCalError('');
    api
      .get(`/tenants/${activeTenantId}/closure-calendar?month=${month}`)
      .then((res) => mounted.current && setCalData(res.data))
      .catch(() => {
        if (mounted.current) {
          setCalData(null);
          setCalError(t('settings.calLoadFailed'));
        }
      });
  };

  const shiftCalMonth = (delta) => {
    const [y, m] = calMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setCalMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };

  const saveTimezone = async () => {
    setTzSaving(true);
    try {
      await api.patch(`/tenants/${activeTenantId}`, { timezone: tz.trim() || null });
      toast.success(t('settings.tzSaved'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || t('settings.tzSaveFailed'));
    } finally {
      setTzSaving(false);
    }
  };

  const loadClosures = () => {
    if (!activeTenantId) return;
    setClosuresLoaded(false);
    setWeekdayClosuresLoaded(false);
    api
      .get(`/tenants/${activeTenantId}/closures`)
      .then((res) => {
        if (mounted.current) {
          setClosures(res.data.map((c) => ({ date: c.date, label: c.label || '' })));
          setClosuresLoaded(true);
        }
      })
      .catch(() => mounted.current && setClosuresLoaded(true));
    api
      .get(`/tenants/${activeTenantId}/weekday-closures`)
      .then((res) => {
        if (mounted.current) {
          setWeekdayClosures(res.data.map((c) => c.weekday));
          setWeekdayClosuresLoaded(true);
        }
      })
      .catch(() => mounted.current && setWeekdayClosuresLoaded(true));
    api
      .get(`/tenants/${activeTenantId}/closure-conflicts`)
      .then((res) => mounted.current && setClosureConflicts(res.data))
      .catch(() => mounted.current && setClosureConflicts(null));
  };

  const saveClosures = async () => {
    if (!activeTenantId) return;
    setClosuresSaving(true);
    setClosuresError('');
    try {
      await api.put(`/tenants/${activeTenantId}/closures`, {
        dates: closures.map((c) => ({ date: c.date, label: c.label?.trim() || null })),
      });
      await api.put(`/tenants/${activeTenantId}/weekday-closures`, { weekdays: weekdayClosures });
      toast.success(t('settings.closuresSaved'));
    } catch (err) {
      setClosuresError(err?.response?.data?.error?.message || t('settings.closuresSaveFailed'));
    } finally {
      setClosuresSaving(false);
    }
  };

  const toggleWeekdayClosure = (weekday) =>
    setWeekdayClosures((list) =>
      list.includes(weekday) ? list.filter((w) => w !== weekday) : [...list, weekday]
    );

  const addClosureDate = () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
    setClosures((list) => [...list, { date: today, label: '' }]);
  };

  const removeClosureDate = (i) => setClosures((list) => list.filter((_, idx) => idx !== i));

  /**
   * Bulk closure import (round 7): each non-empty line is 'YYYY-MM-DD' or
   * 'YYYY-MM-DD Holiday name'. Valid dates merge into the pending list
   * (deduped, first label wins); malformed lines are reported, never
   * silently dropped.
   */
  const importClosures = () => {
    const lines = closureImport
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setClosureImportMsg({ ok: false, text: t('settings.closuresImportEmpty') });
      return;
    }
    const added = [];
    const bad = [];
    const seen = new Set(closures.map((c) => c.date));
    for (const line of lines) {
      const m = /^(\d{4}-\d{2}-\d{2})(?:\s+(.+))?$/.exec(line);
      if (!m || Number.isNaN(new Date(`${m[1]}T00:00:00`).getTime())) {
        bad.push(line);
        continue;
      }
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      added.push({ date: m[1], label: (m[2] || '').trim().slice(0, 120) });
    }
    if (added.length > 0) {
      setClosures((list) => [...list, ...added]);
    }
    const parts = [];
    if (added.length > 0) parts.push(`${added.length} ${t('settings.closuresImportAdded')}`);
    if (bad.length > 0) parts.push(`${bad.length} ${t('settings.closuresImportBad')}: ${bad.join(', ')}`);
    setClosureImportMsg(parts.length > 0 ? { ok: bad.length === 0, text: parts.join(' · ') } : null);
  };

  const loadMembers = () => {
    if (!canManageUsers || !activeTenantId) return;
    api
      .get(`/tenants/${activeTenantId}/members`)
      .then((res) => mounted.current && setMembers(res.data))
      .catch(() => mounted.current && setMembers([]));
  };

  useEffect(() => {
    loadSecurity();
    loadMembers();
    loadPlan();
    loadInvites();
    loadTenantAudit();
    loadClosures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTenantId]);

  useEffect(() => {
    loadClosureCalendar(calMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calMonth]);

  const savePassword = async () => {
    setPwError('');
    if (pw.next !== pw.confirm) {
      setPwError(t('settings.secMismatch'));
      return;
    }
    setPwSaving(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: pw.current,
        newPassword: pw.next,
      });
      setPw({ current: '', next: '', confirm: '' });
      toast.success(t('settings.secUpdated'));
      loadSecurity();
    } catch (err) {
      setPwError(
        err?.response?.data?.error?.code === 'INVALID_CREDENTIALS'
          ? t('settings.secWrongCurrent')
          : t('settings.secFailed')
      );
    } finally {
      setPwSaving(false);
    }
  };

  const revokeSession = async (id) => {
    try {
      await api.delete(`/auth/sessions/${id}`);
      toast.success(t('settings.revoked'));
      loadSecurity();
    } catch {
      toast.error('Could not sign out that session');
    }
  };

  const revokeOthers = async () => {
    setSessionsBusy(true);
    try {
      await api.post('/auth/sessions/revoke-others');
      toast.success(t('settings.revokedOthers'));
      loadSecurity();
    } catch {
      toast.error('Could not sign out other devices');
    } finally {
      setSessionsBusy(false);
    }
  };

  const forceReset = async (member) => {
    try {
      await api.post(`/auth/users/${member.userId}/force-password-reset`);
      toast.success(t('settings.teamForceResetDone'));
      loadMembers();
    } catch {
      toast.error('Could not force a password reset');
    }
  };

  const unlock = async (member) => {
    try {
      await api.post(`/auth/users/${member.userId}/unlock`);
      toast.success(t('settings.teamUnlocked'));
      loadMembers();
    } catch {
      toast.error('Could not unlock the account');
    }
  };

  const setFlags = async (member, permissions) => {
    setMembersBusy(true);
    try {
      await api.patch(`/auth/users/${member.userId}/permissions`, {
        tenantId: Number(activeTenantId),
        permissions,
      });
      toast.success(t('settings.teamPermissionsSaved'));
      loadMembers();
    } catch {
      toast.error('Could not save permission flags');
    } finally {
      setMembersBusy(false);
    }
  };

  const changePlan = async () => {
    if (!newPlanCode) return;
    setPlanBusy(true);
    try {
      const res = await api.patch(`/tenants/${activeTenantId}/plan`, { code: newPlanCode });
      setPlanData(res.data);
      toast.success(t('settings.planChanged'));
      loadTenantAudit();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || t('settings.planChangeFailed'));
    } finally {
      setPlanBusy(false);
    }
  };

  const createInvite = async () => {
    setInviting(true);
    try {
      const res = await api.post(`/tenants/${activeTenantId}/invites`, {
        email: inviteForm.email.trim(),
        role: inviteForm.role,
        days: Number(inviteForm.days) || 7,
      });
      const link = `${window.location.origin}/accept-invite/${res.data.token}`;
      lastCreatedInviteRef.current = { id: res.data.id, token: res.data.token };
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        // Clipboard may be blocked — the toast still shows the flow.
      }
      toast.success(t('settings.inviteCreated'));
      setInviteForm({ email: '', role: 'cashier', days: 7 });
      loadInvites();
      loadPlan();
      loadTenantAudit();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not create the invite');
    } finally {
      setInviting(false);
    }
  };

  const revokeInvite = async (invite) => {
    try {
      await api.delete(`/tenants/${activeTenantId}/invites/${invite.id}`);
      toast.success(t('settings.inviteRevoked'));
      loadInvites();
      loadTenantAudit();
    } catch {
      toast.error('Could not revoke the invite');
    }
  };

  const copyInviteLink = async (inviteId, token) => {
    // The raw token is only returned at creation; for pending invites we
    // re-open the creation result — here we copy from the stored row when
    // available (the list carries no token, so we rebuild via the API result
    // captured at create time).
    const stored = lastCreatedInviteRef.current;
    if (stored && stored.id === inviteId && stored.token) {
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/accept-invite/${stored.token}`);
        toast.success(t('settings.inviteLinkCopied'));
        return;
      } catch {
        // fall through
      }
    }
    void token;
    toast.error('Copy the link from the invite creation toast instead');
  };

  const transferOwnership = async () => {
    const target = members?.find((m) => m.email === transferEmail);
    if (!target) return;
    if (!window.confirm(t('settings.transferConfirm')(target.name || target.email))) return;
    try {
      await api.post(`/tenants/${activeTenantId}/transfer-ownership`, { userId: target.userId });
      toast.success(t('settings.transferDone'));
      loadMembers();
      loadTenantAudit();
    } catch {
      toast.error(t('settings.transferFailed'));
    }
  };

  const active = tenants.find((x) => Number(x.id) === Number(activeTenantId));

  useEffect(() => {
    mounted.current = true;
    if (!activeTenantId) {
      setLoading(false);
      return undefined;
    }
    api
      .get(`/tenants/${activeTenantId}`)
      .then((res) => {
        if (!mounted.current) return;
        setTenant(res.data);
        setBrand({
          ...DEFAULT_BRAND,
          ...(res.data.brand || {}),
          logoUrl: res.data.logoUrl || '',
        });
        setWa({
          enabled: Boolean(res.data.settings?.whatsapp?.enabled),
          number: res.data.settings?.whatsapp?.number || '',
          webhookUrl: res.data.settings?.whatsapp?.webhookUrl || '',
          secret: res.data.settings?.whatsapp?.secret || '',
          notifyCustomer: Boolean(res.data.settings?.whatsapp?.notifyCustomer),
        });
        const savedPm = res.data.settings?.paymentMethods || {};
        setPm({
          cash: { enabled: savedPm.cash?.enabled ?? true },
          bkash: { enabled: Boolean(savedPm.bkash?.enabled), number: savedPm.bkash?.number || '' },
          nagad: { enabled: Boolean(savedPm.nagad?.enabled), number: savedPm.nagad?.number || '' },
          card: { enabled: Boolean(savedPm.card?.enabled) },
          online: { enabled: Boolean(savedPm.online?.enabled) },
        });
        const savedRp = res.data.settings?.reports || {};
        setReports({
          closeoutEmail: savedRp.closeoutEmail || '',
          autoSend: Boolean(savedRp.autoSendCloseout?.enabled),
          hour: savedRp.autoSendCloseout?.hour ?? 23,
        });
        setTz(res.data.settings?.timezone || '');
        const savedVat = res.data.settings?.vat || {};
        setInv({
          registeredName: savedVat.registeredName || '',
          address: savedVat.address || '',
          bin: savedVat.bin || '',
          vatRate: savedVat.defaultRate != null ? String(savedVat.defaultRate) : '',
        });
        const savedDel = res.data.settings?.delivery || {};
        setDelFee(savedDel.fee != null ? String(savedDel.fee) : '');
        setLoading(false);
      })
      .catch(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [activeTenantId]);

  const set = (key, value) => setBrand((b) => ({ ...b, [key]: value }));
  const updateWa = (key, value) => setWa((w) => ({ ...w, [key]: value }));

  const saveWhatsApp = async () => {
    setWaSaving(true);
    try {
      await api.patch(`/tenants/${activeTenantId}`, {
        whatsapp: {
          enabled: wa.enabled,
          number: wa.number.trim(),
          webhookUrl: wa.webhookUrl.trim(),
          secret: wa.secret.trim(),
          notifyCustomer: wa.notifyCustomer,
        },
      });
      toast.success(t('settings.waSaved'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not save WhatsApp settings');
    } finally {
      setWaSaving(false);
    }
  };

  const updatePm = (key, patch) => setPm((p) => ({ ...p, [key]: { ...p[key], ...patch } }));

  const savePaymentMethods = async () => {
    setPmSaving(true);
    try {
      await api.patch(`/tenants/${activeTenantId}`, { paymentMethods: pm });
      toast.success(t('settings.pmSaved'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not save payment methods');
    } finally {
      setPmSaving(false);
    }
  };

  const saveReports = async () => {
    setReportsSaving(true);
    try {
      await api.patch(`/tenants/${activeTenantId}`, {
        reports: {
          closeoutEmail: reports.closeoutEmail.trim(),
          autoSendCloseout: { enabled: reports.autoSend, hour: Number(reports.hour) },
        },
      });
      toast.success(t('settings.savedReports'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not save closeout settings');
    } finally {
      setReportsSaving(false);
    }
  };

  const saveInvoice = async () => {
    const bin = inv.bin.trim();
    if (bin && !/^\d{13}$/.test(bin)) {
      toast.error(t('settings.invBinInvalid'));
      return;
    }
    setInvSaving(true);
    try {
      const vat = { registeredName: inv.registeredName.trim(), address: inv.address.trim(), bin };
      const rate = Number(inv.vatRate);
      if (Number.isFinite(rate) && rate >= 0 && rate <= 100) vat.defaultRate = rate;
      await api.patch(`/tenants/${activeTenantId}`, { vat });
      toast.success(t('settings.invSaved'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not save invoice settings');
    } finally {
      setInvSaving(false);
    }
  };

  const saveDelivery = async () => {
    setDelSaving(true);
    try {
      const fee = Number(delFee);
      const delivery = { enabled: true };
      if (Number.isFinite(fee) && fee >= 0) delivery.fee = Math.round(fee * 100) / 100;
      await api.patch(`/tenants/${activeTenantId}`, { delivery });
      toast.success(t('settings.delSaved'));
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not save delivery settings');
    } finally {
      setDelSaving(false);
    }
  };

  const testWhatsApp = async () => {
    setWaTesting(true);
    setWaManualLink(null);
    try {
      const res = await api.post(`/tenants/${activeTenantId}/whatsapp/test`);
      if (res.data.sent) {
        toast.success(t('settings.waTestOk'));
      } else {
        setWaManualLink(res.data.waLink || null);
        toast.success(t('settings.waTestManual'));
      }
    } catch {
      toast.error('Test alert failed');
    } finally {
      setWaTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { logoUrl, ...brandFields } = brand;
      const res = await api.patch(`/tenants/${activeTenantId}`, {
        brand: brandFields,
        logoUrl: logoUrl || null,
      });
      setTenant(res.data);
      setBrand({ ...DEFAULT_BRAND, ...(res.data.brand || {}), logoUrl: res.data.logoUrl || '' });
      toast.success(t('settings.saved'), t('settings.savedDesc'));
    } catch {
      toast.error('Save failed', 'Could not save branding. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="oms-page">
        <PageHeader title={t('settings.page')} desc={t('settings.pageDesc')} />
        <Skeleton height={320} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="oms-page">
        <PageHeader title={t('settings.page')} desc={t('settings.pageDesc')} />
        <Card>
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
            No workspace selected.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="oms-page">
      <PageHeader title={t('settings.page')} desc={t('settings.pageDesc')} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) 380px', gap: 16, alignItems: 'start' }}>
        {/* Editor */}
        <Card title={t('settings.brand')} subtitle={t('settings.brandDesc')}>
          <div style={{ display: 'grid', gap: 16 }}>
            {/* Presets */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('settings.presets')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    className="oms-brand-preset"
                    onClick={() => setBrand((b) => ({ ...b, primaryColor: p.primary, accentColor: p.accent }))}
                    title={p.name}
                  >
                    <span style={{ background: p.primary }} />
                    <span style={{ background: p.accent }} />
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <ColorField label={t('settings.primaryColor')} value={brand.primaryColor} onChange={(v) => set('primaryColor', v)} />
              <ColorField label={t('settings.accentColor')} value={brand.accentColor} onChange={(v) => set('accentColor', v)} />
            </div>

            <Field label={t('settings.tagline')} hint={t('settings.taglineHint')}>
              <Input value={brand.tagline} maxLength={120} onChange={(e) => set('tagline', e.target.value)} placeholder="It’s finger lickin’ good" />
            </Field>

            <Field label={t('settings.announcement')} hint={t('settings.announcementHint')}>
              <Textarea value={brand.announcement} maxLength={160} rows={2} onChange={(e) => set('announcement', e.target.value)} placeholder="Free delivery on orders over ৳500" />
            </Field>

            <Field label={t('settings.logoUrl')}>
              <Input value={brand.logoUrl || ''} maxLength={500} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…" />
            </Field>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? t('common.loading') : t('settings.save')}
              </Button>
              {active?.slug && (
                <Link to={`/m/${active.slug}`} target="_blank" rel="noreferrer">
                  <Button variant="outline">{t('settings.viewStorefront')} ↗</Button>
                </Link>
              )}
            </div>
          </div>
        </Card>

        {/* Live preview */}
        <Card title={t('settings.preview')} subtitle={t('settings.previewHint')}>
          <StorefrontPreview brand={brand} name={tenant.name} logoUrl={tenant.logoUrl} />
        </Card>
      </div>

      {/* WhatsApp order alerts (Phase 5) */}
      <Card title={t('settings.waTitle')} subtitle={t('settings.waDesc')}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Switch
            id="wa-enabled"
            label={t('settings.waEnabled')}
            checked={wa.enabled}
            onChange={(e) => updateWa('enabled', e.target.checked)}
          />
          <div>
            <Switch
              id="wa-notify-customer"
              label={t('settings.waNotifyCustomer')}
              checked={wa.notifyCustomer}
              onChange={(e) => updateWa('notifyCustomer', e.target.checked)}
            />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('settings.waNotifyCustomerHint')}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label={t('settings.waNumber')} hint={t('settings.waNumberHint')}>
              <Input value={wa.number} maxLength={20} onChange={(e) => updateWa('number', e.target.value)} placeholder="+8801712345678" />
            </Field>
            <Field label={t('settings.waWebhook')} hint={t('settings.waWebhookHint')}>
              <Input value={wa.webhookUrl} maxLength={500} onChange={(e) => updateWa('webhookUrl', e.target.value)} placeholder="https://gateway.example.com/hook" />
            </Field>
          </div>
          <Field label={t('settings.waSecret')} hint={t('settings.waSecretHint')}>
            <Input value={wa.secret} maxLength={200} onChange={(e) => updateWa('secret', e.target.value)} placeholder="shared-secret" />
          </Field>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" onClick={saveWhatsApp} disabled={waSaving}>
              {waSaving ? t('common.loading') : t('settings.waSave')}
            </Button>
            <Button variant="outline" onClick={testWhatsApp} disabled={waTesting}>
              {waTesting ? t('common.loading') : t('settings.waTest')}
            </Button>
            {waManualLink && (
              <a href={waManualLink} target="_blank" rel="noreferrer">
                <Button variant="ghost">{t('settings.waSendLink')} ↗</Button>
              </a>
            )}
          </div>
        </div>
      </Card>

      {/* Payment methods (Phase 5) — bKash/Nagad/cash acceptance */}
      <Card title={t('settings.pmTitle')} subtitle={t('settings.pmDesc')}>
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
            <MethodCard
              label={t('settings.pmCash')}
              enabled={pm.cash.enabled}
              onToggle={(v) => updatePm('cash', { enabled: v })}
            />
            <MethodCard
              label={t('settings.pmBkash')}
              enabled={pm.bkash.enabled}
              onToggle={(v) => updatePm('bkash', { enabled: v })}
              number={pm.bkash.number}
              onNumber={(v) => updatePm('bkash', { number: v })}
              numberLabel={t('settings.pmNumber')}
              numberHint={t('settings.pmNumberHint')}
            />
            <MethodCard
              label={t('settings.pmNagad')}
              enabled={pm.nagad.enabled}
              onToggle={(v) => updatePm('nagad', { enabled: v })}
              number={pm.nagad.number}
              onNumber={(v) => updatePm('nagad', { number: v })}
              numberLabel={t('settings.pmNumber')}
              numberHint={t('settings.pmNumberHint')}
            />
            <MethodCard
              label={t('settings.pmCard')}
              enabled={pm.card.enabled}
              onToggle={(v) => updatePm('card', { enabled: v })}
            />
            <MethodCard
              label={t('settings.pmOnline')}
              enabled={pm.online.enabled}
              onToggle={(v) => updatePm('online', { enabled: v })}
              hint={t('settings.pmOnlineHint')}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={savePaymentMethods} disabled={pmSaving}>
              {pmSaving ? t('common.loading') : t('settings.pmSave')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Invoice / NBR supplier block (Phase 6) — registered name, address,
          BIN + default VAT printed on every invoice. */}
      <Card title={t('settings.invTitle')} subtitle={t('settings.invDesc')} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label={t('settings.invRegisteredName')} hint="Upgrade Diner Ltd">
            <Input value={inv.registeredName} onChange={(e) => setInv((v) => ({ ...v, registeredName: e.target.value }))} />
          </Field>
          <Field label={t('settings.invAddress')}>
            <Input value={inv.address} onChange={(e) => setInv((v) => ({ ...v, address: e.target.value }))} />
          </Field>
          <Field label={t('settings.invBin')} hint={t('settings.invBinHint')}>
            <Input value={inv.bin} maxLength={13} onChange={(e) => setInv((v) => ({ ...v, bin: e.target.value.replace(/\D/g, '') }))} />
          </Field>
          <Field label={t('settings.invVatRate')} hint={t('settings.invVatHint')}>
            <Input type="number" min="0" max="100" step="0.1" value={inv.vatRate} onChange={(e) => setInv((v) => ({ ...v, vatRate: e.target.value }))} style={{ maxWidth: 160 }} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={saveInvoice} disabled={invSaving}>
              {invSaving ? t('common.loading') : t('settings.invSave')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Delivery fee (Phase 6) — charged to delivery orders. */}
      <Card title={t('settings.delTitle')} subtitle={t('settings.delFeeHint')} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label={t('settings.delFee')}>
            <Input type="number" min="0" step="0.01" value={delFee} onChange={(e) => setDelFee(e.target.value)} style={{ maxWidth: 160 }} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={saveDelivery} disabled={delSaving}>
              {delSaving ? t('common.loading') : t('settings.delSave')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Daily closeout email (Phase 5) — nightly report delivery */}
      <Card title={t('settings.reports')} subtitle={t('settings.reportsDesc')} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label={t('settings.closeoutEmail')} hint={t('settings.closeoutEmailHint')}>
            <Input
              type="email"
              value={reports.closeoutEmail}
              onChange={(e) => setReports((r) => ({ ...r, closeoutEmail: e.target.value }))}
              placeholder="owner@restaurant.com"
            />
          </Field>
          <div
            className="oms-card"
            style={{ opacity: reports.autoSend ? 1 : 0.6, transition: 'opacity .2s var(--ease-out)' }}
          >
            <div className="oms-card__body" style={{ padding: 16, display: 'grid', gap: 12 }}>
              <Switch
                id="reports-auto-send"
                label={t('settings.autoSend')}
                checked={reports.autoSend}
                onChange={(e) => setReports((r) => ({ ...r, autoSend: e.target.checked }))}
              />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6 }}>
                {t('settings.autoSendDesc')}
              </div>
              {reports.autoSend && (
                <Field label={t('settings.closeoutHour')}>
                  <select
                    className="oms-input"
                    value={reports.hour}
                    onChange={(e) => setReports((r) => ({ ...r, hour: Number(e.target.value) }))}
                    style={{ width: 200 }}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={saveReports} disabled={reportsSaving}>
              {reportsSaving ? t('common.loading') : t('settings.pmSave')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Restaurant-wide closures (Phase 5): one-off closed days + recurring
          weekday closures — the whole storefront is hidden and checkout is
          rejected on those days. */}
      <Card title={t('settings.closuresTitle')} subtitle={t('settings.closuresDesc')} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Field label={t('settings.tzLabel')} hint={t('settings.tzHint')}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
              <Input
                list="tz-suggestions"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
                placeholder="Asia/Dhaka"
                style={{ width: 260 }}
                aria-label={t('settings.tzLabel')}
              />
              <datalist id="tz-suggestions">
                {['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'].map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
              <Button variant="outline" size="sm" onClick={saveTimezone} loading={tzSaving}>
                {t('settings.tzSave')}
              </Button>
            </div>
          </Field>

          <Field label={t('settings.closuresDates')} hint={t('settings.closuresDatesHint')}>
            {closures.map((c, i) => (
              <div
                key={`${c.date}-${i}`}
                style={{ display: 'grid', gridTemplateColumns: '170px 1fr auto', gap: 8, alignItems: 'center', marginBottom: 8 }}
              >
                <Input
                  type="date"
                  value={c.date}
                  onChange={(e) =>
                    setClosures((list) => list.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x)))
                  }
                  aria-label={`Closure ${i + 1} date`}
                />
                <Input
                  value={c.label || ''}
                  maxLength={120}
                  onChange={(e) =>
                    setClosures((list) => list.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))
                  }
                  placeholder={t('settings.closuresLabelPlaceholder')}
                  aria-label={`Closure ${i + 1} label`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => removeClosureDate(i)}
                  aria-label="Remove closure date"
                >
                  ×
                </Button>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Button variant="outline" size="sm" type="button" onClick={addClosureDate}>
                + {t('settings.closuresAdd')}
              </Button>
              {!closuresLoaded && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>
              )}
            </div>

            {/* Bulk import (round 7) — paste a list of dates, optionally with
                holiday names ('2026-12-25 Christmas Day'). */}
            <div style={{ marginTop: 4 }}>
              <Textarea
                rows={4}
                value={closureImport}
                onChange={(e) => setClosureImport(e.target.value)}
                placeholder={'2026-12-25 Christmas Day\n2026-12-26 Boxing Day\n2026-12-31'}
                aria-label={t('settings.closuresImport')}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <Button variant="outline" size="sm" type="button" onClick={importClosures}>
                  {t('settings.closuresImport')}
                </Button>
                {closureImportMsg && (
                  <span
                    style={{
                      fontSize: 12,
                      color: closureImportMsg.ok ? 'var(--primary)' : 'var(--danger, #e5484d)',
                    }}
                  >
                    {closureImportMsg.text}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {t('settings.closuresImportHint')}
              </div>
            </div>
          </Field>

          <Field label={t('settings.closuresWeekdays')} hint={t('settings.closuresWeekdaysHint')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, weekday) => (
                <button
                  key={weekday}
                  type="button"
                  onClick={() => toggleWeekdayClosure(weekday)}
                  aria-pressed={weekdayClosures.includes(weekday)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 999,
                    border: `1.5px solid ${weekdayClosures.includes(weekday) ? 'var(--danger, #e5484d)' : 'var(--border)'}`,
                    background: weekdayClosures.includes(weekday) ? 'color-mix(in srgb, var(--danger, #e5484d) 10%, transparent)' : 'transparent',
                    color: weekdayClosures.includes(weekday) ? 'var(--danger, #e5484d)' : 'inherit',
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  {name}
                </button>
              ))}
              {!weekdayClosuresLoaded && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>Loading…</span>
              )}
            </div>
          </Field>

          {closuresError && (
            <div style={{ fontSize: 13, color: 'var(--danger, #e5484d)' }}>{closuresError}</div>
          )}

          {/* Closure-conflict warnings (Phase 5 follow-up): windowed
              overrides / weekday rules that open an item on a closed day
              contradict the closure — show them before the merchant saves. */}
          {closureConflicts &&
            (closureConflicts.dates.length > 0 || closureConflicts.weekdays.length > 0) && (
              <div style={{ display: 'grid', gap: 10 }}>
                {closureConflicts.dates.map(({ date, conflicts }) => (
                  <div
                    key={`d-${date}`}
                    style={{
                      fontSize: 13,
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'color-mix(in srgb, var(--danger, #e5484d) 8%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--danger, #e5484d) 30%, transparent)',
                    }}
                  >
                    <strong>{t('settings.closuresConflictDate')}: {date}</strong>
                    <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                      {conflicts
                        .map(
                          (c) =>
                            `${c.itemName || `#${c.itemId}`} (${c.availableFrom || '00:00'}–${c.availableTo || '23:59'})`
                        )
                        .join(' · ')}
                    </div>
                  </div>
                ))}
                {closureConflicts.weekdays.map(({ weekday, conflicts }) => (
                  <div
                    key={`w-${weekday}`}
                    style={{
                      fontSize: 13,
                      borderRadius: 10,
                      padding: '10px 12px',
                      background: 'color-mix(in srgb, var(--danger, #e5484d) 8%, transparent)',
                      border: '1px solid color-mix(in srgb, var(--danger, #e5484d) 30%, transparent)',
                    }}
                  >
                    <strong>
                      {t('settings.closuresConflictWeekday')}: {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday]}
                    </strong>
                    <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>
                      {conflicts
                        .map(
                          (c) =>
                            `${c.itemName || `#${c.itemId}`} (${c.availableFrom || '00:00'}–${c.availableTo || '23:59'})`
                        )
                        .join(' · ')}
                    </div>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('settings.closuresConflictHint')}
                </div>
              </div>
            )}
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="primary" onClick={saveClosures} disabled={closuresSaving}>
              {closuresSaving ? t('common.loading') : t('settings.pmSave')}
            </Button>
          </div>
        </div>
      </Card>

      {/* Merchant closure calendar (Phase 5 follow-up): one month of closure
          dates, restaurant-wide weekday closures and per-day override counts
          at a glance — the "closure day on the merchant calendar". */}
      <Card title={t('settings.calTitle')} subtitle={t('settings.calDesc')} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="outline" size="sm" onClick={() => shiftCalMonth(-1)} aria-label="Previous month">
              ‹
            </Button>
            <span style={{ fontWeight: 700, fontSize: 15, minWidth: 120, textAlign: 'center' }}>
              {calData?.month ? formatMonthLabel(calData.month) : calMonth}
            </span>
            <Button variant="outline" size="sm" onClick={() => shiftCalMonth(1)} aria-label="Next month">
              ›
            </Button>
            {!calData && !calError && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.loading')}…</span>
            )}
          </div>

          {calError ? (
            <div style={{ fontSize: 13, color: 'var(--danger, #e5484d)' }}>{calError}</div>
          ) : calData ? (
            <ClosureCalendarGrid data={calData} t={t} />
          ) : null}
        </div>
      </Card>

      {/* Security & password (Phase 2 hardening) */}
      {/* Plan & usage (Phase 3 multi-tenant) */}
      <Card title={t('settings.planTitle')} subtitle={t('settings.planDesc')} style={{ marginTop: 16 }}>
        {!planData ? (
          <Skeleton height={160} />
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{planData.plan?.name || '—'}</span>
              <Badge tone={planData.subscription?.status === 'trialing' ? 'warning' : 'success'}>
                {planData.subscription?.status === 'trialing' ? t('settings.planTrialing') : t('settings.planActive')}
              </Badge>
              {planData.subscription?.trialEndsAt && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('settings.planTrialEnds')}: {new Date(planData.subscription.trialEndsAt).toLocaleDateString()}
                </span>
              )}
              {planData.subscription?.currentPeriodEnd && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('settings.planRenews')}: {new Date(planData.subscription.currentPeriodEnd).toLocaleDateString()}
                </span>
              )}
            </div>
            {planData.subscription?.status === 'trialing' && planData.subscription?.trialEndsAt && (() => {
              const days = Math.max(0, Math.ceil((new Date(planData.subscription.trialEndsAt) - new Date()) / 86400000));
              if (days <= 5) {
                return (
                  <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'var(--warning-soft, #fff4d6)', color: 'var(--warning, #b45309)', fontSize: 13 }}>
                    ⏳ {days === 0 ? t('settings.trialEndedBanner') : t('settings.trialEndsSoon')(days)}
                  </div>
                );
              }
              return null;
            })()}
            <div style={{ display: 'grid', gap: 12 }}>
              <QuotaMeter label={t('settings.planProducts')} used={planData.usage.products} limit={planData.limits.products} />
              <QuotaMeter label={t('settings.planOrdersToday')} used={planData.usage.ordersToday} limit={planData.limits.ordersPerDay} />
              <QuotaMeter label={t('settings.planMembers')} used={planData.usage.members} limit={planData.limits.members} />
              <QuotaMeter label={t('settings.planStorage')} used={planData.usage.storageMb} limit={planData.limits.storageMb} unit="MB" />
            </div>
            {user?.platformRole === 'platform_admin' && (
              <div style={{ display: 'flex', gap: 10, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={newPlanCode}
                  onChange={(e) => setNewPlanCode(e.target.value)}
                  className="oms-input"
                  style={{ width: 180, padding: '9px 10px' }}
                >
                  <option value="">{t('settings.planChange')}…</option>
                  {PLANS.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={changePlan} loading={planBusy} disabled={!newPlanCode}>
                  {t('settings.planChange')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title={t('settings.secTitle')} subtitle={t('settings.secDesc')} style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <Field label={t('settings.secCurrent')}>
            <Input
              type="password"
              value={pw.current}
              onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
          <Field label={t('settings.secNew')} hint={t('settings.secPolicy')}>
            <Input
              type="password"
              value={pw.next}
              onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
          <Field label={t('settings.secConfirm')}>
            <Input
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </Field>
        </div>
        {pwError && (
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 13 }}>
            {pwError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <Button variant="primary" onClick={savePassword} disabled={pwSaving}>
            {pwSaving ? t('common.loading') : t('settings.secSave')}
          </Button>
        </div>
      </Card>

      {/* Active sessions (Phase 2 hardening) */}
      <Card title={t('settings.sessionsTitle')} subtitle={t('settings.sessionsDesc')} style={{ marginTop: 16 }}>
        {!sessions ? (
          <Skeleton height={120} />
        ) : sessions.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '4px 0' }}>{t('settings.sessionsEmpty')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {sessions.map((s) => (
              <div
                key={s.id}
                className="oms-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  border: s.current ? '1px solid var(--primary)' : undefined,
                }}
              >
                <span style={{ fontSize: 18 }}>{isMobileAgent(s.userAgent) ? '📱' : '🖥️'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {friendlyDevice(s.userAgent)}
                    {s.current && <Badge tone="success">{t('settings.currentDevice')}</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {s.ip ? `${s.ip} · ` : ''}
                    {t('settings.expires')}: {new Date(s.expiresAt).toLocaleDateString()}{' '}
                    {new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" onClick={() => revokeSession(s.id)}>
                    {t('settings.revoke')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {sessions?.length > 1 && (
          <div style={{ marginTop: 12 }}>
            <Button variant="outline" size="sm" onClick={revokeOthers} loading={sessionsBusy}>
              {t('settings.revokeOthers')}
            </Button>
          </div>
        )}
      </Card>

      {/* Login activity (Phase 2 hardening) */}
      <Card title={t('settings.auditTitle')} subtitle={t('settings.auditDesc')} style={{ marginTop: 16 }}>
        {!audit ? (
          <Skeleton height={120} />
        ) : audit.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '4px 0' }}>{t('settings.auditEmpty')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {audit.slice(0, 20).map((e) => (
              <AuditRow key={e.id} event={e} />
            ))}
          </div>
        )}
      </Card>

      {/* Team & access — per-user RBAC flags (Phase 2 hardening) */}
      {canManageUsers && (
        <Card title={t('settings.teamTitle')} subtitle={t('settings.teamDesc')} style={{ marginTop: 16 }}>
          {!members ? (
            <Skeleton height={160} />
          ) : members.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('settings.teamLoadFailed')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  t={t}
                  busy={membersBusy}
                  onFlags={(flags) => setFlags(m, flags)}
                  onForceReset={() => forceReset(m)}
                  onUnlock={() => unlock(m)}
                />
              ))}
            </div>
          )}

          {/* Invite a teammate (Phase 3 — expiring links) */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>{t('settings.inviteTitle')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 170px 120px auto', gap: 10, alignItems: 'end' }}>
              <Field label={t('settings.inviteEmail')}>
                <Input
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="teammate@example.com"
                />
              </Field>
              <Field label={t('settings.inviteRole')}>
                <select
                  value={inviteForm.role}
                  onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value }))}
                  className="oms-input"
                  style={{ width: '100%', padding: '9px 10px' }}
                >
                  {TEAM_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`roles.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('settings.inviteDays')}>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={inviteForm.days}
                  onChange={(e) => setInviteForm((f) => ({ ...f, days: e.target.value }))}
                />
              </Field>
              <Button variant="primary" onClick={createInvite} loading={inviting} disabled={!inviteForm.email.trim()}>
                {t('settings.inviteCreate')}
              </Button>
            </div>

            {invites && invites.filter((i) => i.status === 'pending').length > 0 && (
              <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.invitePending')}</div>
                {invites
                  .filter((i) => i.status === 'pending')
                  .map((inv) => (
                    <div key={inv.id} className="oms-card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
                      <span style={{ fontSize: 13, flex: 1 }}>
                        {inv.email} · {t(`roles.${inv.role}`)}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('settings.expires')}: {new Date(inv.expiresAt).toLocaleDateString()}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => copyInviteLink(inv.id)}>
                        {t('settings.inviteCopyLink')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => revokeInvite(inv)}>
                        {t('settings.inviteRevoke')}
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Transfer ownership (owner only — Phase 3) */}
          {user?.tenantRole === 'owner' && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t('settings.transferTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{t('settings.transferDesc')}</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
                <Field label={t('settings.transferSelect')}>
                  <select
                    value={transferEmail}
                    onChange={(e) => setTransferEmail(e.target.value)}
                    className="oms-input"
                    style={{ width: 260, padding: '9px 10px' }}
                  >
                    <option value="">—</option>
                    {members
                      ?.filter((m) => m.role !== 'owner')
                      .map((m) => (
                        <option key={m.userId} value={m.email}>
                          {m.name || m.email}
                        </option>
                      ))}
                  </select>
                </Field>
                <Button variant="danger" size="sm" onClick={transferOwnership} disabled={!transferEmail}>
                  {t('settings.transferButton')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Workspace activity — tenant-scoped audit trail (Phase 3) */}
      {canManageUsers && (
        <Card title={t('settings.tenantAuditTitle')} subtitle={t('settings.tenantAuditDesc')} style={{ marginTop: 16 }}>
          {!tenantAudit ? (
            <Skeleton height={120} />
          ) : tenantAudit.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '4px 0' }}>{t('settings.tenantAuditEmpty')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
              {tenantAudit.map((e) => (
                <TenantAuditRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Delivery zones + rider coverage — auto-assignment (Phase 5 follow-up) */}
      {canManageUsers && <DeliveryZonesCard />}

      {/* Settlements + gateway wallet balance (Phase 6) — manager only. */}
      {canManageUsers && <SettlementsCard />}
    </div>
  );
}

/** Parses a user-agent into a friendly device label. */
function friendlyDevice(ua) {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
      : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
      : /Firefox\//.test(ua) ? 'Firefox'
      : /Safari\//.test(ua) ? 'Safari'
      : '';
  const os =
    /Windows/.test(ua) ? 'Windows'
      : /Mac OS/.test(ua) ? 'macOS'
      : /Android/.test(ua) ? 'Android'
      : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Linux/.test(ua) ? 'Linux'
      : '';
  return [browser, os].filter(Boolean).join(' · ') || 'Unknown device';
}

const isMobileAgent = (ua) => /Android|iPhone|iPad|Mobile/i.test(ua || '');

/** One row of the login-activity trail, with an icon per action. */
function AuditRow({ event }) {
  const icons = {
    'auth.login': '🔓',
    'auth.login_failed': '⚠️',
    'auth.account_locked': '🔐',
    'auth.account_unlocked': '🔓',
    'auth.logout': '🔒',
    'auth.refresh': '🔄',
    'auth.refresh_reuse_detected': '🚨',
    'auth.password_changed': '🔑',
    'auth.password_reset': '🔑',
    'auth.password_reset_requested': '✉️',
    'auth.sessions_revoked_others': '📴',
    'auth.session_revoked': '📴',
    'auth.2fa_failed': '⚠️',
    'auth.2fa_verified': '🔐',
    'user.password_force_reset': '🛡️',
    'user.permissions_updated': '🏷️',
    'user.two_factor_enabled': '🔐',
    'user.two_factor_disabled': '🔓',
  };
  const label = icons[event.action] || '•';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 2px', borderBottom: '1px dashed var(--border)' }}>
      <span style={{ width: 18, textAlign: 'center' }}>{label}</span>
      <span style={{ flex: 1 }}>
        {friendlyAction(event.action)}
        {event.metadata?.attempts ? ` (attempt ${event.metadata.attempts})` : ''}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {event.ip ? `${event.ip} · ` : ''}
        {new Date(event.createdAt).toLocaleString()}
      </span>
    </div>
  );
}

/** Human label for an audit action. */
function friendlyAction(action) {
  const map = {
    'auth.login': 'Signed in',
    'auth.login_failed': 'Failed sign-in attempt',
    'auth.account_locked': 'Account locked (too many failures)',
    'auth.account_unlocked': 'Account unlocked by admin',
    'auth.logout': 'Signed out',
    'auth.refresh': 'Session refreshed',
    'auth.refresh_reuse_detected': 'Stolen-token reuse detected',
    'auth.password_changed': 'Password changed',
    'auth.password_reset': 'Password reset',
    'auth.password_reset_requested': 'Password reset requested',
    'auth.sessions_revoked_others': 'Other devices signed out',
    'auth.session_revoked': 'Session signed out',
    'auth.2fa_failed': '2FA code rejected',
    'auth.2fa_verified': '2FA verified',
    'user.password_force_reset': 'Admin forced a password reset',
    'user.permissions_updated': 'Permission flags updated',
    'user.two_factor_enabled': '2FA enabled',
    'user.two_factor_disabled': '2FA disabled',
  };
  return map[action] || action;
}

const TEAM_FLAGS = [
  { value: 'refund:orders', label: 'Refunds' },
  { value: 'manage:inventory', label: 'Inventory' },
  { value: 'view:reports', label: 'Reports' },
  { value: 'manage:promotions', label: 'Promotions' },
  { value: 'manage:users', label: 'Users' },
  { value: 'manage:members', label: 'Team' },
];

/** One usage bar in the Plan & usage card (Phase 3). */
function QuotaMeter({ label, used, limit, unit = '' }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const near = pct >= 85;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: near ? 'var(--danger)' : 'var(--text-muted)', fontWeight: near ? 700 : 400 }}>
          {used}
          {unit ? ` ${unit}` : ''} / {limit}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 99, background: 'var(--border)', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 99,
            background: near ? 'var(--danger)' : 'var(--primary)',
            transition: 'width .3s ease',
          }}
        />
      </div>
    </div>
  );
}

/** One row of the workspace-activity trail (tenant-scoped audit, Phase 3). */
function TenantAuditRow({ event }) {
  const icons = {
    'tenant.created': '🏠',
    'tenant.updated': '✏️',
    'tenant.status_changed': '🚦',
    'tenant.whatsapp_test_sent': '📲',
    'tenant.member_added': '👤',
    'tenant.member_updated': '🔄',
    'tenant.member_removed': '🚪',
    'tenant.invite_created': '✉️',
    'tenant.invite_revoked': '🚫',
    'tenant.invite_accepted': '✅',
    'tenant.ownership_transferred': '👑',
    'tenant.plan_changed': '💳',
  };
  const label = icons[event.action] || '•';
  const extra =
    event.action === 'tenant.invite_created' && event.metadata?.email
      ? ` (${event.metadata.email})`
      : event.action === 'tenant.plan_changed' && event.metadata
        ? ` (${event.metadata.from || '—'} → ${event.metadata.to || '—'})`
        : event.action === 'tenant.ownership_transferred'
          ? ''
          : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 2px', borderBottom: '1px dashed var(--border)' }}>
      <span style={{ width: 18, textAlign: 'center' }}>{label}</span>
      <span style={{ flex: 1 }}>
        {friendlyTenantAction(event.action)}
        {extra}
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {event.actor?.name ? `${event.actor.name} · ` : ''}
        {new Date(event.createdAt).toLocaleString()}
      </span>
    </div>
  );
}

/** Human label for a tenant-scoped audit action. */
function friendlyTenantAction(action) {
  const map = {
    'tenant.created': 'Workspace created',
    'tenant.updated': 'Workspace updated',
    'tenant.status_changed': 'Workspace status changed',
    'tenant.whatsapp_test_sent': 'Test WhatsApp alert sent',
    'tenant.member_added': 'Member added',
    'tenant.member_updated': 'Member role changed',
    'tenant.member_removed': 'Member removed',
    'tenant.invite_created': 'Invite sent',
    'tenant.invite_revoked': 'Invite revoked',
    'tenant.invite_accepted': 'Invite accepted',
    'tenant.ownership_transferred': 'Ownership transferred',
    'tenant.plan_changed': 'Plan changed',
  };
  return map[action] || action;
}

/** One member row: role, tri-state permission flags, account actions. */
function MemberRow({ member, t, busy, onFlags, onForceReset, onUnlock }) {
  const setFlag = (value, mode) => {
    const rest = (member.permissions || []).filter((f) => f !== value && f !== `-${value}`);
    if (mode === 'grant') rest.push(value);
    if (mode === 'deny') rest.push(`-${value}`);
    onFlags(rest);
  };

  const flagMode = (value) => {
    if ((member.permissions || []).includes(value)) return 'grant';
    if ((member.permissions || []).includes(`-${value}`)) return 'deny';
    return 'default';
  };

  return (
    <div className="oms-card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {member.name}
            {member.locked && (
              <Badge tone="warning" style={{ marginLeft: 8 }}>
                🔒 {t('settings.teamLocked')}
              </Badge>
            )}
            {member.mustChangePassword && (
              <Badge tone="neutral" style={{ marginLeft: 8 }}>
                {t('settings.teamMustChange')}
              </Badge>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{member.email}</div>
        </div>
        <Badge tone="neutral">{t(`roles.${member.role}`)}</Badge>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline" size="sm" onClick={onForceReset} disabled={busy}>
            {t('settings.teamForceReset')}
          </Button>
          {member.locked && (
            <Button variant="outline" size="sm" onClick={onUnlock} disabled={busy}>
              {t('settings.teamUnlock')}
            </Button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {TEAM_FLAGS.map((f) => (
          <select
            key={f.value}
            className="oms-input"
            style={{ width: 'auto', fontSize: 12, padding: '4px 8px' }}
            value={flagMode(f.value)}
            disabled={busy}
            onChange={(e) => setFlag(f.value, e.target.value)}
            aria-label={`${f.label} flag for ${member.name}`}
          >
            <option value="default">{f.label}: {t('settings.teamFlagDefault')}</option>
            <option value="grant">{f.label}: {t('settings.teamFlagGrant')}</option>
            <option value="deny">{f.label}: {t('settings.teamFlagDeny')}</option>
          </select>
        ))}
      </div>
    </div>
  );
}

/** One payment-method row: toggle + (for wallets) a receiving number. */
function MethodCard({ label, enabled, onToggle, number, onNumber, numberLabel, numberHint, hint }) {
  return (
    <div
      className="oms-card"
      style={{ opacity: enabled ? 1 : 0.6, transition: 'opacity .2s var(--ease-out)' }}
    >
      <div className="oms-card__body" style={{ padding: 16, display: 'grid', gap: 12 }}>
        <Switch
          id={`pm-${label.replace(/\s+/g, '-').toLowerCase()}`}
          label={label}
          checked={Boolean(enabled)}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {hint && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -6 }}>{hint}</div>
        )}
        {enabled && number !== undefined && (
          <Field label={numberLabel} hint={numberHint}>
            <Input value={number || ''} maxLength={20} onChange={(e) => onNumber(e.target.value)} placeholder="+8801XXXXXXXXX" />
          </Field>
        )}
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div className="oms-brand-color">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#00b3a5'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          value={value || ''}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          className="oms-brand-color__hex"
        />
      </div>
    </div>
  );
}

/** Mini storefront preview driven by the current brand draft. */
function StorefrontPreview({ brand, name, logoUrl }) {
  const primary = /^#[0-9a-fA-F]{6}$/.test(brand.primaryColor || '') ? brand.primaryColor : '#00b3a5';
  const accent = /^#[0-9a-fA-F]{6}$/.test(brand.accentColor || '') ? brand.accentColor : '#f5d300';

  return (
    <div className="oms-brand-preview" style={{ '--preview-primary': primary, '--preview-accent': accent }}>
      <div className="oms-brand-preview__hero">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="oms-brand-preview__logo" />
        ) : (
          <span className="oms-brand-preview__logo">🏪</span>
        )}
        <div>
          <div className="oms-brand-preview__name">{name}</div>
          <div className="oms-brand-preview__tagline">{brand.tagline || 'Your tagline appears here'}</div>
        </div>
      </div>
      {brand.announcement && (
        <div className="oms-brand-preview__banner">📢 {brand.announcement}</div>
      )}
      <div className="oms-brand-preview__chips">
        <span className="is-on">Popular</span>
        <span>Burgers</span>
        <span>Drinks</span>
      </div>
      <div className="oms-brand-preview__item">
        <span>🍔 Signature Burger</span>
        <b>৳ 320</b>
      </div>
      <div className="oms-brand-preview__item">
        <span>🍟 Classic Fries</span>
        <b>৳ 150</b>
      </div>
    </div>
  );
}

/** 'YYYY-MM' → 'August 2026'-style label. */
function formatMonthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Merchant closure calendar — one month grid. Closure dates are red, days
 * falling on a restaurant-wide weekday closure are tinted with a ⟳ chip, and
 * days with per-item availability overrides show a count badge. Uses UTC
 * date math so the grid never shifts with the browser's timezone.
 */
function ClosureCalendarGrid({ data, t }) {
  const [y, m] = data.month.split('-').map(Number);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0=Sun
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekdayClosed = new Set(data.weekdayClosures || []);

  const cells = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${data.month}-${String(d).padStart(2, '0')}`;
    const info = data.days?.[key];
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    cells.push({ key, d, dow, closure: Boolean(info?.closure), overrides: info?.overrides || 0, weekdayClosed: weekdayClosed.has(dow) });
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 6,
        }}
      >
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name, dow) => (
          <div
            key={name}
            style={{
              fontSize: 11,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: weekdayClosed.has(dow) ? 'var(--danger, #e5484d)' : 'var(--text-muted)',
              textAlign: 'center',
            }}
          >
            {name}
          </div>
        ))}
        {cells.map((cell, i) =>
          cell ? (
            <div
              key={cell.key}
              title={
                cell.closure
                  ? `${cell.key} — ${t('settings.calClosed')}`
                  : cell.weekdayClosed
                    ? `${cell.key} — ${t('settings.calWeekdayClosed')}`
                    : `${cell.key}${cell.overrides ? ` — ${cell.overrides} ${t('settings.calOverrides')}` : ''}`
              }
              style={{
                minHeight: 44,
                borderRadius: 10,
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                fontSize: 13,
                fontWeight: 700,
                background: cell.closure
                  ? 'color-mix(in srgb, var(--danger, #e5484d) 16%, transparent)'
                  : cell.weekdayClosed
                    ? 'color-mix(in srgb, var(--danger, #e5484d) 7%, transparent)'
                    : 'transparent',
                borderColor: cell.closure
                  ? 'color-mix(in srgb, var(--danger, #e5484d) 55%, transparent)'
                  : cell.weekdayClosed
                    ? 'color-mix(in srgb, var(--danger, #e5484d) 30%, transparent)'
                    : 'var(--border)',
                color: cell.closure ? 'var(--danger, #e5484d)' : 'inherit',
              }}
            >
              {cell.d}
              {cell.closure ? (
                <span style={{ fontSize: 10, fontWeight: 800 }}>✕</span>
              ) : cell.weekdayClosed ? (
                <span style={{ fontSize: 10, fontWeight: 800 }}>⟳</span>
              ) : cell.overrides > 0 ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    background: 'var(--primary-soft, rgba(0,179,165,.12))',
                    color: 'var(--primary)',
                    borderRadius: 999,
                    padding: '0 6px',
                  }}
                >
                  {cell.overrides}
                </span>
              ) : null}
            </div>
          ) : (
            <div key={`empty-${i}`} />
          )
        )}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-muted)' }}>
        <span>
          <b style={{ color: 'var(--danger, #e5484d)' }}>✕</b> {t('settings.calClosed')}
        </span>
        <span>
          <b style={{ color: 'var(--danger, #e5484d)' }}>⟳</b> {t('settings.calWeekdayClosed')}
        </span>
        <span>
          <b style={{ color: 'var(--primary)' }}>N</b> {t('settings.calOverrides')}
        </span>
      </div>
    </div>
  );
}
