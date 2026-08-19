import { useEffect, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import { Card, Button, Input, Badge, useToast } from './ui';

/**
 * Delivery zones + rider coverage (Phase 5 follow-up).
 *
 * Managers maintain the zone catalogue and mark which zones each delivery
 * member covers. Auto-assignment uses this to pick a least-loaded in-zone
 * rider for every delivery order (a rider with no zones covers everything).
 */

export default function DeliveryZonesCard() {
  const { t } = useI18n();
  const toast = useToast();
  const { activeTenantId } = useAuth();
  const [zones, setZones] = useState([]);
  const [members, setMembers] = useState([]);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get('/orders/delivery-zones').then((res) => setZones(res.data || [])).catch(() => {});
    api.get('/orders/delivery-members').then((res) => setMembers(res.data || [])).catch(() => {});
  };

  useEffect(() => {
    if (!activeTenantId) return undefined;
    load();
  }, [activeTenantId]);

  const addZone = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await api.post('/orders/delivery-zones', { name: newName.trim() });
      setNewName('');
      toast.success(t('settings.zoneAdded'));
      load();
    } catch {
      toast.error(t('settings.zoneFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggleZone = async (z) => {
    try {
      await api.patch(`/orders/delivery-zones/${z.id}`, { is_active: !z.is_active });
      load();
    } catch {
      toast.error(t('settings.zoneFailed'));
    }
  };

  const deleteZone = async (z) => {
    if (!window.confirm(t('settings.zoneDeleteConfirm'))) return;
    try {
      await api.delete(`/orders/delivery-zones/${z.id}`);
      toast.success(t('settings.zoneDeleted'));
      load();
    } catch {
      toast.error(t('settings.zoneFailed'));
    }
  };

  const setCoverage = async (m, zone, on) => {
    const zones = Array.isArray(m.delivery_zones) ? m.delivery_zones : [];
    const next = on ? [...new Set([...zones, zone])] : zones.filter((z) => z !== zone);
    try {
      await api.patch(`/orders/delivery-members/${m.userId}/zones`, { delivery_zones: next });
      toast.success(t('settings.coverageSaved'));
      load();
    } catch {
      toast.error(t('settings.coverageFailed'));
    }
  };

  return (
    <Card title={t('settings.deliveryZonesTitle')} subtitle={t('settings.deliveryZonesDesc')} style={{ marginTop: 16 }}>
      <div style={{ display: 'grid', gap: 16 }}>
        {/* Zone catalogue */}
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addZone()}
              placeholder={t('settings.zonePlaceholder')}
              style={{ flex: 1, minWidth: 180 }}
            />
            <Button variant="primary" size="sm" onClick={addZone} loading={saving} disabled={!newName.trim()}>
              + {t('settings.zoneAdd')}
            </Button>
          </div>
          {zones.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('settings.zoneEmpty')}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {zones.map((z) => (
              <div
                key={z.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  border: '1px solid var(--border)', borderRadius: 10,
                  opacity: z.is_active ? 1 : 0.55,
                }}
              >
                <Badge tone={z.is_active ? 'primary' : 'neutral'}>{z.name}</Badge>
                <Button size="sm" variant="ghost" onClick={() => toggleZone(z)} title={t('settings.zoneToggle')}>
                  {z.is_active ? '✓' : '○'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => deleteZone(z)} title={t('settings.zoneDelete')}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* Rider coverage matrix */}
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{t('settings.coverageTitle')}</div>
          {members.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('settings.coverageNoMembers')}</div>
          )}
          {members.map((m) => {
            const covered = Array.isArray(m.delivery_zones) ? m.delivery_zones : [];
            const coversAll = covered.length === 0;
            return (
              <div
                key={m.userId}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 10, flexWrap: 'wrap' }}
              >
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name || m.email}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {coversAll ? t('settings.coverageAll') : `${covered.length} ${t('settings.coverageZones')}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {zones.map((z) => {
                    const on = covered.includes(z.name);
                    return (
                      <button
                        key={z.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setCoverage(m, z.name, !on)}
                        style={{
                          padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                          border: on ? '1px solid var(--primary)' : '1px solid var(--border)',
                          background: on ? 'var(--primary)' : 'transparent',
                          color: on ? '#fff' : 'var(--text)',
                        }}
                      >
                        {z.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}