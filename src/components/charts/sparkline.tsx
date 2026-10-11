import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Compact inline sparkline. Pure SVG so it stays cheap at table density and
 * needs no canvas context (important for tests + low-power devices).
 */
export function Sparkline({
  data,
  width = 88,
  height = 22,
  className,
  strokeWidth = 1.25,
  showArea = true,
}: {
  data: number[] | null | undefined;
  width?: number;
  height?: number;
  className?: string;
  strokeWidth?: number;
  showArea?: boolean;
}) {
  const gid = React.useId();
  const path = React.useMemo(() => buildSparkPath(data, width, height), [data, width, height]);

  if (!path) {
    return <div className={cn('inline-block text-dim', className)} style={{ width, height }} aria-hidden />;
  }

  const { line, area, tone } = path;
  const color = tone >= 0 ? 'var(--tw-bull,#22c55e)' : 'var(--tw-bear,#ef4444)';

  return (
    <svg
      className={cn('inline-block overflow-visible', className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={tone >= 0 ? 'Sparkline trending up' : 'Sparkline trending down'}
    >
      {showArea ? (
        <>
          <defs>
            <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#spark-${gid})`} />
        </>
      ) : null}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function buildSparkPath(
  data: number[] | null | undefined,
  width: number,
  height: number,
): { line: string; area: string; tone: number } | null {
  const points = (data ?? []).filter((v) => Number.isFinite(v));
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  const pad = 1.5;
  const h = Math.max(1, height - pad * 2);
  const stepX = width / (points.length - 1);

  const coords = points.map((v, i) => {
    const x = i * stepX;
    const y = pad + h - (range === 0 ? h / 2 : ((v - min) / range) * h);
    return [x, y] as const;
  });

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return { line, area, tone: points[points.length - 1]! - points[0]! };
}

/** Horizontal bar used for relative comparisons (liquidity, volume share). */
export function MiniBar({
  value,
  max,
  className,
  tone = 'cyan',
}: {
  value: number | null;
  max: number | null;
  className?: string;
  tone?: 'cyan' | 'bull' | 'bear' | 'amber';
}) {
  if (value === null || max === null || max <= 0) {
    return <div className={cn('h-1 w-full rounded-sm bg-surface-3', className)} />;
  }
  const pct = Math.max(2, Math.min(100, (value / max) * 100));
  const tones: Record<string, string> = {
    cyan: 'bg-cyan/70',
    bull: 'bg-bull/70',
    bear: 'bg-bear/70',
    amber: 'bg-amber/70',
  };
  return (
    <div className={cn('h-1 w-full overflow-hidden rounded-sm bg-surface-3', className)}>
      <div className={cn('h-full rounded-sm', tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}