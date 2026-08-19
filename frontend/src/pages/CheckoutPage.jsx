import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { Skeleton } from '../components/ui';
import { useI18n } from '../i18n';
import { usePaperTheme } from '../hooks/usePaperTheme';
import {
  enqueuePending,
  pendingCount,
  setupPendingFlusher,
} from '../utils/pendingOrders';

/**
 * Storefront checkout (Phase 5) — the customer journey's final step.
 *
 * Cart lives in localStorage (seeded by the menu page), prices shown here
 * are display-only (the API re-prices server-side), and the order is placed
 * with an Idempotency-Key so double-clicks / retries can never create two
 * orders. Supports pickup, delivery, scheduled pickup and scheduled delivery;
 * payment via the workspace's enabled methods (cash / wallets / online).
 *
 * The whole page lives in "The Table Ticket" world: the brand stub + scalloped
 * tear on top, sections as ticket cards with dashed dividers, chilli-red
 * totals — the customer never leaves the ticket they tore off the menu. The
 * paper theme (rice paper / ink paper) is shared with the menu via
 * usePaperTheme.
 */

const CART_KEY = (slug) => `oms.cart.${slug}`;
const IDEM_KEY = (slug) => `oms.idem.${slug}`;

const ORDER_TYPES = ['pickup', 'delivery', 'scheduled_pickup', 'scheduled_delivery'];
const TYPE_KEY = {
  pickup: 'typePickup',
  delivery: 'typeDelivery',
  scheduled_pickup: 'typeScheduledPickup',
  scheduled_delivery: 'typeScheduledDelivery',
};

const fmtMoney = (n) => `৳ ${Number(n).toFixed(2)}`;

/** Safe hex or a sensible default — checkout never breaks on odd brand data. */
const brandColor = (value, fallback) =>
  /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;

const ORBS = [
  { emoji: '🍔', cls: 'stub__orb--1' },
  { emoji: '🍟', cls: 'stub__orb--2' },
  { emoji: '🍕', cls: 'stub__orb--3' },
  { emoji: '🍗', cls: 'stub__orb--4' },
  { emoji: '🥤', cls: 'stub__orb--5' },
];

