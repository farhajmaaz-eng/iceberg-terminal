import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { NA } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Sparkline } from './sparkline';

/**
 * Sparkline slot for table cells.
 *
 * When the configured providers publish no price history for an asset, the cell
 * shows an explicit em-dash with an explanation instead of an empty box that
 * reads as "flat". Iceberg never synthesizes a trend to fill the gap.
 */
export function SparklineCell({
  data,
  width = 64,
  height = 18,
  className,
}: {
  data: number[] | null | undefined;
  width?: number;
  height?: number;
  className?: string;
}) {
  const hasData = Array.isArray(data) && data.filter((v) => Number.isFinite(v)).length >= 2;

  if (!hasData) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn('tnum inline-flex items-center justify-end gap-1 text-[10px] text-dim', className)}
            style={{ width }}
          >
            {NA}
            <Info size={9} aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          No price history is published for this asset by the configured providers. Iceberg does not synthesize a trend.
        </TooltipContent>
      </Tooltip>
    );
  }

  return <Sparkline data={data} width={width} height={height} className={className} />;
}