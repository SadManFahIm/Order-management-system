import { useEffect, useRef, useState } from 'react';
import api from '../api';
import PromotionForm from '../components/PromotionForm';
import { PageHeader, Card, Table, Button, Badge, Skeleton, useToast } from '../components/ui';

const TYPE_LABEL = { percentage: 'Percentage', fixed: 'Fixed', weighted: 'Weighted' };

// Defensive formatting: legacy rows may contain malformed date strings.
const fmtDate = (d) => {
  if (!d) return '—';
  const parsed = new Date(`${d}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? String(d)
    : parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function PromotionsPage() {
  const [promos, setPromos] = useState(null);
  const toast = useToast();

  const mounted = useRef(true);
  useEffect(() => {
    // Reset on every mount — StrictMode remounts once in dev, and the
    // cleanup would otherwise leave the ref false forever.
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const res = await api.get('/promotions');
      if (mounted.current) setPromos(res.data);
    } catch {
      if (mounted.current) {
        setPromos([]);
        toast?.error('Failed to load promotions');
      }
    }
  };

  const onCreate = async (payload) => {
    await api.post('/promotions', payload);
    toast.success('Promotion created');
    await load();
  };

  const onToggle = async (p) => {
    await api.put(`/promotions/${p.id}`, { enabled: !p.enabled });
    toast.success(p.enabled ? 'Promotion disabled' : 'Promotion enabled');
    await load();
  };

  const onDelete = async (p) => {
    if (!window.confirm(`Delete promotion “${p.title}”? This can't be undone.`)) return;
    try {
      await api.delete(`/promotions/${p.id}`);
      toast.success('Promotion deleted');
      await load();
    } catch {
      toast.error('Could not delete promotion');
    }
  };

  return (
    <div className="oms-page">
      <PageHeader
        title="Promotions"
        desc="Create discounts to drive more orders."
      />

      <div className="oms-grid oms-grid--2col">
        <Card title="New promotion" subtitle="Percentage, fixed, or weight-based discounts.">
          <PromotionForm onCreate={onCreate} />
        </Card>

        <Card bodyPadding={false}>
          {promos === null ? (
            <div style={{ padding: 24, display: 'grid', gap: 12 }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} height={34} />
              ))}
            </div>
          ) : (
            <Table
              columns={[
                { key: 'id', label: 'ID' },
                { key: 'title', label: 'Promotion' },
                { key: 'type', label: 'Type' },
                { key: 'start_date', label: 'Starts' },
                { key: 'end_date', label: 'Ends' },
                { key: 'enabled', label: 'Status' },
                { key: 'actions', label: '', align: 'right' },
              ]}
              rows={promos}
              render={(p, key) => {
                if (key === 'title') return <span className="oms-table__cell-strong">{p.title}</span>;
                if (key === 'type') return <Badge tone="primary">{TYPE_LABEL[p.type] ?? p.type}</Badge>;
                if (key === 'start_date' || key === 'end_date') return fmtDate(p[key]);
                if (key === 'enabled')
                  return p.enabled ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Paused</Badge>;
                if (key === 'actions')
                  return (
                    <div className="oms-table__actions">
                      <Button variant="ghost" size="sm" onClick={() => onToggle(p)}>
                        {p.enabled ? 'Pause' : 'Activate'}
                      </Button>
                      <Button variant="danger-ghost" size="sm" onClick={() => onDelete(p)}>
                        Delete
                      </Button>
                    </div>
                  );
                return p[key];
              }}
              empty={{
                icon: <span style={{ fontSize: 22 }}>🏷️</span>,
                title: 'No promotions yet',
                description: 'Create your first promotion to start offering discounts.',
              }}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
