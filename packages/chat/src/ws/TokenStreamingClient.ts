import {
  AjentifyError,
  type AgentEvent,
  type Agent,
  type ClientSideToolCall,
  type ClientSideToolResponse,
} from '../types';
import { uid } from '../lib/utils';

/**
 * Default token streaming endpoint. Devs can override on the provider.
 */
export const DEFAULT_TOKEN_STREAMING_URL =
  'wss://token-streaming-server.prod.token-streaming.ajentify.com/ws';

// -------- protocol shapes (JSON-RPC dialect) --------

interface RpcRequest {
  method: string;
  params: Record<string, unknown>;
  id?: string;
}

interface RpcResponse {
  id: string;
  result?: { success?: boolean; error?: string; [k: string]: unknown };
}

interface RpcNotification {
  method: string;
  params: Record<string, unknown>;
}

type IncomingMessage = RpcResponse | RpcNotification;

// -------- event types emitted by the client --------

export interface TokenStreamingEvents {
  open: () => void;
  close: (info: { code: number; reason: string; wasClean: boolean }) => void;
  status: (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;
  error: (err: AjentifyError) => void;
  on_token: (params: { token: string; response_id: string }) => void;
  on_stop_token: (params: { response_id: string }) => void;
  on_tool_call: (params: {
    tool_call_id: string;
    tool_name: string;
    tool_input: Record<string, unknown>;
  }) => void;
  on_tool_response: (params: {
    tool_call_id: string;
    tool_name: string;
    tool_output: string;
  }) => void;
  on_client_side_tool_calls: (params: {
    tool_calls: ClientSideToolCall[];
    response_id: string;
  }) => void;
  on_events: (params: { events: AgentEvent[]; response_id: string }) => void;
  agent_connected: (params: { agent: Agent; agent_speaks_first?: boolean }) => void;
}

type EventName = keyof TokenStreamingEvents;
type Listener<T extends EventName> = TokenStreamingEvents[T];

// -------- options --------

export interface TokenStreamingClientOptions {
  url?: string;
  /**
   * Called every time the client is about to connect or reconnect. Must
   * return a fresh access token. This is invoked **before** every
   * `connect_to_context` call, per the configured token strategy.
   */
  getAccessToken: () => Promise<string> | string;
  /** The context to (re)connect to. */
  contextId: string;
  /**
   * If true, will automatically reconnect when the WebSocket drops. Defaults
   * to true.
   */
  autoReconnect?: boolean;
  reconnect?: {
    /** Max number of reconnect attempts before giving up. Defaults to 8. */
    maxAttempts?: number;
    /** Base delay in ms. Doubles each attempt, capped at maxDelayMs. Defaults to 500. */
    baseDelayMs?: number;
    /** Max delay between attempts in ms. Defaults to 10_000. */
    maxDelayMs?: number;
  };
  /** Per-request response timeout in ms. Defaults to 30_000. */
  requestTimeoutMs?: number;
  /** Inject a custom WebSocket constructor (useful for tests / Node). */
  WebSocketImpl?: typeof WebSocket;
  /** Optional debug logger. */
  debug?: (...args: unknown[]) => void;
}

interface PendingRequest {
  resolve: (result: Record<string, unknown>) => void;
  reject: (err: AjentifyError) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * Lightweight, framework-agnostic client for the Ajentify token streaming
 * server. Implements the JSON-RPC-like dialect documented in
 * docs/WEBSOCKET_API.md.
 *
 *   - Always calls `getAccessToken()` right before every (re)connect.
 *   - Auto-reconnects with exponential backoff.
 *   - Re-issues `connect_to_context` automatically on each reconnect so the
 *     caller does not need to manage that lifecycle.
 *
 * Usage is event-driven:
 *
 * ```ts
 * const client = new TokenStreamingClient({ contextId, getAccessToken });
 * client.on('on_token', ({ token }) => console.log(token));
 * client.on('on_stop_token', () => console.log('done'));
 * await client.connect();
 * await client.addMessage('Hello!');
 * ```
 */
export class TokenStreamingClient {
  private readonly url: string;
  private readonly opts: Required<
    Pick<TokenStreamingClientOptions, 'autoReconnect' | 'requestTimeoutMs'>
  > & {
    reconnect: Required<NonNullable<TokenStreamingClientOptions['reconnect']>>;
  } & Pick<TokenStreamingClientOptions, 'getAccessToken' | 'contextId' | 'WebSocketImpl' | 'debug'>;

