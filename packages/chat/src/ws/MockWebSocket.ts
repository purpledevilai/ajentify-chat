/**
 * A tiny in-memory WebSocket pair used by the tests. The `MockWebSocket`
 * has the shape `TokenStreamingClient` expects, and a paired `MockServer`
 * lets you assert outgoing frames and push incoming ones.
 */

type Listener = (...args: unknown[]) => void;

export interface MockWebSocketServer {
  /** Called on every JSON frame the client sends. */
  onSend: (raw: string) => void;
  /** Push a JSON-RPC notification or response from server -> client. */
  push: (payload: Record<string, unknown>) => void;
  /** Force-close the connection. */
  close: (code?: number, reason?: string, wasClean?: boolean) => void;
  /** The currently-connected client, if any. */
  client: MockWebSocket | null;
}

let activeServer: MockWebSocketServer | null = null;

export function setActiveMockServer(server: MockWebSocketServer | null): void {
  activeServer = server;
}

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  url: string;
  onopen: Listener | null = null;
  onclose: Listener | null = null;
  onmessage: Listener | null = null;
  onerror: Listener | null = null;

  constructor(url: string) {
    this.url = url;
    if (!activeServer) {
      throw new Error('No active mock server; call createMockServer() first.');
    }
    const server = activeServer;
    server.client = this;
    server.push = (payload) => {
      if (this.readyState !== MockWebSocket.OPEN) return;
      this.onmessage?.({ data: JSON.stringify(payload) });
    };
    server.close = (code = 1000, reason = '', wasClean = true) => {
      if (this.readyState === MockWebSocket.CLOSED) return;
      this.readyState = MockWebSocket.CLOSED;
      // Browsers schedule `onclose` asynchronously, so simulate that here.
      // Tests that need to assert on the close event should `await` a flush.
      queueMicrotask(() => {
        this.onclose?.({ code, reason, wasClean });
      });
    };
    queueMicrotask(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.({});
    });
  }

  send(data: string): void {
    activeServer?.onSend(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    // Browsers schedule `onclose` asynchronously after `ws.close()` returns,
    // so simulate that here. Without this the ordering bug where a stale
    // `wsClient`'s onclose clobbers freshly-set state can't be reproduced.
    queueMicrotask(() => {
      this.onclose?.({ code, reason, wasClean: true });
    });
  }
}

export function createMockServer(): MockWebSocketServer & {
  sent: string[];
  WebSocketImpl: typeof MockWebSocket;
} {
  const sent: string[] = [];
  const server: MockWebSocketServer = {
    client: null,
    onSend: (raw: string) => sent.push(raw),
    push: () => {
      throw new Error('client not connected yet');
    },
    close: () => {
      throw new Error('client not connected yet');
    },
  };
  setActiveMockServer(server);
  return Object.assign(server, { sent, WebSocketImpl: MockWebSocket });
}
