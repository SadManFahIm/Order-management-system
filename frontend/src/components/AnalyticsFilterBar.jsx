/**
 * Analytics filter bar (Phase 7) — custom date range + channel/order-type
 * filters shared by the dashboard's analytics sections and the CSV exports.
 *
 * Backend-authoritative: the bar only collects params; every validation
 * (range span caps, enum checks) happens server-side and surfaces as an
 * error badge when a request fails.
 */

const CHANNELS = [
  { value: 'all', label: 'All channels' },
  { value: 'pos', label: 'POS' },
  { value: 'storefront', label: 'Storefront' },
];

const ORDER_TYPES = [
  { value: 'all', label: 'All order types' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'scheduled_pickup', label: 'Scheduled pickup' },
  { value: 'scheduled_delivery', label: 'Scheduled delivery' },
];

const selectStyle = {
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 13,
  fontWeight: 600,
};

export default function AnalyticsFilterBar({ filters, onChange, error }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const hasRange = Boolean(filters.from && filters.to);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 14,
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>
        Filters
      </span>
      <input
        type="date"
        aria-label="From date"
        value={filters.from}
        max={filters.to || undefined}
        onChange={(e) => set({ from: e.target.value })}
        style={selectStyle}
      />
      <span style={{ color: 'var(--text-muted)' }}>→</span>
      <input
        type="date"
        aria-label="To date"
        value={filters.to}
        min={filters.from || undefined}
        onChange={(e) => set({ to: e.target.value })}
        style={selectStyle}
      />
      <select
        aria-label="Channel"
        value={filters.channel}
        onChange={(e) => set({ channel: e.target.value })}
        style={{ ...selectStyle, minWidth: 130 }}
      >
        {CHANNELS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Order type"
        value={filters.orderType}
        onChange={(e) => set({ orderType: e.target.value })}
        style={{ ...selectStyle, minWidth: 170 }}
      >
        {ORDER_TYPES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hasRange && (
        <button
          onClick={() => onChange({ from: '', to: '', channel: 'all', orderType: 'all' })}
          style={{
            padding: '8px 12px',
            borderRadius: 10,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--text-muted)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      )}
      {error && (
        <span
          role="alert"
          style={{
            fontSize: 12.5,
            fontWeight: 650,
            color: 'var(--danger)',
            background: 'var(--danger-soft, rgba(220,38,38,.08))',
            padding: '6px 10px',
            borderRadius: 999,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
