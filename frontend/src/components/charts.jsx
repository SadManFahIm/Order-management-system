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

        {grid.map((g, gi) => (
          <g key={`g-${gi}`}>
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
        {grid.map((g, gi) => (
          <g key={`g-${gi}`}>
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

const METHOD_COLORS = {
  cash: 'var(--primary)',
  bkash: '#00a85e',
  nagad: '#e34c26',
  card: '#6366f1',
  online: 'var(--accent)',
  other: 'var(--text-muted)',
};

const METHOD_LABELS_SHORT = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  online: 'Online',
  other: 'Other',
};

/**
 * Closeout trend (Phase 5) — stacked bars of revenue per Dhaka day, split by
 * payment method, so both the daily curve and the method mix over time are
 * visible in one chart. Hover pins the day readout (revenue + per-method).
 *
 * Phase 6: when `forecast` is passed, a dotted 7-day moving-average line
 * traces the baseline and a dashed polyline projects the next 3 days.
 */
export function CloseoutTrendChart({ data, forecast = null, height = 240 }) {
  const [hover, setHover] = useState(null);
  const active = hover ?? Math.max(data.length - 1, 0);
  const H = height;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const methods = Object.keys(METHOD_COLORS);
  const projection = forecast?.projection || [];
  const movingAverage = forecast?.movingAverage || [];

  // x positions span actuals + projection so the forecast sits to the right
  // of the last bar instead of overflowing the plot area.
  const totalSlots = Math.max(data.length + projection.length - 1, 1);
  const slot = innerW / totalSlots;
  const x = (i) => PAD.l + i * slot;
  const allValues = [
    ...data.map((d) => Number(d.revenue) || 0),
    ...projection.map((p) => Number(p.revenue) || 0),
    ...movingAverage.map((m) => Number(m.value) || 0),
  ];
  const max = Math.max(...allValues, 1);
  const barW = Math.min(slot * 0.52, 34);
  const y = (v) => PAD.t + innerH - (v / max) * innerH;

  const grid = [0, 0.5, 1].map((f) => ({
    v: Math.round(max * f),
    yy: PAD.t + innerH - f * innerH,
  }));
  const activeDay = data[active];
  const mixEntries = methods
    .map((m) => ({ m, v: Number(activeDay.methodMix?.[m]) || 0 }))
    .filter((x) => x.v > 0);

  // Dotted 7-day moving-average polyline (aligned to the actuals).
  const maLine =
    movingAverage.length > 0
      ? movingAverage
          .map(
            (m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(Number(m.value) || 0).toFixed(1)}`
          )
          .join(' ')
      : null;

  // Dashed projection: last actual point → each forecast point.
  const projPts = projection.length > 0
    ? [
        [x(data.length - 1), y(Number(data[data.length - 1].revenue) || 0)],
        ...projection.map((p, k) => [x(data.length - 1 + k + 1), y(Number(p.revenue) || 0)]),
      ]
    : [];
  const projLine = projPts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(' ');

  return (
    <div className="oms-chart">
      <div className="oms-chart__readout">
        <span className="oms-chart__readout-label">{activeDay.date}</span>
        <span className="oms-chart__readout-value">
          {fmtTaka2(activeDay.revenue)}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, marginLeft: 8 }}>
            {activeDay.orders} orders
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Revenue per day by payment method with forecast"
        className="oms-chart__svg"
        onMouseLeave={() => setHover(null)}
      >
        {grid.map((g, gi) => (
          <g key={`g-${gi}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={g.yy} y2={g.yy} stroke="var(--border)" strokeDasharray="3 5" />
            <text x={PAD.l - 8} y={g.yy + 3.5} textAnchor="end" className="oms-chart__axis">
              {fmtTaka(g.v)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          let acc = 0;
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              {methods.map((m) => {
                const v = Number(d.methodMix?.[m]) || 0;
                if (v <= 0) return null;
                const yTop = y(acc + v);
                const yBot = y(acc);
                acc += v;
                return (
                  <rect
                    key={m}
                    x={x(i) + (slot - barW) / 2}
                    y={yTop}
                    width={barW}
                    height={Math.max(yBot - yTop, 2)}
                    rx={2}
                    fill={METHOD_COLORS[m]}
                    opacity={i === active ? 1 : 0.72}
                  />
                );
              })}
              <text
                x={x(i) + slot / 2}
                y={H - 8}
                textAnchor="middle"
                className={`oms-chart__axis ${i === active ? 'oms-chart__axis--active' : ''}`}
              >
                {dayLabel(d.date)}
              </text>
            </g>
          );
        })}

        {maLine && (
          <path d={maLine} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="1 4" strokeLinecap="round" opacity="0.85" />
        )}
        {projLine && (
          <path d={projLine} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
        )}
        {projection.map((p, k) => (
          <g key={p.date}>
            <circle
              cx={x(data.length - 1 + k + 1)}
              cy={y(Number(p.revenue) || 0)}
              r={4}
              fill="var(--surface)"
              stroke="var(--primary)"
              strokeWidth="2"
            />
            <text
              x={x(data.length - 1 + k + 1)}
              y={H - 8}
              textAnchor="middle"
              className="oms-chart__axis"
            >
              F{k + 1}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12 }}>
        {mixEntries.map(({ m, v }) => (
          <span key={m} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: METHOD_COLORS[m] }} />
            {METHOD_LABELS_SHORT[m]} · {fmtTaka2(v)}
          </span>
        ))}
        {mixEntries.length === 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>No revenue this day</span>
        )}
        {maLine && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <span style={{ width: 16, height: 0, borderTop: '2px dotted var(--accent)' }} />
            7-day avg
          </span>
        )}
        {projLine && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
            <span style={{ width: 16, height: 0, borderTop: '2px dashed var(--primary)' }} />
            Forecast
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Peak-hours heatmap (Phase 7) — a 7 (day-of-week, Sun-first) × 24 (Dhaka
 * hour) grid colored by revenue intensity. Hover pins a cell readout with
 * the exact order count + revenue. Zero cells render as the surface tone so
 * slow hours read at a glance (the "busiest hour" insight the merchant
 * actually acts on).
 */
export function PeakHoursHeatmap({ grid = [], days = [], hours = [], maxRevenue = 1, height = 240 }) {
  const [hover, setHover] = useState(null);
  const H = height;
  const ROWS = Math.max(days.length, 7);
  const COLS = Math.max(hours.length, 24);
  const padL = 34;
  const padB = 24;
  const padT = 10;
  const plotW = W - padL - PAD.r;
  const plotH = H - padT - padB;
  const cellW = plotW / COLS;
  const cellH = plotH / ROWS;

  const cellAt = (day, hour) => grid[day]?.[hour] || { orders: 0, revenue: 0 };
  const intensity = (v) => (maxRevenue > 0 ? Math.min(v / maxRevenue, 1) : 0);
  const active = hover;
  const activeCell = active ? cellAt(active.day, active.hour) : null;
  const busiest = activeCell
    ? `${days[active.day]} ${String(active.hour).padStart(2, '0')}:00`
    : null;

  return (
    <div className="oms-chart">
      <div className="oms-chart__readout">
        <span className="oms-chart__readout-label">{busiest || 'Peak hours'}</span>
        <span className="oms-chart__readout-value">
          {activeCell
            ? `${fmtTaka2(activeCell.revenue)} · ${activeCell.orders} ${activeCell.orders === 1 ? 'order' : 'orders'}`
            : 'Hover a cell'}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Peak hours heatmap: orders and revenue by day of week and hour"
        className="oms-chart__svg"
        onMouseLeave={() => setHover(null)}
      >
        {/* Day-of-week labels (Sun-first — Bangladesh work week) */}
        {days.map((label, day) => (
          <text
            key={label}
            x={padL - 7}
            y={padT + cellH * day + cellH / 2 + 4}
            textAnchor="end"
            className={`oms-chart__axis ${active?.day === day ? 'oms-chart__axis--active' : ''}`}
          >
            {label}
          </text>
        ))}
        {/* Hour ticks every 3h */}
        {hours.map((h) =>
          h % 3 === 0 ? (
            <text
              key={h}
              x={padL + cellW * h + cellW / 2}
              y={H - 8}
              textAnchor="middle"
              className="oms-chart__axis"
            >
              {h}
            </text>
          ) : null
        )}
        {/* Cells */}
        {days.map((label, day) =>
          hours.map((hour) => {
            const cell = cellAt(day, hour);
            const hot = active?.day === day && active?.hour === hour;
            const alpha = intensity(cell.revenue);
            return (
              <rect
                key={`${label}-${hour}`}
                x={padL + cellW * hour + 1}
                y={padT + cellH * day + 1}
                width={Math.max(cellW - 2, 1)}
                height={Math.max(cellH - 2, 1)}
                rx={3}
                fill={alpha > 0 ? 'var(--primary)' : 'var(--surface-2)'}
                opacity={hot ? 1 : alpha > 0 ? 0.35 + alpha * 0.6 : 0.55}
                stroke={hot ? 'var(--accent)' : 'none'}
                strokeWidth={hot ? 2 : 0}
                onMouseEnter={() => setHover({ day, hour })}
              >
                <title>{`${label} ${String(hour).padStart(2, '0')}:00 — ${cell.orders} orders, ${fmtTaka2(cell.revenue)}`}</title>
              </rect>
            );
          })
        )}
      </svg>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Slow</span>
        <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--surface-2)', opacity: 0.55 }} />
        <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--primary)', opacity: 0.35 }} />
        <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--primary)', opacity: 1 }} />
        <span>Busy</span>
        <span style={{ marginLeft: 'auto' }}>Hours: Dhaka time (0–23)</span>
      </div>
    </div>
  );
}

