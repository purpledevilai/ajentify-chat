import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  AjentifyError,
  type Agent,
  type AgentEvent,
  type ChatMessage,
  type ConnectionStatus,
  type CreateContextRequest,
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
  /**
   * If `true`, `startNewContext()` eagerly calls `create_context` and opens
   * the WebSocket so the agent can stream its first message before the user
   * types anything. Defaults to `false` (lazy: stay in a local `draft`
   * state until the user sends their first message) which is the right
   * choice for typical webchat embeds where most opens never become real
   * conversations.
   */
  agentSpeaksFirst?: boolean;
}

export interface CurrentContextStore {
  contextId: string | null;
  agent: Agent | null;
  agentSpeaksFirst: boolean;
  messages: ChatMessage[];
  pendingResponse: { responseId: string; text: string } | null;
  status: ConnectionStatus;
  error: string | null;
  /**
   * True while the dev's `create_context` callback is in flight. Set when a
   * draft is materialized on first send (or when `startNewContext()` is
   * called eagerly via `agentSpeaksFirst`); reset by `connect()` once a
   * real `contextId` is bound.
   */
  creating: boolean;
  /**
   * True when the user has expressed interest in a new chat ("+", history's
   * "+ New chat", or `autoCreateContext` on mount) but no `create_context`
   * call has been dispatched yet. The first `sendMessage()` materializes
   * the draft into a real context.
   */
  isDraft: boolean;
  /**
   * Stashed request payload supplied to `startNewContext(req)` so the
   * deferred `create_context` call (triggered by the first `sendMessage()`)
   * uses the same args the dev provided up-front.
   */
  draftRequest: CreateContextRequest | null;

  // -------- actions --------

  /**
   * Initialize a fresh chat. By default this enters a local `'draft'`
   * status: messages and the agent are cleared, no WebSocket is opened,
   * and no `create_context` request is dispatched. The first
   * `sendMessage()` then transparently runs `create_context` -> `connect`
   * -> `add_message` so the user sees their message immediately while the
   * backend round-trip happens in the background.
   *
   * If the provider is configured with `agentSpeaksFirst: true`, this
   * eagerly creates and connects so the agent can stream its initial
   * message before the user types.
   *
   * Idempotent: calling on an already-fresh chat (empty draft, or empty
   * connected context with no streaming activity) is a no-op so users
   * spamming "+" don't churn through empty contexts.
   */
  startNewContext: (req?: CreateContextRequest) => Promise<void>;

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

  /**
   * Send a human message and stream the agent's response. If the chat is in
   * `'draft'` status this transparently materializes the draft first
   * (`create_context` + `connect`) and then dispatches the message.
   */
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
    creating: false,
    isDraft: false,
    draftRequest: null,

