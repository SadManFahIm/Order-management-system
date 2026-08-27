import { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';
import { Modal, Button, Input, Select, Skeleton, EmptyState, useToast } from '../components/ui';

/**
 * Per-outlet menu overrides (Outlet menu overrides sector).
 * Lists the central menu and lets the manager override, for this outlet only:
 *   price        — blank = inherit catalog price
 *   availability — inherit / available / hidden (is_available)
 *   visible      — show or hide at this outlet
 * NULL override fields fall back to the central catalog at serving time.
 */
export default function OutletMenuOverridesModal({ outlet, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [savingId, setSavingId] = useState(null);
  const toast = useToast();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/outlets/${outlet.id}/menu`);
      if (mounted.current) {
        setData(res.data);
        setLoading(false);
      }
    } catch {
      if (mounted.current) {
        toast?.error('Could not load menu');
        setLoading(false);
      }
    }
  };

  // Local working copy of overrides (edits apply on save per item).
  const [draft, setDraft] = useState({});

  const applyDraft = (key, patch) => {
    setDraft((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const categoryById = useMemo(() => {
    if (!data) return new Map();
    return new Map(data.categories.map((c) => [c.id, c.name]));
  }, [data]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    let list = data.items;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [data, search]);

  const dirty = (id) => {
    const ov = data?.items.find((i) => i.id === id)?.override || {};
    const dr = draft[id] || {};
    return (
      (dr.priceOverride !== undefined && (dr.priceOverride ?? '') !== (ov.priceOverride ?? '')) ||
      (dr.isAvailable !== undefined && (dr.isAvailable ?? '') !== (ov.isAvailable ?? '')) ||
      (dr.visible !== undefined && (dr.visible ?? '') !== (ov.visible ?? ''))
    );
  };

  const saveOverride = async (item) => {
    const ov = item.override || {};
    const dr = draft[item.id] || {};
    // Build payload: only include fields the user changed, null clears them.
    const payload = {};
    if (dr.priceOverride !== undefined) {
      const raw = String(dr.priceOverride).trim();
      payload.price_override = raw === '' ? null : Number(raw);
    }
    if (dr.isAvailable !== undefined) {
      payload.is_available = dr.isAvailable;
    }
    if (dr.visible !== undefined) {
      payload.visible = dr.visible;
    }
    if (Object.keys(payload).length === 0 && ov.priceOverride == null && ov.isAvailable == null && ov.visible == null) return;

    // All fields to null → clear the override entirely.
    const allNull = payload.price_override === null && payload.is_available === null && payload.visible === null;
    setSavingId(item.id);
    try {
      if (allNull) {
        await api.delete(`/outlets/${outlet.id}/menu/items/${item.id}`);
      } else {
        await api.put(`/outlets/${outlet.id}/menu/items/${item.id}`, payload);
      }
      toast.success(`Saved "${item.name}"`);
      setDraft((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || 'Could not save override');
    } finally {
      setSavingId(null);
    }
  };

  const clearOverride = async (item) => {
    if (!window.confirm(`Clear all overrides for "${item.name}" at this outlet?`)) return;
    setSavingId(item.id);
    try {
      await api.delete(`/outlets/${outlet.id}/menu/items/${item.id}`);
      toast.success(`Reset "${item.name}" to catalog defaults`);
      setDraft((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
      await load();
    } catch {
      toast.error('Could not clear override');
    } finally {
      setSavingId(null);
    }
  };

  const hasAnyOverride = (item) =>
    item.override?.priceOverride != null ||
    item.override?.isAvailable != null ||
    item.override?.visible != null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Menu overrides — ${outlet.name}`}
      description="Per-outlet price, availability and visibility. Leave fields at Inherit to use the central menu."
      width={760}
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}
    >
      {/* Search */}
      <div className="outlet-members-search" style={{ marginBottom: 12 }}>
        <input
          className="outlet-members-search__input"
          placeholder="Search menu items..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="outlet-members-search__icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
          </svg>
        </span>
      </div>

      {loading ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={64} />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
            </svg>
          }
          title={search ? 'No matching items' : 'No menu items yet'}
          description={search ? 'Try a different search term.' : 'Add items to your menu to configure outlet overrides.'}
        />
      ) : (
        <div style={{ display: 'grid', gap: 8, maxHeight: '56vh', overflowY: 'auto', paddingRight: 4 }}>
          {filteredItems.map((item) => {
            const ov = item.override || {};
            const dr = draft[item.id] || {};
            const priceVal = dr.priceOverride !== undefined ? (dr.priceOverride ?? '') : (ov.priceOverride != null ? ov.priceOverride : '');
            const avail = dr.isAvailable !== undefined ? dr.isAvailable : (ov.isAvailable != null ? ov.isAvailable : 'inherit');
            const visible = dr.visible !== undefined ? dr.visible : (ov.visible != null ? ov.visible : true);
            const categoryName = categoryById.get(item.categoryId) || 'Uncategorised';
            return (
              <div key={item.id} className={`outlet-ov-item ${hasAnyOverride(item) ? 'outlet-ov-item--override' : ''}`}>
                <div className="outlet-ov-item__head">
                  <div className="outlet-ov-item__name">{item.name}</div>
                  <span className="outlet-ov-item__cat">{categoryName}</span>
                </div>
                <div className="outlet-ov-item__controls">
                  <div className="outlet-ov-price">
                    <span className="outlet-ov-price__label">Price</span>
                    <div className="outlet-ov-price__row">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Inherit"
                        value={priceVal}
                        onChange={(e) => applyDraft(item.id, { priceOverride: e.target.value === '' ? null : Number(e.target.value) })}
                        style={{ width: 96, height: 30, fontSize: 13 }}
                      />
                      {hasAnyOverride(item) && (
                        <span className="outlet-ov-price__val outlet-ov-price__val--override">
                          ৳{Number(item.effectivePrice ?? item.price).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="outlet-ov-price">
                    <span className="outlet-ov-price__label">Availability</span>
                    <Select
                      value={avail}
                      onChange={(e) => applyDraft(item.id, { isAvailable: e.target.value === 'inherit' ? '' : e.target.value === 'yes' })}
                      style={{ height: 30, fontSize: 13 }}
                    >
                      <option value="inherit">Inherit</option>
                      <option value="yes">Available</option>
                      <option value="no">Unavailable</option>
                    </Select>
                  </div>

                  <div className="outlet-ov-price">
                    <span className="outlet-ov-price__label">Visible</span>
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(e) => applyDraft(item.id, { visible: e.target.checked })}
                    />
                  </div>

                  <div className="outlet-ov-item__actions">
                    {dirty(item.id) && (
                      <Button variant="primary" size="sm" disabled={savingId === item.id} onClick={() => saveOverride(item)}>
                        {savingId === item.id ? 'Saving…' : 'Save'}
                      </Button>
                    )}
                    {hasAnyOverride(item) && !dirty(item.id) && (
                      <Button variant="danger-ghost" size="sm" disabled={savingId === item.id} onClick={() => clearOverride(item)}>
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredItems.length === 0 && (
            <EmptyState
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                </svg>
              }
              title="No items match"
              description="Try a different search term."
            />
          )}
        </div>
      )}
    </Modal>
  );
}
