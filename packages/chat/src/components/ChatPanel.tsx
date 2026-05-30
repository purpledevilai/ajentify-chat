'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../lib/utils';
import { Sheet, SheetContent } from './primitives/Sheet';
import { ChatView, type ChatViewClassNames, type ChatViewProps } from './ChatView';

const WIDTH_STORAGE_KEY = 'ajentify.chat.panel.width';

export interface ChatPanelClassNames {
  view?: ChatViewClassNames;
  /** The chat container (the inline dock on desktop, the sheet on modal/mobile). */
  panel?: string;
  /** The resize handle (desktop only). */
  handle?: string;
  /** Mobile (< md) sheet content. */
  mobileSheet?: string;
  /** The outer wrapper (inline mode only). Defaults to a horizontal flex row that fills its parent. */
  root?: string;
  /** The slot containing `children` (inline mode only). Defaults to a scrollable flex column. */
  body?: string;
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
   *  - `modal` (default): the chat opens as an overlaying Sheet with a
   *    backdrop; blocks page clicks behind it. `children` render normally
   *    underneath.
   *  - `inline`: the chat docks in-flow on the right and `children` (your
   *    routes / page content) render in the remaining space. Resizing the
   *    panel shrinks/expands the children area in real time.
   */
  desktopVariant?: 'modal' | 'inline';
  classNames?: ChatPanelClassNames;
  /**
   * Page content the panel docks alongside. In `modal` (and on mobile) the
   * children render in their natural place and the chat opens as an overlay;
   * in desktop `inline` mode they share a horizontal flex layout with the
   * docked chat.
   */
  children?: React.ReactNode;
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
 * Opinionated wrapper around `<ChatView />` designed to *wrap* your page or
 * route content. On desktop it can either dock inline (`desktopVariant="inline"`,
 * sharing horizontal space with `children`) or open as a modal Sheet over the
 * top of `children`. On mobile it always falls back to a full-screen Sheet.
 *
 * ```tsx
 * <ChatPanel open={open} onOpenChange={setOpen} desktopVariant="inline">
 *   <Routes>...</Routes>
 * </ChatPanel>
 * ```
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
  children,
  ...viewProps
}: ChatPanelProps): JSX.Element {
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

  // Modal Sheet on desktop or full-screen Sheet on mobile. Used for both the
  // explicit `modal` desktop variant and any mobile breakpoint.
  const sheet = (
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
        {/*
          Radix Dialog requires a Title + Description for screen readers.
          The visible <ChatHeader /> already shows the agent name, so we
          render the accessibility-only nodes here as sr-only siblings.
        */}
        <DialogPrimitive.Title className="sr-only">
          {viewProps.title ? String(viewProps.title) : 'Assistant chat'}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="sr-only">
          Conversation panel
        </DialogPrimitive.Description>
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

  // Modal mode (and any mobile rendering) just renders the children in their
  // normal place and overlays the Sheet via Radix's portal.
  if (isMobile || desktopVariant === 'modal') {
    return (
      <>
        {children}
        {sheet}
      </>
    );
  }

  // Desktop inline mode: wrap children + the docked chat in a horizontal
  // flex row that fills its parent. The children area gets `flex-1` so it
  // shrinks/expands as the chat is resized.
  return (
    <div
      className={cn(
        'aj-root flex min-h-0 flex-1 flex-row',
        classNames?.root
      )}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-auto',
          classNames?.body
        )}
      >
        {children}
      </div>
      {open ? (
        <div
          className={cn(
            'relative flex h-full shrink-0 flex-col self-stretch border-l border-border bg-background animate-aj-slide-in-right',
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
                'absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-ew-resize select-none bg-transparent hover:bg-border/60 transition-colors',
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
      ) : null}
    </div>
  );
}
