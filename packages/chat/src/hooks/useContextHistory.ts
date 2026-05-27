'use client';

import { useCallback } from 'react';
import { useStore } from 'zustand';
import type { CreateContextRequest, HistoryContext } from '../types';
import { useAjentifyStores } from './useAjentify';

export interface UseContextHistoryResult {
  history: HistoryContext[];
  loading: boolean;
  error: string | null;
  /** The currently-selected context id. */
  currentContextId: string | null;
  /** Fetch the history list. */
  load: () => Promise<HistoryContext[]>;
  /**
   * Switch to a previous context: fetch its messages, mint a fresh token,
   * and (re)connect the WebSocket.
   */
  switchTo: (contextId: string) => Promise<void>;
  /**
   * Create a brand new context via the dev's createContext callback and
   * connect to it. Returns the new context id.
   */
  createNew: (req?: CreateContextRequest) => Promise<string>;
  /** Clear the active context locally and disconnect. */
  clearCurrent: () => void;
}

/**
 * Surface for the chat header's "+ new", "history" and "switch context"
 * actions. Coordinates the contexts store and the current context store.
 */
export function useContextHistory(): UseContextHistoryResult {
  const stores = useAjentifyStores();
  const history = useStore(stores.contexts, (s) => s.history);
  const loading = useStore(stores.contexts, (s) => s.historyLoading);
  const error = useStore(stores.contexts, (s) => s.historyError);
  const currentContextId = useStore(stores.contexts, (s) => s.contextId);

  const load = useCallback(() => stores.contexts.getState().loadHistory(), [stores]);

  const switchTo = useCallback(
    async (contextId: string) => {
      const ctx = await stores.contexts.getState().loadContext(contextId);
      stores.contexts.getState().setCurrentContext(contextId, null, ctx.client_id ?? null);
      const hydrated = ctx.messages ?? [];
      await stores.currentContext.getState().connect(contextId, undefined);
      stores.currentContext.getState().hydrateMessages(hydrated);
    },
    [stores]
  );

  const createNew = useCallback(
    async (req?: CreateContextRequest) => {
      const created = await stores.contexts.getState().createContext(req);
      stores.currentContext.getState().clear();
      await stores.currentContext.getState().connect(created.context_id);
      if (created.messages?.length) {
        stores.currentContext.getState().hydrateMessages(created.messages);
      }
      return created.context_id;
    },
    [stores]
  );

  const clearCurrent = useCallback(() => {
    stores.currentContext.getState().clear();
    stores.contexts.getState().clearCurrentContext();
  }, [stores]);

  return {
    history,
    loading,
    error,
    currentContextId,
    load,
    switchTo,
    createNew,
    clearCurrent,
  };
}
