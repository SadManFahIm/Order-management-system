import { useState } from 'react';

/**
 * Dependency-free SVG chart kit for the merchant dashboard (Phase 4 R3).
 * Everything is driven by CSS variables so charts adapt to light/dark mode
 * and per-tenant brand accents automatically. No charting library — keeps
 * the bundle lean and the look custom (Stripe/Linear-style).
 */

const fmtTaka = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const fmtTaka2 = (n) => `৳ ${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** YYYY-MM-DD → short weekday label (timezone-safe). */
const dayLabel = (dateStr) => {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'short' });
};

const W = 560;
const PAD = { t: 18, r: 10, b: 28, l: 46 };

/**
 * 7-day revenue area chart. Hovering a day pins the value readout; the line
 * draws itself in on mount (stroke-dashoffset animation).
 */
export function TrendAreaChart({ data, height = 220 }) {
  const [hover, setHover] = useState(null);
  const active = hover ?? Math.max(data.length - 1, 0);
  const H = height;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(...data.map((d) => Number(d.revenue) || 0), 1);

  const x = (i) =>
    PAD.l + (data.length <= 1 ? innerW / 2 : (i * innerW) / (data.length - 1));
  const y = (v) => PAD.t + innerH - (v / max) * innerH;

  const pts = data.map((d, i) => [x(i), y(Number(d.revenue) || 0)]);
  const line = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${PAD.t + innerH} L${x(0).toFixed(
    1
  )},${PAD.t + innerH} Z`;

  const grid = [0, 0.5, 1].map((f) => ({
    v: Math.round(max * f),
    yy: PAD.t + innerH - f * innerH,
  }));

  return (
    <div className="oms-chart">
      <div className="oms-chart__readout">
        <span className="oms-chart__readout-label">{dayLabel(data[active].date)}</span>
        <span className="oms-chart__readout-value">{fmtTaka2(data[active].revenue)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Revenue over the last 7 days"
        className="oms-chart__svg"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="trend-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
        </defs>

        {grid.map((g) => (
          <g key={g.v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={g.yy}
              y2={g.yy}
              stroke="var(--border)"
              strokeDasharray="3 5"
            />
            <text x={PAD.l - 8} y={g.yy + 3.5} textAnchor="end" className="oms-chart__axis">
              {fmtTaka(g.v)}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#trend-fill)" />
        <path d={line} fill="none" stroke="url(#trend-line)" strokeWidth="2.5" strokeLinecap="round" pathLength="1" className="oms-chart__draw" />

        {data.map((d, i) => (
          <circle
            key={d.date}
            cx={x(i)}
            cy={y(Number(d.revenue) || 0)}
            r={i === active ? 5.5 : 3.5}
            fill={i === active ? 'var(--primary)' : 'var(--surface)'}
            stroke="var(--primary)"
            strokeWidth="2"
            className="oms-chart__point"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {data.map((d, i) => (
          <text
            key={`x-${d.date}`}
            x={x(i)}
            y={H - 8}
            textAnchor="middle"
            className={`oms-chart__axis ${i === active ? 'oms-chart__axis--active' : ''}`}
          >
            {dayLabel(d.date)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * 7-day orders bar chart — rounded bars that grow in on mount, hover shows
 * the exact order count.
 */
export function OrdersBarChart({ data, height = 220 }) {
  const [hover, setHover] = useState(null);
  const active = hover ?? Math.max(data.length - 1, 0);
  const H = height;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const max = Math.max(...data.map((d) => Number(d.orders) || 0), 1);
  const slot = innerW / data.length;
  const barW = Math.min(slot * 0.46, 42);
  const y = (v) => PAD.t + innerH - (v / max) * innerH;

  const grid = [0, 0.5, 1].map((f) => ({
    v: Math.round(max * f),
    yy: PAD.t + innerH - f * innerH,
  }));

  return (
    <div className="oms-chart">
      <div className="oms-chart__readout">
        <span className="oms-chart__readout-label">{dayLabel(data[active].date)}</span>
        <span className="oms-chart__readout-value">{data[active].orders} orders</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Orders over the last 7 days"
        className="oms-chart__svg"
        onMouseLeave={() => setHover(null)}
      >
        {grid.map((g) => (
          <g key={g.v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={g.yy} y2={g.yy} stroke="var(--border)" strokeDasharray="3 5" />
            <text x={PAD.l - 8} y={g.yy + 3.5} textAnchor="end" className="oms-chart__axis">
              {g.v}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const bh = innerH - (y(Number(d.orders) || 0) - PAD.t);
          const barH = Math.max(bh, d.orders > 0 ? 3 : 1.5);
          return (
            <g
              key={d.date}
              className="oms-chart__bar"
              onMouseEnter={() => setHover(i)}
            >
              <rect
                x={PAD.l + slot * i + (slot - barW) / 2}
                y={y(Number(d.orders) || 0)}
                width={barW}
                height={barH}
                rx={Math.min(7, barW / 2)}
                fill={i === active ? 'var(--accent)' : 'var(--primary)'}
                opacity={i === active ? 1 : 0.78}
              />
              <text x={PAD.l + slot * i + slot / 2} y={H - 8} textAnchor="middle" className={`oms-chart__axis ${i === active ? 'oms-chart__axis--active' : ''}`}>
                {dayLabel(d.date)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const STATUS_COLORS = {
  placed: 'var(--primary)',
  preparing: 'var(--accent)',
  ready: '#0ea5e9',
  delivered: 'var(--success)',
  canceled: 'var(--danger)',
};

/** Donut of order statuses over the window, with a legend. */
export function StatusDonut({ data, size = 168 }) {
  const total = data.reduce((sum, d) => sum + (Number(d.count) || 0), 0);
  const r = (size - 26) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="oms-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Order status breakdown">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="22" />
        {data.map((d) => {
          const frac = total > 0 ? (Number(d.count) || 0) / total : 0;
          const dash = frac * c;
          const offset = -acc * c;
          acc += frac;
          if (frac === 0) return null;
          return (
            <circle
              key={d.status}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={STATUS_COLORS[d.status] || 'var(--text-muted)'}
              strokeWidth="22"
              strokeDasharray={`${Math.max(dash - 3, 0.5)} ${c}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="oms-donut__seg"
            >
              <title>{`${d.status}: ${d.count}`}</title>
            </circle>
          );
        })}
        <text x="50%" y="47%" textAnchor="middle" className="oms-donut__total">{total}</text>
        <text x="50%" y="58%" textAnchor="middle" className="oms-donut__caption">orders</text>
      </svg>
      <div className="oms-donut__legend">
        {data.map((d) => (
          <div key={d.status} className="oms-donut__row">
            <span className="oms-donut__dot" style={{ background: STATUS_COLORS[d.status] || 'var(--text-muted)' }} />
            <span className="oms-donut__name">{d.status}</span>
            <span className="oms-donut__count">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

