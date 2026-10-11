import * as React from 'react';
import { cn } from '@/lib/utils';

export const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }
>(({ className, flush: _flush, children, ...props }, ref) => (
  <div ref={ref} className={cn('panel flex min-h-0 flex-col', className)} {...props}>
    {children}
  </div>
));
Panel.displayName = 'Panel';

export function PanelHeader({
  title,
  icon,
  actions,
  subtitle,
  className,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('panel-header', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {icon ? <span className="text-dim shrink-0">{icon}</span> : null}
        <span className="panel-title truncate">{title}</span>
        {subtitle ? <span className="truncate text-2xs text-dim">{subtitle}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

export const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('min-h-0 flex-1 overflow-auto scroll-thin', className)} {...props} />
  ),
);
PanelBody.displayName = 'PanelBody';