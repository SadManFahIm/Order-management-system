import { useState } from 'react';
import api from '../api';

/**
 * CSV export button (Phase 7) — downloads one chart dataset from
 * GET /api/analytics/export.csv using the exact filter params in play, so
 * what the merchant sees is what they export. Uses the same blob → anchor
 * download pattern as ReportsPage.
 */
export default function ExportCsvButton({ type, params = {}, label = 'CSV', title }) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = await api.get('/analytics/export.csv', {
        params: { type, ...params },
        responseType: 'blob',
      });
      // Prefer the server's filename header; fall back to the documented
      // <type>-analytics-<from>-to-<to>.csv pattern.
      const disposition = res.headers?.['content-disposition'] || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const fallback = `${type}-analytics-${params.from || ''}${
        params.to ? `-to-${params.to}` : ''
      }.csv`;
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = match ? match[1] : fallback;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      /* the card shows its own error state; exports stay silent-fail */
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={download}
      disabled={busy}
      title={title || `Export ${type} as CSV`}
      style={{
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--text-muted)',
        cursor: busy ? 'wait' : 'pointer',
      }}
    >
      {busy ? '…' : `⬇ ${label}`}
    </button>
  );
}
