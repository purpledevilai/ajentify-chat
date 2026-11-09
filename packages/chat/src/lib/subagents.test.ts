import { describe, expect, it } from 'vitest';
import {
  deriveSubagentCard,
  deriveSubagentCards,
  findSubagentReply,
  isSubagentReplyToolCall,
  isSubagentToolCall,
  linkedSubagentReplyIds,
} from './subagents';
import { CANCELLED_TOOL_OUTPUT, type ChatMessage, type SubagentRun, type ToolCallMessage } from '../types';

function tc(
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput?: string
): ToolCallMessage {
  return {
    kind: 'tool_call',
    localId: `l-${toolCallId}`,
    toolCallId,
    toolName,
    toolInput,
    toolOutput,
    createdAt: 0,
  };
}

const text = (sender: 'human' | 'ai', content: string): ChatMessage => ({
  kind: 'text',
  localId: `t-${content}`,
  sender,
  content,
  createdAt: 0,
});

describe('deriveSubagentCard', () => {
  it('returns null for unrelated tool calls', () => {
    const m = tc('x', 'search', { q: 1 }, 'ok');
    expect(deriveSubagentCard(m, [m])).toBeNull();
    expect(isSubagentToolCall(m)).toBe(false);
  });

  it('create_context → created chip with the new context id from the output', () => {
    const running = tc('c1', 'create_context', { agent_id: 'a1' });
    expect(deriveSubagentCard(running, [running])).toMatchObject({
      kind: 'created',
      status: 'awaiting',
      toolCallId: 'c1',
      contextId: undefined,
    });
    const done = tc('c1', 'create_context', { agent_id: 'a1' }, '{"context_id": "ctx_child"}');
    expect(deriveSubagentCard(done, [done])).toMatchObject({
      kind: 'created',
      status: 'complete',
      contextId: 'ctx_child',
      ack: '{"context_id": "ctx_child"}',
    });
  });

  it('send_context_message without await → sent chip', () => {
    const pending = tc('s1', 'send_context_message', {
      context_id: 'ctx_child',
      message: 'go',
      await_response: false,
    });
    expect(deriveSubagentCard(pending, [pending])).toMatchObject({
      kind: 'sent',
      status: 'awaiting',
      contextId: 'ctx_child',
      message: 'go',
    });
    const acked = { ...pending, toolOutput: 'sent to ctx_child' };
    expect(deriveSubagentCard(acked, [acked])).toMatchObject({
      kind: 'sent',
      status: 'complete',
      ack: 'sent to ctx_child',
    });
  });

  it('send_context_message with await is "awaiting" after its ack until the reply lands', () => {
    const send = tc(
      's1',
      'send_context_message',
      { context_id: 'ctx_child', message: 'summarise', await_response: true },
      'sent; the reply will arrive as send_context_message_response'
    );
    const before = deriveSubagentCard(send, [send]);
    expect(before).toMatchObject({
      kind: 'awaiting',
      status: 'awaiting',
      contextId: 'ctx_child',
      message: 'summarise',
      replyText: undefined,
    });

    // The pair may arrive in a later turn, after more messages.
    const reply = tc(
      'r1',
      'send_context_message_response',
      { original_tool_call_id: 's1' },
      'Here is the summary.'
    );
    const messages: ChatMessage[] = [send, text('ai', 'Asked the child.'), text('human', 'ok'), reply];
    const after = deriveSubagentCard(send, messages);
    expect(after).toMatchObject({
      kind: 'awaiting',
      status: 'complete',
      replyText: 'Here is the summary.',
      replyToolCallId: 'r1',
    });
    expect(findSubagentReply(messages, 's1')?.toolCallId).toBe('r1');
    expect(isSubagentReplyToolCall(reply)).toBe(true);
  });

  it('ignores a _response call that answers a different send', () => {
    const send = tc('s1', 'send_context_message', { await_response: true }, 'sent');
    const other = tc('r9', 'send_context_message_response', { original_tool_call_id: 'zzz' }, 'nope');
    expect(deriveSubagentCard(send, [send, other])?.status).toBe('awaiting');
  });

  it('attaches live run progress and the current child tool name', () => {
    const send = tc('s1', 'send_context_message', { context_id: 'ctx_child', await_response: true }, 'sent');
    const run: SubagentRun = {
      parentToolCallId: 's1',
      childContextId: 'ctx_child_real',
      status: 'running',
      latestEvent: { type: 'tool_call', tool_call_id: 'k2', tool_name: 'fetch_page' },
      toolCalls: [
        { toolCallId: 'k1', toolName: 'search', state: 'complete', toolOutput: 'ok' },
        { toolCallId: 'k2', toolName: 'fetch_page', state: 'running' },
      ],
    };
    const card = deriveSubagentCard(send, [send], { s1: run });
    expect(card).toMatchObject({
      status: 'awaiting',
      contextId: 'ctx_child_real',
      currentToolName: 'fetch_page',
    });
    expect(card?.run).toBe(run);

    // All children complete → falls back to the latest one.
    const settled = { ...run, toolCalls: run.toolCalls.map((t) => ({ ...t, state: 'complete' as const })) };
    expect(deriveSubagentCard(send, [send], { s1: settled })?.currentToolName).toBe('fetch_page');
  });

  it('on_subagent_complete ends the awaiting state even without a reply pair', () => {
    const send = tc('s1', 'send_context_message', { await_response: true }, 'sent');
    const base: SubagentRun = { parentToolCallId: 's1', childContextId: 'c', status: 'running', toolCalls: [] };
    expect(deriveSubagentCard(send, [send], { s1: { ...base, status: 'complete' } })).toMatchObject({
      status: 'complete',
      replyText: undefined,
    });
    expect(deriveSubagentCard(send, [send], { s1: { ...base, status: 'cancelled' } })?.status).toBe(
      'cancelled'
    );
    expect(
      deriveSubagentCard(send, [send], {
        s1: { ...base, status: 'error', errorMessage: 'child blew up' },
      })
    ).toMatchObject({ status: 'error', errorMessage: 'child blew up' });
  });

  it('a child error event flips the card to error before on_subagent_complete', () => {
    const send = tc('s1', 'send_context_message', { await_response: true }, 'sent');
    const run: SubagentRun = {
      parentToolCallId: 's1',
      childContextId: 'c',
      status: 'running',
      latestEvent: { type: 'error', message: 'rate limited' },
      toolCalls: [],
    };
    expect(deriveSubagentCard(send, [send], { s1: run })).toMatchObject({
      status: 'error',
      errorMessage: 'rate limited',
    });
  });

  it('a reply that landed wins over a stale run status', () => {
    const send = tc('s1', 'send_context_message', { await_response: true }, 'sent');
    const reply = tc('r1', 'send_context_message_response', { original_tool_call_id: 's1' }, 'done');
    const run: SubagentRun = { parentToolCallId: 's1', childContextId: 'c', status: 'error', toolCalls: [] };
    expect(deriveSubagentCard(send, [send, reply], { s1: run })).toMatchObject({
      status: 'complete',
      replyText: 'done',
    });
  });

  it('marks cards cancelled when the parent turn was stopped mid-call', () => {
    const send = tc('s1', 'send_context_message', { await_response: true }, CANCELLED_TOOL_OUTPUT);
    expect(deriveSubagentCard(send, [send])?.status).toBe('cancelled');
    const chip = tc('s2', 'send_context_message', { await_response: false }, CANCELLED_TOOL_OUTPUT);
    expect(deriveSubagentCard(chip, [chip])?.status).toBe('cancelled');
    const created = tc('c1', 'create_context', {}, CANCELLED_TOOL_OUTPUT);
    expect(deriveSubagentCard(created, [created])?.status).toBe('cancelled');
  });

  it('deriveSubagentCards + linkedSubagentReplyIds cover a whole history', () => {
    const messages: ChatMessage[] = [
      text('human', 'do it'),
      tc('c1', 'create_context', { agent_id: 'a' }, '{"context_id":"ctx_child"}'),
      tc('s1', 'send_context_message', { context_id: 'ctx_child', message: 'hi', await_response: true }, 'sent'),
      tc('s2', 'send_context_message', { context_id: 'ctx_child', message: 'fyi', await_response: false }, 'sent'),
      text('ai', 'Waiting on the child.'),
      tc('r1', 'send_context_message_response', { original_tool_call_id: 's1' }, 'child says hi'),
      tc('orphan', 'send_context_message_response', { original_tool_call_id: 'missing' }, '?'),
      text('ai', 'The child said hi.'),
    ];
    const cards = deriveSubagentCards(messages);
    expect(Object.keys(cards).sort()).toEqual(['c1', 's1', 's2']);
    expect(cards.c1?.kind).toBe('created');
    expect(cards.s1).toMatchObject({ kind: 'awaiting', status: 'complete', replyText: 'child says hi' });
    expect(cards.s2).toMatchObject({ kind: 'sent', status: 'complete' });
    // Only the linked reply is hidden; the orphan stays visible.
    expect([...linkedSubagentReplyIds(messages)]).toEqual(['r1']);
  });
});
