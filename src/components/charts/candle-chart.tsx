import * as React from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { cn } from '@/lib/utils';
import { formatPrice, formatUsdCompact } from '@/lib/format';
import type { PricePoint } from '@/types/models';

/**
 * Candlestick + volume chart.
 *
 * Volume is a histogram on a separate price scale, so it is never confused
 * with price action. Both panes read from the same normalized series, so any
 * provider (or demo data) renders identically.
 */

export interface CandleChartHandle {
  container: HTMLDivElement | null;
}

const UP = '#22c55e';
const DOWN = '#ef4444';

function toSec(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

export function CandleChart({
  candles,
  className,
  height,
  showVolume = true,
  onCrosshair,
  label,
}: {
  candles: PricePoint[];
  className?: string;
  /**
   * Fixed pixel height. When omitted the chart fills its parent and tracks the
   * container via ResizeObserver, which keeps it correct across responsive
   * breakpoints without duplicating breakpoint logic.
   */
  height?: number;
  showVolume?: boolean;
  onCrosshair?: (point: PricePoint | null) => void;
  label?: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const candleSeriesRef = React.useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = React.useRef<ISeriesApi<'Histogram'> | null>(null);
  const crosshairCb = React.useRef(onCrosshair);
  crosshairCb.current = onCrosshair;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => (height ? height : Math.max(220, container.clientHeight));

    const chart = createChart(container, {
      width: container.clientWidth,
      height: measure(),
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6b7684',
        fontFamily: 'JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(35,42,51,0.55)' },
        horzLines: { color: 'rgba(35,42,51,0.55)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#2f3945', width: 1, style: 3, labelBackgroundColor: '#1e242c' },
        horzLine: { color: '#2f3945', width: 1, style: 3, labelBackgroundColor: '#1e242c' },
      },
      rightPriceScale: { borderColor: '#232a33', scaleMargins: { top: 0.08, bottom: showVolume ? 0.26 : 0.08 } },
      timeScale: { borderColor: '#232a33', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      autoSize: false,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineVisible: true,
      priceLineColor: '#2f3945',
      lastValueVisible: true,
    });
    candleSeriesRef.current = candleSeries;

    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    if (showVolume) {
      volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
      volumeSeriesRef.current = volumeSeries;
    }

    chart.subscribeCrosshairMove((param) => {
      if (!crosshairCb.current) return;
      const point = param.seriesData.get(candleSeries) as { time?: Time; open?: number; high?: number; low?: number; close?: number } | undefined;
      if (!point || typeof point.close !== 'number') {
        crosshairCb.current(null);
        return;
      }
      crosshairCb.current({
        time: Number(point.time) * 1000,
        open: point.open ?? point.close,
        high: point.high ?? point.close,
        low: point.low ?? point.close,
        close: point.close,
        volume: null,
      });
    });

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      const h = entries[0]?.contentRect.height;
      if (!w || w <= 0) return;
      chart.applyOptions({ width: Math.floor(w), ...(height ? {} : { height: Math.floor(h || measure()) }) });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [height, showVolume]);

  React.useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || candles.length === 0) return;

    const bars = candles.map((c) => ({
      time: toSec(c.time) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    series.setData(bars);

    const vol = volumeSeriesRef.current;
    if (vol) {
      vol.setData(
        candles
          .filter((c) => c.volume !== null && c.volume !== undefined)
          .map((c) => ({
            time: toSec(c.time) as Time,
            value: c.volume!,
            color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
          })),
      );
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  return (
    <div className={cn('relative w-full', height ? 'shrink-0' : 'h-full', className)} style={height ? { height } : undefined}>
      <div ref={containerRef} className="h-full w-full" aria-label={label ?? 'Price chart'} role="img" />
    </div>
  );
}

/** Lightweight line chart used for sparkline-style overviews and comparisons. */
export function LineChart({
  data,
  className,
  height = 120,
  color = '#22d3ee',
  area = true,
}: {
  data: { time: number; value: number }[];
  className?: string;
  height?: number;
  color?: string;
  area?: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#6b7684',
        fontFamily: 'JetBrains Mono, ui-monospace, monospace',
        fontSize: 9,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(35,42,51,0.5)' } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderVisible: false, timeVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(area ? (LineSeries as never) : (CandlestickSeries as never), {} as never);
    if (area) {
      series.applyOptions({
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }

    (series as unknown as ISeriesApi<'Line'>).setData(
      data.map((d) => ({ time: toSec(d.time) as Time, value: d.value })),
    );

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) chart.applyOptions({ width: Math.floor(w) });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height, color, area]);

  return <div ref={containerRef} className={cn('w-full', className)} style={{ height }} />;
}

export function ChartLegend({
  point,
  last,
}: {
  point: PricePoint | null;
  last: PricePoint | null | undefined;
}) {
  const src = point ?? last ?? null;
  if (!src) return null;
  return (
    <div className="pointer-events-none absolute left-2 top-1 flex flex-wrap items-center gap-2 font-mono text-[10px]">
      <span className="text-dim">
        {new Date(src.time).toLocaleString('en-US', { hour12: false, month: 'short', day: '2-digit' })}
      </span>
      <span className="text-slate-300">O {formatPrice(src.open)}</span>
      <span className="text-slate-300">H {formatPrice(src.high)}</span>
      <span className="text-slate-300">L {formatPrice(src.low)}</span>
      <span className="text-slate-300">C {formatPrice(src.close)}</span>
      {src.volume != null ? <span className="text-dim">V {formatUsdCompact(src.volume)}</span> : null}
    </div>
  );
}