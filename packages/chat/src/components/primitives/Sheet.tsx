'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('aj-sheet-overlay', className)}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'right' | 'left' | 'top' | 'bottom';
  /** Render without an overlay (useful for non-modal docked panels). */
  modal?: boolean;
  /** Optional inline style for width. */
  widthPx?: number;
  /** True on mobile breakpoints (forces full-width). */
  isMobile?: boolean;
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  (
    {
      side = 'right',
      className,
      children,
      modal = true,
      widthPx,
      isMobile,
      style,
      ...props
    },
    ref
  ) => (
    <SheetPortal>
      {modal ? <SheetOverlay /> : null}
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'aj-sheet-content',
          `aj-sheet-content--${side}`,
          isMobile && 'aj-sheet-content--mobile',
          className,
        )}
        style={widthPx && !isMobile ? { width: widthPx, ...style } : style}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
);
SheetContent.displayName = 'SheetContent';
