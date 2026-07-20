import type { CSSProperties } from 'react';
import type { ActivityTrendPoint, LeadFunnelStage } from '../lib/types';

/* ─── Shared bits ─────────────────────────────────────────────────── */

const ERROR_COLOR = '#ff6b6b';

const SERIES = [
  { key: 'messages', label: 'Messages', color: '#00f2fe' },
  { key: 'leads', label: 'New Leads', color: '#4facfe' },
  { key: 'bookings', label: 'Bookings', color: '#00ff87' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

function noteStyle(kind: 'loading' | 'error' | 'empty'): CSSProperties {
  return {
    padding: '24px 4px',
    fontSize: '13px',
    color: kind === 'error' ? ERROR_COLOR : 'var(--text-muted)',
  };
}

/* Round a value up to a "nice" axis maximum (1/2/5 × 10ⁿ). */
function niceCeil(value: number): number {
  if (value <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/* Short UTC day label, e.g. "Jul 7". */
function shortDay(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return dateKey;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function Legend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '12px' }}>
      {SERIES.map((s) => (
        <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '3px',
              backgroundColor: s.color,
              boxShadow: `0 0 6px ${s.color}66`,
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

/* ─── 14-day activity trend (inline SVG multi-series line/area) ────── */

export function ActivityTrendChart({
  data,
  loading,
  error,
}: {
  data: ActivityTrendPoint[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !data) return <div style={noteStyle('loading')}>Loading 14-day activity…</div>;
  if (error) return <div style={noteStyle('error')}>{error}</div>;
  if (!data || data.length === 0) return <div style={noteStyle('empty')}>No activity data yet.</div>;

  const totalEvents = data.reduce((sum, p) => sum + p.messages + p.leads + p.bookings, 0);
  if (totalEvents === 0) {
    return (
      <div style={noteStyle('empty')}>
        No messages, leads, or bookings recorded in the last 14 days.
      </div>
    );
  }

  const W = 760;
  const H = 260;
  const padL = 44;
  const padR = 20;
  const padT = 20;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = data.length;

  const maxVal = data.reduce(
    (m, p) => Math.max(m, p.messages, p.leads, p.bookings),
    0
  );
  const axisMax = niceCeil(maxVal);

  const x = (i: number): number => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number): number => padT + plotH * (1 - v / axisMax);

  const gridValues = [0, axisMax / 2, axisMax];

  const latest = data[n - 1];
  if (!latest) return <div style={noteStyle('empty')}>No activity data yet.</div>;

  // Line path for a series, built by mapping (avoids indexed element access).
  const linePath = (key: SeriesKey): string =>
    data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p[key])}`).join(' ');

  const ariaLabel =
    `14-day activity trend. Latest day ${shortDay(latest.date)}: ` +
    `${latest.messages} messages, ${latest.leads} new leads, ${latest.bookings} bookings. ` +
    `Peak daily value ${maxVal}.`;

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={ariaLabel}
          style={{ display: 'block', minWidth: '520px' }}
        >
          <title>14-day activity trend</title>
          <desc>{ariaLabel}</desc>

          {/* Gridlines + y-axis labels */}
          {gridValues.map((gv) => {
            const gy = y(gv);
            return (
              <g key={`grid-${gv}`}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={gy}
                  y2={gy}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
                <text
                  x={padL - 8}
                  y={gy + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {Math.round(gv)}
                </text>
              </g>
            );
          })}

          {/* X-axis day labels (thinned to avoid clutter) */}
          {data.map((p, i) =>
            i % 2 === 0 || i === n - 1 ? (
              <text
                key={`xlabel-${p.date}`}
                x={x(i)}
                y={H - 12}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {shortDay(p.date)}
              </text>
            ) : null
          )}

          {/* Area fill under the messages series */}
          <path
            d={`${linePath('messages')} L ${x(n - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`}
            fill="#00f2fe"
            fillOpacity={0.1}
            stroke="none"
          />

          {/* Series lines + point markers */}
          {SERIES.map((s) => {
            const key = s.key as SeriesKey;
            return (
              <g key={s.key}>
                <path
                  d={linePath(key)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
                {data.map((p, i) => (
                  <circle
                    key={`${s.key}-${p.date}`}
                    cx={x(i)}
                    cy={y(p[key])}
                    r={2.2}
                    fill={s.color}
                  />
                ))}
                {/* Emphasized latest point */}
                <circle cx={x(n - 1)} cy={y(latest[key])} r={7} fill={s.color} fillOpacity={0.2} />
                <circle
                  cx={x(n - 1)}
                  cy={y(latest[key])}
                  r={4}
                  fill={s.color}
                  stroke="var(--bg-secondary)"
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <Legend />
    </div>
  );
}

/* ─── Lead funnel (horizontal bars) ───────────────────────────────── */

export function LeadFunnelChart({
  data,
  loading,
  error,
}: {
  data: LeadFunnelStage[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading && !data) return <div style={noteStyle('loading')}>Loading lead funnel…</div>;
  if (error) return <div style={noteStyle('error')}>{error}</div>;
  if (!data || data.length === 0) return <div style={noteStyle('empty')}>No lead data yet.</div>;

  const total = data.reduce((sum, s) => sum + s.count, 0);
  if (total === 0) {
    return <div style={noteStyle('empty')}>No leads captured yet — the funnel is empty.</div>;
  }

  const maxCount = data.reduce((m, s) => Math.max(m, s.count), 0) || 1;
  const ariaLabel =
    'Lead funnel by stage. ' + data.map((s) => `${s.stage}: ${s.count}`).join(', ') + '.';

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowX: 'auto' }}
    >
      {data.map((s, i) => {
        const pct = Math.round((s.count / maxCount) * 100);
        return (
          <div key={s.stage} style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: '320px' }}>
            <span
              style={{
                width: '96px',
                flexShrink: 0,
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'capitalize',
                color: 'var(--text-muted)',
                textAlign: 'right',
              }}
            >
              {s.stage}
            </span>
            <div
              style={{
                flex: 1,
                height: '26px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-tertiary)',
                border: '1px solid var(--border-muted)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.max(pct, s.count > 0 ? 6 : 0)}%`,
                  height: '100%',
                  borderRadius: '8px',
                  background: `linear-gradient(135deg, var(--color-primary), var(--color-secondary))`,
                  opacity: 1 - i * 0.13,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <span
              style={{
                width: '40px',
                flexShrink: 0,
                fontSize: '14px',
                fontWeight: 700,
                fontFamily: 'var(--font-heading)',
                fontVariantNumeric: 'tabular-nums',
                color: 'var(--text-main)',
              }}
            >
              {s.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