export default function CheckoutPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useI18n();
  const { paperPref, effectiveDark, cyclePaper } = usePaperTheme();
  // Schedule-from-calendar (Phase 5 follow-up): the menu's Check-times modal
  // navigates here with ?date=YYYY-MM-DD&time=HH:MM — the wall clock in the
  // restaurant's timezone — pre-selecting scheduled pickup.
  const scheduledParam = (() => {
    const d = searchParams.get('date');
    const tm = searchParams.get('time');
    return d && tm && /^\d{4}-\d{2}-\d{2}$/.test(d) && /^\d{1,2}:\d{2}$/.test(tm)
      ? `${d}T${tm}`
      : null;
  })();

  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  // Product snapshot (stock / low-stock / availability) for scarcity cues +
  // the restaurant-wide closed flag — from the public menu payload (Phase 5).
  const [menuMap, setMenuMap] = useState(new Map());
  const [closedToday, setClosedToday] = useState(false);
  // Scheduled-order availability preview: per-item availability at the
  // chosen datetime (Phase 5), fetched from the public availability API.
  const [scheduleCheck, setScheduleCheck] = useState(null); // null | { loading, restaurantClosed, unavailableIds }
  const [scheduleCheckError, setScheduleCheckError] = useState(false);
  const [orderType, setOrderType] = useState('pickup');
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', scheduled_at: '' });
  const [paymentMethod, setPaymentMethod] = useState('cash');
  // Split payment (Phase 6): one order, multiple methods — e.g. part bKash
  // + part cash. Only shown when the workspace enables >= 2 non-online
  // methods; the server re-validates every part + the exact sum.
  const [useSplit, setUseSplit] = useState(false);
  const [splitParts, setSplitParts] = useState({});
  // Diner bill-split (QR table): group cart lines by diner, each diner
  // picks a method — amounts auto-computed (their items + an equal
  // delivery-fee share), each part tagged with the diner's name.
  const [splitMode, setSplitMode] = useState('amount'); // 'amount' | 'diner'
  const [diners, setDiners] = useState([]); // [{ name, method, ref }]
  const [dinerAssign, setDinerAssign] = useState({}); // cartLineIdx -> dinerIdx
  // Wallet payment UX (Phase 6): the merchant's receiving numbers + a
  // transaction-ID field per wallet part — single, split-amount and diner
  // modes all carry the trxID so the cashier can confirm instantly.
  const [walletTrxId, setWalletTrxId] = useState('');
  const [splitRefs, setSplitRefs] = useState({});
  const [copiedNum, setCopiedNum] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [placed, setPlaced] = useState(null);
  // Offline submit queue (Phase 5 follow-up): when the POST can't reach the
  // server the order is parked locally and replayed once the browser is back
  // online. `queued` shows the "we saved your order" confirmation.
  const [queued, setQueued] = useState(null); // null | { id, count }
  const idemKeyRef = useRef(null);

  const tableNo = searchParams.get('table');

  // Restore / mint the Idempotency-Key for THIS checkout attempt. It is
  // reused across retries (same key → same order), and cleared on success.
  const idemKey = () => {
    if (!idemKeyRef.current) {
      try {
        idemKeyRef.current = window.sessionStorage.getItem(IDEM_KEY(slug)) ||
          (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        window.sessionStorage.setItem(IDEM_KEY(slug), idemKeyRef.current);
      } catch {
        idemKeyRef.current = idemKeyRef.current || `${Date.now()}-${Math.random()}`;
      }
    }
    return idemKeyRef.current;
  };

  // Offline queue: register the global online-listener (replays any parked
  // orders as soon as connectivity returns).
  useEffect(() => {
    setupPendingFlusher();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [infoRes, menuRes] = await Promise.all([
          axios.get(`/api/public/restaurants/${slug}`),
          axios.get(`/api/public/restaurants/${slug}/menu?available=false&limit=200`),
        ]);
        if (!mounted) return;
        setRestaurant(infoRes.data);
        setCart(loadCart());
        const cfg = infoRes.data.checkout || {};
        if (cfg.paymentMethods?.length) setPaymentMethod(cfg.paymentMethods[0]);
        // Pre-fill a scheduled order from the per-dish calendar jump.
        if (scheduledParam) {
          setOrderType('scheduled_pickup');
          setForm((f) => ({ ...f, scheduled_at: scheduledParam }));
        }
        // Stock snapshot per product — the menu payload carries stock /
        // lowStockAt / variants (each with its own stock) / availability for
        // every item (available=false keeps out-of-window items in the
        // response for scheduled previews).
        const map = new Map();
        for (const cat of menuRes.data.categories || []) {
          for (const item of cat.items || []) {
            map.set(item.id, item);
          }
        }
        setMenuMap(map);
        setClosedToday(!!menuRes.data.closedToday);
      } catch (err) {
        if (mounted) setError(err?.response?.status === 404 ? 'notFound' : 'load');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Scheduled-order availability preview: whenever a scheduled order type is
  // selected and a valid future datetime is set, ask the public availability
  // API whether the restaurant + each cart item are orderable at that instant.
  const isScheduled = orderType === 'scheduled_pickup' || orderType === 'scheduled_delivery';
  useEffect(() => {
    if (!isScheduled) {
      setScheduleCheck(null);
      return;
    }
    const at = new Date(form.scheduled_at);
    if (!form.scheduled_at || Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 5 * 60 * 1000) {
      setScheduleCheck(null);
      return;
    }
    let mounted = true;
    // The typed value IS the wall clock in the restaurant's timezone — send
    // it as-is so the backend resolves against the tenant's configured tz
    // (Phase 5 follow-up) instead of the browser's.
    const wallDate = String(form.scheduled_at).slice(0, 10);
    const wallTime = String(form.scheduled_at).slice(11, 16);
    setScheduleCheck((prev) => ({ ...(prev || {}), loading: true }));
    axios
      .get(`/api/public/restaurants/${slug}/availability`, { params: { date: wallDate, time: wallTime } })
      .then((res) => {
        if (!mounted) return;
        const data = res.data;
        const byId = new Map((data.items || []).map((i) => [i.id, i.available]));
        setScheduleCheck({
          loading: false,
          restaurantClosed: !!data.restaurantClosed,
          unavailableIds: new Set(
            cart
              .map((l) => l.product_id)
              .filter((pid) => byId.get(pid) === false)
          ),
        });
        setScheduleCheckError(false);
      })
      .catch(() => {
        if (!mounted) return;
        setScheduleCheckError(true);
        setScheduleCheck((prev) => (prev ? { ...prev, loading: false } : { loading: false, restaurantClosed: false, unavailableIds: new Set() }));
      });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isScheduled, form.scheduled_at, slug]);

  const loadCart = () => {
    try {
      const raw = window.localStorage.getItem(CART_KEY(slug));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };
  const clearCart = () => {
    try {
      window.localStorage.removeItem(CART_KEY(slug));
      window.sessionStorage.removeItem(IDEM_KEY(slug));
    } catch {
      /* storage unavailable */
    }
  };

  const checkoutConfig = restaurant?.checkout || { paymentMethods: ['cash'], deliveryEnabled: true, deliveryFee: 0 };
  const methods = checkoutConfig.paymentMethods || ['cash'];
  // Merchant's wallet receiving numbers (public menu API, Phase 6) — shown
  // with a copy button so the customer can send money and enter the trxID.
  const walletNumbers = checkoutConfig.walletNumbers || {};
  // Split is for wallet/cash parts only — online goes through the hosted
  // gateway and can never be a split part (mirrors the backend rule).
  const splitMethods = methods.filter((m) => m !== 'online');
  const deliveryFee = orderType === 'delivery' || orderType === 'scheduled_delivery' ? Number(checkoutConfig.deliveryFee || 0) : 0;

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + Number(l.unit_price) * l.quantity, 0),
    [cart]
  );
  const total = Math.round((subtotal + deliveryFee) * 100) / 100;

  // Per-line stock snapshot (Phase 5 scarcity cues): the menu payload's
  // inventory per product (stock null when untracked) + variant stock. The
  // BACKEND enforces per-VARIANT stock (VARIANT_OUT_OF_STOCK) — product
  // inventory is informational only — so the hard block mirrors exactly
  // that boundary: a line is blocking only when its chosen variant is out
  // of stock. Product-level stock 0 keeps its informational cue but never
  // blocks placement (the API happily prices it).
  const lineInfo = (line) =>
    menuMap.get(line.product_id) || { stock: null, lowStockAt: null, variants: [], available: true };
  const lineVariant = (line) =>
    (lineInfo(line).variants || []).find((v) => v.id === line.variant_id) || null;
  const lineVariantOut = (line) => {
    if (!line.variant_id) return false;
    const v = lineVariant(line);
    if (!v || v.stock === null || v.stock === undefined) return false;
    return Number(v.stock) <= 0 || line.quantity > Number(v.stock);
  };
  const productOut = (line) => {
    const s = lineInfo(line).stock;
    return s !== null && s !== undefined && Number(s) <= 0;
  };
  const anyVariantOut = cart.some(lineVariantOut);
  // Scheduled-order preview gate: once the availability check has answered,
  // unavailable items block placement (the server would reject anyway).
  const scheduledBlocked =
    isScheduled &&
    !!scheduleCheck &&
    !scheduleCheck.loading &&
    !scheduleCheck.restaurantClosed &&
    scheduleCheck.unavailableIds.size > 0;

  const splitTotal = Object.values(splitParts).reduce((s, v) => s + (Number(v) || 0), 0);
  const splitRemaining = Math.round((total - splitTotal) * 100) / 100;
  const splitValid =
    splitMethods.filter((m) => Number(splitParts[m]) > 0).length >= 2 &&
    Math.abs(splitRemaining) < 0.005;

  const toggleSplit = () => {
    setUseSplit((s) => {
      if (!s) {
        // Seed: first method carries the whole total, the rest empty — the
        // customer just edits the parts.
        const seed = {};
        splitMethods.forEach((m, i) => { seed[m] = i === 0 ? String(total) : ''; });
        setSplitParts(seed);
      } else {
        setSplitParts({});
      }
      return !s;
    });
  };
  const setSplitPart = (m, value) => {
    const sanitized = value.replace(/[^0-9.]/g, '');
    setSplitParts((p) => ({ ...p, [m]: sanitized }));
  };

  // ── Diner bill-split (QR table) ────────────────────────────────────────
  const dinerShareOf = (di) =>
    cart.reduce(
      (s, l, li) => s + (dinerAssign[li] === di ? Number(l.unit_price) * l.quantity : 0),
      0
    );
  const dinerCount = diners.length;
  const dinerShares = diners.map((d, di) => {
    const itemsTotal = dinerShareOf(di);
    // Delivery fee split equally; the last diner absorbs the rounding.
    let feeShare = 0;
    if (deliveryFee > 0 && dinerCount > 0) {
      const equal = Math.round((deliveryFee / dinerCount) * 100) / 100;
      feeShare = di === dinerCount - 1 ? deliveryFee - equal * (dinerCount - 1) : equal;
    }
    return Math.round((itemsTotal + feeShare) * 100) / 100;
  });
  const dinerParts = diners
    .map((d, di) => ({
      method: d.method,
      amount: dinerShares[di],
      note: d.name.trim() ? d.name.trim().slice(0, 80) : `Diner ${di + 1}`,
      reference: d.ref && d.ref.trim() ? d.ref.trim().slice(0, 120) : null,
    }))
    .filter((p) => p.amount > 0);
  const dinerSplitValid = dinerParts.length >= 2;

  const copyNumber = async (num) => {
    try {
      await navigator.clipboard.writeText(num);
      setCopiedNum(num);
      setTimeout(() => setCopiedNum(null), 1600);
    } catch {
      /* clipboard unavailable — the number stays visible */
    }
  };

  const switchSplitMode = (mode) => {
    setSplitMode(mode);
    if (mode === 'diner') {
      // Default: two diners, cart lines distributed round-robin.
      const d = Array.from({ length: 2 }, () => ({
        name: '',
        method: splitMethods[0] || 'cash',
        ref: '',
      }));
      const assign = {};
      cart.forEach((_, li) => { assign[li] = li % 2; });
      setDiners(d);
      setDinerAssign(assign);
    }
  };
  const addDiner = () => {
    setDiners((ds) => [...ds, { name: '', method: splitMethods[0] || 'cash', ref: '' }]);
  };
  const removeDiner = (di) => {
    setDiners((ds) => ds.filter((_, i) => i !== di));
    setDinerAssign((a) => {
      const next = {};
      Object.entries(a).forEach(([li, v]) => {
        if (v === di) next[li] = 0; // reassign to the first diner
        else next[li] = v > di ? v - 1 : v;
      });
      return next;
    });
  };

  const validate = () => {
    const digits = form.phone.replace(/\D/g, '');
    if (!form.name.trim()) return t('store.requiredField') + ': ' + t('store.fullName');
    if (digits.length < 10) return t('store.invalidPhone');
    if ((orderType === 'delivery' || orderType === 'scheduled_delivery') && !form.address.trim()) {
      return t('store.requiredField') + ': ' + t('store.address');
    }
    if (orderType === 'scheduled_pickup' || orderType === 'scheduled_delivery') {
      if (!form.scheduled_at) return t('store.requiredField') + ': ' + t('store.schedule');
      const at = new Date(form.scheduled_at);
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 5 * 60 * 1000) {
        return t('store.invalidSchedule');
      }
    }
    if (closedToday) return t('store.closedTodayDesc');
    if (anyVariantOut) return t('store.itemSoldOut');
    if (scheduledBlocked) return t('store.scheduleBlocked');
    if (useSplit && splitMode === 'diner' && !dinerSplitValid) return t('store.dinerSplitMismatch');
    if (useSplit && splitMode === 'amount' && !splitValid) return t('store.splitMismatch');
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSubmitting(true);
    setError(null);
    // Built before the request so the offline catch can replay the exact
    // payload (body must be in scope in the catch block).
    let body;
    try {
      body = {
        order_type: orderType,
        customer_name: form.name.trim(),
        customer_phone: form.phone.trim(),
        customer_email: form.email.trim() || undefined,
        customer_address: (orderType === 'delivery' || orderType === 'scheduled_delivery') ? form.address.trim() : undefined,
        scheduled_at:
          orderType === 'scheduled_pickup' || orderType === 'scheduled_delivery'
            ? scheduledIso()
            : undefined,
        items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: l.quantity,
          variant_id: l.variant_id ?? undefined,
          addon_ids: l.addon_ids || [],
        })),
      };
      if (useSplit && splitMode === 'diner') {
        // Diner split: parts carry the diner's name as the note + trxID.
        body.payments = dinerParts.map((p) => ({
          method: p.method,
          amount: Math.round(p.amount * 100) / 100,
          note: p.note,
          reference: p.reference || undefined,
        }));
      } else if (useSplit) {
        // Amount split: send the parts (server re-validates method + sum).
        body.payments = splitMethods
          .filter((m) => Number(splitParts[m]) > 0)
          .map((m) => ({
            method: m,
            amount: Math.round(Number(splitParts[m]) * 100) / 100,
            reference: splitRefs[m]?.trim() || undefined,
          }));
      } else {
        body.payment_method = paymentMethod;
        // Wallet flow: the customer sends money to the merchant's number and
        // pastes the transaction ID for the cashier to confirm.
        if (['bkash', 'nagad'].includes(paymentMethod) && walletTrxId.trim()) {
          body.payment_reference = walletTrxId.trim();
        }
      }
      const res = await axios.post(
        `/api/public/restaurants/${slug}/checkout`,
        body,
        { headers: { 'Idempotency-Key': idemKey() } }
      );
      clearCart();
      idemKeyRef.current = null;
      setPlaced(res.data);
      window.scrollTo(0, 0);
    } catch (err) {
      const code = err?.response?.data?.error?.code;
      const message = err?.response?.data?.error?.message;
      // No response = the request never reached the server (offline / DNS).
      // Park the exact order + its Idempotency-Key so we can replay it — the
      // same key guarantees the retry can never double-charge or double-create.
      if (!err?.response || err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED') {
        const id = enqueuePending(slug, body, idemKey());
        clearCart();
        idemKeyRef.current = null;
        setQueued({ id, count: pendingCount(slug) });
        window.scrollTo(0, 0);
        return;
      }
      if (code === 'IDEMPOTENCY_KEY_MISMATCH') {
        // A stale key from a previous attempt — mint a fresh one and retry once.
        try { window.sessionStorage.removeItem(IDEM_KEY(slug)); } catch { /* noop */ }
        idemKeyRef.current = null;
      }
      setError(message || t('store.orderFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const updateQty = (idx, delta) => {
    setCart((c) =>
      c.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, Math.min(99, l.quantity + delta)) } : l))
    );
    try {
      window.localStorage.setItem(CART_KEY(slug), JSON.stringify(
        cart.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, Math.min(99, l.quantity + delta)) } : l))
      ));
    } catch { /* noop */ }
  };
  const removeLine = (idx) => {
    const next = cart.filter((_, i) => i !== idx);
    setCart(next);
    try { window.localStorage.setItem(CART_KEY(slug), JSON.stringify(next)); } catch { /* noop */ }
  };

  /**
   * The customer's chosen wall time as an ISO instant. When the restaurant
   * configures a timezone (Phase 5 follow-up), the typed value is that tz's
   * wall clock — convert wall→UTC via the Intl offset (same math as the
   * backend). Without a timezone, the browser-local interpretation is kept.
   */
  const scheduledIso = () => {
    const wall = String(form.scheduled_at);
    if (!wall) return undefined;
    const tz = restaurant?.timezone;
    if (!tz) return new Date(wall).toISOString();
    const [y, mo, d, h, mi] = wall.split(/[-T:]/).map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    const offset = (date) => {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        }).formatToParts(date).map((p) => [p.type, p.value])
      );
      const hour = Number(parts.hour) % 24;
      return Date.UTC(+parts.year, +parts.month - 1, +parts.day, hour, +parts.minute) - date.getTime();
    };
    return new Date(guess - offset(new Date(guess))).toISOString();
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px', display: 'grid', gap: 16 }}>
        <Skeleton height={36} width={220} />
        <Skeleton height={120} />
        <Skeleton height={160} />
      </div>
    );
  }

  const brand = restaurant?.brand || {};
  const primary = brandColor(brand.primaryColor, '#00b3a5');
  const accent = brandColor(brand.accentColor, '#f5d300');
  const paperClass = effectiveDark ? ' menu--dark' : '';
  const paperAttrs = { 'data-paper': paperPref, style: { '--brand': primary, '--brand-accent': accent } };
  const paperBtn = (
    <button
      onClick={cyclePaper}
      aria-label={t(paperPref === 'auto' ? 'store.paperAuto' : paperPref === 'light' ? 'store.paperLight' : 'store.paperDark')}
      title={t(paperPref === 'auto' ? 'store.paperAuto' : paperPref === 'light' ? 'store.paperLight' : 'store.paperDark')}
      className="stub__lang"
    >
      {paperPref === 'light' ? '☀️' : paperPref === 'dark' ? '🌙' : '🌓'}
    </button>
  );

  // ── Offline queued view — order saved, waiting for the network ────────
  if (queued) {
    return (
      <div className={`menu menu--checkout${paperClass}`} {...paperAttrs}>
        <header className="stub stub--done">
          <div className="stub__orbs" aria-hidden="true">
            {ORBS.map((o) => (
              <span key={o.cls} className={`stub__orb ${o.cls}`}>{o.emoji}</span>
            ))}
          </div>
          <div className="stub__inner">
            <div className="stub__meta">
              {paperBtn}
              <span className="stub__table">📶 {t('store.offlineQueued')}</span>
            </div>
            <div className="stub__brand">
              {restaurant.logoUrl ? (
                <img src={restaurant.logoUrl} alt="" className="stub__logo" />
              ) : (
                <div className="stub__logo">🏪</div>
              )}
              <div className="stub__copy">
                <h1 className="stub__name">{restaurant.name}</h1>
                <div className="stub__tagline">{t('store.offlineQueuedDesc')}</div>
                <div className="stub__eyebrow">📶 {t('store.offlinePending', { n: queued.count })}</div>
              </div>
            </div>
          </div>
          <div className="stub__tear" aria-hidden="true" />
        </header>
        <main className="menu__body checkout__body">
          <section className="ticket-card ticket-done__card">
            <div className="ticket-done__label">{t('store.offlineOrderSaved')}</div>
            <div className="ticket-done__no">📶 {t('store.offlineAwaitNetwork')}</div>
            <div className="ticket-done__total">{fmtMoney(total)}</div>
            <p className="ticket-done__hint">{t('store.offlineHint')}</p>
            <div className="ticket-actions">
              <Link to={`/m/${slug}`} className="ticket-btn ticket-btn--ghost">
                {t('store.continueShopping')}
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // ── Confirmation view (post-place) — the ticket stub, torn off ────────
  if (placed) {
    return (
      <div className={`menu menu--checkout${paperClass}`} {...paperAttrs}>
        <header className="stub stub--done">
          <div className="stub__orbs" aria-hidden="true">
            {ORBS.map((o) => (
              <span key={o.cls} className={`stub__orb ${o.cls}`}>{o.emoji}</span>
            ))}
          </div>
          <div className="stub__inner">
            <div className="stub__meta">
              {paperBtn}
              <span className="stub__table">🎟️ {t('store.orderPlaced')}</span>
            </div>
            <div className="stub__brand">
              {restaurant.logoUrl ? (
                <img src={restaurant.logoUrl} alt="" className="stub__logo" />
              ) : (
                <div className="stub__logo">🏪</div>
              )}
              <div className="stub__copy">
                <h1 className="stub__name">{restaurant.name}</h1>
                <div className="stub__tagline">{t('store.orderPlacedDesc', { name: placed.customer_name })}</div>
                <div className="stub__eyebrow">✓ {t('store.yourOrderNo')}</div>
              </div>
            </div>
          </div>
          <div className="stub__tear" aria-hidden="true" />
        </header>
        <main className="menu__body checkout__body">
          <section className="ticket-card ticket-done__card">
            <div className="ticket-done__label">{t('store.yourOrderNo')}</div>
            <div className="ticket-done__no">{placed.order_no}</div>
            <div className="ticket-done__total">{fmtMoney(placed.grand_total)}</div>
            {(placed.payments || []).length > 1 && (
              <div className="ticket-done__parts">
                {(placed.payments || []).map((p) => (
                  <div key={p.id} className="ticket-done__part">
                    <span className="ticket-done__part-name">
                      {p.method === 'cash' ? t('store.payAtCounter') : p.method}
                      {p.notes ? ` · ${p.notes}` : ''}
                    </span>
                    <span className="ticket-done__part-amount">{fmtMoney(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="ticket-actions">
              {placed.paymentUrl && (
                <a href={placed.paymentUrl} target="_blank" rel="noreferrer" className="ticket-btn">
                  {t('store.payNow')} →
                </a>
              )}
              <Link to={placed.trackUrl || '/track'} className="ticket-btn ticket-btn--ghost">
                🛎️ {t('store.trackIt')}
              </Link>
              <Link to={`/m/${slug}`} className="ticket-btn ticket-btn--ghost">
                {t('store.continueShopping')}
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  // ── Empty cart — the torn-off ticket with nothing written on it ───────
  if (cart.length === 0) {
    return (
      <div className={`menu menu--checkout${paperClass}`} {...paperAttrs}>
        <header className="stub">
          <div className="stub__orbs" aria-hidden="true">
            {ORBS.map((o) => (
              <span key={o.cls} className={`stub__orb ${o.cls}`}>{o.emoji}</span>
            ))}
          </div>
          <div className="stub__inner">
            <div className="stub__meta">{paperBtn}</div>
            <div className="stub__brand">
              {restaurant.logoUrl ? (
                <img src={restaurant.logoUrl} alt="" className="stub__logo" />
              ) : (
                <div className="stub__logo">🏪</div>
              )}
              <div className="stub__copy">
                <h1 className="stub__name">{restaurant.name}</h1>
                <div className="stub__eyebrow">🛒 {t('store.checkoutTicket')}</div>
              </div>
            </div>
          </div>
          <div className="stub__tear" aria-hidden="true" />
        </header>
        <main className="menu__body checkout__body">
          <div className="ticket-empty">
            <div className="ticket-empty__emoji">🛒</div>
            <h1 className="ticket-empty__title">{t('store.cartEmpty')}</h1>
            <p className="ticket-empty__desc">{t('store.cartEmptyDesc')}</p>
            <Link to={`/m/${slug}`} className="ticket-btn">{t('store.backToMenu')}</Link>
          </div>
        </main>
      </div>
    );
  }

  // ── Main checkout — the order form as a ticket ────────────────────────
  return (
    <div className={`menu menu--checkout${paperClass}`} {...paperAttrs}>
      <header className="stub">
        <div className="stub__orbs" aria-hidden="true">
          {ORBS.map((o) => (
            <span key={o.cls} className={`stub__orb ${o.cls}`}>{o.emoji}</span>
          ))}
        </div>
        <div className="stub__inner">
          <div className="stub__meta">
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <Link to={`/m/${slug}`} className="checkout__back">← {t('store.backToMenu')}</Link>
              {paperBtn}
            </div>
            {tableNo && (
              <span className="stub__table" title={t('store.scanToOrder')}>
                🪑 {t('store.table', tableNo)}
              </span>
            )}
          </div>
          <div className="stub__brand">
            {restaurant.logoUrl ? (
              <img src={restaurant.logoUrl} alt="" className="stub__logo" />
            ) : (
              <div className="stub__logo">🏪</div>
            )}
            <div className="stub__copy">
              <h1 className="stub__name">{restaurant.name}</h1>
              {brand.tagline && <div className="stub__tagline">{brand.tagline}</div>}
              <div className="stub__eyebrow">🧾 {t('store.checkoutTicket')} · {t('store.checkout')}</div>
            </div>
          </div>
        </div>
        <div className="stub__tear" aria-hidden="true" />
      </header>

      <main className="menu__body checkout__body">
        {/* 1. Order type */}
        <section className="ticket-card">
          <h2 className="ticket-card__title">{t('store.orderType')}</h2>
          <div className="ticket-opts">
            {ORDER_TYPES.map((type) => {
              const isDelivery = type === 'delivery' || type === 'scheduled_delivery';
              const disabled = isDelivery && !checkoutConfig.deliveryEnabled;
              return (
                <button
                  key={type}
                  disabled={disabled}
                  aria-pressed={orderType === type}
                  onClick={() => setOrderType(type)}
                  className={`ticket-opt${orderType === type ? ' ticket-opt--on' : ''}`}
                >
                  <span className="ticket-opt__emoji">{type === 'pickup' ? '🛍️' : type === 'delivery' ? '🛵' : type === 'scheduled_pickup' ? '📅' : '📦'}</span>
                  <span className="ticket-opt__label">{t(`store.${TYPE_KEY[type]}`)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Customer info */}
        <section className="ticket-card">
          <h2 className="ticket-card__title">{t('store.fullName')}</h2>
          <div className="ticket-field">
            <label className="ticket-label" htmlFor="ticket-name">{t('store.fullName')}</label>
            <input
              id="ticket-name"
              className="ticket-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Rahim Uddin"
            />
          </div>
          <div className="ticket-field">
            <label className="ticket-label" htmlFor="ticket-phone">{t('store.phone')}</label>
            <input
              id="ticket-phone"
              className="ticket-input"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="017XXXXXXXX"
              inputMode="tel"
            />
            <div className="ticket-hint">{t('store.phoneHint')}</div>
          </div>
          <div className="ticket-field">
            <label className="ticket-label" htmlFor="ticket-email">{t('store.email')}</label>
            <input
              id="ticket-email"
              type="email"
              className="ticket-input"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="rahim@example.com"
              autoComplete="email"
            />
            <div className="ticket-hint">{t('store.emailHint')}</div>
          </div>
          {(orderType === 'delivery' || orderType === 'scheduled_delivery') && (
            <div className="ticket-field">
              <label className="ticket-label" htmlFor="ticket-address">{t('store.address')}</label>
              <textarea
                id="ticket-address"
                className="ticket-input"
                style={{ minHeight: 76, resize: 'vertical' }}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                placeholder={t('store.addressHint')}
              />
            </div>
          )}
          {(orderType === 'scheduled_pickup' || orderType === 'scheduled_delivery') && (
            <div className="ticket-field">
              <label className="ticket-label" htmlFor="ticket-schedule">{t('store.schedule')}</label>
              <input
                id="ticket-schedule"
                type="datetime-local"
                className="ticket-input"
                value={form.scheduled_at}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))}
                min={new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)}
              />
              <div className="ticket-hint">{t('store.scheduleHint')}</div>
            </div>
          )}
        </section>

        {/* 3. Payment */}
        <section className="ticket-card">
          <h2 className="ticket-card__title">{t('store.payWith')}</h2>
          <div className="ticket-pays">
            {methods.map((m) => (
              <label
                key={m}
                className={`ticket-pay${paymentMethod === m ? ' ticket-pay--on' : ''}`}
              >
                <input
                  type="radio"
                  name="pay"
                  checked={paymentMethod === m}
                  onChange={() => setPaymentMethod(m)}
                />
                <span className="ticket-pay__name">
                  {m === 'online' ? t('store.payOnline') : m}
                </span>
                <span className="ticket-pay__note">
                  {m === 'cash' ? t('store.payAtCounter') : m === 'online' ? t('store.onlineNote') : t('store.walletHint')}
                </span>
              </label>
            ))}
          </div>

          {!useSplit && ['bkash', 'nagad'].includes(paymentMethod) && walletNumbers[paymentMethod] && (
            <div className="ticket-wallet">
              <div className="ticket-wallet__row">
                <span>{t('store.sendMoneyTo')}</span>
                <span className="ticket-wallet__num">{walletNumbers[paymentMethod]}</span>
                <button
                  onClick={() => copyNumber(walletNumbers[paymentMethod])}
                  className="ticket-copy"
                >
                  {copiedNum === walletNumbers[paymentMethod] ? t('store.copied') : t('store.copyNumber')}
                </button>
              </div>
              <input
                placeholder={t('store.trxId')}
                value={walletTrxId}
                onChange={(e) => setWalletTrxId(e.target.value)}
                className="ticket-input"
                style={{ padding: '9px 12px', fontSize: 13 }}
              />
              <div className="ticket-hint">{t('store.trxIdHint')}</div>
            </div>
          )}

          {splitMethods.length >= 2 && (
            <div style={{ marginTop: 18, borderTop: '1px dashed var(--line-strong)', paddingTop: 16 }}>
              <button onClick={toggleSplit} className="ticket-split-toggle">
                <span>⇄ {useSplit ? t('store.splitOff') : t('store.splitPay')}</span>
                <span className={`ticket-switch${useSplit ? ' ticket-switch--on' : ''}`}>
                  <span className="ticket-switch__knob" />
                </span>
              </button>
              {useSplit && (
                <div className="ticket-splitbox" style={{ marginTop: 14 }}>
                  {/* Mode switch: by amount (free-form) vs by diner (QR table) */}
                  <div className="ticket-seg">
                    {['amount', 'diner'].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => switchSplitMode(mode)}
                        className={`ticket-seg__btn${splitMode === mode ? ' ticket-seg__btn--on' : ''}`}
                      >
                        {mode === 'amount' ? t('store.splitByAmount') : t('store.splitByDiner')}
                      </button>
                    ))}
                  </div>

                  {splitMode === 'amount' ? (
                    <>
                      <div className="ticket-hint">{t('store.splitHint')}</div>
                      {splitMethods.map((m) => (
                        <div key={m} className="ticket-part">
                          <div className="ticket-part__row">
                            <span className="ticket-part__name">
                              {m === 'cash' ? t('store.payAtCounter') : m}
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0"
                              value={splitParts[m] || ''}
                              onChange={(e) => setSplitPart(m, e.target.value)}
                              className="ticket-input ticket-part__amount"
                            />
                            <span className="ticket-part__currency">৳</span>
                          </div>
                          {['bkash', 'nagad'].includes(m) && (
                            <input
                              placeholder={`${t('store.trxId')} ${t('store.optional')}`}
                              aria-label={`${t('store.trxId')} ${m}`}
                              value={splitRefs[m] || ''}
                              onChange={(e) => setSplitRefs((r) => ({ ...r, [m]: e.target.value }))}
                              className="ticket-input"
                              style={{ padding: '8px 11px', fontSize: 12.5 }}
                            />
                          )}
                        </div>
                      ))}
                      <div className={`ticket-reconcile${splitValid ? '' : ' ticket-reconcile--bad'}`}>
                        <span>{t('store.splitRemaining')}</span>
                        <span>৳ {splitRemaining.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="ticket-hint">{t('store.dinerSplitHint')}</div>
                      {diners.map((d, di) => (
                        <div key={di} className="ticket-part">
                          <div className="ticket-part__row">
                            <input
                              placeholder={`${t('store.diner')} ${di + 1}`}
                              value={d.name}
                              onChange={(e) =>
                                setDiners((ds) => ds.map((x, i) => (i === di ? { ...x, name: e.target.value } : x)))
                              }
                              className="ticket-input"
                              style={{ padding: '9px 11px' }}
                            />
                            <select
                              value={d.method}
                              aria-label={`${t('store.diner')} ${di + 1} method`}
                              onChange={(e) =>
                                setDiners((ds) => ds.map((x, i) => (i === di ? { ...x, method: e.target.value } : x)))
                              }
                              className="ticket-input ticket-diner-pick"
                            >
                              {splitMethods.map((m) => (
                                <option key={m} value={m}>
                                  {m === 'cash' ? t('store.payAtCounter') : m}
                                </option>
                              ))}
                            </select>
                            <span
                              aria-label={`${t('store.diner')} ${di + 1} share`}
                              className="ticket-part__amount"
                              style={{ minWidth: 74 }}
                            >
                              {fmtMoney(dinerShares[di])}
                            </span>
                            {diners.length > 2 && (
                              <button
                                onClick={() => removeDiner(di)}
                                aria-label={`${t('store.removeDiner')} ${di + 1}`}
                                className="ticket-remove"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                          {['bkash', 'nagad'].includes(d.method) && (
                            <input
                              placeholder={`${t('store.trxId')} ${t('store.optional')}`}
                              aria-label={`${t('store.trxId')} ${t('store.diner')} ${di + 1}`}
                              value={d.ref || ''}
                              onChange={(e) =>
                                setDiners((ds) => ds.map((x, i) => (i === di ? { ...x, ref: e.target.value } : x)))
                              }
                              className="ticket-input"
                              style={{ padding: '8px 11px', fontSize: 12.5 }}
                            />
                          )}
                        </div>
                      ))}
                      <button onClick={addDiner} className="ticket-add">
                        + {t('store.addDiner')}
                      </button>
                      <div className={`ticket-reconcile${dinerSplitValid ? '' : ' ticket-reconcile--bad'}`}>
                        <span>{t('store.splitRemaining')}</span>
                        <span>৳ 0.00</span>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 4. Summary + submit */}
        <section className="ticket-card">
          <h2 className="ticket-card__title">{t('store.cart')}</h2>

          {/* Restaurant-wide closure (Phase 5): the whole storefront is dark —
              no ordering until the closure passes. */}
          {closedToday && (
            <div className="ticket-note ticket-note--closed">
              <span className="ticket-note__icon">🔒</span>
              <span>{t('store.closedTodayDesc')}</span>
            </div>
          )}

          {/* Scheduled-order availability preview (Phase 5): per-item check at
              the chosen datetime, so the customer never hits a surprise
              "unavailable" rejection after filling the whole form. */}
          {isScheduled && scheduleCheck && scheduleCheck.loading && (
            <div className="ticket-hint">
              {t('store.schedulePreviewTitle')}…
            </div>
          )}
          {isScheduled && scheduleCheck && !scheduleCheck.loading && (
            <div
              className={`ticket-note${scheduleCheck.restaurantClosed || scheduleCheck.unavailableIds.size > 0 ? ' ticket-note--closed' : ' ticket-note--ok'}`}
            >
              <span className="ticket-note__icon">
                {scheduleCheck.restaurantClosed || scheduleCheck.unavailableIds.size > 0 ? '⚠️' : '✓'}
              </span>
              <span>
                {scheduleCheck.restaurantClosed
                  ? t('store.scheduleRestaurantClosed')
                  : scheduleCheck.unavailableIds.size > 0
                    ? cart
                        .filter((l) => scheduleCheck.unavailableIds.has(l.product_id))
                        .map((l) => l.name)
                        .join(', ')
                    : t('store.schedulePreviewDesc')}
              </span>
            </div>
          )}
          {isScheduled && scheduleCheckError && (
            <div className="ticket-hint">{t('store.orderFailed')} — {t('store.schedulePreviewTitle')}</div>
          )}

          {cart.map((line, idx) => {
            const info = lineInfo(line);
            const variantOut = lineVariantOut(line);
            const soldOut = variantOut || productOut(line);
            const scheduledOut = !!scheduleCheck && !scheduleCheck.loading && scheduleCheck.unavailableIds.has(line.product_id);
            const low = (() => {
              const s = info.stock;
              if (s === null || s === undefined || Number(s) <= 0) return null;
              const lowAt = Number(info.lowStockAt ?? 0);
              return lowAt > 0 ? Number(s) <= lowAt : Number(s) <= 5;
            })();
            const blocked = variantOut || scheduledOut;
            return (
            <div key={`${line.product_id}-${line.variant_id}-${line.addon_ids?.join(',')}`} className={`ticket-line${blocked ? ' ticket-line--blocked' : ''}`}>
              <div className="ticket-line__main">
                <div className="ticket-line__name">
                  {line.name}
                  {soldOut && <span className="ticket-stock ticket-stock--out">{t('store.soldOut')}</span>}
                  {!soldOut && low && <span className="ticket-stock ticket-stock--low">{t('store.onlyLeft', Number(info.stock))}</span>}
                  {scheduledOut && !soldOut && (
                    <span className="ticket-stock ticket-stock--out">{t('store.scheduleUnavailableLine', line.name)}</span>
                  )}
                </div>
                {line.options?.length > 0 && (
                  <div className="ticket-line__sub">{line.options.join(' + ')}</div>
                )}
                <div className="ticket-line__sub">{fmtMoney(line.unit_price)} each</div>
              </div>
              <div className="ticket-qty">
                <button onClick={() => updateQty(idx, -1)} disabled={variantOut} className="ticket-qty__btn">−</button>
                <span className="ticket-qty__n">{line.quantity}</span>
                <button onClick={() => updateQty(idx, 1)} disabled={variantOut} className="ticket-qty__btn">+</button>
              </div>
              <span className="ticket-line__amount">{fmtMoney(line.unit_price * line.quantity)}</span>
              {useSplit && splitMode === 'diner' && (
                <select
                  value={dinerAssign[idx] ?? 0}
                  onChange={(e) => setDinerAssign((a) => ({ ...a, [idx]: Number(e.target.value) }))}
                  aria-label={`${t('store.dinerFor')} ${line.name}`}
                  className="ticket-diner-pick"
                >
                  {diners.map((d, di) => (
                    <option key={di} value={di}>
                      {t('store.diner')} {di + 1}
                    </option>
                  ))}
                </select>
              )}
              <button onClick={() => removeLine(idx)} className="ticket-remove">✕</button>
            </div>
            );
          })}
          <div className="ticket-summary">
            <div className="ticket-row">
              <span className="ticket-row__label">{t('store.subtotal')}</span>
              <span>{fmtMoney(subtotal)}</span>
            </div>
            {deliveryFee > 0 && (
              <div className="ticket-row">
                <span className="ticket-row__label">{t('store.deliveryFee')}</span>
                <span>{fmtMoney(deliveryFee)}</span>
              </div>
            )}
            <div className="ticket-row ticket-row--total">
              <span className="ticket-row__label">{t('store.total')}</span>
              <span>{fmtMoney(total)}</span>
            </div>
          </div>
          {error && <div className="ticket-error">{error}</div>}
          <button
            onClick={submit}
            disabled={submitting}
            className="ticket-cta"
          >
            {submitting ? t('store.placingOrder') : `${t('store.placeOrder')} · ${fmtMoney(total)}`}
          </button>
        </section>
      </main>
    </div>
  );
}
