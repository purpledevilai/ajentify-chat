/**
 * Public type surface for @ajentify/chat.
 *
 * These mirror the server-side shapes documented in:
 *   - docs/WEBSOCKET_API.md
 *   - docs/api/get-context.md
 *   - docs/api/create-context.md
 *   - docs/api/generate-api-key.md
 *   - src/Models/Context.py (FilteredMessage, ToolCallMessage, ToolResponseMessage, HistoryContext)
 */

// ---------- Agent ----------

export interface Agent {
  agent_id: string;
  agent_name: string;
  agent_description?: string | null;
  prompt?: string | null;
  org_id?: string | null;
  is_public?: boolean;
  is_default_agent?: boolean;
  agent_speaks_first?: boolean;
  tools?: string[];
  uses_prompt_args?: boolean;
  voice_id?: string | null;
  initialize_tool_id?: string | null;
  created_at?: number;
  updated_at?: number;
}

export interface HistoryAgent {
  agent_id: string;
  agent_name: string;
  agent_description?: string | null;
}

// ---------- Messages ----------

/** A regular text message from the user or the assistant. */
export interface TextMessage {
  kind: 'text';
  /** A locally-generated id used purely for React keys. Not server-issued. */
  localId: string;
  sender: 'human' | 'ai' | 'system';
  content: string;
  /** True while the assistant is still streaming this message. */
  pending?: boolean;
  /** Server-issued response_id for tracking. Only set for AI messages. */
  responseId?: string;
  /** Unix-ms timestamp. */
  createdAt: number;
}

/** A tool call emitted by the assistant. */
export interface ToolCallMessage {
  kind: 'tool_call';
  localId: string;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  /** Whether this tool is being dispatched to the client side. */
  clientSide?: boolean;
  createdAt: number;
}

/** A response from a previously-issued tool call. */
export interface ToolResponseMessage {
  kind: 'tool_response';
  localId: string;
  toolCallId: string;
  toolName?: string;
  toolOutput: string;
  createdAt: number;
}

export type ChatMessage = TextMessage | ToolCallMessage | ToolResponseMessage;

// ---------- Client-side tools ----------

