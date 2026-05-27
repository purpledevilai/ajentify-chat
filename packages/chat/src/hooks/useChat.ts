'use client';

import { useCallback } from 'react';
import { useStore } from 'zustand';
import type { Agent, ChatMessage, ConnectionStatus } from '../types';
import { useAjentifyStores } from './useAjentify';

export interface UseChatResult {
  /** Full message history (including streaming AI partials via pendingResponse). */
  messages: ChatMessage[];
  /** Currently-streaming AI response text, or null. */
  pendingResponse: { responseId: string; text: string } | null;
  status: ConnectionStatus;
  agent: Agent | null;
  /** True when there is no active context yet. */
  hasContext: boolean;
  error: string | null;
  /** Send a human message. No-op when not connected. */
  send: (text: string) => Promise<void>;
  /** Disconnect the WebSocket but keep the messages. */
  disconnect: () => void;
}

/**
 * The most common hook devs will reach for. Returns the live conversation
 * along with a `send()` function. Internally subscribes to a stable shape of
 * the current context store.
 */
export function useChat(): UseChatResult {
  const stores = useAjentifyStores();
  const messages = useStore(stores.currentContext, (s) => s.messages);
  const pendingResponse = useStore(stores.currentContext, (s) => s.pendingResponse);
  const status = useStore(stores.currentContext, (s) => s.status);
  const agent = useStore(stores.currentContext, (s) => s.agent);
  const contextId = useStore(stores.currentContext, (s) => s.contextId);
  const error = useStore(stores.currentContext, (s) => s.error);

  const send = useCallback(
    (text: string) => stores.currentContext.getState().sendMessage(text),
    [stores]
  );
  const disconnect = useCallback(
    () => stores.currentContext.getState().disconnect(),
    [stores]
  );

  return {
    messages,
    pendingResponse,
    status,
    agent,
    hasContext: Boolean(contextId),
    error,
    send,
    disconnect,
  };
}
