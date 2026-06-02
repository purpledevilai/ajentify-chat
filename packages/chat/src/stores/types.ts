import type { StoreApi } from 'zustand';
import type { CurrentContextStore } from './currentContextStore';
import type { ContextsStore } from './contextsStore';
import type { ClientSideToolsStore } from './clientSideToolsStore';
import type { PanelStore } from './panelStore';

/**
 * The bundle of vanilla Zustand stores owned by a single `AjentifyProvider`.
 * Wired together via `createStores()`.
 */
export interface AjentifyStores {
  currentContext: StoreApi<CurrentContextStore>;
  contexts: StoreApi<ContextsStore>;
  clientSideTools: StoreApi<ClientSideToolsStore>;
  panel: StoreApi<PanelStore>;
}
