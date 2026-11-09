import { useState } from 'react';

/** Vertical bars on one scale, with a hover/focus tooltip per bar. Single series: one hue. */
export function BarChart({ values, labels, tickEvery = 1, format = String, height = 180, ariaLabel }: {
  values: number[];
  labels: string[];
  tickEvery?: number;
  format?: (v: number, i: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const nice = niceMax(max);
  const ticks = [0, nice / 2, nice];
  const W = 640;
  const H = height;
  const padL = 36;
  const padB = 24;
  const padT = 8;
  const plotW = W - padL - 4;
  const plotH = H - padB - padT;
  const step = plotW / values.length;
  const barW = Math.max(2, Math.min(28, step - 2));
  const y = (v: number) => padT + plotH - (v / nice) * plotH;

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 4} className="axis" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {values.map((v, i) => {
          const x = padL + i * step + (step - barW) / 2;
          const h = Math.max(v > 0 ? 2 : 0, y(0) - y(v));
          return (
            <g key={i}>
              <path d={roundedTop(x, y(0) - h, barW, h, Math.min(4, barW / 2))} className={`bar ${hover === i ? 'bar-on' : ''}`} />
              <rect
                x={padL + i * step}
                y={padT}
                width={step}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${labels[i]}: ${format(v, i)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {i % tickEvery === 0 && (
                <text x={padL + i * step + step / 2} y={H - 6} className="axis" textAnchor="middle">
                  {labels[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: `${((padL + hover * step + step / 2) / W) * 100}%`, top: `${(y(values[hover]) / H) * 100}%` }}>
          <span className="tooltip-label">{labels[hover]}</span>
          <strong>{format(values[hover], hover)}</strong>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a short list of categories, each directly labelled. */
export function HBars({ rows, format = String }: { rows: { label: string; value: number }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${format(r.value)}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="hbar-value">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
