import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: 'border-edge-strong bg-surface-3 text-slate-200 hover:bg-surface-4 hover:text-white',
        primary: 'border-cyan/40 bg-cyan/15 text-cyan hover:bg-cyan/25',
        ghost: 'border-transparent bg-transparent text-slate-400 hover:bg-surface-3 hover:text-slate-100',
        outline: 'border-edge bg-transparent text-slate-300 hover:bg-surface-2 hover:text-white',
        danger: 'border-bear/40 bg-bear/10 text-bear hover:bg-bear/20',
        bull: 'border-bull/40 bg-bull/10 text-bull hover:bg-bull/20',
      },
      size: {
        sm: 'h-6 px-2 text-2xs',
        md: 'h-7 px-2.5',
        lg: 'h-9 px-4',
        icon: 'h-6 w-6',
        'icon-sm': 'h-5 w-5',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };