import { describe, expect, it, vi } from 'vitest';
import { TokenStreamingClient } from './TokenStreamingClient';
import { createMockServer, MockWebSocket } from './MockWebSocket';

function findRequest(sent: string[], method: string) {
  for (const raw of sent) {
    const msg = JSON.parse(raw) as { method: string; id?: string; params: unknown };
    if (msg.method === method) return msg;
  }
  return undefined;
}

describe('TokenStreamingClient', () => {
  it('connects, calls connect_to_context with the access token, and emits agent_connected', async () => {
    const server = createMockServer();
    const tokenSpy = vi.fn().mockResolvedValue('test-token-123');

    const client = new TokenStreamingClient({
      url: 'ws://test',
      contextId: 'ctx_abc',
      getAccessToken: tokenSpy,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
    });

    const agentEvents: unknown[] = [];
    client.on('agent_connected', (payload) => agentEvents.push(payload));

    // Auto-respond to the connect_to_context request.
    const origOnSend = server.onSend;
    server.onSend = (raw: string) => {
      origOnSend(raw);
      const msg = JSON.parse(raw) as { method: string; id?: string; params: { access_token?: string } };
      if (msg.method === 'connect_to_context' && msg.id) {
        server.push({
          id: msg.id,
          result: {
            success: true,
            agent_speaks_first: false,
            agent: { agent_id: 'a1', agent_name: 'Bot' },
          },
        });
      }
    };

    const agent = await client.connect();
    expect(agent).toMatchObject({ agent_id: 'a1', agent_name: 'Bot' });
    expect(tokenSpy).toHaveBeenCalledTimes(1);

    const connectReq = findRequest(server.sent, 'connect_to_context');
    expect(connectReq).toBeDefined();
    expect((connectReq?.params as Record<string, unknown>).access_token).toBe('test-token-123');
    expect((connectReq?.params as Record<string, unknown>).context_id).toBe('ctx_abc');
    // Always on: the server ignores it once mainlined, selects the right
    // handler on servers that still gate on it.
    expect((connectReq?.params as Record<string, unknown>).beta).toBe(true);
    expect(agentEvents).toHaveLength(1);

    client.disconnect();
  });

  it('sends addMessage / sendClientSideToolResponses fire-and-forget (no id, no reply needed)', async () => {
    const server = createMockServer();
    const client = new TokenStreamingClient({
      url: 'ws://test',
      contextId: 'ctx_abc',
      getAccessToken: async () => 'tok',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
      requestTimeoutMs: 10,
    });
    const origOnSend = server.onSend;
    server.onSend = (raw: string) => {
      origOnSend(raw);
      const msg = JSON.parse(raw) as { method: string; id?: string };
      if (msg.method === 'connect_to_context' && msg.id) {
        server.push({ id: msg.id, result: { success: true, agent: {} } });
      }
    };
    await client.connect();

    // Neither call gets a server reply; both must resolve immediately and
    // never trip the (deliberately tiny) request timeout.
    await client.addMessage('hello');
    await client.sendClientSideToolResponses([{ tool_call_id: 'tc1', response: 'ok' }]);
    await new Promise((r) => setTimeout(r, 30));

    const add = findRequest(server.sent, 'add_message');
    expect(add).toBeDefined();
    expect(add?.id).toBeUndefined();
    expect(add?.params).toEqual({ message: 'hello' });

    const resp = findRequest(server.sent, 'client_side_tool_responses');
    expect(resp).toBeDefined();
    expect(resp?.id).toBeUndefined();
    expect(resp?.params).toEqual({ tool_responses: [{ tool_call_id: 'tc1', response: 'ok' }] });

    client.disconnect();
  });

  it('accepts and ignores the deprecated beta option', async () => {
    const server = createMockServer();
    const client = new TokenStreamingClient({
      url: 'ws://test',
      contextId: 'ctx_abc',
      getAccessToken: async () => 'tok',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
      beta: false,
    });
    const origOnSend = server.onSend;
    server.onSend = (raw: string) => {
      origOnSend(raw);
      const msg = JSON.parse(raw) as { method: string; id?: string };
      if (msg.method === 'connect_to_context' && msg.id) {
        server.push({ id: msg.id, result: { success: true, agent: {} } });
      }
    };
    await client.connect();
    await client.addMessage('hi');

    expect((findRequest(server.sent, 'connect_to_context')?.params as Record<string, unknown>).beta).toBe(true);
    expect(findRequest(server.sent, 'add_message')?.id).toBeUndefined();

    client.disconnect();
  });

  it('emits on_message_start / on_turn_complete / on_error notifications', async () => {
    const server = createMockServer();
    const client = new TokenStreamingClient({
      url: 'ws://test',
      contextId: 'ctx_abc',
      getAccessToken: async () => 'tok',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
    });
    const origOnSend = server.onSend;
    server.onSend = (raw: string) => {
      origOnSend(raw);
      const msg = JSON.parse(raw) as { method: string; id?: string };
      if (msg.method === 'connect_to_context' && msg.id) {
        server.push({ id: msg.id, result: { success: true, agent: {} } });
      }
    };
    const seen: Array<[string, unknown]> = [];
    client.on('on_message_start', (p) => seen.push(['on_message_start', p]));
    client.on('on_turn_complete', (p) => seen.push(['on_turn_complete', p]));
    client.on('on_error', (p) => seen.push(['on_error', p]));

    await client.connect();
    server.push({ method: 'on_message_start', params: { response_id: 'r1' } });
    server.push({ method: 'on_turn_complete', params: { response_id: 'r1' } });
    server.push({ method: 'on_error', params: { message: 'boom' } });

    expect(seen).toEqual([
      ['on_message_start', { response_id: 'r1' }],
      ['on_turn_complete', { response_id: 'r1' }],
      ['on_error', { message: 'boom' }],
    ]);

    client.disconnect();
  });

  it('streams tokens via on_token / on_stop_token', async () => {
    const server = createMockServer();
    const client = new TokenStreamingClient({
      url: 'ws://test',
      contextId: 'ctx_abc',
      getAccessToken: async () => 'tok',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
    });

    const tokens: string[] = [];
    let stopped = false;
    client.on('on_token', ({ token }) => tokens.push(token));
    client.on('on_stop_token', () => {
      stopped = true;
    });

    server.onSend = (raw: string) => {
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

    await client.connect();
    server.push({ method: 'on_token', params: { token: 'Hello', response_id: 'r1' } });
    server.push({ method: 'on_token', params: { token: ' world', response_id: 'r1' } });
    server.push({ method: 'on_stop_token', params: { response_id: 'r1' } });

    expect(tokens.join('')).toBe('Hello world');
    expect(stopped).toBe(true);

    client.disconnect();
  });

  it('surfaces RPC errors from the server', async () => {
    const server = createMockServer();
    const client = new TokenStreamingClient({
      url: 'ws://test',
      contextId: 'ctx_abc',
      getAccessToken: async () => 'tok',
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      autoReconnect: false,
    });

    server.onSend = (raw: string) => {
      const msg = JSON.parse(raw) as { method: string; id?: string };
      if (msg.method === 'connect_to_context' && msg.id) {
        server.push({ id: msg.id, result: { error: 'nope' } });
      }
    };

    await expect(client.connect()).rejects.toThrow(/nope/);
    client.disconnect();
  });
});
