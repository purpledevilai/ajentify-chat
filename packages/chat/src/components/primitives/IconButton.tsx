'use client';

import * as React from 'react';
import { Button, type ButtonProps } from './Button';
import { cn } from '../../lib/utils';

export interface IconButtonProps extends Omit<ButtonProps, 'size'> {
  label: string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className, variant = 'ghost', children, ...props }, ref) => {
    return (
      <Button
        ref={ref}
        size="icon"
        variant={variant}
        aria-label={label}
        title={label}
        className={cn('aj-icon-button', className)}
        {...props}
      >
        {children}
      </Button>
    );
  }
);
IconButton.displayName = 'IconButton';
