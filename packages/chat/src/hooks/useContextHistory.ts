'use client';

import { useCallback } from 'react';
import { useStore } from 'zustand';
import type { CreateContextRequest, HistoryContext } from '../types';
import { useAjentifyStores } from './useAjentify';

export interface UseContextHistoryResult {
  history: HistoryContext[];
  loading: boolean;
  error: string | null;
  /** True after the first successful load this session. */
  loaded: boolean;
  /** The currently-selected context id. */
  currentContextId: string | null;
  /** Force a refetch of the history list. */
  load: () => Promise<HistoryContext[]>;
  /**
   * Return the cached history if it has already been loaded; otherwise
   * fetch it. Use this for "open the history view" mounts so the list
   * isn't refetched every time.
   */
  ensureLoaded: () => Promise<HistoryContext[]>;
  /** Mark the cached history as stale so the next `ensureLoaded()` refetches. */
  invalidate: () => void;
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
  /**
   * Delete a context by id. Dispatches the `delete_context` event to the
   * dev's backend, drops the entry from the cached history list, and — if
   * the deleted context was the active one — disconnects the WebSocket and
   * clears local state so the chat returns to an empty state.
   */
  deleteContext: (contextId: string) => Promise<void>;
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
  const loaded = useStore(stores.contexts, (s) => s.historyLoaded);
  const currentContextId = useStore(stores.contexts, (s) => s.contextId);

  const load = useCallback(() => stores.contexts.getState().loadHistory(), [stores]);
  const ensureLoaded = useCallback(
    () => stores.contexts.getState().ensureHistoryLoaded(),
    [stores]
  );
  const invalidate = useCallback(
    () => stores.contexts.getState().invalidateHistory(),
    [stores]
  );

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

  const deleteContext = useCallback(
    async (contextId: string) => {
      const wasCurrent = stores.contexts.getState().contextId === contextId;
      await stores.contexts.getState().deleteContext(contextId);
      // Tear down the live WebSocket if the deleted context was the active
      // one. The contexts store has already cleared the persisted current
      // context for us; we just need to drop the connection + chat state.
      if (wasCurrent) {
        stores.currentContext.getState().clear();
      }
    },
    [stores]
  );

  return {
    history,
    loading,
    error,
    loaded,
    currentContextId,
    load,
    ensureLoaded,
    invalidate,
    switchTo,
    createNew,
    clearCurrent,
    deleteContext,
  };
}
