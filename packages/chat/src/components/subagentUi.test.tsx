import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';
import { AjentifyContext } from '../provider/context';
import { createStores } from '../stores/createStores';
import { createMockServer, MockWebSocket, setActiveMockServer } from '../ws/MockWebSocket';
import { ChatInput } from './ChatInput';
import { ChatMessages } from './ChatMessages';
import { Message } from './Message';
import { SubagentCard } from './SubagentCard';
import type { SubagentCard as SubagentCardModel } from '../types';

function makeStores() {
  const server = createMockServer();
  const orig = server.onSend;
  server.onSend = (raw: string) => {
    orig(raw);
    const msg = JSON.parse(raw) as { method: string; id?: string };
    if (msg.method === 'connect_to_context' && msg.id) {
      server.push({ id: msg.id, result: { success: true, agent: { agent_id: 'a1', agent_name: 'Bot' } } });
    }
    if (msg.method === 'stop_invocation' && msg.id) {
      server.push({ id: msg.id, result: { success: true, cancelled: true } });
    }
  };
  const stores = createStores({
    onAjentifyProxyRequest: (req) => {
      if (req.type === 'create_context') return { context_id: 'ctx_new', agent_id: 'a1', client_api_key: 'k' };
      if (req.type === 'generate_access_token') return { token: 't' };
      return {};
    },
    storage: null,
    WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    reconnect: { maxAttempts: 0 },
  });
  return { stores, server };
}

function Wrap({ stores, children }: { stores: ReturnType<typeof makeStores>['stores']; children: React.ReactNode }) {
  return (
    <AjentifyContext.Provider value={{ stores, config: { onAjentifyProxyRequest: () => ({}) } }}>
      {children}
    </AjentifyContext.Provider>
  );
}

afterEach(() => {
  cleanup();
  setActiveMockServer(null);
});

describe('ChatInput cancel button', () => {
  it('shows a stop button only while streaming and wires it to stop_invocation', async () => {
    const { stores, server } = makeStores();
    render(
      <Wrap stores={stores}>
        <ChatInput />
      </Wrap>
    );
    expect(screen.queryByLabelText('Stop generating')).toBeNull();

    await stores.currentContext.getState().startNewContext();
    await stores.currentContext.getState().sendMessage('hi');
    expect(stores.currentContext.getState().status).toBe('streaming');
    const stop = await screen.findByLabelText('Stop generating');
    // With an empty composer the stop button replaces send.
    expect(screen.queryByLabelText('Send')).toBeNull();

    fireEvent.click(stop);
    await vi.waitFor(() => {
      const frames = server.sent.map((r) => JSON.parse(r) as { method: string; id?: string });
      expect(frames.find((f) => f.method === 'stop_invocation')?.id).toBeDefined();
    });

    server.push({ method: 'on_cancelled', params: { response_id: null } });
    await vi.waitFor(() => expect(screen.queryByLabelText('Stop generating')).toBeNull());
    expect(screen.getByLabelText('Send')).toBeTruthy();
    stores.currentContext.getState().disconnect();
  });

  it('can be hidden with showCancelButton={false}', async () => {
    const { stores } = makeStores();
    render(
      <Wrap stores={stores}>
        <ChatInput showCancelButton={false} />
      </Wrap>
    );
    await stores.currentContext.getState().startNewContext();
    await stores.currentContext.getState().sendMessage('hi');
    expect(screen.queryByLabelText('Stop generating')).toBeNull();
    stores.currentContext.getState().disconnect();
  });
});

describe('Message markers', () => {
  it('renders a queued marker on a queued human bubble', () => {
    render(
      <Message
        message={{ kind: 'text', localId: '1', sender: 'human', content: 'later', queued: true, createdAt: 0 }}
      />
    );
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(document.querySelector('.aj-message-bubble--queued')).toBeTruthy();
  });

  it('renders a stopped marker on a cancelled AI bubble', () => {
    render(
      <Message
        message={{ kind: 'text', localId: '1', sender: 'ai', content: 'partial', cancelled: true, createdAt: 0 }}
        animate={false}
      />
    );
    expect(screen.getByText('Stopped')).toBeTruthy();
    expect(document.querySelector('.aj-message-bubble--cancelled')).toBeTruthy();
  });
});