  private ws: WebSocket | null = null;
  // Stored as Set<Function> internally; cast to the right Listener<T> at use sites.
  private listeners: Map<EventName, Set<(...args: unknown[]) => void>> = new Map();
  private pending = new Map<string, PendingRequest>();

  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Set during the first reconnect to skip backoff. */
  private firstConnect = true;

  constructor(options: TokenStreamingClientOptions) {
    this.url = options.url ?? DEFAULT_TOKEN_STREAMING_URL;
    this.opts = {
      autoReconnect: options.autoReconnect ?? true,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      reconnect: {
        maxAttempts: options.reconnect?.maxAttempts ?? 8,
        baseDelayMs: options.reconnect?.baseDelayMs ?? 500,
        maxDelayMs: options.reconnect?.maxDelayMs ?? 10_000,
      },
      getAccessToken: options.getAccessToken,
      contextId: options.contextId,
      WebSocketImpl: options.WebSocketImpl,
      debug: options.debug,
    };
  }

  // ---------------- public API ----------------

  on<T extends EventName>(event: T, listener: Listener<T>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set<(...args: unknown[]) => void>();
      this.listeners.set(event, set);
    }
    const fn = listener as unknown as (...args: unknown[]) => void;
    set.add(fn);
    return () => set!.delete(fn);
  }

  off<T extends EventName>(event: T, listener: Listener<T>): void {
    this.listeners.get(event)?.delete(listener as unknown as (...args: unknown[]) => void);
  }

  /** Opens the WS, calls `connect_to_context`. Resolves with the agent info. */
  async connect(): Promise<Agent> {
    this.stopped = false;
    return this.openAndConnectToContext();
  }

