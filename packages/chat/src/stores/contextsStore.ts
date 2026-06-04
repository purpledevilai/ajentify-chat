import { createStore } from 'zustand/vanilla';
import {
  AjentifyError,
  type AjentifyProxyRequest,
  type AjentifyProxyHandler,
  type AjentifyProxyResult,
  type CreateContextRequest,
  type CreateContextResponse,
  type FilteredContext,
  type HistoryContext,
} from '../types';
import { createSafeStorage } from '../lib/utils';

export interface ContextsStoreOptions {
  /**
   * The single handler the developer provides on `<AjentifyProvider>`. Every
   * backend request the SDK makes is dispatched through this function as a
   * tagged `AjentifyProxyRequest`. The handler should forward to the dev's
   * backend proxy and return Ajentify API responses unchanged.
   */
  onProxy: AjentifyProxyHandler;
  storage?: Storage | null;
  storageKey?: string;
}

interface PersistedShape {
  contextId: string | null;
  accessToken: string | null;
  clientId: string | null;
  contextIdsByClientId?: Record<string, string>;
}

export interface ContextsStore {
  /** The active context the chat is (or should be) connected to. */
  contextId: string | null;
  /** Last access token used. May be expired; always refresh before WS connect. */
  accessToken: string | null;
  /** The Ajentify-issued client_id this user is mapped to (org-owned). */
  clientId: string | null;

  /** Chat history listing (filled by `loadHistory()`). */
  history: HistoryContext[];
  historyLoading: boolean;
  historyError: string | null;
  /** True after the first successful `loadHistory()` call this session. */
  historyLoaded: boolean;

  /** Whether a createContext call is currently in flight. */
  creating: boolean;
  createError: string | null;

  // -------- actions --------

  /**
   * Persist a (contextId, accessToken[, clientId]) tuple to localStorage and
   * update state. Does NOT connect the WebSocket; that is the CurrentContext
   * store's job.
   */
  setCurrentContext: (
    contextId: string,
    accessToken: string | null,
    clientId?: string | null
  ) => void;

  /** Clear localStorage and state for the current context. */
  clearCurrentContext: () => void;

  /** Create a new context via the dev's backend. */
  createContext: (
    req?: CreateContextRequest
  ) => Promise<CreateContextResponse>;

  /** Mint a fresh access token for the current context. */
  generateAccessToken: () => Promise<string>;

  /** Load the messages for a context by id. */
  loadContext: (contextId: string) => Promise<FilteredContext>;

  /**
   * Force a refetch of the user's chat history. Concurrent calls share the
   * same in-flight request.
   */
  loadHistory: () => Promise<HistoryContext[]>;

  /**
   * Return the cached history if it has already been loaded this session;
   * otherwise call `loadHistory()`. Use this for "open the history view"
   * flows so we don't refetch on every mount.
   */
  ensureHistoryLoaded: () => Promise<HistoryContext[]>;

  /** Mark the cached history as stale so the next `ensureHistoryLoaded()` refetches. */
  invalidateHistory: () => void;

  /**
   * Delete a context via the dev's backend. Optimistically drops it from the
   * cached history list and clears the persisted current context if it was
   * the one being deleted. Throws an `AjentifyError` (`code: 'callback'`) if
   * the handler rejects.
   */
  deleteContext: (contextId: string) => Promise<void>;
}

const STORAGE_VERSION = 1;

function readPersisted(storage: Storage | null, key: string): PersistedShape | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: number; state?: PersistedShape };
    if (parsed.version !== STORAGE_VERSION || !parsed.state) return null;
    return parsed.state;
  } catch {
    return null;
  }
}

function writePersisted(
  storage: Storage | null,
  key: string,
  state: PersistedShape
): void {
  if (!storage) return;
  try {
    storage.setItem(
      key,
      JSON.stringify({ version: STORAGE_VERSION, state })
    );
  } catch {
    // ignore quota / private mode failures
  }
}

/**
 * Type-narrowing wrapper around the dev's proxy handler. Awaits sync or
 * async returns and casts the result to whatever the caller's request variant
 * is supposed to resolve with.
 */
