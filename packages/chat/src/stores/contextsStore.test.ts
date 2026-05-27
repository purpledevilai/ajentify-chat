import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createContextsStore } from './contextsStore';

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

describe('contextsStore', () => {
  let callbacks: Parameters<typeof createContextsStore>[0]['callbacks'];

  beforeEach(() => {
    callbacks = {
      createContext: vi.fn().mockResolvedValue({
        context_id: 'ctx_new',
        agent_id: 'a1',
        client_id: 'cln_1',
        client_api_key: null,
      }),
      generateAccessToken: vi.fn().mockResolvedValue('tok_xyz'),
      getContext: vi.fn().mockResolvedValue({
        context_id: 'ctx_old',
        agent_id: 'a1',
        client_id: 'cln_1',
        messages: [],
      }),
      getContextHistory: vi.fn().mockResolvedValue({ contexts: [] }),
    };
  });

  it('persists contextId / accessToken on setCurrentContext', () => {
    const storage = memoryStorage();
    const store = createContextsStore({ callbacks, storage, storageKey: 'k' });
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
    const store = createContextsStore({ callbacks, storage, storageKey: 'k' });
    expect(store.getState().contextId).toBe('ctx_persisted');
    expect(store.getState().accessToken).toBe('tt');
    expect(store.getState().clientId).toBe('cln_2');
  });

  it('createContext stores returned identifiers', async () => {
    const storage = memoryStorage();
    const store = createContextsStore({ callbacks, storage, storageKey: 'k' });
    const result = await store.getState().createContext();
    expect(result.context_id).toBe('ctx_new');
    expect(store.getState().contextId).toBe('ctx_new');
    expect(store.getState().clientId).toBe('cln_1');
  });

  it('generateAccessToken stores the freshly-minted token', async () => {
    const storage = memoryStorage();
    const store = createContextsStore({ callbacks, storage, storageKey: 'k' });
    store.getState().setCurrentContext('ctx_1', null, 'cln_1');
    const tok = await store.getState().generateAccessToken();
    expect(tok).toBe('tok_xyz');
    expect(store.getState().accessToken).toBe('tok_xyz');
  });
});
