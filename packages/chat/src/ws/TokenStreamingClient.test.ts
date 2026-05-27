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
    expect(agentEvents).toHaveLength(1);

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
