'use client';

import * as React from 'react';
import { cn } from '../lib/utils';
import { Sheet, SheetContent } from './primitives/Sheet';
import { ChatView, type ChatViewClassNames, type ChatViewProps } from './ChatView';

const WIDTH_STORAGE_KEY = 'ajentify.chat.panel.width';

export interface ChatPanelClassNames {
  view?: ChatViewClassNames;
  panel?: string;
  handle?: string;
  /** Mobile (< md) sheet content. */
  mobileSheet?: string;
}

export interface ChatPanelProps extends Omit<ChatViewProps, 'classNames' | 'onClose'> {
  /** Controlled open state. */
  open?: boolean;
  /** Controlled change handler. */
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled initial state. */
  defaultOpen?: boolean;
  /** Min width in px on desktop. Defaults to 320. */
  minWidthPx?: number;
  /** Max width in px on desktop. Defaults to 720. */
  maxWidthPx?: number;
  /** Initial width in px on desktop. Defaults to 420. */
  defaultWidthPx?: number;
  /** Disable the resize handle. */
  disableResize?: boolean;
  /** Mobile breakpoint in px. Defaults to 768. */
  mobileBreakpointPx?: number;
  /**
   * Render style on desktop:
   *  - `modal` (default): a slide-in Sheet with overlay; blocks page clicks behind it
   *  - `inline`: a fixed-right docked panel without overlay so users can keep interacting with the page
   */
  desktopVariant?: 'modal' | 'inline';
  classNames?: ChatPanelClassNames;
}

function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', callback);
      return () => mql.removeEventListener('change', callback);
    },
    [query]
  );
  const getSnapshot = React.useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);
  const getServerSnapshot = React.useCallback(() => false, []);
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Opinionated wrapper around `<ChatView />` that slides in from the right
 * edge on desktop (with a draggable resize handle) and full-screens from
 * the right on mobile.
 */
export function ChatPanel({
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  minWidthPx = 320,
  maxWidthPx = 720,
  defaultWidthPx = 420,
  disableResize = false,
  mobileBreakpointPx = 768,
  desktopVariant = 'modal',
  classNames,
  ...viewProps
}: ChatPanelProps): JSX.Element | null {
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = isControlled ? !!controlledOpen : uncontrolledOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  const isMobile = useMediaQuery(`(max-width: ${mobileBreakpointPx - 1}px)`);

  // Persisted desktop width.
  const [width, setWidth] = React.useState(defaultWidthPx);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(WIDTH_STORAGE_KEY);
      if (stored) {
        const num = Number.parseInt(stored, 10);
        if (Number.isFinite(num)) {
          setWidth(Math.min(maxWidthPx, Math.max(minWidthPx, num)));
        }
      }
    } catch {
      // ignore
    }
  }, [maxWidthPx, minWidthPx]);

  const persistWidth = React.useCallback((w: number) => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(WIDTH_STORAGE_KEY, String(w));
      }
    } catch {
      // ignore
    }
  }, []);

  const dragStateRef = React.useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disableResize) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = { startX: e.clientX, startWidth: width };
    },
    [disableResize, width]
  );

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const delta = drag.startX - e.clientX; // panel grows to the left
      const next = Math.min(maxWidthPx, Math.max(minWidthPx, drag.startWidth + delta));
      setWidth(next);
    },
    [maxWidthPx, minWidthPx]
  );

  const onPointerUp = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      dragStateRef.current = null;
      persistWidth(width);
    },
    [persistWidth, width]
  );

  // Inline (non-modal) docked panel on desktop: render a fixed-right div
  // without an overlay so users can keep clicking the underlying page. This
  // is the recommended mode for "always-attached" experiences.
  if (!isMobile && desktopVariant === 'inline') {
    if (!open) return null;
    return (
      <div
        className={cn(
          'aj-root fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-background shadow-xl animate-aj-slide-in-right',
          classNames?.panel
        )}
        style={{ width }}
      >
        {!disableResize ? (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={cn(
              'absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize select-none bg-transparent hover:bg-border/60 transition-colors',
              classNames?.handle
            )}
          />
        ) : null}
        <ChatView
          {...viewProps}
          onClose={() => setOpen(false)}
          classNames={classNames?.view}
        />
      </div>
    );
  }

  // Modal Sheet on desktop, full-screen on mobile.
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className={cn(
          'p-0 border-l',
          isMobile ? 'w-full max-w-full' : '',
          isMobile ? classNames?.mobileSheet : classNames?.panel
        )}
        widthPx={isMobile ? undefined : width}
      >
        {!isMobile && !disableResize ? (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={cn(
              'absolute left-0 top-0 z-10 h-full w-1.5 cursor-ew-resize select-none bg-transparent hover:bg-border/60 transition-colors',
              classNames?.handle
            )}
          />
        ) : null}
        <ChatView
          {...viewProps}
          onClose={() => setOpen(false)}
          classNames={classNames?.view}
        />
      </SheetContent>
    </Sheet>
  );
}
