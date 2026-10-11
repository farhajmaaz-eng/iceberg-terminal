import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm border px-1 py-px font-mono text-[10px] font-medium uppercase tracking-label',
  {
    variants: {
      tone: {
        neutral: 'border-edge-strong bg-surface-3 text-slate-400',
        info: 'border-cyan/40 bg-cyan/10 text-cyan',
        bull: 'border-bull/40 bg-bull/10 text-bull',
        bear: 'border-bear/40 bg-bear/10 text-bear',
        warn: 'border-amber/40 bg-amber/10 text-amber',
        demo: 'border-fuchsia-500/60 bg-fuchsia-500/15 text-fuchsia-300',
        muted: 'border-transparent bg-transparent text-dim',
        /**
         * Provenance. Providers are frequently named — often several times per
         * view — and a boxed uppercase chip for each one competes with the
         * numbers they describe. This tone is deliberately weightless: the
         * source stays available on hover and to assistive tech, without
         * shouting louder than the data.
         */
        source: 'border-transparent bg-surface-3/60 px-1.5 text-[9px] font-normal normal-case tracking-normal text-dim',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/**
 * Provenance badge.
 *
 * The single most important trust signal in the app: it tells the user,
 * unambiguously, whether a value came from a live provider or from
 * deterministic demo data.
 *
 * The two cases are deliberately asymmetric. Synthetic data is LOUD — it is a
 * safety claim and must be impossible to miss. A live source name is quiet —
 * it is metadata, usually redundant across a view, and would otherwise
 * out-shout the values it describes.
 */
export function ProvenanceBadge({
  origin,
  source,
  fetchedAt,
  stale,
  className,
}: {
  origin: 'live' | 'demo' | 'cached';
  source?: string;
  fetchedAt?: number;
  stale?: boolean;
  className?: string;
}) {
  if (origin === 'demo') {
    return (
      <Badge tone="demo" className={className} title="Deterministic synthetic sample data — not a live market price.">
        Demo data
      </Badge>
    );
  }
  if (stale) {
    return (
      <Badge
        tone="warn"
        className={className}
        title={`Cached data${fetchedAt ? ` from ${new Date(fetchedAt).toLocaleTimeString()}` : ''}.`}
      >
        stale{source ? ` · ${source}` : ''}
      </Badge>
    );
  }
  // A live provider name: present and readable on hover, visually quiet.
  return (
    <Badge
      tone="source"
      className={className}
      title={source ? `Source: ${source}` : 'Live provider data'}
    >
      {source ?? 'live'}
    </Badge>
  );
}