'use client';

import { useCallback } from 'react';
import { useStore } from 'zustand';
import type {
  Agent,
  ChatMessage,
  ConnectionStatus,
  StopInvocationResult,
  SubagentRun,
} from '../types';
import { useAjentifyStores } from './useAjentify';

export interface UseChatResult {
  /** Full message history (including streaming AI partials via pendingResponse). */
  messages: ChatMessage[];
  /** Currently-streaming AI response text, or null. */
  pendingResponse: { responseId: string; text: string } | null;
  status: ConnectionStatus;
  agent: Agent | null;
  /**
   * True when there is an active context, a draft, or a creation request in
   * flight. Lets the UI render an empty conversation the moment the user
   * asks for a new chat, even if the backend `create_context` call is
   * deferred until the first message.
   */
  hasContext: boolean;
  error: string | null;
  /**
   * True when the user is in a deferred draft chat — they've asked for a
   * new conversation but no `create_context` request has been dispatched
   * yet. The first send will materialize it.
   */
  isDraft: boolean;
  /**
   * True between `useContextHistory().createNew()` (or the first send on a
   * draft) and the resulting WebSocket being connected. Useful for showing
   * a subtle "Starting new chat…" affordance.
   */
  isPreparingNewChat: boolean;
  /**
   * True between sending a message (or returning client-side tool responses)
   * and the first streamed token of the agent's reply. UI can show a generic
   * placeholder ("Thinking…", "Working…", a spinner, etc.) during this window.
   */
  isWaitingForResponse: boolean;
  /**
   * Live progress of awaited sub-agents keyed by the parent
   * `send_context_message` tool call id (see `deriveSubagentCard`).
   */
  subagentRuns: Record<string, SubagentRun>;
  /**
   * True while the agent is generating and `cancel()` would stop something
   * (`status === 'streaming'`).
   */
  canCancel: boolean;
  /** True between `cancel()` and the server's terminal `on_cancelled`. */
  isCancelling: boolean;
  /** Send a human message. Materializes a draft if needed before sending. */
  send: (text: string) => Promise<void>;
  /** Stop the turn currently generating (`stop_invocation`). */
  cancel: () => Promise<StopInvocationResult>;
  /** Dismiss the current error and restore the chat to a usable state. */
  clearError: () => void;
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
  const creating = useStore(stores.currentContext, (s) => s.creating);
  const isDraft = useStore(stores.currentContext, (s) => s.isDraft);
  const subagentRuns = useStore(stores.currentContext, (s) => s.subagentRuns);
  const isCancelling = useStore(stores.currentContext, (s) => s.cancelling);

  const send = useCallback(
    (text: string) => stores.currentContext.getState().sendMessage(text),
    [stores]
  );
  const cancel = useCallback(
    () => stores.currentContext.getState().cancel(),
    [stores]
  );
  const clearError = useCallback(
    () => stores.currentContext.getState().clearError(),
    [stores]
  );
  const disconnect = useCallback(
    () => stores.currentContext.getState().disconnect(),
    [stores]
  );

  // Show the waiting indicator any time the user has sent a message but
  // hasn't seen any of the agent's reply yet. Includes the brief
  // 'connecting' window during draft materialization (createContext +
  // WebSocket handshake) so the bubble doesn't flicker between send and
  // first token.
  const lastMessage = messages[messages.length - 1];
  const lastIsHuman =
    lastMessage?.kind === 'text' && lastMessage.sender === 'human';
  const isWaitingForResponse =
    !pendingResponse &&
    (status === 'streaming' ||
      status === 'awaiting_tool_responses' ||
      (status === 'connecting' && lastIsHuman) ||
      (creating && lastIsHuman));

  return {
    messages,
    pendingResponse,
    status,
    agent,
    hasContext: Boolean(contextId) || creating || isDraft,
    error,
    isDraft,
    isPreparingNewChat: creating || isDraft,
    isWaitingForResponse,
    subagentRuns,
    canCancel: status === 'streaming',
    isCancelling,
    send,
    cancel,
    clearError,
    disconnect,
  };
}
