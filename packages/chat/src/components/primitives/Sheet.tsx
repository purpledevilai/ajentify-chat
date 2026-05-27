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
    className={cn(
      'fixed inset-0 z-40 bg-black/40 backdrop-blur-sm animate-aj-fade-in data-[state=closed]:opacity-0',
      className
    )}
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
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  (
    { side = 'right', className, children, modal = true, widthPx, style, ...props },
    ref
  ) => (
    <SheetPortal>
      {modal ? <SheetOverlay /> : null}
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 flex flex-col bg-background shadow-lg border border-border outline-none',
          side === 'right' &&
            'inset-y-0 right-0 h-full data-[state=open]:animate-aj-slide-in-right data-[state=closed]:animate-aj-slide-out-right',
          side === 'left' && 'inset-y-0 left-0 h-full',
          side === 'top' && 'inset-x-0 top-0',
          side === 'bottom' && 'inset-x-0 bottom-0',
          className
        )}
        style={widthPx ? { width: widthPx, ...style } : style}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </SheetPortal>
  )
);
SheetContent.displayName = 'SheetContent';
