import { createStore } from 'zustand/vanilla';

/**
 * Owns the open/closed state of the chat panel for the provider.
 *
 * Hosts can ignore this entirely and drive `<ChatPanel open={...}>` as a
 * controlled component, but most apps just want a "toggle the chat" button
 * somewhere in their layout — this store lets `<ChatToggleButton />` (or any
 * dev's own button calling `useChatPanel().toggle()`) flip the panel without
 * prop plumbing.
 */
export interface PanelStore {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

export function createPanelStore(initialOpen = false) {
  return createStore<PanelStore>((set, get) => ({
    open: initialOpen,
    setOpen: (next: boolean) => set({ open: next }),
    toggle: () => set({ open: !get().open }),
    openPanel: () => set({ open: true }),
    closePanel: () => set({ open: false }),
  }));
}
