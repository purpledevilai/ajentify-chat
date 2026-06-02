'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../../lib/utils';

export type ButtonVariant =
  | 'default'
  | 'secondary'
  | 'ghost'
  | 'outline'
  | 'destructive'
  | 'link';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function variantClass(v: ButtonVariant): string {
  return `aj-button--${v}`;
}
function sizeClass(s: ButtonSize): string {
  return `aj-button--${s}`;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          'aj-button',
          variantClass(variant),
          sizeClass(size),
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';
