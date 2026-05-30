import {
  createCurrentContextStore,
  type CurrentContextStoreOptions,
} from './currentContextStore';
import {
  createContextsStore,
  type ContextsStoreOptions,
} from './contextsStore';
import { createClientSideToolsStore } from './clientSideToolsStore';
import type { AjentifyStores } from './types';
import type { AjentifyEventHandler } from '../types';

export interface CreateStoresOptions {
  /** Single dispatcher routing every backend request through one handler. */
  onAjentifyEvent: AjentifyEventHandler;
  websocketUrl?: string;
  storage?: ContextsStoreOptions['storage'];
  storageKey?: string;
  WebSocketImpl?: typeof WebSocket;
  reconnect?: CurrentContextStoreOptions['reconnect'];
  requestTimeoutMs?: CurrentContextStoreOptions['requestTimeoutMs'];
  onEvents?: CurrentContextStoreOptions['onEvents'];
  onError?: CurrentContextStoreOptions['onError'];
}

/**
 * Build the three stores for a single Provider instance. The three stores
 * reference each other internally (current → contexts for tokens, current →
 * clientSideTools for tool dispatch).
 */
export function createStores(options: CreateStoresOptions): AjentifyStores {
  const contexts = createContextsStore({
    onEvent: options.onAjentifyEvent,
    storage: options.storage,
    storageKey: options.storageKey,
  });
  const clientSideTools = createClientSideToolsStore();
  const currentContext = createCurrentContextStore({
    websocketUrl: options.websocketUrl,
    contextsStore: contexts,
    clientSideToolsStore: clientSideTools,
    WebSocketImpl: options.WebSocketImpl,
    reconnect: options.reconnect,
    requestTimeoutMs: options.requestTimeoutMs,
    onEvents: options.onEvents,
    onError: options.onError,
  });
  return { currentContext, contexts, clientSideTools };
}