async function dispatch<R extends AjentifyProxyRequest>(
  onProxy: AjentifyProxyHandler,
  request: R
): Promise<AjentifyProxyResult<R>> {
  return (await onProxy(request)) as AjentifyProxyResult<R>;
}

// ---- Per-variant resolve-shape validation -------------------------------
//
// Every variant has a documented expected return shape (see the JSDoc on
// `AjentifyProxyRequest`). When the dev's proxy resolves with something
// unexpected — usually because the response was wrapped differently — we
// can't actually use the value, so the SDK was rejecting later with a
// generic "callback failed" message that hid the real bug. We surface
// the bug at the dispatch site with a hint about the expected shape.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function describeShape(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(length=${v.length})`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v).slice(0, 5).join(', ');
    return `object({ ${keys}${Object.keys(v).length > 5 ? ', …' : ''} })`;
  }
  return typeof v;
}
function validateCreateContext(raw: unknown): CreateContextResponse {
  if (!isPlainObject(raw)) {
    throw new AjentifyError(
      `'create_context' callback resolved with ${describeShape(raw)} but ` +
        `expected an object matching CreateContextResponse (must include 'context_id', 'agent_id'). ` +
        `Did your backend wrap the response (e.g. '{ data: { ... } }')?`,
      'callback',
    );
  }
  if (typeof raw.context_id !== 'string' || !raw.context_id) {
    throw new AjentifyError(
      `'create_context' callback resolved without a 'context_id' string. ` +
        `Received ${describeShape(raw)}. The dev's backend must return the ` +
        `body of POST /context unchanged.`,
      'callback',
    );
  }
  return raw as unknown as CreateContextResponse;
}
function extractAccessToken(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  if (isPlainObject(raw) && typeof raw.token === 'string' && raw.token.length > 0) {
    return raw.token;
  }
  throw new AjentifyError(
    `'generate_access_token' proxy resolved with ${describeShape(raw)} ` +
      `but expected '{ token: string }' (the upstream /generate-api-key response). ` +
      `Make sure your proxy returns the Ajentify response unchanged.`,
    'callback',
  );
}

function validateGetContext(raw: unknown): FilteredContext {
  if (!isPlainObject(raw) || typeof raw.context_id !== 'string') {
    throw new AjentifyError(
      `'get_context' callback resolved with ${describeShape(raw)} but ` +
        `expected a FilteredContext (must include 'context_id', 'messages'). ` +
        `If your backend returns '{ context: ... }', unwrap it first.`,
      'callback',
    );
  }
  return raw as unknown as FilteredContext;
}
function validateGetContextHistory(raw: unknown): HistoryContext[] {
  if (Array.isArray(raw)) return raw as HistoryContext[];
  if (isPlainObject(raw) && Array.isArray(raw.contexts)) {
    return raw.contexts as HistoryContext[];
  }
  throw new AjentifyError(
    `'get_context_history' callback resolved with ${describeShape(raw)} but ` +
      `expected an array of HistoryContext (or '{ contexts: HistoryContext[] }'). ` +
      `If you proxy GET /context-history, return the response body unchanged.`,
    'callback',
  );
}