const CATEGORY_PALETTE = [
  '#f97316',
  '#0ea5e9',
  '#8b5cf6',
  '#10b981',
  '#f43f5e',
  '#eab308',
  '#6366f1',
  '#14b8a6',
  '#f59e0b',
  '#64748b',
];

/**
 * Category-mix donut (Phase 7) — revenue share by menu category with a
 * legend showing % and per-category totals. Shares the oms-donut styles
 * with StatusDonut.
 */
export function CategoryMixDonut({ data = [], size = 168 }) {
  const total = data.reduce((sum, d) => sum + (Number(d.revenue) || 0), 0);
  const r = (size - 26) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="oms-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Revenue by menu category">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="22" />
        {data.map((d, i) => {
          const frac = total > 0 ? (Number(d.revenue) || 0) / total : 0;
          const dash = frac * c;
          const offset = -acc * c;
          acc += frac;
          if (frac === 0) return null;
          return (
            <circle
              key={d.name}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]}
              strokeWidth="22"
              strokeDasharray={`${Math.max(dash - 3, 0.5)} ${c}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="oms-donut__seg"
            >
              <title>{`${d.name}: ${fmtTaka2(d.revenue)} (${d.pct}%)`}</title>
            </circle>
          );
        })}
        <text x="50%" y="47%" textAnchor="middle" className="oms-donut__total">{fmtTaka(total)}</text>
        <text x="50%" y="58%" textAnchor="middle" className="oms-donut__caption">revenue</text>
      </svg>
      <div className="oms-donut__legend">
        {data.map((d, i) => (
          <div key={d.name} className="oms-donut__row">
            <span
              className="oms-donut__dot"
              style={{ background: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }}
            />
            <span className="oms-donut__name">{d.name}</span>
            <span className="oms-donut__count">
              {d.pct}% · {fmtTaka(d.revenue)}
            </span>
          </div>
        ))}
        {data.length === 0 && (
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
            No paid orders yet
          </div>
        )}
      </div>
    </div>
  );
}

const SPLIT_METHOD_COLORS = {
  equal: '#10b981',
  item: '#6366f1',
  custom: '#f59e0b',
  unsplit: '#64748b',
};

const SPLIT_METHOD_LABELS = {
  equal: 'Equal split',
  item: 'Item split',
  custom: 'Custom split',
  unsplit: 'Unsplit',
};

/**
 * Split-billing donut (dine-in split billing) — how orders in the window
 * were split (equal / item / custom / unsplit). The legend shows order
 * count + % for each method and the paid revenue it generated. Shares the
 * oms-donut styles with CategoryMixDonut / StatusDonut.
 */
export function SplitMethodDonut({ data = {}, size = 168 }) {
  const segments = ['equal', 'item', 'custom', 'unsplit'].map((m) => ({
    method: m,
    orders: m === 'unsplit' ? data.splitOrders?.unsplit || 0 : data.splitOrders?.[m] || 0,
    revenue:
      m === 'unsplit'
        ? 0
        : Number((data.revenue || []).find((r) => r.method === m)?.revenue) || 0,
  }));
  const total = segments.reduce((s, d) => s + d.orders, 0);
  const r = (size - 26) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <div className="oms-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Orders by split method">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-2)" strokeWidth="22" />
        {segments.map((d) => {
          const frac = total > 0 ? d.orders / total : 0;
          const dash = frac * c;
          const offset = -acc * c;
          acc += frac;
          if (frac === 0) return null;
          return (
            <circle
              key={d.method}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={SPLIT_METHOD_COLORS[d.method]}
              strokeWidth="22"
              strokeDasharray={`${Math.max(dash - 3, 0.5)} ${c}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="oms-donut__seg"
            >
              <title>{`${SPLIT_METHOD_LABELS[d.method]}: ${d.orders} orders (${total > 0 ? Math.round((d.orders / total) * 1000) / 10 : 0}%)`}</title>
            </circle>
          );
        })}
        <text x="50%" y="47%" textAnchor="middle" className="oms-donut__total">{total}</text>
        <text x="50%" y="58%" textAnchor="middle" className="oms-donut__caption">orders</text>
      </svg>
      <div className="oms-donut__legend">
        {segments.map((d) => {
          const pct = total > 0 ? Math.round((d.orders / total) * 1000) / 10 : 0;
          return (
            <div key={d.method} className="oms-donut__row">
              <span className="oms-donut__dot" style={{ background: SPLIT_METHOD_COLORS[d.method] }} />
              <span className="oms-donut__name">{SPLIT_METHOD_LABELS[d.method]}</span>
              <span className="oms-donut__count">
                {pct}% · {d.orders}
                {d.revenue > 0 ? ` · ${fmtTaka(d.revenue)}` : ''}
              </span>
            </div>
          );
        })}
        {total === 0 && (
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>
            No orders yet
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_COLORS = {
  placed: 'var(--primary)',
  preparing: 'var(--accent)',
  ready: '#0ea5e9',
  delivered: 'var(--success)',
  canceled: 'var(--danger)',
};/** Donut of order statuses over the window, with a legend. */
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

/**
 * Conversion funnel (Phase 7) — Browse → Cart → Checkout → Paid as
 * proportional horizontal bars with stage counts and step-conversion
 * percentages. Null conversions (zero denominator upstream) render as an
 * em dash, never 0%.
 */
export function FunnelChart({ stages = [], conversions = {} }) {
  const max = Math.max(...stages.map((s) => s.count), 1);
  const convRows = [
    { label: 'Browse → Cart', value: conversions.browseToCart },
    { label: 'Cart → Checkout', value: conversions.cartToCheckout },
    { label: 'Checkout → Paid', value: conversions.checkoutToPaid },
    { label: 'Browse → Paid', value: conversions.browseToPaid },
  ];

  return (
    <div>
      <div style={{ display: 'grid', gap: 12 }}>
        {stages.map((s) => (
          <div key={s.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontWeight: 650 }}>{s.label}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {s.count} sessions
              </span>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 999,
                background: 'var(--surface-2)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.max((s.count / max) * 100, s.count > 0 ? 4 : 0)}%`,
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, var(--primary), var(--accent))',
                  transition: 'width .5s var(--ease-out)',
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
        }}
      >
        {convRows.map((c) => (
          <div key={c.label} className="oms-mini-stat">
            <div className="oms-mini-stat__value">{c.value === null || c.value === undefined ? '—' : `${c.value}%`}</div>
            <div className="oms-mini-stat__label" style={{ fontSize: 11.5 }}>{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

