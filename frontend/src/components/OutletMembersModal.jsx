import { useEffect, useRef, useState, useMemo } from 'react';
import api from '../api';
import { Modal, Button, Field, Select, Skeleton, EmptyState, useToast } from '../components/ui';

const AVATAR_COLORS = [
  'outlet-member-avatar--0',
  'outlet-member-avatar--1',
  'outlet-member-avatar--2',
  'outlet-member-avatar--3',
  'outlet-member-avatar--4',
];

function getInitials(name, email) {
  if (name) return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (email || '?')[0].toUpperCase();
}

function getAvatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

export default function OutletMembersModal({ outlet, onClose }) {
  const [members, setMembers] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('staff');
  const [memberSearch, setMemberSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const mounted = useRef(true);
  // A scoped outlet_manager member manages their branch but may only add /
  // manage staff — they cannot grant outlet_manager or touch managers.
  const isScopedManager = outlet.my_role === 'outlet_manager';

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [membersRes, usersRes] = await Promise.all([
        api.get(`/outlets/${outlet.id}/members`),
        api.get(`/outlets/${outlet.id}/members/candidates`),
      ]);
      if (!mounted.current) return;
      setMembers(membersRes.data);
      // Candidates endpoint already excludes users assigned to this outlet.
      setUsers(usersRes.data);
    } catch {
      if (mounted.current) toast?.error('Could not load members');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  const filteredMembers = useMemo(() => {
    if (!members) return null;
    if (!memberSearch.trim()) return members;
    const q = memberSearch.toLowerCase();
    return members.filter(
      (m) =>
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.email && m.email.toLowerCase().includes(q))
    );
  }, [members, memberSearch]);

  const addMember = async () => {
    if (!selectedUser) return;
    setAdding(true);
    try {
      await api.post(`/outlets/${outlet.id}/members`, {
        user_id: Number(selectedUser),
        role: selectedRole,
      });
      toast.success('Member added');
      setSelectedUser('');
      setSelectedRole('staff');
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || 'Could not add member');
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (member) => {
    if (!window.confirm(`Remove "${member.name || member.email}" from this outlet?`)) return;
    try {
      await api.delete(`/outlets/${outlet.id}/members/${member.user_id}`);
      toast.success('Member removed');
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || 'Could not remove member');
    }
  };

  const changeRole = async (member, newRole) => {
    try {
      await api.post(`/outlets/${outlet.id}/members`, {
        user_id: member.user_id,
        role: newRole,
      });
      toast.success('Role updated');
      await load();
    } catch (err) {
      const msg = err?.response?.data?.error?.message;
      toast.error(msg || 'Could not update role');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Manage Members — ${outlet.name}`}
      description={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {members ? members.length : '...'} member{members?.length !== 1 ? 's' : ''} assigned to this outlet
          {members && members.length > 0 && (
            <span className="outlet-member-count-badge">{members.length}</span>
          )}
        </span>
      }
      width={560}
      footer={
        <Button variant="ghost" onClick={onClose}>Close</Button>
      }
    >
      {/* Add member form */}
      {users.length > 0 && (
        <div className="outlet-add-form">
          <Field label="Add Staff Member" style={{ flex: 1, marginBottom: 0 }}>
            <Select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
              <option value="">Select a user...</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}{u.name ? ` (${u.email})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Role" style={{ width: 130, marginBottom: 0 }}>
            <Select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}>
              <option value="staff">Staff</option>
              {!isScopedManager && <option value="outlet_manager">Manager</option>}
            </Select>
          </Field>
          <Button variant="primary" size="sm" disabled={!selectedUser || adding} onClick={addMember}>
            {adding ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="oms-btn__spinner" />
                Adding...
              </span>
            ) : 'Add'}
          </Button>
        </div>
      )}

      {/* Search members */}
      {members && members.length > 3 && (
        <div className="outlet-members-search">
          <input
            className="outlet-members-search__input"
            placeholder="Search members..."
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
          />
          <span className="outlet-members-search__icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
          </span>
        </div>
      )}

      {/* Current members */}
      {loading ? (
        <div style={{ display: 'grid', gap: 8 }}>
          {[1, 2].map((i) => <Skeleton key={i} height={56} />)}
        </div>
      ) : !filteredMembers || filteredMembers.length === 0 ? (
        <EmptyState
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            </svg>
          }
          title={memberSearch ? 'No matching members' : 'No members yet'}
          description={memberSearch ? 'Try a different search term.' : 'Use the form above to add staff to this outlet.'}
        />
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {filteredMembers.map((m, i) => (
            <div
              key={m.user_id}
              className="outlet-member-card"
              style={{ '--member-index': i }}
            >
              <div className={`outlet-member-avatar ${getAvatarColor(m.user_id)}`}>
                {getInitials(m.name, m.email)}
              </div>
              <div className="outlet-member-info">
                <div className="outlet-member-name">{m.name || m.email}</div>
                {m.name && <div className="outlet-member-email">{m.email}</div>}
              </div>
              <div className="outlet-member-actions">
                {isScopedManager && m.role === 'outlet_manager' ? (
                  <>
                    <span className="outlet-role-badge outlet_manager">Manager</span>
                    <span className="outlet-readonly">locked</span>
                  </>
                ) : (
                  <>
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      style={{ height: 30, fontSize: 12, padding: '0 24px 0 8px', borderRadius: 'var(--radius-xs)' }}
                    >
                      <option value="staff">Staff</option>
                      {!isScopedManager && <option value="outlet_manager">Manager</option>}
                    </Select>
                    <Button variant="danger-ghost" size="sm" onClick={() => removeMember(m)}>
                      Remove
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
