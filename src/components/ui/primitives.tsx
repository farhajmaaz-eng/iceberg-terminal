import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]" />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-[min(96vw,52rem)] -translate-x-1/2 -translate-y-1/2',
        'border border-edge bg-surface-1 shadow-2xl shadow-black/60',
        'max-h-[92vh] overflow-y-auto scroll-thin',
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close
        className="absolute right-2 top-2 rounded-sm p-1 text-dim transition-colors hover:bg-surface-3 hover:text-slate-100"
        aria-label="Close"
      >
        <X size={14} />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="border-b border-edge px-4 py-3">
      <DialogPrimitive.Title className="text-sm font-semibold tracking-tight text-slate-100">{title}</DialogPrimitive.Title>
      {description ? (
        <DialogPrimitive.Description className="mt-0.5 text-xs text-slate-500">
          {description}
        </DialogPrimitive.Description>
      ) : null}
    </div>
  );
}

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-edge-strong transition-colors',
      'data-[state=checked]:border-cyan/60 data-[state=checked]:bg-cyan/25',
      'data-[state=unchecked]:bg-surface-3',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block h-3 w-3 translate-x-0.5 rounded-full bg-slate-400 transition-transform data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-cyan" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('flex items-center gap-0.5 overflow-x-auto border-b border-edge bg-surface-1 px-1', className)}
    {...props}
  />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'whitespace-nowrap border-b-2 border-transparent px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wider text-dim',
      'transition-colors hover:text-slate-200 data-[state=active]:border-cyan data-[state=active]:text-cyan',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('min-h-0 flex-1 focus-visible:outline-none', className)} {...props} />
));
TabsContent.displayName = 'TabsContent';

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn('shrink-0 bg-edge', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    {...props}
  />
));
Separator.displayName = 'Separator';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-sm border border-edge bg-surface-3 px-2 py-1 text-2xs text-slate-300 shadow-lg',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse-dim rounded-sm bg-surface-3', className)} />;
}