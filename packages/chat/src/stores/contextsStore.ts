import { createStore } from 'zustand/vanilla';
import {
  AjentifyError,
  type CreateContextRequest,
  type CreateContextResponse,
  type FilteredContext,
  type HistoryContext,
} from '../types';
import { createSafeStorage } from '../lib/utils';

/**
 * The four callbacks the developer must provide to the provider. Each one
 * should hit the developer's own backend (which proxies to the Ajentify REST
 * API using the org-scoped API key).
 */
export interface ContextCallbacks {
  /**
   * Create a new context. The dev's backend calls `POST /context`. May omit
   * `agent_id` server-side if the backend has it hard-coded.
   */
  createContext: (
    req?: CreateContextRequest
  ) => Promise<CreateContextResponse>;

  /**
   * Mint a fresh access token for connecting to a context. The dev's backend
   * calls `POST /generate-api-key` and returns the JWT string. It is the
   * callback's responsibility to identify the user (e.g. via session cookie).
   */
  generateAccessToken: () => Promise<string>;

  /** Fetch full context messages. Dev's backend calls `GET /context/{id}`. */
  getContext: (contextId: string) => Promise<FilteredContext>;

  /** Fetch the user's context history. Dev's backend calls `GET /context-history`. */
  getContextHistory: () => Promise<HistoryContext[] | { contexts: HistoryContext[] }>;
}

export interface ContextsStoreOptions {
  callbacks: ContextCallbacks;
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

  /** Load the user's chat history. */
  loadHistory: () => Promise<HistoryContext[]>;
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

export function createContextsStore(options: ContextsStoreOptions) {
  const storage = options.storage === null ? null : options.storage ?? createSafeStorage('localStorage');
  const storageKey = options.storageKey ?? 'ajentify.chat';

  const persisted = readPersisted(storage, storageKey);

  const store = createStore<ContextsStore>((set, get) => ({
    contextId: persisted?.contextId ?? null,
    accessToken: persisted?.accessToken ?? null,
    clientId: persisted?.clientId ?? null,

    history: [],
    historyLoading: false,
    historyError: null,

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
        const created = await options.callbacks.createContext(req);
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
        return created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ creating: false, createError: msg });
        throw new AjentifyError('createContext callback failed', 'callback', err);
      }
    },

    generateAccessToken: async () => {
      try {
        const token = await options.callbacks.generateAccessToken();
        if (typeof token !== 'string' || token.length === 0) {
          throw new AjentifyError(
            'generateAccessToken callback returned an empty token',
            'callback'
          );
        }
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
        throw new AjentifyError('generateAccessToken callback failed', 'callback', err);
      }
    },

    loadContext: async (contextId) => {
      try {
        const ctx = await options.callbacks.getContext(contextId);
        if (!ctx?.context_id) {
          throw new AjentifyError(
            'getContext callback returned an invalid context payload',
            'callback'
          );
        }
        if (ctx.client_id) {
          set({ clientId: ctx.client_id });
        }
        return ctx;
      } catch (err) {
        if (err instanceof AjentifyError) throw err;
        throw new AjentifyError('getContext callback failed', 'callback', err);
      }
    },

    loadHistory: async () => {
      set({ historyLoading: true, historyError: null });
      try {
        const raw = await options.callbacks.getContextHistory();
        const list: HistoryContext[] = Array.isArray(raw) ? raw : raw.contexts ?? [];
        set({ history: list, historyLoading: false });
        return list;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ historyLoading: false, historyError: msg });
        throw new AjentifyError('getContextHistory callback failed', 'callback', err);
      }
    },
  }));

  return store;
}
