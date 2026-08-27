import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';
import { useI18n } from '../i18n';
import OutletForm from '../components/OutletForm';
import OutletMembersModal from '../components/OutletMembersModal';
import OutletMenuOverridesModal from '../components/OutletMenuOverridesModal';
import { PageHeader, Card, Table, Button, Skeleton, EmptyState, Switch, useToast } from '../components/ui';
import './Outlets.css';

const TIMEZONE_LABELS = {
  'Asia/Dhaka': 'Dhaka (UTC+6)',
  'Asia/Kolkata': 'Kolkata (UTC+5:30)',
  'Asia/Karachi': 'Karachi (UTC+5)',
  'Asia/Dubai': 'Dubai (UTC+4)',
  'Asia/Singapore': 'Singapore (UTC+8)',
  'Asia/Tokyo': 'Tokyo (UTC+9)',
  'Europe/London': 'London (UTC+0)',
  'America/New_York': 'New York (UTC-5)',
  'America/Chicago': 'Chicago (UTC-6)',
  'America/Los_Angeles': 'Los Angeles (UTC-8)',
  'Etc/UTC': 'UTC',
};

const AVATAR_GRADIENTS = [
  'outlet-avatar--teal',
  'outlet-avatar--violet',
  'outlet-avatar--rose',
  'outlet-avatar--amber',
  'outlet-avatar--emerald',
];

function getInitials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function getAvatarGradient(id) {
  return AVATAR_GRADIENTS[id % AVATAR_GRADIENTS.length];
}