describe('SubagentCard', () => {
  const base: SubagentCardModel = {
    kind: 'awaiting',
    status: 'awaiting',
    toolCallId: 's1',
    contextId: 'ctx_child_1234567890',
    message: 'summarise this',
    ack: 'sent',
  };

  it('shows a processing state with the current child tool while awaiting', () => {
    render(<SubagentCard card={{ ...base, currentToolName: 'search' }} />);
    expect(screen.getByText('Waiting for sub-agent')).toBeTruthy();
    expect(screen.getByText('search')).toBeTruthy();
    expect(document.querySelector('.aj-subagent--awaiting .aj-spin')).toBeTruthy();
  });

  it('shows the reply text once it lands', () => {
    render(<SubagentCard card={{ ...base, status: 'complete', replyText: 'The summary.' }} />);
    expect(screen.getByText('Sub-agent replied')).toBeTruthy();
    expect(screen.getByText('The summary.')).toBeTruthy();
    expect(document.querySelector('.aj-spin')).toBeNull();
  });

  it('shows the error state', () => {
    render(<SubagentCard card={{ ...base, status: 'error', errorMessage: 'child failed' }} />);
    expect(screen.getByText('Sub-agent failed')).toBeTruthy();
    expect(screen.getByText('child failed')).toBeTruthy();
  });

  it('renders chips for non-await sends and created contexts', () => {
    render(
      <>
        <SubagentCard card={{ kind: 'sent', status: 'complete', toolCallId: 'a', contextId: 'ctx_a' }} />
        <SubagentCard card={{ kind: 'created', status: 'complete', toolCallId: 'b', contextId: 'ctx_b' }} />
      </>
    );
    expect(screen.getByText('Sent to sub-agent')).toBeTruthy();
    expect(screen.getByText('Created sub-agent context')).toBeTruthy();
    expect(document.querySelectorAll('.aj-subagent-chip')).toHaveLength(2);
  });
});

describe('ChatMessages sub-agent integration', () => {
  it('renders the card for an awaited send and hides the linked _response tool call', async () => {
    const { stores } = makeStores();
    await stores.currentContext.getState().startNewContext();
    stores.currentContext.getState().hydrateMessages([
      { sender: 'human', message: 'ask' },
      {
        type: 'tool_call',
        tool_call_id: 's1',
        tool_name: 'send_context_message',
        tool_input: { context_id: 'ctx_child', message: 'summarise', await_response: true },
      },
      { type: 'tool_response', tool_call_id: 's1', tool_name: 'send_context_message', tool_output: 'sent' },
      {
        type: 'tool_call',
        tool_call_id: 'r1',
        tool_name: 'send_context_message_response',
        tool_input: { original_tool_call_id: 's1' },
      },
      { type: 'tool_response', tool_call_id: 'r1', tool_name: 'send_context_message_response', tool_output: 'The summary.' },
      { type: 'tool_call', tool_call_id: 'x', tool_name: 'search', tool_input: {} },
      { type: 'tool_response', tool_call_id: 'x', tool_name: 'search', tool_output: 'ok' },
    ]);
    stores.currentContext.setState({ status: 'connected', contextId: 'ctx_x', isDraft: false });

    render(
      <Wrap stores={stores}>
        <ChatMessages noAnimation />
      </Wrap>
    );
    expect(screen.getByText('Sub-agent replied')).toBeTruthy();
    expect(screen.getByText('The summary.')).toBeTruthy();
    // Only the plain `search` call renders as a generic tool row.
    expect(document.querySelectorAll('.aj-tool-call')).toHaveLength(1);
    expect(screen.queryByText('send_context_message_response')).toBeNull();
  });
});
