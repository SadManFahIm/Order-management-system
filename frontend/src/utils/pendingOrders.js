import axios from 'axios';

/**
 * Offline submit queue (Phase 5 follow-up) — resilient order placement.
 *
 * The storefront checkout POSTs to the public endpoint with an Idempotency-Key.
 * When the network is unreachable we must NOT lose the customer's order, so we
 * park the exact payload + key in localStorage and replay it the moment the
 * browser comes back online. Each entry keeps its own key, so a retry can never
 * double-create an order (the same key replays into the same order).
 *
 * Storage is slug-scoped to match the cart/idempotency keys:
 *   oms.pending.<slug> → [{ id, body, idemKey, queuedAt }]
 */

const PENDING_KEY = (slug) => `oms.pending.${slug}`;

let initialized = false;

/** Read the queue for a slug (empty array when nothing stored). */
export function listPending(slug) {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY(slug));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function pendingCount(slug) {
  return listPending(slug).length;
}

/** Park an order payload for replay once the network returns. */
export function enqueuePending(slug, body, idemKey) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry = { id, body, idemKey, queuedAt: new Date().toISOString() };
  try {
    const next = [...listPending(slug), entry];
    window.localStorage.setItem(PENDING_KEY(slug), JSON.stringify(next));
  } catch {
    /* storage full / unavailable — nothing more we can do */
  }
  return id;
}

export function removePending(slug, id) {
  try {
    const next = listPending(slug).filter((e) => e.id !== id);
    window.localStorage.setItem(PENDING_KEY(slug), JSON.stringify(next));
  } catch {
    /* noop */
  }
}

export function clearPending(slug) {
  try {
    window.localStorage.removeItem(PENDING_KEY(slug));
  } catch {
    /* noop */
  }
}

/** Replay one queued entry. Resolves true when replayed+removed, false when it
 *  must stay queued (still offline), 'dropped' when the server rejected it. */
async function replayOne(slug, entry) {
  let res;
  try {
    res = await axios.post(`/api/public/restaurants/${slug}/checkout`, entry.body, {
      headers: { 'Idempotency-Key': entry.idemKey },
      timeout: 15000,
    });
  } catch (err) {
    const code = err?.response?.data?.error?.code;
    // A server validation/domain error means the order can never succeed as
    // queued — drop it rather than retry forever. Network / timeout → stay queued.
    if (err?.response && code) {
      removePending(slug, entry.id);
      return 'dropped';
    }
    if (code === 'IDEMPOTENCY_KEY_MISMATCH') {
      // Corrupted local key — drop it too.
      removePending(slug, entry.id);
      return 'dropped';
    }
    return false; // still offline / transient — keep for the next flush
  }
  if (res.status >= 200 && res.status < 300) {
    removePending(slug, entry.id);
    return true;
  }
  return false;
}

/** Replay every queued entry for a slug. Returns counts: { replayed, dropped }. */
export async function flushPending(slug) {
  const entries = listPending(slug);
  if (entries.length === 0) return { replayed: 0, dropped: 0 };
  let replayed = 0;
  let dropped = 0;
  for (const entry of [...entries]) {
    const outcome = await replayOne(slug, entry);
    if (outcome === true) replayed += 1;
    else if (outcome === 'dropped') dropped += 1;
    else break; // offline — replaying the rest will fail the same way
  }
  return { replayed, dropped };
}

/** Flush every tenant's queue. Returns the total number replayed. */
export async function flushAll() {
  const keys = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('oms.pending.')) keys.push(k);
    }
  } catch {
    /* noop */
  }
  let replayed = 0;
  for (const key of keys) {
    const slug = key.slice('oms.pending.'.length);
    replayed += (await flushPending(slug)).replayed;
  }
  return replayed;
}

/**
 * Register global online/offline listeners that auto-flush the queue whenever
 * the browser regains connectivity. Safe to call multiple times (idempotent).
 */
export function setupPendingFlusher() {
  if (initialized) return () => {};
  initialized = true;
  const onOnline = () => {
    flushAll().catch(() => {});
  };
  window.addEventListener('online', onOnline);
  return () => {
    initialized = false;
    window.removeEventListener('online', onOnline);
  };
}