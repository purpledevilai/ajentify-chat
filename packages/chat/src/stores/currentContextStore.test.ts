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
  /** Deprecated no-op; only passed to prove it is ignored. */
  beta?: boolean;
  onError?: (err: unknown) => void;
  clientSideTools?: ReturnType<typeof createClientSideToolsStore>;
} = {}): Setup {
  const proxy = opts.proxy ?? makeProxy();
  const server = createMockServer();
  const contexts = createContextsStore({ onProxy: proxy, storage: null });
  const clientSideTools = opts.clientSideTools ?? createClientSideToolsStore();
  const current = createCurrentContextStore({
    contextsStore: contexts,
    clientSideToolsStore: clientSideTools,
    WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    agentSpeaksFirst: opts.agentSpeaksFirst,
    beta: opts.beta,
    onError: opts.onError,
    reconnect: { maxAttempts: 0 },
  });
  return { current, contexts, proxy, server };
}

/**
 * Wire a happy-path mock server that auto-replies to `connect_to_context`
 * with a successful result. `add_message` / `client_side_tool_responses`
 * are fire-and-forget (no id) so the server never replies to them.
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
    }
  };
}

function parseFrames(server: ReturnType<typeof createMockServer>) {
  return server.sent.map(
    (raw) =>
      JSON.parse(raw) as {
        method: string;
        id?: string;
        params: Record<string, unknown>;
      }
  );
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

  describe('streaming protocol (always on)', () => {
    /** Materialize a connected context with one human message sent. */
    async function connectAndSend(opts: Parameters<typeof setupStores>[0] = {}) {
      const setup = setupStores(opts);
      autoRespond(setup.server);
      await setup.current.getState().startNewContext();
      await setup.current.getState().sendMessage('hi');
      return setup;
    }

    it('sends connect_to_context with beta:true and add_message fire-and-forget (no id)', async () => {
      const { current, server } = await connectAndSend();

      const frames = parseFrames(server);
      const connectFrame = frames.find((f) => f.method === 'connect_to_context');
      expect(connectFrame).toBeDefined();
      expect(connectFrame?.params.beta).toBe(true);

      const addFrame = frames.find((f) => f.method === 'add_message');
      expect(addFrame).toBeDefined();
      // Fire-and-forget => no RPC id, so the request timer never applies.
      expect(addFrame?.id).toBeUndefined();
      // sendMessage resolved without any server reply and we are waiting.
      expect(current.getState().status).toBe('streaming');

      current.getState().disconnect();
    });

    it('ignores the deprecated beta option (beta:false still uses the protocol)', async () => {
      const { current, server } = await connectAndSend({ beta: false });

      const frames = parseFrames(server);
      expect(frames.find((f) => f.method === 'connect_to_context')?.params.beta).toBe(true);
      expect(frames.find((f) => f.method === 'add_message')?.id).toBeUndefined();

      // A lone on_stop_token does not end the turn.
      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'hey', response_id: 'r1' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });
      expect(current.getState().status).toBe('streaming');
      server.push({ method: 'on_turn_complete', params: {} });
      expect(current.getState().status).toBe('connected');

      current.getState().disconnect();
    });

    it('does not time out a long turn (no reply for longer than requestTimeoutMs)', async () => {
      vi.useFakeTimers();
      try {
        const onError = vi.fn();
        const { current, server } = await connectAndSend({ onError });

        // Well past the default 30s request timeout with no server reply.
        await vi.advanceTimersByTimeAsync(60_000);

        expect(onError).not.toHaveBeenCalled();
        expect(current.getState().status).toBe('streaming');
        expect(current.getState().error).toBeNull();

        server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
        server.push({ method: 'on_token', params: { token: 'late', response_id: 'r1' } });
        server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });
        server.push({ method: 'on_turn_complete', params: {} });

        expect(current.getState().status).toBe('connected');
        expect(
          current.getState().messages.filter((m) => m.kind === 'text' && m.sender === 'ai')
        ).toHaveLength(1);

        current.getState().disconnect();
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps streaming across a tool round and only finishes on on_turn_complete', async () => {
      const { current, server } = await connectAndSend();

      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'Checking…', response_id: 'r1' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });
      server.push({
        method: 'on_tool_call',
        params: { tool_call_id: 'tc1', tool_name: 'search', tool_input: {} },
      });
      expect(current.getState().status).toBe('streaming');
      server.push({
        method: 'on_tool_response',
        params: { tool_call_id: 'tc1', tool_name: 'search', tool_output: 'ok' },
      });
      expect(current.getState().status).toBe('streaming');

      server.push({ method: 'on_message_start', params: { response_id: 'r2' } });
      server.push({ method: 'on_token', params: { token: 'Done.', response_id: 'r2' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r2' } });
      expect(current.getState().status).toBe('streaming');

      server.push({ method: 'on_turn_complete', params: { response_id: 'r2' } });
      expect(current.getState().status).toBe('connected');
      expect(current.getState().messages.map((m) => m.kind)).toEqual([
        'text',
        'text',
        'tool_call',
        'text',
      ]);

      current.getState().disconnect();
    });

    it('sends client_side_tool_responses fire-and-forget and lets the continuation drive status', async () => {
      const clientSideTools = createClientSideToolsStore();
      clientSideTools.getState().setClientSideToolHandler(async () => 'tool-result');
      const { current, server } = await connectAndSend({ clientSideTools });

      server.push({
        method: 'on_client_side_tool_calls',
        params: {
          response_id: 'r1',
          tool_calls: [{ tool_call_id: 'ct1', tool_name: 'lookup', tool_input: { q: 1 } }],
        },
      });
      expect(current.getState().status).toBe('awaiting_tool_responses');

      // Let the async handler + send settle.
      await vi.waitFor(() => {
        expect(
          parseFrames(server).find((f) => f.method === 'client_side_tool_responses')
        ).toBeDefined();
      });
      const respFrame = parseFrames(server).find(
        (f) => f.method === 'client_side_tool_responses'
      );
      expect(respFrame?.id).toBeUndefined();
      expect(respFrame?.params.tool_responses).toEqual([
        { tool_call_id: 'ct1', response: 'tool-result' },
      ]);
      const toolMsg = current
        .getState()
        .messages.find((m) => m.kind === 'tool_call' && m.toolCallId === 'ct1');
      expect((toolMsg as { toolOutput?: string }).toolOutput).toBe('tool-result');
      // No reply from the server, status is untouched until the continuation.
      expect(current.getState().status).toBe('awaiting_tool_responses');

      server.push({ method: 'on_message_start', params: { response_id: 'r2' } });
      server.push({ method: 'on_token', params: { token: 'Found it.', response_id: 'r2' } });
      expect(current.getState().status).toBe('streaming');
      server.push({ method: 'on_stop_token', params: { response_id: 'r2' } });
      server.push({ method: 'on_turn_complete', params: {} });
      expect(current.getState().status).toBe('connected');

      current.getState().disconnect();
    });

    it('splits preamble and final text into two bubbles across segments', async () => {
      const { current, server } = await connectAndSend();

      // Segment 1: preamble
      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'Let me check…', response_id: 'r1' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });

      // After a segment ends the turn is still going -> status stays streaming.
      expect(current.getState().status).toBe('streaming');
      expect(current.getState().pendingResponse).toBeNull();

      // Segment 2: final answer
      server.push({ method: 'on_message_start', params: { response_id: 'r2' } });
      server.push({ method: 'on_token', params: { token: 'All done!', response_id: 'r2' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r2' } });

      // Turn finishes.
      server.push({ method: 'on_turn_complete', params: {} });

      const aiMessages = current
        .getState()
        .messages.filter((m) => m.kind === 'text' && m.sender === 'ai');
      expect(aiMessages).toHaveLength(2);
      expect((aiMessages[0] as { content: string }).content).toBe('Let me check…');
      expect((aiMessages[1] as { content: string }).content).toBe('All done!');
      expect(current.getState().status).toBe('connected');
      expect(current.getState().pendingResponse).toBeNull();

      current.getState().disconnect();
    });

    it('merges on_tool_response onto the matching tool_call (no standalone response message)', async () => {
      const { current, server } = await connectAndSend();

      server.push({
        method: 'on_tool_call',
        params: { tool_call_id: 'tc1', tool_name: 'search', tool_input: { q: 'hi' } },
      });

      let toolCalls = current
        .getState()
        .messages.filter((m) => m.kind === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect((toolCalls[0] as { toolOutput?: string }).toolOutput).toBeUndefined();

      server.push({
        method: 'on_tool_response',
        params: { tool_call_id: 'tc1', tool_name: 'search', tool_output: '{"n":1}' },
      });

      toolCalls = current
        .getState()
        .messages.filter((m) => m.kind === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect((toolCalls[0] as { toolOutput?: string }).toolOutput).toBe('{"n":1}');
      // No standalone tool_response message is emitted.
      expect(
        current.getState().messages.some((m) => m.kind === 'tool_response')
      ).toBe(false);

      current.getState().disconnect();
    });

    it('on_error sets status to error and surfaces the message', async () => {
      const onError = vi.fn();
      const { current, server } = await connectAndSend({ onError });

      server.push({ method: 'on_error', params: { message: 'boom' } });

      expect(current.getState().status).toBe('error');
      expect(current.getState().error).toBe('boom');
      expect(onError).toHaveBeenCalled();

      current.getState().disconnect();
    });
  });

  describe('0.7: queued messages', () => {
    async function connectAndSend(opts: Parameters<typeof setupStores>[0] = {}) {
      const setup = setupStores(opts);
      autoRespond(setup.server);
      await setup.current.getState().startNewContext();
      await setup.current.getState().sendMessage('first');
      return setup;
    }

    function humanMessages(current: Setup['current']) {
      return current
        .getState()
        .messages.filter((m) => m.kind === 'text' && m.sender === 'human') as Array<{
        content: string;
        queued?: boolean;
        queuedItemId?: string;
      }>;
    }

    it('on_queued flags the latest un-queued human bubble and keeps waiting', async () => {
      const { current, server } = await connectAndSend();

      // Turn for 'first' is streaming; user sends a second message mid-turn.
      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'Work', response_id: 'r1' } });
      await current.getState().sendMessage('second');

      // Sending mid-turn must not clobber the in-flight partial.
      expect(current.getState().pendingResponse).toEqual({ responseId: 'r1', text: 'Work' });
      expect(current.getState().status).toBe('streaming');

      server.push({ method: 'on_queued', params: { item_id: 'item_2' } });
      const humans = humanMessages(current);
      expect(humans[0]).toMatchObject({ content: 'first' });
      expect(humans[0]?.queued).toBeUndefined();
      expect(humans[1]).toMatchObject({ content: 'second', queued: true, queuedItemId: 'item_2' });
      expect(current.getState().status).toBe('streaming');

      current.getState().disconnect();
    });

    it('a queued message keeps status streaming across on_turn_complete and is cleared by the next on_message_start', async () => {
      const { current, server } = await connectAndSend();

      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'A', response_id: 'r1' } });
      await current.getState().sendMessage('second');
      server.push({ method: 'on_queued', params: { item_id: 'item_2' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });
      server.push({ method: 'on_turn_complete', params: { response_id: 'r1' } });

      // The runner starts the queued turn by itself — stay in waiting mode.
      expect(current.getState().status).toBe('streaming');
      expect(humanMessages(current)[1]?.queued).toBe(true);

      server.push({ method: 'on_message_start', params: { response_id: 'r2' } });
      expect(humanMessages(current)[1]?.queued).toBe(false);
      expect(humanMessages(current)[1]?.queuedItemId).toBe('item_2');
      server.push({ method: 'on_token', params: { token: 'B', response_id: 'r2' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r2' } });
      server.push({ method: 'on_turn_complete', params: { response_id: 'r2' } });
      expect(current.getState().status).toBe('connected');

      current.getState().disconnect();
    });

    it('on_queued for a message sent while idle (another process holds the context) still shows waiting', async () => {
      const { current, server } = await connectAndSend();
      // The very first send is answered with on_queued (api lambda holds the lease).
      server.push({ method: 'on_queued', params: { item_id: 'item_1' } });
      expect(humanMessages(current)[0]).toMatchObject({ content: 'first', queued: true });
      expect(current.getState().status).toBe('streaming');
      current.getState().disconnect();
    });
  });

  describe('0.7: cancel / on_cancelled', () => {
    async function connectAndSend(opts: Parameters<typeof setupStores>[0] = {}) {
      const setup = setupStores(opts);
      autoRespond(setup.server);
      await setup.current.getState().startNewContext();
      await setup.current.getState().sendMessage('hi');
      return setup;
    }

    /** Auto-reply to stop_invocation RPCs with the given result. */
    function answerStop(server: Setup['server'], result: Record<string, unknown>) {
      const orig = server.onSend;
      server.onSend = (raw: string) => {
        orig(raw);
        const msg = JSON.parse(raw) as { method: string; id?: string };
        if (msg.method === 'stop_invocation' && msg.id) {
          server.push({ id: msg.id, result });
        }
      };
    }

    it('cancel() sends stop_invocation with an RPC id and resolves with the reply', async () => {
      const { current, server } = await connectAndSend();
      answerStop(server, { success: true, cancelled: true });

      const p = current.getState().cancel();
      expect(current.getState().cancelling).toBe(true);
      const result = await p;
      expect(result).toEqual({ success: true, cancelled: true });

      const frame = parseFrames(server).find((f) => f.method === 'stop_invocation');
      expect(frame).toBeDefined();
      expect(frame?.id).toBeDefined();
      // Still waiting for the terminal on_cancelled frame.
      expect(current.getState().cancelling).toBe(true);
      expect(current.getState().status).toBe('streaming');

      current.getState().disconnect();
    });

    it('cancel() with nothing running resets cancelling immediately', async () => {
      const { current, server } = await connectAndSend();
      answerStop(server, { success: true, cancelled: false });
      const result = await current.getState().cancel();
      expect(result.cancelled).toBe(false);
      expect(current.getState().cancelling).toBe(false);
      current.getState().disconnect();
    });

    it('cancel() before connecting is a no-op', async () => {
      const { current } = setupStores();
      await current.getState().startNewContext();
      await expect(current.getState().cancel()).resolves.toEqual({ success: false, cancelled: false });
    });

    it('on_cancelled after on_stop_token marks the last segment as cancelled and ends the turn', async () => {
      const { current, server } = await connectAndSend();
      answerStop(server, { success: true, cancelled: true });

      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'Partial', response_id: 'r1' } });
      void current.getState().cancel();
      // Server closes the open segment, then emits the terminal frame.
      server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });
      server.push({ method: 'on_cancelled', params: { response_id: 'r1' } });

      const ai = current
        .getState()
        .messages.filter((m) => m.kind === 'text' && m.sender === 'ai') as Array<{
        content: string;
        cancelled?: boolean;
      }>;
      expect(ai).toHaveLength(1);
      expect(ai[0]).toMatchObject({ content: 'Partial', cancelled: true });
      expect(current.getState().status).toBe('connected');
      expect(current.getState().pendingResponse).toBeNull();
      expect(current.getState().cancelling).toBe(false);

      current.getState().disconnect();
    });

    it('on_cancelled with an open partial commits it as a cancelled bubble', async () => {
      const { current, server } = await connectAndSend();
      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'Half', response_id: 'r1' } });
      server.push({ method: 'on_cancelled', params: { response_id: 'r1' } });

      const last = current.getState().messages[current.getState().messages.length - 1];
      expect(last).toMatchObject({ kind: 'text', sender: 'ai', content: 'Half', cancelled: true });
      expect(current.getState().status).toBe('connected');
      current.getState().disconnect();
    });

    it('on_cancelled before any token leaves no assistant bubble and fills dangling tool calls', async () => {
      const { current, server } = await connectAndSend();
      server.push({
        method: 'on_tool_call',
        params: { tool_call_id: 'tc1', tool_name: 'slow_tool', tool_input: {} },
      });
      server.push({ method: 'on_cancelled', params: { response_id: null } });

      const msgs = current.getState().messages;
      expect(msgs.map((m) => m.kind)).toEqual(['text', 'tool_call']);
      expect(msgs[1]).toMatchObject({ toolCallId: 'tc1', toolOutput: 'cancelled by user' });
      // The human bubble is untouched.
      expect(msgs[0]).toMatchObject({ sender: 'human' });
      expect((msgs[0] as { cancelled?: boolean }).cancelled).toBeUndefined();
      expect(current.getState().status).toBe('connected');
      current.getState().disconnect();
    });

    it('on_cancelled keeps waiting when another message is queued', async () => {
      const { current, server } = await connectAndSend();
      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'A', response_id: 'r1' } });
      await current.getState().sendMessage('second');
      server.push({ method: 'on_queued', params: { item_id: 'i2' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });
      server.push({ method: 'on_cancelled', params: { response_id: 'r1' } });
      expect(current.getState().status).toBe('streaming');
      current.getState().disconnect();
    });
  });

  describe('0.7: sub-agent events', () => {
    async function connectAndAsk() {
      const setup = setupStores();
      autoRespond(setup.server);
      await setup.current.getState().startNewContext();
      await setup.current.getState().sendMessage('ask the child');
      setup.server.push({
        method: 'on_tool_call',
        params: {
          tool_call_id: 's1',
          tool_name: 'send_context_message',
          tool_input: { context_id: 'ctx_child', message: 'summarise', await_response: true },
        },
      });
      setup.server.push({
        method: 'on_tool_response',
        params: {
          tool_call_id: 's1',
          tool_name: 'send_context_message',
          tool_output: 'sent; the reply will arrive as send_context_message_response',
        },
      });
      return setup;
    }

    it('on_subagent_event builds a run keyed by parent_tool_call_id with child tool calls', async () => {
      const { current, server } = await connectAndAsk();
      expect(current.getState().subagentRuns).toEqual({});

      server.push({
        method: 'on_subagent_event',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', event: { type: 'message_start' } },
      });
      expect(current.getState().subagentRuns.s1).toMatchObject({
        parentToolCallId: 's1',
        childContextId: 'ctx_child',
        status: 'running',
        latestEvent: { type: 'message_start' },
        toolCalls: [],
      });

      server.push({
        method: 'on_subagent_event',
        params: {
          parent_tool_call_id: 's1',
          child_context_id: 'ctx_child',
          event: { type: 'tool_call', tool_call_id: 'k1', tool_name: 'search', tool_input: { q: 'x' } },
        },
      });
      expect(current.getState().subagentRuns.s1?.toolCalls).toEqual([
        { toolCallId: 'k1', toolName: 'search', toolInput: { q: 'x' }, state: 'running' },
      ]);

      server.push({
        method: 'on_subagent_event',
        params: {
          parent_tool_call_id: 's1',
          child_context_id: 'ctx_child',
          event: { type: 'tool_response', tool_call_id: 'k1', tool_name: 'search', tool_output: 'found' },
        },
      });
      expect(current.getState().subagentRuns.s1?.toolCalls).toEqual([
        { toolCallId: 'k1', toolName: 'search', toolInput: { q: 'x' }, state: 'complete', toolOutput: 'found' },
      ]);

      server.push({
        method: 'on_subagent_event',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', event: { type: 'turn_complete' } },
      });
      expect(current.getState().subagentRuns.s1?.status).toBe('running');
      expect(current.getState().subagentRuns.s1?.latestEvent).toEqual({ type: 'turn_complete' });

      // The parent turn is still going the whole time.
      expect(current.getState().status).toBe('streaming');
      current.getState().disconnect();
    });

    it('a duplicate child tool_call id is not appended twice', async () => {
      const { current, server } = await connectAndAsk();
      const ev = {
        parent_tool_call_id: 's1',
        child_context_id: 'ctx_child',
        event: { type: 'tool_call', tool_call_id: 'k1', tool_name: 'search' },
      };
      server.push({ method: 'on_subagent_event', params: ev });
      server.push({ method: 'on_subagent_event', params: ev });
      expect(current.getState().subagentRuns.s1?.toolCalls).toHaveLength(1);
      current.getState().disconnect();
    });

    it('a child error event sets status error and keeps the message', async () => {
      const { current, server } = await connectAndAsk();
      server.push({
        method: 'on_subagent_event',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', event: { type: 'error', message: 'child boom' } },
      });
      expect(current.getState().subagentRuns.s1).toMatchObject({ status: 'error', errorMessage: 'child boom' });
      // The parent turn itself is not in error.
      expect(current.getState().status).toBe('streaming');
      expect(current.getState().error).toBeNull();
      current.getState().disconnect();
    });

    it('on_subagent_complete records the terminal status and settles running child tools', async () => {
      const { current, server } = await connectAndAsk();
      server.push({
        method: 'on_subagent_event',
        params: {
          parent_tool_call_id: 's1',
          child_context_id: 'ctx_child',
          event: { type: 'tool_call', tool_call_id: 'k1', tool_name: 'search' },
        },
      });
      server.push({
        method: 'on_subagent_complete',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', status: 'complete' },
      });
      expect(current.getState().subagentRuns.s1).toMatchObject({
        status: 'complete',
        toolCalls: [{ toolCallId: 'k1', state: 'complete' }],
      });

      // A late event never downgrades a terminal status.
      server.push({
        method: 'on_subagent_event',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', event: { type: 'message_start' } },
      });
      expect(current.getState().subagentRuns.s1?.status).toBe('complete');
      current.getState().disconnect();
    });

    it('on_subagent_complete without prior events creates the run', async () => {
      const { current, server } = await connectAndAsk();
      server.push({
        method: 'on_subagent_complete',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', status: 'cancelled' },
      });
      expect(current.getState().subagentRuns.s1).toMatchObject({
        parentToolCallId: 's1',
        childContextId: 'ctx_child',
        status: 'cancelled',
        toolCalls: [],
      });
      current.getState().disconnect();
    });

    it('the reply pair lands as a normal tool call in a later turn and links to the card', async () => {
      const { current, server } = await connectAndAsk();
      server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
      server.push({ method: 'on_token', params: { token: 'Asked.', response_id: 'r1' } });
      server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });
      server.push({ method: 'on_turn_complete', params: { response_id: 'r1' } });
      expect(current.getState().status).toBe('connected');

      // Reply arrives → the runner starts a fresh turn by itself.
      server.push({
        method: 'on_subagent_complete',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', status: 'complete' },
      });
      server.push({
        method: 'on_tool_call',
        params: {
          tool_call_id: 'r1',
          tool_name: 'send_context_message_response',
          tool_input: { original_tool_call_id: 's1' },
        },
      });
      server.push({
        method: 'on_tool_response',
        params: { tool_call_id: 'r1', tool_name: 'send_context_message_response', tool_output: 'The summary.' },
      });

      const { deriveSubagentCard } = await import('../lib/subagents');
      const send = current
        .getState()
        .messages.find((m) => m.kind === 'tool_call' && m.toolCallId === 's1');
      expect(send?.kind).toBe('tool_call');
      const card = deriveSubagentCard(
        send as Extract<typeof send, { kind: 'tool_call' }>,
        current.getState().messages,
        current.getState().subagentRuns
      );
      expect(card).toMatchObject({
        kind: 'awaiting',
        status: 'complete',
        replyText: 'The summary.',
        replyToolCallId: 'r1',
        contextId: 'ctx_child',
      });
      current.getState().disconnect();
    });

    it('hydration from history produces the same card and resets live runs', async () => {
      const { current, server } = await connectAndAsk();
      server.push({
        method: 'on_subagent_event',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', event: { type: 'message_start' } },
      });
      expect(Object.keys(current.getState().subagentRuns)).toEqual(['s1']);

      current.getState().hydrateMessages([
        { sender: 'human', message: 'ask the child' },
        {
          type: 'tool_call',
          tool_call_id: 's1',
          tool_name: 'send_context_message',
          tool_input: { context_id: 'ctx_child', message: 'summarise', await_response: true },
        },
        { type: 'tool_response', tool_call_id: 's1', tool_name: 'send_context_message', tool_output: 'sent' },
        { sender: 'ai', message: 'Asked.' },
        {
          type: 'tool_call',
          tool_call_id: 'r1',
          tool_name: 'send_context_message_response',
          tool_input: { original_tool_call_id: 's1' },
        },
        {
          type: 'tool_response',
          tool_call_id: 'r1',
          tool_name: 'send_context_message_response',
          tool_output: 'The summary.',
        },
        { sender: 'ai', message: 'The child says: The summary.' },
      ]);
      expect(current.getState().subagentRuns).toEqual({});

      const { deriveSubagentCards, linkedSubagentReplyIds } = await import('../lib/subagents');
      const cards = deriveSubagentCards(current.getState().messages);
      expect(cards.s1).toMatchObject({ kind: 'awaiting', status: 'complete', replyText: 'The summary.' });
      expect([...linkedSubagentReplyIds(current.getState().messages)]).toEqual(['r1']);
      current.getState().disconnect();
    });

    it('clear() and startNewContext() drop sub-agent runs', async () => {
      const { current, server } = await connectAndAsk();
      server.push({
        method: 'on_subagent_complete',
        params: { parent_tool_call_id: 's1', child_context_id: 'ctx_child', status: 'complete' },
      });
      expect(Object.keys(current.getState().subagentRuns)).toHaveLength(1);
      await current.getState().startNewContext();
      expect(current.getState().subagentRuns).toEqual({});
    });
  });
});