  /** Closes the WebSocket and disables auto-reconnect. */
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.failAllPending(new AjentifyError('Client disconnected', 'transport'));
    if (this.ws) {
      try {
        this.ws.close(1000, 'client disconnect');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.emit('status', 'disconnected');
  }

  /** True when the websocket is OPEN. */
  get isOpen(): boolean {
    return this.ws?.readyState === 1; // WebSocket.OPEN
  }

  // ---------------- protocol helpers ----------------

  /**
   * Send a message to the agent. The response is streamed via the
   * `on_token` / `on_stop_token` events.
   */
  async addMessage(message: string): Promise<void> {
    await this.call('add_message', { message });
  }

  /**
   * Send tool responses for a previously-emitted `on_client_side_tool_calls`.
   * Does NOT wait for a response — the server continues streaming the next
   * agent turn via `on_token` / `on_stop_token`.
   */
  async sendClientSideToolResponses(
    toolResponses: ClientSideToolResponse[]
  ): Promise<void> {
    // The server may issue a response with `success: true` but it is also
    // valid to send as a notification (no id) per the docs. We use id-based
    // form to surface validation errors.
    await this.call('client_side_tool_responses', { tool_responses: toolResponses });
  }

  /**
   * Low-level: send a JSON-RPC call. Resolves with `result` (server returns
   * `{ result: { success: true, ... } }`) or rejects with an `AjentifyError`
   * when the server returns `{ result: { error: '...' } }`.
   */
  async call(
    method: string,
    params: Record<string, unknown>,
    options: { awaitResponse?: boolean } = {}
  ): Promise<Record<string, unknown>> {
    const awaitResponse = options.awaitResponse ?? true;
    if (!this.isOpen) {
      throw new AjentifyError('WebSocket is not open', 'transport');
    }
    if (!awaitResponse) {
      this.sendRaw({ method, params });
      return {};
    }
    const id = uid('req');
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new AjentifyError(
            `RPC '${method}' timed out after ${this.opts.requestTimeoutMs}ms`,
            'transport'
          )
        );
      }, this.opts.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.sendRaw({ method, params, id });
    });
  }

  // ---------------- internals ----------------

  private async openAndConnectToContext(): Promise<Agent> {
    this.emit('status', 'connecting');
    let accessToken: string;
    try {
      accessToken = await this.opts.getAccessToken();
    } catch (err) {
      const e = new AjentifyError(
        'Failed to obtain access token before connecting',
        'auth',
        err
      );
      this.emit('error', e);
      this.emit('status', 'error');
      throw e;
    }

    await this.openSocket();

    let result: Record<string, unknown>;
    try {
      result = await this.call('connect_to_context', {
        context_id: this.opts.contextId,
        access_token: accessToken,
      });
    } catch (err) {
      const e =
        err instanceof AjentifyError
          ? err
          : new AjentifyError('connect_to_context failed', 'rpc', err);
      this.emit('error', e);
      throw e;
    }

    const agent = (result.agent ?? {}) as Agent;
    const agentSpeaksFirst = Boolean(result.agent_speaks_first);
    this.emit('agent_connected', { agent, agent_speaks_first: agentSpeaksFirst });
    this.emit('status', 'connected');
    this.reconnectAttempts = 0;
    this.firstConnect = false;
    return agent;
  }

  private async openSocket(): Promise<void> {
    const WS = this.opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) {
      throw new AjentifyError(
        'No WebSocket implementation available. Pass `WebSocketImpl` in node environments.',
        'config'
      );
    }
    return await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = new WS(this.url);
      this.ws = ws;
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        this.emit('open');
        resolve();
      };
      ws.onerror = (event) => {
        const err = new AjentifyError('WebSocket error', 'transport', event);
        this.emit('error', err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };
      ws.onclose = (event) => {
        this.handleClose(event);
      };
      ws.onmessage = (event) => {
        try {
          const data = typeof event.data === 'string' ? event.data : String(event.data);
          this.handleIncoming(JSON.parse(data) as IncomingMessage);
        } catch (err) {
          this.emit(
            'error',
            new AjentifyError('Failed to parse incoming message', 'transport', err)
          );
        }
      };
    });
  }

  private handleClose(event: CloseEvent): void {
    this.opts.debug?.('ws close', event.code, event.reason);
    this.ws = null;
    this.failAllPending(
      new AjentifyError(`WebSocket closed (${event.code})`, 'transport')
    );
    this.emit('close', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
    });
    if (this.stopped || !this.opts.autoReconnect) {
      this.emit('status', 'disconnected');
      return;
    }
    if (this.reconnectAttempts >= this.opts.reconnect.maxAttempts) {
      this.emit(
        'error',
        new AjentifyError(
          `Exceeded ${this.opts.reconnect.maxAttempts} reconnect attempts`,
          'transport'
        )
      );
      this.emit('status', 'disconnected');
      return;
    }
    const delay = Math.min(
      this.opts.reconnect.baseDelayMs * 2 ** this.reconnectAttempts,
      this.opts.reconnect.maxDelayMs
    );
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openAndConnectToContext().catch(() => {
        // openAndConnectToContext already emits 'error'; close will retry.
      });
    }, delay);
  }

  private handleIncoming(msg: IncomingMessage): void {
    // Response to a request
    if ('id' in msg && msg.id) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timeout);
      const result = msg.result ?? {};
      if (result.error) {
        pending.reject(new AjentifyError(String(result.error), 'rpc'));
      } else {
        pending.resolve(result);
      }
      return;
    }
    // Notification
    const notification = msg as RpcNotification;
    switch (notification.method) {
      case 'on_token':
        this.emit('on_token', notification.params as never);
        break;
      case 'on_stop_token':
        this.emit('on_stop_token', notification.params as never);
        break;
      case 'on_tool_call':
        this.emit('on_tool_call', notification.params as never);
        break;
      case 'on_tool_response':
        this.emit('on_tool_response', notification.params as never);
        break;
      case 'on_client_side_tool_calls':
        this.emit('on_client_side_tool_calls', notification.params as never);
        break;
      case 'on_events':
        this.emit('on_events', notification.params as never);
        break;
      default:
        this.opts.debug?.('unknown notification', notification.method, notification.params);
    }
  }

  private sendRaw(payload: RpcRequest): void {
    if (!this.ws || this.ws.readyState !== 1) {
      throw new AjentifyError('WebSocket is not open', 'transport');
    }
    this.ws.send(JSON.stringify(payload));
  }

  private failAllPending(err: AjentifyError): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timeout);
      p.reject(err);
    }
    this.pending.clear();
  }

  private emit<T extends EventName>(event: T, ...args: Parameters<Listener<T>>): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn(...(args as unknown[]));
      } catch (err) {
        this.opts.debug?.(`listener for ${event} threw`, err);
      }
    }
  }
}