export interface ClientSideToolCall {
  tool_call_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface ClientSideToolResponse {
  tool_call_id: string;
  response: string;
}

/**
 * The structure of a "page" exposed to the agent via the special
 * `get_page_data` client-side tool. `data` is the JSON view of what is on
 * screen; `actions` lists the actions the agent may invoke via `do_page_action`.
 */
export interface PageData {
  data: Record<string, unknown>;
  actions: Record<string, PageAction>;
}

export interface PageAction {
  description: string;
  /** Optional JSON Schema describing the action's `arguments`. */
  argsSchema?: Record<string, unknown>;
}

// ---------- Connection / events ----------

export interface AgentEvent {
  type: string;
  data: string;
}

export type ConnectionStatus =
  | 'idle'
  /**
   * The user has expressed interest in a new chat (clicked "+", mounted the
   * panel on a fresh session, etc.) but no `create_context` request has
   * been sent yet. The first `sendMessage()` call materializes the draft
   * into a real backend context. Distinct from `idle` so the UI can render
   * an empty conversation rather than an error / empty state.
   */
  | 'draft'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'awaiting_tool_responses'
  | 'error'
  | 'disconnected';

// ---------- REST shapes ----------

export interface FilteredContextMessage {
  // From docs/api/get-context.md, with_tool_calls=false
  // and src/Models/Context.py FilteredMessage / Tool*Message
  sender?: 'human' | 'ai' | 'system';
  message?: string;
  type?: 'tool_call' | 'tool_response';
  tool_call_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
}

export interface FilteredContext {
  context_id: string;
  agent_id: string;
  user_id?: string;
  client_id?: string | null;
  messages: FilteredContextMessage[];
  user_defined?: Record<string, unknown>;
  model_id?: string;
  context_percentage?: number;
  created_at?: number;
  updated_at?: number;
  expires_at?: number | null;
}

export interface CreateContextRequest {
  agent_id?: string;
  prompt_args?: Record<string, string>;
  user_defined?: Record<string, unknown>;
  invoke_agent_message?: boolean;
  ttl_days?: number;
  client_id?: string;
}

export interface CreateContextResponse {
  context_id: string;
  agent_id: string;
  user_id?: string;
  client_id?: string | null;
  messages?: FilteredContextMessage[];
  user_defined?: Record<string, unknown>;
  model_id?: string;
  context_percentage?: number;
  created_at?: number;
  updated_at?: number;
  expires_at?: number | null;
  /**
   * The 30-day client API key returned for unauthenticated public-agent flows.
   * For authenticated/private flows this is null and the dev's backend mints a
   * short-lived client token via `POST /generate-api-key` instead.
   */
  client_api_key?: string | null;
}

export interface HistoryContext {
  context_id: string;
  user_id?: string;
  client_id?: string | null;
  last_message: string;
  created_at: number;
  updated_at: number;
  expires_at?: number | null;
  agent: HistoryAgent;
}

// ---------- Ajentify proxy (consolidated callback) ----------

/**
 * The discriminated union of every request the SDK sends through the
 * developer's `onAjentifyProxyRequest` handler. The developer writes a
 * single `fetch` call (or equivalent) that POSTs each request to their
 * own backend. The backend authenticates the caller, resolves the
 * `client_id`, and proxies to the matching Ajentify REST endpoint with
 * the org API key. Responses should be returned as-is — the SDK handles
 * any unwrapping.
 *
 * ```ts
 * const onAjentifyProxyRequest = async (request: AjentifyProxyRequest) => {
 *   const res = await fetch('/api/ajentify/proxy', {
 *     method: 'POST',
 *     credentials: 'include',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify(request),
 *   });
 *   if (!res.ok) throw new Error(`Proxy ${request.type} failed: ${res.status}`);
 *   return res.json();
 * };
 * ```
 */
export type AjentifyProxyRequest =
  /**
   * Create a brand new context. The dev's backend should call
   * `POST /context` with the org-scoped API key and return the response.
   * Expected resolve type: `CreateContextResponse`.
   */
  | { type: 'create_context'; request?: CreateContextRequest }
  /**
   * Mint a fresh client access token (JWT) for the current user. The dev's
   * backend should call `POST /generate-api-key` and return the response
   * unchanged (the SDK extracts `.token` internally).
   * Expected resolve type: `{ token: string }`.
   */
  | { type: 'generate_access_token' }
  /**
   * Fetch a single context with its messages. The dev's backend should call
   * `GET /context/{id}`.
   * Expected resolve type: `FilteredContext`.
   */
  | { type: 'get_context'; contextId: string }
  /**
   * Fetch the user's chat history. The dev's backend should call
   * `GET /context-history`.
   * Expected resolve type: `HistoryContext[]` or `{ contexts: HistoryContext[] }`.
   */
  | { type: 'get_context_history' }
  /**
   * Delete a context. The dev's backend should call `DELETE /context/{id}`
   * (this endpoint is non-public and requires the org API key). The SDK
   * does not inspect the resolve value.
   */
  | { type: 'delete_context'; contextId: string };

/**
 * Maps each proxy request to the value the handler must resolve with.
 * The proxy should return Ajentify API responses unchanged — the SDK
 * handles any internal unwrapping (e.g. extracting `.token` from
 * `generate_access_token`).
 */
export type AjentifyProxyResult<R extends AjentifyProxyRequest> = R extends {
  type: 'create_context';
}
  ? CreateContextResponse
  : R extends { type: 'generate_access_token' }
    ? { token: string } | string
    : R extends { type: 'get_context' }
      ? FilteredContext
      : R extends { type: 'get_context_history' }
        ? HistoryContext[] | { contexts: HistoryContext[] }
        : R extends { type: 'delete_context' }
          ? void | unknown
          : never;

/**
 * The single function a developer registers on `<AjentifyProvider>` to
 * service every backend request the SDK needs to make. The developer
 * controls the HTTP request — method, headers, auth, error handling —
 * and sends the `AjentifyProxyRequest` to their backend, which proxies
 * to the Ajentify REST API and returns responses unchanged.
 */
export type AjentifyProxyHandler = (
  request: AjentifyProxyRequest
) => Promise<unknown> | unknown;

// ---------- Errors ----------

export type AjentifyErrorCode =
  | 'transport'
  | 'rpc'
  | 'auth'
  | 'config'
  | 'callback'
  | 'tool';

export class AjentifyError extends Error {
  readonly code: AjentifyErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, code: AjentifyErrorCode, cause?: unknown) {
    super(message);
    this.name = 'AjentifyError';
    this.code = code;
    this.cause = cause;
  }
}
