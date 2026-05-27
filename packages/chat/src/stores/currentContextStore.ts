import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  AjentifyError,
  type Agent,
  type AgentEvent,
  type ChatMessage,
  type ConnectionStatus,
  type FilteredContext,
  type FilteredContextMessage,
  type TextMessage,
} from '../types';
import { uid } from '../lib/utils';
import {
  TokenStreamingClient,
  DEFAULT_TOKEN_STREAMING_URL,
  type TokenStreamingClientOptions,
} from '../ws/TokenStreamingClient';
import type { ContextsStore } from './contextsStore';
import type { ClientSideToolsStore } from './clientSideToolsStore';

export interface CurrentContextStoreOptions {
  websocketUrl?: string;
  /** Vanilla store handle for contexts (used to mint access tokens). */
  contextsStore: StoreApi<ContextsStore>;
  /** Vanilla store handle for client-side tools (used to dispatch calls). */
  clientSideToolsStore: StoreApi<ClientSideToolsStore>;
  /** Optional WebSocket constructor override (for tests / Node). */
  WebSocketImpl?: typeof WebSocket;
  /** Forwarded to TokenStreamingClient. */
  reconnect?: TokenStreamingClientOptions['reconnect'];
  /** Forwarded to TokenStreamingClient. */
  requestTimeoutMs?: TokenStreamingClientOptions['requestTimeoutMs'];
  /** Optional callback for server-side agent events. */
  onEvents?: (events: AgentEvent[], responseId: string) => void;
  /** Surface all internal errors. */
  onError?: (err: AjentifyError) => void;
}

export interface CurrentContextStore {
  contextId: string | null;
  agent: Agent | null;
  agentSpeaksFirst: boolean;
  messages: ChatMessage[];
  pendingResponse: { responseId: string; text: string } | null;
  status: ConnectionStatus;
  error: string | null;

  // -------- actions --------

  /**
   * Open the WebSocket and connect to `contextId`. If `hydratedMessages` is
   * passed, the message list is replaced with those entries (used when
   * switching to a history context). Otherwise the existing message list is
   * preserved on reconnects.
   */
  connect: (
    contextId: string,
    hydratedMessages?: ChatMessage[]
  ) => Promise<Agent>;

  /** Replace the message list with hydrated server messages. */
  hydrateMessages: (messages: FilteredContextMessage[]) => void;

  /** Send a human message and stream the agent's response. */
  sendMessage: (text: string) => Promise<void>;

  /** Disconnect and clear chat state. */
  disconnect: () => void;

  /** Wipe everything (used by "new chat"). */
  clear: () => void;
}

function filteredMessagesToChatMessages(
  msgs: FilteredContextMessage[] | undefined
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of msgs ?? []) {
    if (m.type === 'tool_call') {
      out.push({
        kind: 'tool_call',
        localId: uid('msg'),
        toolCallId: m.tool_call_id ?? uid('tc'),
        toolName: m.tool_name ?? '',
        toolInput: m.tool_input ?? {},
        createdAt: Date.now(),
      });
    } else if (m.type === 'tool_response') {
      out.push({
        kind: 'tool_response',
        localId: uid('msg'),
        toolCallId: m.tool_call_id ?? uid('tc'),
        toolName: m.tool_name,
        toolOutput: m.tool_output ?? '',
        createdAt: Date.now(),
      });
    } else if (m.sender && typeof m.message === 'string') {
      out.push({
        kind: 'text',
        localId: uid('msg'),
        sender: m.sender,
        content: m.message,
        createdAt: Date.now(),
      });
    }
  }
  return out;
}

