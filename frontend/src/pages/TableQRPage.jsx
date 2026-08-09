import { useEffect, useRef, useState } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n';
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Skeleton,
  Modal,
  Input,
  Field,
  useToast,
} from '../components/ui';

/**
 * QR table menu (Phase 5 starter) — merchant page.
 *
 * Lists every table in the workspace with its QR code (SVG data URI served by
 * `GET /api/tables/qr`). Merchants can add/remove tables, copy a table's
 * storefront link, or print a full A4 sheet of QR codes to cut and stick on
 * tables. Customers scan the QR → storefront opens with `?table=N` pre-set.
 */
export default function TableQRPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { tenants, activeTenantId } = useAuth();
  const activeTenant = tenants.find((tn) => Number(tn.id) === Number(activeTenantId));

  const [tables, setTables] = useState(null); // null = loading
  const [qrs, setQrs] = useState([]);
  const [slug, setSlug] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    try {
      const [tableRes, qrRes] = await Promise.all([
        api.get('/tables'),
        api.get('/tables/qr'),
      ]);
      if (!mounted.current) return;
      setTables(tableRes.data);
      setQrs(qrRes.data.qrs || []);
      setSlug(qrRes.data.slug || null);
    } catch {
      if (mounted.current) {
        setTables([]);
        toast.error('Failed to load tables');
      }
    }
  };

  const qrByTable = (tableNo) => qrs.find((q) => q.tableNo === tableNo);

  /** Hide/show a table — hidden tables drop off the QR sheet and storefront. */
  const toggleActive = async (table) => {
    try {
      await api.patch(`/tables/${table.id}`, { is_active: !table.is_active });
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not update table');
    }
  };

  /** Renders the QR SVG into a canvas and downloads a PNG (falls back to SVG). */
  const downloadPng = async (qr) => {
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = qr.svg;
      await img.decode();
      const size = 600;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      // White background + quiet zone so printers/phones scan it reliably.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      const pad = 32;
      ctx.drawImage(img, pad, pad, size - pad * 2, size - pad * 2);
      const a = document.createElement('a');
      a.download = `table-${qr.tableNo}-qr.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    } catch {
      // Canvas unavailable / decode failed — the SVG data URI still downloads.
      const a = document.createElement('a');
      a.download = `table-${qr.tableNo}-qr.svg`;
      a.href = qr.svg;
      a.click();
    }
  };

  const addTable = async (payload) => {
    try {
      await api.post('/tables', payload);
      toast.success(t('tables.save'));
      setAddOpen(false);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not add table');
    }
  };

  const removeTable = async (table) => {
    if (!window.confirm(t('tables.removeConfirm', table.table_no))) return;
    try {
      await api.delete(`/tables/${table.id}`);
      toast.success(t('tables.remove'));
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.error?.message || 'Could not remove table');
    }
  };

  const copyLink = async (qr) => {
    try {
      await navigator.clipboard.writeText(qr.url);
      setCopiedId(qr.id);
      setTimeout(() => { if (mounted.current) setCopiedId(null); }, 1600);
    } catch {
      toast.error('Copy failed — select the link manually');
    }
  };

  const printSheet = () => window.print();

  const brandName = activeTenant?.name || slug || 'My restaurant';
  // ALL tables render — hidden ones stay visible so they can be re-enabled.
  const visibleTables = tables ?? [];

  return (
    <div className="oms-page">
      <PageHeader
        title={t('tables.page')}
        desc={t('tables.pageDesc')}
        actions={
          <>
            <Button variant="outline" onClick={printSheet} disabled={qrs.length === 0}>
              🖨️ {t('tables.printAll')}
            </Button>
            <Button onClick={() => setAddOpen(true)}>＋ {t('tables.addTable')}</Button>
          </>
        }
      />

      {tables === null ? (
        <Card>
          <div style={{ padding: 24, display: 'grid', gap: 12 }}>
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} height={120} />)}
          </div>
        </Card>
      ) : tables.length === 0 ? (
        <Card>
          <div style={{ padding: '56px 24px', textAlign: 'center', display: 'grid', gap: 8, placeItems: 'center' }}>
            <div style={{ fontSize: 40 }}>🪑</div>
            <h3 style={{ margin: 0 }}>{t('tables.noTables')}</h3>
            <Button onClick={() => setAddOpen(true)} style={{ marginTop: 8 }}>＋ {t('tables.addTable')}</Button>
          </div>
        </Card>
      ) : (
        <>
          <div className="qr-grid">
            {visibleTables.map((table) => {
              const qr = qrByTable(table.table_no);
              return (
                <div className={`qr-card ${table.is_active ? '' : 'qr-card--hidden'}`} key={table.id}>
                  <div className="qr-card__head">
                    <div className="qr-card__no">#{table.table_no}</div>
                    <div className="qr-card__meta">
                      {table.name && <b>{table.name}</b>}
                      <span>
                        {table.capacity ? t('tables.seats', table.capacity) : '—'}
                        {!table.is_active && (
                          <span style={{ marginLeft: 8 }}><Badge tone="neutral">{t('tables.hidden')}</Badge></span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="qr-card__code">
                    {qr ? (
                      <img src={qr.svg} alt={`${t('tables.qrFor', table.table_no)}`} />
                    ) : (
                      <div className="qr-card__placeholder" title={t('tables.hiddenPlaceholder')}>
                        <span>🚫</span>
                        <small>{t('tables.hiddenPlaceholder')}</small>
                      </div>
                    )}
                  </div>
                  <div className="qr-card__actions">
                    {slug && table.is_active && (
                      <Button variant="ghost" size="sm" to={`/m/${slug}?table=${table.table_no}`} target="_blank" rel="noreferrer">
                        {t('tables.openMenu')}
                      </Button>
                    )}
                    {qr && (
                      <Button variant="ghost" size="sm" onClick={() => copyLink(qr)}>
                        {copiedId === qr.id ? t('tables.copied') : t('tables.copyLink')}
                      </Button>
                    )}
                    {qr && (
                      <Button variant="ghost" size="sm" title={t('tables.downloadPngTitle')} onClick={() => downloadPng(qr)}>
                        ⬇ {t('tables.downloadPng')}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(table)}>
                      {table.is_active ? t('tables.hide') : t('tables.show')}
                    </Button>
                    <Button variant="ghost" size="sm" tone="danger" onClick={() => removeTable(table)}>
                      {t('tables.remove')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="qr-hint">💡 {t('tables.printHint')}</p>
        </>
      )}

      {addOpen && (
        <AddTableModal
          existingNos={new Set((tables ?? []).map((tb) => tb.table_no))}
          onSave={addTable}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* Hidden print sheet — only visible in @media print. */}
      <div className="qr-print-sheet" aria-hidden="true">
        <div className="qr-print-sheet__header">
          <h1>{t('tables.printTitle', brandName)}</h1>
          <p>{t('tables.printSub')}</p>
        </div>
        <div className="qr-print-sheet__grid">
          {qrs.map((qr) => (
            <div className="qr-print-sheet__cell" key={qr.id}>
              <img src={qr.svg} alt="" />
              <b>{t('tables.table', qr.tableNo)}</b>
              {qr.name && <span>{qr.name}</span>}
              <small>{qr.url}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddTableModal({ existingNos, onSave, onClose }) {
  const { t } = useI18n();
  const [tableNo, setTableNo] = useState('');
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const no = Number(tableNo);
    if (!Number.isInteger(no) || no < 1) return;
    onSave({
      table_no: no,
      name: name.trim() || null,
      capacity: capacity ? Number(capacity) : null,
    });
  };

  const taken = tableNo !== '' && existingNos.has(Number(tableNo));

  return (
    <Modal open title={t('tables.addTitle')} description={t('tables.addDesc')} onClose={onClose}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 16 }}>
        <Field label={t('tables.tableNo')} hint={taken ? 'Already exists' : undefined}>
          <Input
            autoFocus
            type="number"
            min={1}
            value={tableNo}
            onChange={(e) => setTableNo(e.target.value)}
          />
        </Field>
        <Field label={t('tables.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('tables.capacity')}>
          <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </Field>
        <div className="oms-modal__actions">
          <Button variant="ghost" onClick={onClose}>{t('tables.cancel')}</Button>
          <Button type="submit" disabled={taken || tableNo === ''}>{t('tables.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