export function createContextsStore(options: ContextsStoreOptions) {
  const storage = options.storage === null ? null : options.storage ?? createSafeStorage('localStorage');
  const storageKey = options.storageKey ?? 'ajentify.chat';

  const persisted = readPersisted(storage, storageKey);

  // Dedupes concurrent `loadHistory()` callers so e.g. ChatHistory mounting
  // while a refresh is already in flight reuses the same promise.
  let inFlightHistoryLoad: Promise<HistoryContext[]> | null = null;

  const store = createStore<ContextsStore>((set, get) => ({
    contextId: persisted?.contextId ?? null,
    accessToken: persisted?.accessToken ?? null,
    clientId: persisted?.clientId ?? null,

    history: [],
    historyLoading: false,
    historyError: null,
    historyLoaded: false,

    creating: false,
    createError: null,

    setCurrentContext: (contextId, accessToken, clientId) => {
      const nextClientId = clientId ?? get().clientId ?? null;
      set({
        contextId,
        accessToken,
        clientId: nextClientId,
      });
      writePersisted(storage, storageKey, {
        contextId,
        accessToken,
        clientId: nextClientId,
      });
    },

    clearCurrentContext: () => {
      set({ contextId: null, accessToken: null });
      writePersisted(storage, storageKey, {
        contextId: null,
        accessToken: null,
        clientId: get().clientId,
      });
    },

    createContext: async (req) => {
      set({ creating: true, createError: null });
      try {
        const rawCreated = await dispatch(options.onProxy, {
          type: 'create_context',
          request: req,
        });
        const created = validateCreateContext(rawCreated);
        const newClientId = created.client_id ?? get().clientId ?? null;
        // Public-agent flows return a long-lived `client_api_key` on creation.
        // For private flows the dev's backend either returned it on the
        // response or it will be minted later via generateAccessToken().
        const accessToken = created.client_api_key ?? null;
        set({
          contextId: created.context_id,
          accessToken,
          clientId: newClientId,
          creating: false,
        });
        writePersisted(storage, storageKey, {
          contextId: created.context_id,
          accessToken,
          clientId: newClientId,
        });
        // Refresh the cached history so the new context shows up next time
        // the user opens the history panel. Fire-and-forget — failures are
        // surfaced via `historyError`.
        if (get().historyLoaded) {
          void get().loadHistory().catch(() => {
            // already captured into historyError
          });
        }
        return created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ creating: false, createError: msg });
        if (err instanceof AjentifyError) throw err;
        throw new AjentifyError('create_context callback failed', 'callback', err);
      }
    },

    generateAccessToken: async () => {
      try {
        const raw = await dispatch(options.onProxy, {
          type: 'generate_access_token',
        });
        const token = extractAccessToken(raw);
        // Persist alongside contextId so a refresh keeps continuity.
        set({ accessToken: token });
        writePersisted(storage, storageKey, {
          contextId: get().contextId,
          accessToken: token,
          clientId: get().clientId,
        });
        return token;
      } catch (err) {
        if (err instanceof AjentifyError) throw err;
        throw new AjentifyError(
          'generate_access_token callback failed',
          'callback',
          err
        );
      }
    },

    loadContext: async (contextId) => {
      try {
        const raw = await dispatch(options.onProxy, {
          type: 'get_context',
          contextId,
        });
        const ctx = validateGetContext(raw);
        if (ctx.client_id) {
          set({ clientId: ctx.client_id });
        }
        return ctx;
      } catch (err) {
        if (err instanceof AjentifyError) throw err;
        throw new AjentifyError('get_context callback failed', 'callback', err);
      }
    },

    loadHistory: async () => {
      if (inFlightHistoryLoad) return inFlightHistoryLoad;
      set({ historyLoading: true, historyError: null });
      inFlightHistoryLoad = (async () => {
        try {
          const raw = await dispatch(options.onProxy, {
            type: 'get_context_history',
          });
          const list = validateGetContextHistory(raw);
          set({ history: list, historyLoading: false, historyLoaded: true });
          return list;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          set({ historyLoading: false, historyError: msg });
          if (err instanceof AjentifyError) throw err;
          throw new AjentifyError(
            'get_context_history callback failed',
            'callback',
            err
          );
        } finally {
          inFlightHistoryLoad = null;
        }
      })();
      return inFlightHistoryLoad;
    },

    ensureHistoryLoaded: async () => {
      const s = get();
      if (s.historyLoaded) return s.history;
      return get().loadHistory();
    },

    invalidateHistory: () => {
      set({ historyLoaded: false });
    },

    deleteContext: async (contextId) => {
      try {
        await dispatch(options.onProxy, { type: 'delete_context', contextId });
      } catch (err) {
        if (err instanceof AjentifyError) throw err;
        throw new AjentifyError(
          'delete_context callback failed',
          'callback',
          err
        );
      }
      // Drop it from the cached history list (if loaded). We do this whether
      // the list was loaded or not — `historyLoaded` stays unchanged so the
      // next `ensureHistoryLoaded()` still treats the cache as authoritative.
      set({
        history: get().history.filter((h) => h.context_id !== contextId),
      });
      // If we just deleted the active context, drop it from local state /
      // storage so the UI knows there's nothing connected. The current-context
      // store is responsible for tearing down its own WebSocket via the hook.
      if (get().contextId === contextId) {
        get().clearCurrentContext();
      }
    },
  }));

  return store;
}
