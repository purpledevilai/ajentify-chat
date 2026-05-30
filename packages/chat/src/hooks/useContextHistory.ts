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
   * Start a brand new chat. By default this only initializes a local
   * `'draft'` state in the current context store — no `create_context`
   * request is dispatched until the user sends their first message.
   *
   * If the provider is configured with `agentSpeaksFirst: true`, this
   * eagerly calls `create_context` and connects the WebSocket. Idempotent:
   * spamming the "+" button on an already-fresh chat is a no-op.
   */
  createNew: (req?: CreateContextRequest) => Promise<void>;
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
      // Tear down the prior chat synchronously so the user doesn't see a
      // flash of the previous context's messages while we wait for
      // `loadContext` + the new WebSocket handshake. We set
      // `status: 'connecting'` and keep `contextId` truthy so
      // `<ChatMessages />` keeps rendering (showing its connecting state)
      // instead of falling back to the "no active chat" empty UI.
      stores.currentContext.getState().disconnect();
      stores.currentContext.setState({
        contextId,
        agent: null,
        agentSpeaksFirst: false,
        messages: [],
        pendingResponse: null,
        status: 'connecting',
        error: null,
        creating: false,
        isDraft: false,
        draftRequest: null,
      });

      const ctx = await stores.contexts.getState().loadContext(contextId);
      stores.contexts
        .getState()
        .setCurrentContext(contextId, null, ctx.client_id ?? null);
      const hydrated = ctx.messages ?? [];
      await stores.currentContext.getState().connect(contextId, undefined);
      stores.currentContext.getState().hydrateMessages(hydrated);
    },
    [stores]
  );

  const createNew = useCallback(
    async (req?: CreateContextRequest): Promise<void> => {
      // The store handles all the nuance: idempotency for spam-clicks,
      // eager vs. draft (deferred) creation based on the provider's
      // `agentSpeaksFirst` config, WebSocket teardown, and rollback on
      // failure. Custom UIs that don't use this hook get the same
      // behavior by calling `currentContext.startNewContext()` directly.
      await stores.currentContext.getState().startNewContext(req);
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