export default function OutletsPage() {
  const [outlets, setOutlets] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [membersOutlet, setMembersOutlet] = useState(null);
  const [menuOutlet, setMenuOutlet] = useState(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const toast = useToast();
  const { t } = useI18n();
  const mounted = useRef(true);
  const searchTimer = useRef(null);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const res = await api.get('/outlets');
      if (mounted.current) setOutlets(res.data);
    } catch {
      if (mounted.current) {
        setOutlets([]);
        toast?.error('Failed to load outlets');
      }
    }
  };

  const stats = useMemo(() => {
    if (!outlets) return { total: 0, active: 0, inactive: 0, members: 0 };
    return {
      total: outlets.length,
      active: outlets.filter((o) => o.status === 'active').length,
      inactive: outlets.filter((o) => o.status !== 'active').length,
      members: outlets.reduce((sum, o) => sum + (o.member_count || 0), 0),
    };
  }, [outlets]);

  // Global outlet managers see every outlet with my_role null. Scoped members
  // (outlet_manager / staff) are narrowed to their branches via the API.
  const isGlobalManager = !!outlets && outlets.length > 0 && outlets.some((o) => o.my_role == null);

  const filtered = useMemo(() => {
    if (!outlets) return null;
    let list = outlets;
    if (filter === 'active') list = list.filter((o) => o.status === 'active');
    if (filter === 'inactive') list = list.filter((o) => o.status !== 'active');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.code.toLowerCase().includes(q) ||
          (o.address && o.address.toLowerCase().includes(q))
      );
    }
    return list;
  }, [outlets, filter, search]);

  const onSearchChange = useCallback((e) => {
    const val = e.target.value;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 200);
    // also set immediately for responsive input
    setSearch(val);
  }, []);

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (o) => { setEditing({ ...o }); setShowForm(true); };
  const closeForm = () => { setEditing(null); setShowForm(false); };

  const onCreate = async (data) => {
    await api.post('/outlets', data);
    toast.success('Outlet created');
    closeForm();
    await load();
  };

  const onUpdate = async (data) => {
    try {
      await api.put(`/outlets/${editing.id}`, data);
      closeForm();
      toast.success('Outlet updated');
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || 'Could not update outlet');
      throw err;
    }
  };

  const onToggleStatus = async (o) => {
    const next = o.status === 'active' ? 'inactive' : 'active';
    // optimistic update
    setOutlets((prev) => prev.map((x) => x.id === o.id ? { ...x, status: next } : x));
    try {
      await api.put(`/outlets/${o.id}`, { status: next });
      toast.success(`Outlet ${next === 'active' ? 'activated' : 'deactivated'}`);
    } catch {
      // revert on error
      setOutlets((prev) => prev.map((x) => x.id === o.id ? { ...x, status: o.status } : x));
      toast.error('Could not update status');
    }
  };

  const onDelete = async (o) => {
    if (!window.confirm(`Delete "${o.name}"? Staff assigned to this outlet will be removed.`)) return;
    try {
      await api.delete(`/outlets/${o.id}`);
      toast.success('Outlet deleted');
      if (editing?.id === o.id) closeForm();
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || 'Could not delete outlet');
    }
  };

  const tzLabel = (tz) => TIMEZONE_LABELS[tz] || tz;

  return (
    <div className="oms-page">
      <PageHeader
        title={t('pages.outlets')}
        desc={t('pages.outletsDesc')}
        actions={
          isGlobalManager && (
            <Button variant="primary" onClick={openCreate}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Outlet
            </Button>
          )
        }
      />

      {/* Stats row */}
      {outlets && (
        <div className="outlet-stats">
          <div className="outlet-stat outlet-stat--enter" style={{ '--stagger': 0 }}>
            <div className="outlet-stat__icon outlet-stat__icon--total">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l1-5h16l1 5" /><path d="M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9" /><path d="M9 21V13h6v8" />
              </svg>
            </div>
            <div>
              <div className="outlet-stat__value">{stats.total}</div>
              <div className="outlet-stat__label">Total outlets</div>
            </div>
          </div>
          <div className="outlet-stat outlet-stat--enter" style={{ '--stagger': 1 }}>
            <div className="outlet-stat__icon outlet-stat__icon--active">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div>
              <div className="outlet-stat__value">{stats.active}</div>
              <div className="outlet-stat__label">Active</div>
            </div>
          </div>
          <div className="outlet-stat outlet-stat--enter" style={{ '--stagger': 2 }}>
            <div className="outlet-stat__icon outlet-stat__icon--inactive">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" />
              </svg>
            </div>
            <div>
              <div className="outlet-stat__value">{stats.inactive}</div>
              <div className="outlet-stat__label">Inactive</div>
            </div>
          </div>
          <div className="outlet-stat outlet-stat--enter" style={{ '--stagger': 3 }}>
            <div className="outlet-stat__icon outlet-stat__icon--members">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="outlet-stat__value">{stats.members}</div>
              <div className="outlet-stat__label">Members</div>
            </div>
          </div>
        </div>
      )}

      <div className="oms-grid oms-grid--2col">
        {/* Left: form (only reachable for global outlet managers) */}
        {isGlobalManager && (
          <Card
            title={editing ? t('pages.outletEdit') : t('pages.outletAdd')}
            subtitle={editing ? `Editing "${editing.name}"` : 'Set up a new franchise location.'}
            actions={
              editing && (
                <Button variant="ghost" size="sm" onClick={closeForm}>
                  Cancel
                </Button>
              )
            }
          >
            <OutletForm key={editing?.id ?? 'new'} initial={editing} onSave={editing ? onUpdate : onCreate} />
          </Card>
        )}

        {/* Right: list */}
        <Card bodyPadding={false}>
          {outlets === null ? (
            <div style={{ padding: 24, display: 'grid', gap: 12 }}>
              {[1, 2, 3].map((i) => <Skeleton key={i} height={52} />)}
            </div>
          ) : outlets.length === 0 ? (
            <EmptyState
              icon={
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l1-5h16l1 5" /><path d="M3 9v11a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9" /><path d="M9 21V13h6v8" />
                </svg>
              }
              title="No outlets yet"
              description="Create your first outlet to start managing franchise locations and assigning staff."
              action={
                isGlobalManager && (
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Create first outlet
                  </Button>
                )
              }
            />
          ) : (
            <>
              {/* Search */}
              <div style={{ padding: '16px 16px 0' }}>
                <div className="outlet-search">
                  <span className="outlet-search__icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                    </svg>
                  </span>
                  <input
                    className="outlet-search__input"
                    placeholder="Search by name, code, or address..."
                    defaultValue={search}
                    onChange={onSearchChange}
                  />
                </div>

                {/* Filter chips */}
                <div className="outlet-filters">
                  {[
                    { key: 'all', label: 'All' },
                    { key: 'active', label: 'Active' },
                    { key: 'inactive', label: 'Inactive' },
                  ].map((f) => (
                    <button
                      key={f.key}
                      className={`outlet-chip ${filter === f.key ? 'outlet-chip--active' : ''}`}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                      <span className="outlet-chip__count">
                        {f.key === 'all' ? stats.total : f.key === 'active' ? stats.active : stats.inactive}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Table */}
              <Table className="outlet-table">
                <thead>
                  <tr>
                    <th>Outlet</th>
                    <th>Code</th>
                    <th>Timezone</th>
                    <th>Members</th>
                    <th>Status</th>
                    <th className="oms-table__num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o, i) => (
                    <tr key={o.id} className="outlet-row-enter" style={{ '--row-index': i }}>
                      <td>
                        <div className="outlet-row-name">
                          <div className={`outlet-row-avatar ${getAvatarGradient(o.id)}`}>
                            {getInitials(o.name)}
                          </div>
                          <div className="outlet-row-info">
                            <div className="outlet-row-info__name">{o.name}</div>
                            {o.address && <div className="outlet-row-info__addr">{o.address}</div>}
                          </div>
                        </div>
                      </td>
                      <td><span className="outlet-row-code">{o.code}</span></td>
                      <td>
                        <span className="outlet-row-tz">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                          </svg>
                          {tzLabel(o.timezone)}
                        </span>
                      </td>
                      <td>
                        <span className="outlet-row-members">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                          </svg>
                          {o.member_count || 0}
                        </span>
                      </td>
                      <td>
                        {o.my_role == null ? (
                          <Switch
                            id={`outlet-status-${o.id}`}
                            checked={o.status === 'active'}
                            onChange={() => onToggleStatus(o)}
                            label={o.status === 'active' ? 'Active' : 'Inactive'}
                          />
                        ) : (
                          <span className={`outlet-role-badge ${o.my_role}`}>{o.my_role}</span>
                        )}
                      </td>
                      <td className="oms-table__num">
                        {o.my_role != null && o.my_role !== 'outlet_manager' ? (
                          <span className="outlet-readonly">Read-only</span>
                        ) : (
                          <div className="oms-table__actions">
                            <Button variant="ghost" size="sm" onClick={() => setMenuOutlet(o)} title="Menu overrides">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
                              </svg>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setMembersOutlet(o)} title="Manage members">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                              </svg>
                            </Button>
                            {o.my_role == null && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => openEdit(o)} title="Edit outlet">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                  </svg>
                                </Button>
                                <Button variant="danger-ghost" size="sm" onClick={() => onDelete(o)} title="Delete outlet">
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                  </svg>
                                </Button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          icon={
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
                            </svg>
                          }
                          title="No outlets match"
                          description="Try adjusting your search or filter to find what you're looking for."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>

              <div className="outlet-footer">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                </svg>
                Showing {filtered.length} of {outlets.length} outlet{outlets.length !== 1 ? 's' : ''}
              </div>
            </>
          )}
        </Card>
      </div>

      {showForm && (
        <div className="oms-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeForm(); }}>
          <div className="oms-modal" style={{ maxWidth: 560 }} role="dialog" aria-modal="true">
            <div className="oms-modal__header">
              <div>
                <div className="oms-modal__title">{editing ? 'Edit Outlet' : 'Create Outlet'}</div>
                <div className="oms-modal__desc">{editing ? `Editing "${editing.name}"` : 'Set up a new franchise location.'}</div>
              </div>
              <button className="oms-modal__close" onClick={closeForm} aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="oms-modal__body">
              <OutletForm key={editing?.id ?? 'new'} initial={editing} onSave={editing ? onUpdate : onCreate} />
            </div>
          </div>
        </div>
      )}

      {membersOutlet && (
        <OutletMembersModal
          outlet={membersOutlet}
          onClose={() => setMembersOutlet(null)}
        />
      )}

      {menuOutlet && (
        <OutletMenuOverridesModal
          outlet={menuOutlet}
          onClose={() => setMenuOutlet(null)}
        />
      )}
    </div>
  );
}