export function createCurrentContextStore(options: CurrentContextStoreOptions) {
  const wsUrl = options.websocketUrl ?? DEFAULT_TOKEN_STREAMING_URL;

  let wsClient: TokenStreamingClient | null = null;
  // Tracks tool_call ids for which we have already emitted a tool_call message
  // so on_tool_response can match without duplicating.
  const seenToolCallIds = new Set<string>();

  function emitError(err: AjentifyError): void {
    options.onError?.(err);
  }

  const store = createStore<CurrentContextStore>((set, get) => ({
    contextId: null,
    agent: null,
    agentSpeaksFirst: false,
    messages: [],
    pendingResponse: null,
    status: 'idle',
    error: null,

    async connect(contextId, hydratedMessages) {
      // Tear down any prior client cleanly.
      if (wsClient) {
        try {
          wsClient.disconnect();
        } catch {
          // ignore
        }
        wsClient = null;
      }
      seenToolCallIds.clear();

      set({
        contextId,
        status: 'connecting',
        error: null,
        pendingResponse: null,
        ...(hydratedMessages ? { messages: hydratedMessages } : {}),
      });

      const contextsStore = options.contextsStore;
      const csts = options.clientSideToolsStore;

      const client = new TokenStreamingClient({
        url: wsUrl,
        contextId,
        getAccessToken: async () => {
          // Always re-mint right before (re)connect, per chosen strategy.
          return await contextsStore.getState().generateAccessToken(contextId);
        },
        WebSocketImpl: options.WebSocketImpl,
        reconnect: options.reconnect,
        requestTimeoutMs: options.requestTimeoutMs,
      });

      wsClient = client;

      client.on('status', (s) => {
        if (s === 'connected') {
          set({ status: get().pendingResponse ? 'streaming' : 'connected' });
        } else if (s === 'connecting') {
          set({ status: 'connecting' });
        } else if (s === 'disconnected') {
          set({ status: 'disconnected' });
        } else if (s === 'error') {
          set({ status: 'error' });
        }
      });

      client.on('error', (err) => {
        set({ error: err.message, status: 'error' });
        emitError(err);
      });

      client.on('agent_connected', ({ agent, agent_speaks_first }) => {
        set({ agent, agentSpeaksFirst: Boolean(agent_speaks_first) });
      });

      client.on('on_token', ({ token, response_id }) => {
        const current = get().pendingResponse;
        if (!current || current.responseId !== response_id) {
          set({
            pendingResponse: { responseId: response_id, text: token },
            status: 'streaming',
          });
        } else {
          set({
            pendingResponse: {
              responseId: response_id,
              text: current.text + token,
            },
            status: 'streaming',
          });
        }
      });

      client.on('on_stop_token', ({ response_id }) => {
        const pending = get().pendingResponse;
        if (pending && pending.responseId === response_id && pending.text) {
          const aiMessage: TextMessage = {
            kind: 'text',
            localId: uid('msg'),
            sender: 'ai',
            content: pending.text,
            responseId: response_id,
            createdAt: Date.now(),
          };
          set({
            messages: [...get().messages, aiMessage],
            pendingResponse: null,
            status: 'connected',
          });
        } else {
          set({ pendingResponse: null, status: 'connected' });
        }
      });

      client.on('on_tool_call', (params) => {
        if (seenToolCallIds.has(params.tool_call_id)) return;
        seenToolCallIds.add(params.tool_call_id);
        set({
          messages: [
            ...get().messages,
            {
              kind: 'tool_call',
              localId: uid('msg'),
              toolCallId: params.tool_call_id,
              toolName: params.tool_name,
              toolInput: params.tool_input ?? {},
              clientSide: false,
              createdAt: Date.now(),
            },
          ],
        });
      });

      client.on('on_tool_response', (params) => {
        set({
          messages: [
            ...get().messages,
            {
              kind: 'tool_response',
              localId: uid('msg'),
              toolCallId: params.tool_call_id,
              toolName: params.tool_name,
              toolOutput: params.tool_output ?? '',
              createdAt: Date.now(),
            },
          ],
        });
      });

      client.on('on_client_side_tool_calls', async ({ tool_calls }) => {
        // Surface the tool calls as messages so dev UIs can show them.
        const callMsgs = tool_calls
          .filter((tc) => !seenToolCallIds.has(tc.tool_call_id))
          .map((tc) => {
            seenToolCallIds.add(tc.tool_call_id);
            return {
              kind: 'tool_call' as const,
              localId: uid('msg'),
              toolCallId: tc.tool_call_id,
              toolName: tc.tool_name,
              toolInput: tc.tool_input ?? {},
              clientSide: true,
              createdAt: Date.now(),
            };
          });
        if (callMsgs.length > 0) {
          set({ messages: [...get().messages, ...callMsgs] });
        }
        set({ status: 'awaiting_tool_responses' });

        try {
          const responses = await csts.getState().handleToolCalls(tool_calls);
          // Surface the responses locally as well.
          const respMsgs = responses.map((r, i) => ({
            kind: 'tool_response' as const,
            localId: uid('msg'),
            toolCallId: r.tool_call_id,
            toolName: tool_calls[i]?.tool_name,
            toolOutput: r.response,
            createdAt: Date.now(),
          }));
          set({ messages: [...get().messages, ...respMsgs] });
          await client.sendClientSideToolResponses(responses);
          set({ status: 'streaming' });
        } catch (err) {
          const e =
            err instanceof AjentifyError
              ? err
              : new AjentifyError('Client-side tool dispatch failed', 'tool', err);
          set({ status: 'error', error: e.message });
          emitError(e);
        }
      });

      client.on('on_events', ({ events, response_id }) => {
        options.onEvents?.(events, response_id);
      });

      try {
        const agent = await client.connect();
        return agent;
      } catch (err) {
        const e =
          err instanceof AjentifyError
            ? err
            : new AjentifyError('Failed to connect to context', 'transport', err);
        set({ status: 'error', error: e.message });
        emitError(e);
        throw e;
      }
    },

    hydrateMessages(messages) {
      set({ messages: filteredMessagesToChatMessages(messages) });
    },

    async sendMessage(text) {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!wsClient || !wsClient.isOpen) {
        throw new AjentifyError(
          'sendMessage called before the chat is connected',
          'transport'
        );
      }
      const human: TextMessage = {
        kind: 'text',
        localId: uid('msg'),
        sender: 'human',
        content: trimmed,
        createdAt: Date.now(),
      };
      set({
        messages: [...get().messages, human],
        status: 'streaming',
        pendingResponse: null,
        error: null,
      });
      try {
        await wsClient.addMessage(trimmed);
      } catch (err) {
        const e =
          err instanceof AjentifyError
            ? err
            : new AjentifyError('add_message failed', 'rpc', err);
        set({ status: 'error', error: e.message });
        emitError(e);
        throw e;
      }
    },

    disconnect() {
      if (wsClient) {
        try {
          wsClient.disconnect();
        } catch {
          // ignore
        }
        wsClient = null;
      }
      set({ status: 'disconnected', pendingResponse: null });
    },

    clear() {
      if (wsClient) {
        try {
          wsClient.disconnect();
        } catch {
          // ignore
        }
        wsClient = null;
      }
      seenToolCallIds.clear();
      set({
        contextId: null,
        agent: null,
        agentSpeaksFirst: false,
        messages: [],
        pendingResponse: null,
        status: 'idle',
        error: null,
      });
    },
  }));

  return store;
}
