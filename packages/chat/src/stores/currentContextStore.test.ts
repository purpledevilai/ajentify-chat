import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCurrentContextStore } from './currentContextStore';
import { createContextsStore } from './contextsStore';
import { createClientSideToolsStore } from './clientSideToolsStore';
import {
  createMockServer,
  MockWebSocket,
  setActiveMockServer,
} from '../ws/MockWebSocket';
import type { AjentifyProxyRequest } from '../types';

/**
 * Build a strict mock proxy handler that returns canned values per request
 * type. Lets each test override individual variants.
 */
function makeProxy(
  overrides: Partial<Record<AjentifyProxyRequest['type'], (req: AjentifyProxyRequest) => unknown>> = {}
) {
  const defaults: Record<AjentifyProxyRequest['type'], (req: AjentifyProxyRequest) => unknown> = {
    create_context: () => ({
      context_id: 'ctx_new',
      agent_id: 'a1',
      client_id: 'cln_1',
      client_api_key: 'key_xyz',
    }),
    generate_access_token: () => ({ token: 'tok_xyz' }),
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
  return vi.fn((req: AjentifyProxyRequest) => merged[req.type](req));
}

interface Setup {
  current: ReturnType<typeof createCurrentContextStore>;
  contexts: ReturnType<typeof createContextsStore>;
  proxy: ReturnType<typeof makeProxy>;
  server: ReturnType<typeof createMockServer>;
}

function setupStores(opts: {
  agentSpeaksFirst?: boolean;
  proxy?: ReturnType<typeof makeProxy>;
} = {}): Setup {
  const proxy = opts.proxy ?? makeProxy();
  const server = createMockServer();
  const contexts = createContextsStore({ onProxy: proxy, storage: null });
  const clientSideTools = createClientSideToolsStore();
  const current = createCurrentContextStore({
    contextsStore: contexts,
    clientSideToolsStore: clientSideTools,
    WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    agentSpeaksFirst: opts.agentSpeaksFirst,
    reconnect: { maxAttempts: 0 },
  });
  return { current, contexts, proxy, server };
}

/**
 * Wire a happy-path mock server that auto-replies to `connect_to_context`
 * (and optionally `add_message`) with successful results. Returns the
 * sent-frames buffer for assertions.
 */
function autoRespond(server: ReturnType<typeof createMockServer>) {
  const orig = server.onSend;
  server.onSend = (raw: string) => {
    orig(raw);
    const msg = JSON.parse(raw) as { method: string; id?: string };
    if (msg.method === 'connect_to_context' && msg.id) {
      server.push({
        id: msg.id,
        result: {
          success: true,
          agent: { agent_id: 'a1', agent_name: 'Bot' },
        },
      });
    } else if (msg.method === 'add_message' && msg.id) {
      server.push({ id: msg.id, result: { success: true } });
    }
  };
}

describe('currentContextStore', () => {
  beforeEach(() => {
    // each setupStores() resets activeServer; nothing to do here
  });

  afterEach(() => {
    setActiveMockServer(null);
  });

  describe('startNewContext (default lazy / draft mode)', () => {
    it('enters a draft state and never dispatches create_context', async () => {
      const { current, proxy } = setupStores();

      await current.getState().startNewContext();

      expect(proxy).not.toHaveBeenCalled();
      expect(current.getState().isDraft).toBe(true);
      expect(current.getState().status).toBe('draft');
      expect(current.getState().contextId).toBeNull();
      expect(current.getState().messages).toHaveLength(0);
      expect(current.getState().creating).toBe(false);
    });

    it('stashes the request payload for later materialization', async () => {
      const { current } = setupStores();

      await current
        .getState()
        .startNewContext({ user_defined: { source: 'web' } });

      expect(current.getState().draftRequest).toEqual({
        user_defined: { source: 'web' },
      });
    });

    it('is idempotent: a second call on a fresh draft does not reset state', async () => {
      const { current, proxy } = setupStores();

      await current.getState().startNewContext({ user_defined: { v: 1 } });
      const firstSnapshot = current.getState().draftRequest;

      await current.getState().startNewContext({ user_defined: { v: 2 } });

      // No backend dispatch and the original draft request is preserved.
      expect(proxy).not.toHaveBeenCalled();
      expect(current.getState().draftRequest).toBe(firstSnapshot);
    });
  });

  describe('startNewContext with agentSpeaksFirst', () => {
    it('eagerly dispatches create_context and connects the WebSocket', async () => {
      const { current, proxy, server } = setupStores({
        agentSpeaksFirst: true,
      });
      autoRespond(server);

      await current.getState().startNewContext();

      expect(proxy).toHaveBeenCalledWith({
        type: 'create_context',
        request: undefined,
      });
      expect(current.getState().contextId).toBe('ctx_new');
      expect(current.getState().isDraft).toBe(false);
      expect(current.getState().creating).toBe(false);
      // The WS handshake completes with no messages and no pending response,
      // so the status settles on 'connected'.
      expect(current.getState().status).toBe('connected');

      current.getState().disconnect();
    });

    it('is idempotent on an already-connected empty chat', async () => {
      const { current, proxy, server } = setupStores({
        agentSpeaksFirst: true,
      });
      autoRespond(server);

      await current.getState().startNewContext();
      const firstCallCount = proxy.mock.calls.length;

      // Spam the button — should be a no-op.
      await current.getState().startNewContext();
      await current.getState().startNewContext();

      expect(proxy.mock.calls.length).toBe(firstCallCount);

      current.getState().disconnect();
    });

    it('keeps draft state when transitioning from a previously connected chat', async () => {
      // Regression: tearing down the prior wsClient schedules an async
      // onclose that previously fired *after* startNewContext set
      // status='draft', clobbering it back to 'disconnected'. Now stale
      // listeners must be ignored.
      const { current, server } = setupStores();
      autoRespond(server);

      // Prime: send a real message so we end up with a connected wsClient
      // and at least one human message in state.
      await current.getState().startNewContext();
      await current.getState().sendMessage('hello');

      // Reset to a fresh draft (the user clicks "+").
      await current.getState().startNewContext();
      expect(current.getState().status).toBe('draft');
      expect(current.getState().isDraft).toBe(true);

      // Flush the queued microtasks the prior MockWebSocket scheduled
      // for `onclose`. With the stale-listener guard, the draft state
      // survives.
      await Promise.resolve();
      await Promise.resolve();

      expect(current.getState().status).toBe('draft');
      expect(current.getState().isDraft).toBe(true);
      expect(current.getState().messages).toHaveLength(0);
    });
  });

  describe('sendMessage on a draft', () => {
    it('materializes the draft (create_context -> connect -> add_message) on first send', async () => {
      const { current, contexts, proxy, server } = setupStores();
      autoRespond(server);

      await current.getState().startNewContext({ user_defined: { v: 1 } });

      const sendPromise = current.getState().sendMessage('hello world');

      // The optimistic human message should be visible immediately, before
      // any backend round-trip resolves.
      expect(current.getState().messages).toHaveLength(1);
      expect(current.getState().messages[0]).toMatchObject({
        kind: 'text',
        sender: 'human',
        content: 'hello world',
      });
      expect(current.getState().isDraft).toBe(false);
      expect(current.getState().creating).toBe(true);

      await sendPromise;

      // create_context must have been dispatched with the stashed request.
      expect(proxy).toHaveBeenCalledWith({
        type: 'create_context',
        request: { user_defined: { v: 1 } },
      });

      // The contextsStore now holds the new context id.
      expect(contexts.getState().contextId).toBe('ctx_new');
      expect(current.getState().contextId).toBe('ctx_new');
      expect(current.getState().creating).toBe(false);
      expect(current.getState().draftRequest).toBeNull();

      // An add_message frame was sent over the WebSocket with our text.
      const addMessageFrame = server.sent
        .map((raw) => JSON.parse(raw) as { method: string; params: { message?: string } })
        .find((m) => m.method === 'add_message');
      expect(addMessageFrame).toBeDefined();
      expect(addMessageFrame?.params.message).toBe('hello world');

      current.getState().disconnect();
    });

    it('rolls into an error state if create_context rejects', async () => {
      const proxy = makeProxy({
        create_context: () => {
          throw new Error('backend rejected');
        },
      });
      const { current, server } = setupStores({ proxy });
      autoRespond(server);

      await current.getState().startNewContext();
      await expect(
        current.getState().sendMessage('hello')
      ).rejects.toThrow();

      expect(current.getState().status).toBe('error');
      expect(current.getState().creating).toBe(false);
    });
  });
});
