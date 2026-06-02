'use client';

import { useCallback } from 'react';
import { useStore } from 'zustand';
import { useAjentifyStores } from './useAjentify';

export interface UseChatPanelResult {
  /** True when the chat panel is open. */
  open: boolean;
  /** Programmatically open/close the chat panel. */
  setOpen: (next: boolean) => void;
  /** Flip the chat panel's open state. */
  toggle: () => void;
  /** Open the chat panel (no-op if already open). */
  openPanel: () => void;
  /** Close the chat panel (no-op if already closed). */
  closePanel: () => void;
}

/**
 * Read and mutate the chat panel's open state from anywhere in the tree.
 *
 * The state lives in the provider's built-in panel store, so a `Topbar`
 * button at the root of the layout and a "Need help?" button inside a deep
 * page can both call `toggle()` without sharing a context.
 *
 * ```tsx
 * function TopBar() {
 *   const { toggle } = useChatPanel();
 *   return <button onClick={toggle}>Open chat</button>;
 * }
 * ```
 */
export function useChatPanel(): UseChatPanelResult {
  const stores = useAjentifyStores();
  const open = useStore(stores.panel, (s) => s.open);

  const setOpen = useCallback(
    (next: boolean) => stores.panel.getState().setOpen(next),
    [stores]
  );
  const toggle = useCallback(() => stores.panel.getState().toggle(), [stores]);
  const openPanel = useCallback(
    () => stores.panel.getState().openPanel(),
    [stores]
  );
  const closePanel = useCallback(
    () => stores.panel.getState().closePanel(),
    [stores]
  );

  return { open, setOpen, toggle, openPanel, closePanel };
}
