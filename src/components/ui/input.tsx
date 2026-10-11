import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-7 w-full rounded-sm border border-edge bg-surface-0 px-2 font-mono text-xs text-slate-100',
        'placeholder:text-dim focus:border-cyan/50 focus:outline-none focus:ring-1 focus:ring-cyan/40',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-7 w-full appearance-none rounded-sm border border-edge bg-surface-0 px-2 pr-6 font-mono text-xs text-slate-200',
        'focus:border-cyan/50 focus:outline-none focus:ring-1 focus:ring-cyan/40',
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath fill='%236b7684' d='M0 0h8L4 5z'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
      }}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-sm border border-edge bg-surface-0 px-2 py-1.5 font-mono text-xs text-slate-100',
        'placeholder:text-dim focus:border-cyan/50 focus:outline-none focus:ring-1 focus:ring-cyan/40',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export function Label({
  className,
  children,
  hint,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label className={cn('flex flex-col gap-1', className)} {...props}>
      <span className="text-2xs font-semibold uppercase tracking-wider text-slate-500">{children}</span>
      {hint ? <span className="text-2xs font-normal normal-case tracking-normal text-dim">{hint}</span> : null}
    </label>
  );
}