import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextsStore } from './contextsStore';
import type { AjentifyEvent } from '../types';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/**
 * Build a strict mock dispatcher that returns canned values per event type.
 * Lets each test override individual variants.
 */
function makeDispatcher(
  overrides: Partial<Record<AjentifyEvent['type'], (event: AjentifyEvent) => unknown>> = {}
) {
  const defaults: Record<AjentifyEvent['type'], (event: AjentifyEvent) => unknown> = {
    create_context: () => ({
      context_id: 'ctx_new',
      agent_id: 'a1',
      client_id: 'cln_1',
      client_api_key: null,
    }),
    generate_access_token: () => 'tok_xyz',
    get_context: () => ({
      context_id: 'ctx_old',
      agent_id: 'a1',
      client_id: 'cln_1',
      messages: [],
    }),
    get_context_history: () => ({ contexts: [] }),
    delete_context: () => ({ success: true }),
  };
  const merged = { ...defaults, ...overrides };
  return vi.fn((event: AjentifyEvent) => merged[event.type](event));
}

describe('contextsStore', () => {
  let onEvent: ReturnType<typeof makeDispatcher>;

  beforeEach(() => {
    onEvent = makeDispatcher();
  });

  it('persists contextId / accessToken on setCurrentContext', () => {
    const storage = memoryStorage();
    const store = createContextsStore({ onEvent, storage, storageKey: 'k' });
    store.getState().setCurrentContext('ctx_1', 'tok_1', 'cln_1');
    expect(JSON.parse(storage.getItem('k')!)).toMatchObject({
      state: { contextId: 'ctx_1', accessToken: 'tok_1', clientId: 'cln_1' },
    });
  });

  it('hydrates from storage on construction', () => {
    const storage = memoryStorage();
    storage.setItem(
      'k',
      JSON.stringify({
        version: 1,
        state: { contextId: 'ctx_persisted', accessToken: 'tt', clientId: 'cln_2' },
      })
    );
    const store = createContextsStore({ onEvent, storage, storageKey: 'k' });
    expect(store.getState().contextId).toBe('ctx_persisted');
    expect(store.getState().accessToken).toBe('tt');
    expect(store.getState().clientId).toBe('cln_2');
  });

  it('createContext dispatches a create_context event and stores returned identifiers', async () => {
    const storage = memoryStorage();
    const store = createContextsStore({ onEvent, storage, storageKey: 'k' });
    const result = await store.getState().createContext({ user_defined: { foo: 'bar' } });
    expect(result.context_id).toBe('ctx_new');
    expect(store.getState().contextId).toBe('ctx_new');
    expect(store.getState().clientId).toBe('cln_1');
    expect(onEvent).toHaveBeenCalledWith({
      type: 'create_context',
      request: { user_defined: { foo: 'bar' } },
    });
  });

  it('generateAccessToken dispatches generate_access_token and stores the freshly-minted token', async () => {
    const storage = memoryStorage();
    const store = createContextsStore({ onEvent, storage, storageKey: 'k' });
    store.getState().setCurrentContext('ctx_1', null, 'cln_1');
    const tok = await store.getState().generateAccessToken();
    expect(tok).toBe('tok_xyz');
    expect(store.getState().accessToken).toBe('tok_xyz');
    expect(onEvent).toHaveBeenCalledWith({ type: 'generate_access_token' });
  });

  it('loadHistory accepts a bare array as well as { contexts }', async () => {
    const arrayDispatcher = makeDispatcher({
      get_context_history: () => [
        {
          context_id: 'ctx_a',
          last_message: 'hi',
          created_at: 0,
          updated_at: 0,
          agent: { agent_id: 'a1', agent_name: 'A' },
        },
      ],
    });
    const store = createContextsStore({ onEvent: arrayDispatcher, storage: null });
    const list = await store.getState().loadHistory();
    expect(list).toHaveLength(1);
    expect(store.getState().historyLoaded).toBe(true);
  });

  it('deleteContext removes the entry from cached history and clears current if active', async () => {
    const storage = memoryStorage();
    const dispatcher = makeDispatcher({
      get_context_history: () => ({
        contexts: [
          {
            context_id: 'ctx_a',
            last_message: '',
            created_at: 0,
            updated_at: 0,
            agent: { agent_id: 'a1', agent_name: 'A' },
          },
          {
            context_id: 'ctx_b',
            last_message: '',
            created_at: 0,
            updated_at: 0,
            agent: { agent_id: 'a1', agent_name: 'A' },
          },
        ],
      }),
    });
    const store = createContextsStore({ onEvent: dispatcher, storage, storageKey: 'k' });
    await store.getState().loadHistory();
    store.getState().setCurrentContext('ctx_a', 'tok', 'cln_1');

    await store.getState().deleteContext('ctx_a');

    expect(dispatcher).toHaveBeenCalledWith({
      type: 'delete_context',
      contextId: 'ctx_a',
    });
    expect(store.getState().history.map((h) => h.context_id)).toEqual(['ctx_b']);
    expect(store.getState().contextId).toBeNull();
    expect(store.getState().accessToken).toBeNull();
  });

  it('deleteContext leaves a non-active context selected when something else is current', async () => {
    const dispatcher = makeDispatcher({
      get_context_history: () => ({
        contexts: [
          {
            context_id: 'ctx_a',
            last_message: '',
            created_at: 0,
            updated_at: 0,
            agent: { agent_id: 'a1', agent_name: 'A' },
          },
          {
            context_id: 'ctx_b',
            last_message: '',
            created_at: 0,
            updated_at: 0,
            agent: { agent_id: 'a1', agent_name: 'A' },
          },
        ],
      }),
    });
    const store = createContextsStore({ onEvent: dispatcher, storage: null });
    await store.getState().loadHistory();
    store.getState().setCurrentContext('ctx_a', 'tok', 'cln_1');

    await store.getState().deleteContext('ctx_b');

    expect(store.getState().contextId).toBe('ctx_a');
    expect(store.getState().history.map((h) => h.context_id)).toEqual(['ctx_a']);
  });
});
