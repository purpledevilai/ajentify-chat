import {
  createCurrentContextStore,
  type CurrentContextStoreOptions,
} from './currentContextStore';
import {
  createContextsStore,
  type ContextsStoreOptions,
} from './contextsStore';
import {
  createClientSideToolsStore,
  type OnToolCallCallback,
} from './clientSideToolsStore';
import { createPanelStore } from './panelStore';
import type { AjentifyStores } from './types';
import type { AjentifyProxyHandler } from '../types';

export type { OnToolCallCallback };

export interface CreateStoresOptions {
  /** Single handler forwarding every backend request through the proxy. */
  onAjentifyProxyRequest: AjentifyProxyHandler;
  websocketUrl?: string;
  storage?: ContextsStoreOptions['storage'];
  storageKey?: string;
  WebSocketImpl?: typeof WebSocket;
  reconnect?: CurrentContextStoreOptions['reconnect'];
  requestTimeoutMs?: CurrentContextStoreOptions['requestTimeoutMs'];
  onEvents?: CurrentContextStoreOptions['onEvents'];
  onError?: CurrentContextStoreOptions['onError'];
  agentSpeaksFirst?: CurrentContextStoreOptions['agentSpeaksFirst'];
  /** Analytics hook: fired for every client-side tool dispatch. */
  onToolCall?: OnToolCallCallback;
  /** Initial open/closed state for the panel store. Defaults to false. */
  panelDefaultOpen?: boolean;
}

/**
 * Build the four stores for a single Provider instance. The stores
 * reference each other internally (current → contexts for tokens, current →
 * clientSideTools for tool dispatch).
 */
export function createStores(options: CreateStoresOptions): AjentifyStores {
  const contexts = createContextsStore({
    onProxy: options.onAjentifyProxyRequest,
    storage: options.storage,
    storageKey: options.storageKey,
  });
  const clientSideTools = createClientSideToolsStore({
    onToolCall: options.onToolCall,
  });
  const currentContext = createCurrentContextStore({
    websocketUrl: options.websocketUrl,
    contextsStore: contexts,
    clientSideToolsStore: clientSideTools,
    WebSocketImpl: options.WebSocketImpl,
    reconnect: options.reconnect,
    requestTimeoutMs: options.requestTimeoutMs,
    onEvents: options.onEvents,
    onError: options.onError,
    agentSpeaksFirst: options.agentSpeaksFirst,
  });
  const panel = createPanelStore(options.panelDefaultOpen);
  return { currentContext, contexts, clientSideTools, panel };
}
