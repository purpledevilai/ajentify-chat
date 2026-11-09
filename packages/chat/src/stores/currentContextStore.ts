import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  AjentifyError,
  CANCELLED_TOOL_OUTPUT,
  type Agent,
  type AgentEvent,
  type ChatMessage,
  type ConnectionStatus,
  type CreateContextRequest,
  type FilteredContext,
  type FilteredContextMessage,
  type StopInvocationResult,
  type SubagentRun,
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
  /**
   * @deprecated Since 0.6.0 the (formerly beta) streaming protocol is the only
   * protocol; this option is accepted and ignored.
   */
  beta?: boolean;
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
   * Live progress of every sub-agent the agent is awaiting, keyed by the
   * parent `send_context_message` tool call id. Fed by `on_subagent_event` /
   * `on_subagent_complete`; cleared whenever the message list is replaced
   * (new chat, hydration). Use {@link deriveSubagentCard} to turn a
   * `send_context_message` tool call + this map into a renderable card.
   */
  subagentRuns: Record<string, SubagentRun>;
  /**
   * True between `cancel()` being called and the server's `on_cancelled`
   * (or any other terminal frame) arriving. Lets the UI disable the stop
   * button while the request is in flight.
   */
  cancelling: boolean;
  /**
   * True while the dev's `create_context` callback is in flight. Set when a
   * draft is materialized on first send (or when `startNewContext()` is
   * called eagerly via `agentSpeaksFirst`); reset by `connect()` once a
   * real `contextId` is bound.
   */
  creating: boolean;
  /**
   * True when the user has expressed interest in a new chat (clicked "+",
   * mounted `<ChatView />` on a fresh session, or hit "+ New chat" in the
   * history view) but no `create_context` call has been dispatched yet.
   * The first `sendMessage()` materializes the draft into a real context.
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

  /**
   * Stop the turn that is currently generating (`stop_invocation`). Resolves
   * with the server's `{ success, cancelled }` reply; `cancelled: false`
   * means nothing was running. The turn ends with `on_cancelled`, which
   * marks the partial assistant bubble and returns `status` to
   * `'connected'`. Awaited sub-agents keep running server-side. No-op
   * (resolves `{ success: false, cancelled: false }`) when not connected.
   */
  cancel: () => Promise<StopInvocationResult>;

  /** Disconnect and clear chat state. */
  disconnect: () => void;

  /** Dismiss the current error (resets `error` to null and `status` to the appropriate idle state). */
  clearError: () => void;

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
      // Merge the response onto the matching tool_call (by tool_call_id) so
      // each call is a single expandable item. Fall back to a standalone
      // tool_response only if no matching call was emitted (defensive).
      const match = m.tool_call_id
        ? out.find(
            (o) => o.kind === 'tool_call' && o.toolCallId === m.tool_call_id
          )
        : undefined;
      if (match && match.kind === 'tool_call') {
        match.toolOutput = m.tool_output ?? '';
      } else {
        out.push({
          kind: 'tool_response',
          localId: uid('msg'),
          toolCallId: m.tool_call_id ?? uid('tc'),
          toolName: m.tool_name,
          toolOutput: m.tool_output ?? '',
          createdAt: Date.now(),
        });
      }
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

  /** True when a human message is still waiting in the server inbox. */
  function hasQueuedHuman(messages: ChatMessage[]): boolean {
    return messages.some(
      (m) => m.kind === 'text' && m.sender === 'human' && m.queued === true
    );
  }

  /** Drop the queued flag from every human message (the next turn started). */
  function clearQueuedFlags(messages: ChatMessage[]): ChatMessage[] {
    if (!hasQueuedHuman(messages)) return messages;
    return messages.map((m) =>
      m.kind === 'text' && m.sender === 'human' && m.queued
        ? { ...m, queued: false }
        : m
    );
  }

  const store = createStore<CurrentContextStore>((set, get) => ({
    contextId: null,
    agent: null,
    agentSpeaksFirst: false,
    messages: [],
    pendingResponse: null,
    status: 'idle',
    error: null,
    subagentRuns: {},
    cancelling: false,
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
          subagentRuns: {},
          cancelling: false,
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
        subagentRuns: {},
        cancelling: false,
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
        cancelling: false,
        creating: false,
        ...(hydratedMessages ? { messages: hydratedMessages, subagentRuns: {} } : {}),
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

      // Every listener bails out if the client it was registered on is no
      // longer the active wsClient. WebSocket `onclose` (and any pending
      // RPC rejection) fires asynchronously *after* `disconnect()` returns,
      // so without this guard a stale client tears down state we've
      // already replaced — e.g. clobbering the brand new `'draft'` status
      // with the old client's delayed `'disconnected'`.
      const isStale = () => wsClient !== client;

      client.on('status', (s) => {
        if (isStale()) return;
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
        if (isStale()) return;
        set({ error: err.message, status: 'error' });
        emitError(err);
      });

      client.on('agent_connected', ({ agent, agent_speaks_first }) => {
        if (isStale()) return;
        set({ agent, agentSpeaksFirst: Boolean(agent_speaks_first) });
      });

      // A new assistant text segment is starting. Reset the pending buffer to
      // the fresh response_id so preamble and final text commit as separate
      // bubbles (the intervening on_stop_token flushes the preamble).
      client.on('on_message_start', ({ response_id }) => {
        if (isStale()) return;
        // A new turn consumed whatever was waiting in the inbox: drop the
        // "queued" marker from the user's bubble(s).
        set({
          messages: clearQueuedFlags(get().messages),
          pendingResponse: { responseId: response_id, text: '' },
          status: 'streaming',
        });
      });

      // The message we just sent was accepted but not started: a turn is
      // already running (or another process holds the context). It will be
      // processed automatically — flag the user's bubble and keep waiting.
      client.on('on_queued', ({ item_id }) => {
        if (isStale()) return;
        const msgs = get().messages;
        let idx = -1;
        for (let i = msgs.length - 1; i >= 0; i -= 1) {
          const m = msgs[i];
          if (m && m.kind === 'text' && m.sender === 'human' && !m.queued && !m.queuedItemId) {
            idx = i;
            break;
          }
        }
        const next =
          idx >= 0
            ? msgs.map((m, i) =>
                i === idx ? { ...(m as TextMessage), queued: true, queuedItemId: item_id } : m
              )
            : msgs;
        set({
          messages: next,
          status:
            get().status === 'awaiting_tool_responses' ? 'awaiting_tool_responses' : 'streaming',
        });
      });

      client.on('on_token', ({ token, response_id }) => {
        if (isStale()) return;
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
        if (isStale()) return;
        // on_stop_token only ends a *segment*; the turn continues (more
        // segments / tool rounds may follow), so stay 'streaming' until
        // on_turn_complete.
        const nextStatus = 'streaming';
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
            status: nextStatus,
          });
        } else {
          set({ pendingResponse: null, status: nextStatus });
        }
      });

      // The whole turn (all segments + tools + recursion) finished. If a
      // human message is still queued the runner starts the next turn right
      // away, so keep the waiting indicator up.
      client.on('on_turn_complete', () => {
        if (isStale()) return;
        set({
          pendingResponse: null,
          cancelling: false,
          status: hasQueuedHuman(get().messages) ? 'streaming' : 'connected',
        });
      });

      // Terminal frame of a turn the user stopped. The open segment (if any)
      // was already closed by on_stop_token, so usually the partial text is
      // the last AI bubble; mark it. Tool calls that were still running get
      // the same "cancelled by user" output the server persists, so the
      // shimmer stops and hydrated history matches.
      client.on('on_cancelled', ({ response_id }) => {
        if (isStale()) return;
        const pending = get().pendingResponse;
        let msgs = get().messages;
        if (pending && pending.text) {
          msgs = [
            ...msgs,
            {
              kind: 'text',
              localId: uid('msg'),
              sender: 'ai',
              content: pending.text,
              responseId: pending.responseId,
              cancelled: true,
              createdAt: Date.now(),
            },
          ];
        } else {
          let idx = -1;
          if (response_id) {
            for (let i = msgs.length - 1; i >= 0; i -= 1) {
              const m = msgs[i];
              if (m && m.kind === 'text' && m.sender === 'ai' && m.responseId === response_id) {
                idx = i;
                break;
              }
            }
          }
          if (idx < 0) {
            const last = msgs[msgs.length - 1];
            if (last && last.kind === 'text' && last.sender === 'ai') idx = msgs.length - 1;
          }
          if (idx >= 0) {
            msgs = msgs.map((m, i) =>
              i === idx ? { ...(m as TextMessage), cancelled: true } : m
            );
          }
        }
        msgs = msgs.map((m) =>
          m.kind === 'tool_call' && m.toolOutput == null
            ? { ...m, toolOutput: CANCELLED_TOOL_OUTPUT }
            : m
        );
        set({
          messages: msgs,
          pendingResponse: null,
          cancelling: false,
          status: hasQueuedHuman(msgs) ? 'streaming' : 'connected',
        });
      });

      // Progress of a sub-agent the agent is awaiting, keyed by the parent's
      // send_context_message tool call id.
      client.on('on_subagent_event', ({ parent_tool_call_id, child_context_id, event }) => {
        if (isStale()) return;
        if (!parent_tool_call_id || !event) return;
        const runs = get().subagentRuns;
        const prev: SubagentRun = runs[parent_tool_call_id] ?? {
          parentToolCallId: parent_tool_call_id,
          childContextId: child_context_id,
          status: 'running',
          toolCalls: [],
        };
        let toolCalls = prev.toolCalls;
        let errorMessage = prev.errorMessage;
        if (event.type === 'tool_call') {
          const exists = toolCalls.some((t) => t.toolCallId === event.tool_call_id);
          if (!exists) {
            toolCalls = [
              ...toolCalls,
              {
                toolCallId: event.tool_call_id,
                toolName: event.tool_name,
                toolInput: event.tool_input ?? {},
                state: 'running',
              },
            ];
          }
        } else if (event.type === 'tool_response') {
          const exists = toolCalls.some((t) => t.toolCallId === event.tool_call_id);
          toolCalls = exists
            ? toolCalls.map((t) =>
                t.toolCallId === event.tool_call_id
                  ? { ...t, state: 'complete', toolOutput: event.tool_output ?? '' }
                  : t
              )
            : [
                ...toolCalls,
                {
                  toolCallId: event.tool_call_id,
                  toolName: event.tool_name,
                  toolOutput: event.tool_output ?? '',
                  state: 'complete',
                },
              ];
        } else if (event.type === 'error') {
          errorMessage = event.message;
        }
        set({
          subagentRuns: {
            ...runs,
            [parent_tool_call_id]: {
              ...prev,
              childContextId: child_context_id || prev.childContextId,
              // A terminal status set by on_subagent_complete is never
              // downgraded by a late event; an error event is sticky.
              status:
                prev.status !== 'running'
                  ? prev.status
                  : event.type === 'error'
                    ? 'error'
                    : 'running',
              latestEvent: event,
              toolCalls,
              errorMessage,
            },
          },
        });
      });

      client.on('on_subagent_complete', ({ parent_tool_call_id, child_context_id, status }) => {
        if (isStale()) return;
        if (!parent_tool_call_id) return;
        const runs = get().subagentRuns;
        const prev: SubagentRun = runs[parent_tool_call_id] ?? {
          parentToolCallId: parent_tool_call_id,
          childContextId: child_context_id,
          status: 'running',
          toolCalls: [],
        };
        const terminal: SubagentRun['status'] =
          status === 'error' || status === 'cancelled' ? status : 'complete';
        set({
          subagentRuns: {
            ...runs,
            [parent_tool_call_id]: {
              ...prev,
              childContextId: child_context_id || prev.childContextId,
              status: terminal,
              // Anything still marked running is over now.
              toolCalls: prev.toolCalls.map((t) =>
                t.state === 'running' ? { ...t, state: 'complete' } : t
              ),
            },
          },
        });
      });

      // Server-side turn failure (surfaced explicitly because add_message is
      // fire-and-forget and no RPC error reply is sent).
      client.on('on_error', ({ message }) => {
        if (isStale()) return;
        const e = new AjentifyError(message, 'rpc');
        set({ status: 'error', error: message, cancelling: false });
        emitError(e);
      });

      client.on('on_tool_call', (params) => {
        if (isStale()) return;
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
        if (isStale()) return;
        // Merge the response onto the matching tool_call so it becomes one
        // expandable item (rather than a separate, hidden tool_response).
        set({
          messages: get().messages.map((m) =>
            m.kind === 'tool_call' && m.toolCallId === params.tool_call_id
              ? { ...m, toolOutput: params.tool_output ?? '' }
              : m
          ),
        });
      });

      client.on('on_client_side_tool_calls', async ({ tool_calls }) => {
        if (isStale()) return;
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
          // Merge each response onto its matching tool_call so the row becomes
          // a single expandable item (consistent with server-side tools).
          const outputById = new Map(
            responses.map((r) => [r.tool_call_id, r.response])
          );
          set({
            messages: get().messages.map((m) =>
              m.kind === 'tool_call' && outputById.has(m.toolCallId)
                ? { ...m, toolOutput: outputById.get(m.toolCallId) ?? '' }
                : m
            ),
          });
          // Fire-and-forget: don't touch `status` here. The continuation's
          // on_message_start / on_token / on_stop_token / on_turn_complete
          // (or the next round's on_client_side_tool_calls) drive it.
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
        if (isStale()) return;
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
      set({ messages: filteredMessagesToChatMessages(messages), subagentRuns: {} });
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
      // Sending while a turn is running is allowed since 0.7 (the server
      // queues it and answers with `on_queued`). Keep the in-flight partial
      // and status in that case instead of resetting them.
      const midTurn =
        get().status === 'streaming' || get().status === 'awaiting_tool_responses';
      set({
        messages: [...get().messages, human],
        status: midTurn ? get().status : 'streaming',
        pendingResponse: midTurn ? get().pendingResponse : null,
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

    async cancel() {
      if (!wsClient || !wsClient.isOpen) {
        return { success: false, cancelled: false };
      }
      set({ cancelling: true });
      try {
        const result = await wsClient.stopInvocation();
        if (!result.cancelled) {
          // Nothing was running server-side; no on_cancelled will follow.
          set({ cancelling: false });
        }
        return result;
      } catch (err) {
        const e =
          err instanceof AjentifyError
            ? err
            : new AjentifyError('stop_invocation failed', 'rpc', err);
        set({ cancelling: false, error: e.message });
        emitError(e);
        throw e;
      }
    },

    clearError() {
      if (get().error === null) return;
      const nextStatus = get().contextId
        ? (wsClient?.isOpen ? 'connected' : 'disconnected')
        : (get().isDraft ? 'draft' : 'idle');
      set({ error: null, status: nextStatus });
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
      set({ status: 'disconnected', pendingResponse: null, cancelling: false });
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
        subagentRuns: {},
        cancelling: false,
        creating: false,
        isDraft: false,
        draftRequest: null,
      });
    },
  }));

  return store;
}
