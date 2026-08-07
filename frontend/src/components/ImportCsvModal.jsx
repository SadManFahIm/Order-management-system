import { useRef, useState } from 'react';
import api from '../api';
import { Modal, Button, Select } from './ui';

/**
 * Bulk-import modal (Phase 4). Uploads a CSV of menu items; the backend
 * validates every row and returns a structured summary (succeeded / failed /
 * skipped + per-row errors) which is rendered here for the merchant.
 */
export default function ImportCsvModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [duplicates, setDuplicates] = useState('skip');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setRunning(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = () => {
    reset();
    onClose();
  };

  const run = async () => {
    if (!file) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('duplicates', duplicates);
      const res = await api.post('/products/import', fd);
      setResult(res.data);
      if (res.data.succeeded > 0) onImported?.();
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Import failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import menu (CSV)"
      description="Upload a CSV of menu items. Valid rows are imported; problem rows are reported below — nothing is lost."
      width={560}
      footer={
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={close} disabled={running}>
            Close
          </Button>
          <Button variant="primary" onClick={run} loading={running} disabled={!file}>
            Import
          </Button>
        </div>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setResult(null);
              setError(null);
            }}
          />
          <a
            href="/api/products/import/template"
            download
            style={{ fontSize: 13, color: 'var(--primary, #00b3a5)' }}
          >
            Download the CSV template
          </a>
        </div>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          Duplicate handling
          <Select value={duplicates} onChange={(e) => setDuplicates(e.target.value)}>
            <option value="skip">Skip duplicates (default)</option>
            <option value="error">Fail the whole import on any duplicate</option>
            <option value="update">Update existing items instead</option>
          </Select>
        </label>

        {error && (
          <div style={{ color: 'var(--oms-danger, #dc2626)', fontSize: 13 }}>{error}</div>
        )}

        {result && (
          <div
            style={{
              border: '1px solid var(--oms-border)',
              borderRadius: 12,
              padding: 14,
              display: 'grid',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 18 }}>
              <Metric label="Total" value={result.total} />
              <Metric label="Imported" value={result.succeeded} tone="success" />
              <Metric label="Failed" value={result.failed} tone={result.failed ? 'danger' : 'neutral'} />
              <Metric label="Skipped" value={result.skipped} tone="neutral" />
            </div>
            {result.createdCategories > 0 && (
              <div style={{ fontSize: 13 }}>
                {result.createdCategories} categor{result.createdCategories === 1 ? 'y' : 'ies'} auto-created
              </div>
            )}
            {result.errors.length > 0 && (
              <div style={{ maxHeight: 180, overflow: 'auto', fontSize: 13, display: 'grid', gap: 4 }}>
                {result.errors.slice(0, 50).map((e, i) => (
                  <div key={i} style={{ color: 'var(--oms-danger, #dc2626)' }}>
                    Row {e.row}: {e.field ? `${e.field} — ` : ''}
                    {e.message}
                  </div>
                ))}
                {result.errors.length > 50 && (
                  <div style={{ color: 'var(--oms-muted, #6b7280)' }}>
                    …and {result.errors.length - 50} more
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Metric({ label, value, tone = 'neutral' }) {
  const color =
    tone === 'success'
      ? 'var(--oms-success, #16a34a)'
      : tone === 'danger'
        ? 'var(--oms-danger, #dc2626)'
        : 'var(--oms-text, #111827)';
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--oms-muted, #6b7280)' }}>{label}</div>
    </div>
  );
}
