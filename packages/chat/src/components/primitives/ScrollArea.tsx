'use client';

import * as React from 'react';
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import { cn } from '../../lib/utils';

/**
 * Thin pass-through wrapper around Radix ScrollArea. The chat's first-party
 * surfaces use plain `<div>`s with `overflow-y: auto` (see `.aj-messages` /
 * `.aj-history-list` in styles.css) — this primitive is exported only so
 * advanced consumers composing custom layouts can use it.
 *
 * Apply your own classes via `className` / `viewportClassName`; the chat
 * package itself adds no opinionated styling here.
 */
export const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root> & {
    viewportRef?: React.Ref<HTMLDivElement>;
    viewportClassName?: string;
  }
>(({ className, children, viewportRef, viewportClassName, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn('aj-scroll-area', className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport
      ref={viewportRef}
      className={cn('aj-scroll-area-viewport', viewportClassName)}
    >
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar
      orientation="vertical"
      className="aj-scroll-area-scrollbar"
    >
      <ScrollAreaPrimitive.Thumb className="aj-scroll-area-thumb" />
    </ScrollAreaPrimitive.Scrollbar>
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
));
ScrollArea.displayName = 'ScrollArea';