    async startNewContext(req) {
      // Idempotency: skip if we're already sitting in a fresh chat. Three
      // cases count as "fresh enough that a re-init would be churn":
      //   1. We're already in an empty draft (the lazy default).
      //   2. We have a connected context with no messages and no streaming
      //      activity yet (e.g. an agentSpeaksFirst chat the user just
      //      created and immediately re-clicked +).
      //   3. We're mid-create — the create_context callback is in flight.
      // A bare 'idle' state (no contextId, no draft, no messages) does NOT
      // count: that's the initial state and the very first call must
      // actually do something.
      const s = get();
      const inFreshDraft = s.isDraft && s.messages.length === 0;
      const inFreshConnected =
        Boolean(s.contextId) &&
        s.messages.length === 0 &&
        !s.pendingResponse;
      if (inFreshDraft || inFreshConnected || s.creating) return;

      // Tear down any prior WebSocket cleanly.
      if (wsClient) {
        try {
          wsClient.disconnect();
        } catch {
          // ignore
        }
        wsClient = null;
      }
      seenToolCallIds.clear();

      if (options.agentSpeaksFirst) {
        // Eager flow: create + connect now so the agent can stream its
        // first message before the user types anything.
        set({
          contextId: null,
          agent: null,
          agentSpeaksFirst: false,
          messages: [],
          pendingResponse: null,
          status: 'connecting',
          error: null,
          creating: true,
          isDraft: false,
          draftRequest: null,
        });
        try {
          const created = await options.contextsStore
            .getState()
            .createContext(req);
          await get().connect(created.context_id);
          if (created.messages?.length) {
            get().hydrateMessages(created.messages);
          }
        } catch (err) {
          // Roll the optimistic placeholder back so the UI doesn't get
          // pinned in a "creating" state if the backend rejects.
          get().clear();
          throw err;
        }
        return;
      }

      // Lazy flow (default): just stage a local draft. The first
      // sendMessage() call will materialize this into a real context.
      set({
        contextId: null,
        agent: null,
        agentSpeaksFirst: false,
        messages: [],
        pendingResponse: null,
        status: 'draft',
        error: null,
        creating: false,
        isDraft: true,
        draftRequest: req ?? null,
      });
    },

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
        creating: false,
        ...(hydratedMessages ? { messages: hydratedMessages } : {}),
      });

      const contextsStore = options.contextsStore;
      const csts = options.clientSideToolsStore;

      const client = new TokenStreamingClient({
        url: wsUrl,
        contextId,
        getAccessToken: contextsStore.getState().generateAccessToken,
        WebSocketImpl: options.WebSocketImpl,
        reconnect: options.reconnect,
        requestTimeoutMs: options.requestTimeoutMs,
      });

      wsClient = client;

      client.on('status', (s) => {
        if (s === 'connected') {
          // If the last thing on screen is a human message we're between
          // "user sent" and "agent replied" — keep `status: 'streaming'`
          // so the waiting indicator stays up. This matters during draft
          // materialization (create_context + connect happen *after* the
          // user's first message has been pushed) but is also correct on
          // any reconnect mid-turn.
          const msgs = get().messages;
          const last = msgs[msgs.length - 1];
          const userIsWaitingForReply =
            last?.kind === 'text' && last.sender === 'human';
          set({
            status:
              get().pendingResponse || userIsWaitingForReply
                ? 'streaming'
                : 'connected',
          });
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
          // The server replies to `client_side_tool_responses` only AFTER it
          // has already emitted on_token / on_stop_token (and possibly the
          // next round's on_client_side_tool_calls) for the continuation. By
          // the time this await resolves, those notifications have already
          // driven `status` to its correct value (`connected`, `streaming`,
          // or `awaiting_tool_responses` for the next round). Re-setting it
          // here would clobber that and leave the input permanently
          // disabled when the agent does not produce any further text.
          await client.sendClientSideToolResponses(responses);
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

      const human: TextMessage = {
        kind: 'text',
        localId: uid('msg'),
        sender: 'human',
        content: trimmed,
        createdAt: Date.now(),
      };

      // Draft path: this is the user's first send on a brand new chat.
      // Materialize the draft transparently — push the human message,
      // create_context, connect, and then add_message. Status stays
      // 'streaming' throughout so the waiting indicator is visible from
      // the moment they hit send until the agent's first token arrives.
      if (get().isDraft && !get().contextId) {
        const stagedRequest = get().draftRequest ?? undefined;
        set({
          messages: [...get().messages, human],
          status: 'streaming',
          pendingResponse: null,
          error: null,
          isDraft: false,
          draftRequest: null,
          creating: true,
        });
        try {
          const created = await options.contextsStore
            .getState()
            .createContext(stagedRequest);
          await get().connect(created.context_id);
          // create_context occasionally returns server-side messages
          // (prompt-args setups, etc.). Slot them in *before* the
          // optimistic human message we already showed.
          if (created.messages?.length) {
            const serverMessages = filteredMessagesToChatMessages(
              created.messages
            );
            set({ messages: [...serverMessages, human] });
          }
          if (!wsClient || !wsClient.isOpen) {
            throw new AjentifyError(
              'WebSocket failed to open after draft materialization',
              'transport'
            );
          }
          await wsClient.addMessage(trimmed);
        } catch (err) {
          const e =
            err instanceof AjentifyError
              ? err
              : new AjentifyError(
                  'Failed to materialize draft context',
                  'transport',
                  err
                );
          set({ status: 'error', error: e.message, creating: false });
          emitError(e);
          throw e;
        }
        return;
      }

      if (!wsClient || !wsClient.isOpen) {
        throw new AjentifyError(
          'sendMessage called before the chat is connected',
          'transport'
        );
      }
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
        creating: false,
        isDraft: false,
        draftRequest: null,
      });
    },
  }));

  return store;
}
