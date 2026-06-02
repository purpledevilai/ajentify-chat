'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../lib/utils';
import { Sheet, SheetContent } from './primitives/Sheet';
import { ChatView, type ChatViewClassNames, type ChatViewProps } from './ChatView';
import { useChatPanel } from '../hooks/useChatPanel';

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
  /**
   * Controlled open state. When omitted (the v0.2 default), the panel reads
   * `useChatPanel().open` from the provider so any external trigger
   * (`<ChatToggleButton />`, custom button calling `useChatPanel().toggle()`,
   * keyboard shortcut, etc.) can toggle it without prop plumbing.
   */
  open?: boolean;
  /** Controlled change handler. Pairs with `open`. */
  onOpenChange?: (open: boolean) => void;
  /** Uncontrolled initial state. Ignored when the provider's panel store is in use. */
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
 * <ChatPanel desktopVariant="inline">
 *   <Routes>...</Routes>
 * </ChatPanel>
 * ```
 *
 * Open/close state is owned by the provider's built-in panel store, so any
 * button anywhere in the tree can call `useChatPanel().toggle()` to open it.
 * Pass `open` / `onOpenChange` to override and run it as a controlled
 * component instead.
 */
export function ChatPanel({
  open: controlledOpen,
  onOpenChange,
  defaultOpen,
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
  const { open: storeOpen, setOpen: storeSetOpen } = useChatPanel();
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? !!controlledOpen : storeOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) storeSetOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange, storeSetOpen]
  );

  // Honor `defaultOpen` on first mount when the consumer is using the
  // built-in store (i.e. uncontrolled). We do this once so the panel can
  // start open on certain pages without forcing controlled mode.
  const didApplyDefaultRef = React.useRef(false);
  React.useEffect(() => {
    if (didApplyDefaultRef.current) return;
    didApplyDefaultRef.current = true;
    if (!isControlled && defaultOpen && !storeOpen) {
      storeSetOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Modal Sheet on desktop or full-screen Sheet on mobile.
  const sheet = (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        isMobile={isMobile}
        widthPx={isMobile ? undefined : width}
        className={cn(
          isMobile ? classNames?.mobileSheet : classNames?.panel,
        )}
      >
        {/*
          Radix Dialog requires a Title + Description for screen readers.
          The visible <ChatHeader /> already shows the agent name, so we
          render the accessibility-only nodes here as sr-only siblings.
        */}
        <DialogPrimitive.Title className="aj-sr-only">
          {viewProps.title ? String(viewProps.title) : 'Assistant chat'}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="aj-sr-only">
          Conversation panel
        </DialogPrimitive.Description>
        {!isMobile && !disableResize ? (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={cn('aj-panel-handle', classNames?.handle)}
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
    <div className={cn('aj-root', 'aj-panel-host', classNames?.root)}>
      <div className={cn('aj-panel-host-body', classNames?.body)}>{children}</div>
      {open ? (
        <div
          className={cn('aj-panel-chat', classNames?.panel)}
          style={{ width }}
        >
          {!disableResize ? (
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className={cn('aj-panel-handle', classNames?.handle)}
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
