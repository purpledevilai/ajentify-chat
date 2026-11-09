import {
  CANCELLED_TOOL_OUTPUT,
  CREATE_CONTEXT_TOOL,
  SEND_CONTEXT_MESSAGE_RESPONSE_TOOL,
  SEND_CONTEXT_MESSAGE_TOOL,
  type ChatMessage,
  type SubagentCard,
  type SubagentRun,
  type ToolCallMessage,
} from '../types';

/**
 * True for the tool calls the sub-agent UI renders as cards/chips instead of
 * the generic expandable tool row (`create_context`, `send_context_message`).
 */
export function isSubagentToolCall(message: ChatMessage): message is ToolCallMessage {
  return (
    message.kind === 'tool_call' &&
    (message.toolName === SEND_CONTEXT_MESSAGE_TOOL ||
      message.toolName === CREATE_CONTEXT_TOOL)
  );
}

/**
 * True for the synthetic `send_context_message_response` tool call the server
 * appends when an awaited reply lands. It is folded onto the originating
 * card and should not be rendered on its own.
 */
export function isSubagentReplyToolCall(message: ChatMessage): message is ToolCallMessage {
  return (
    message.kind === 'tool_call' &&
    message.toolName === SEND_CONTEXT_MESSAGE_RESPONSE_TOOL
  );
}

/** The `send_context_message` id a `_response` call answers, if any. */
export function replyOriginalToolCallId(message: ToolCallMessage): string | undefined {
  const raw = message.toolInput?.original_tool_call_id;
  return typeof raw === 'string' && raw ? raw : undefined;
}

/**
 * Find the `send_context_message_response` call that answers
 * `originalToolCallId` (the reply pair may arrive in a later turn).
 */
export function findSubagentReply(
  messages: ChatMessage[],
  originalToolCallId: string
): ToolCallMessage | undefined {
  for (const m of messages) {
    if (isSubagentReplyToolCall(m) && replyOriginalToolCallId(m) === originalToolCallId) {
      return m;
    }
  }
  return undefined;
}

function parseContextIdFromOutput(output: string | undefined): string | undefined {
  if (!output) return undefined;
  try {
    const parsed = JSON.parse(output) as unknown;
    if (parsed && typeof parsed === 'object') {
      const id = (parsed as { context_id?: unknown }).context_id;
      if (typeof id === 'string' && id) return id;
    }
  } catch {
    // not JSON — fall through
  }
  return undefined;
}

function currentToolNameOf(run: SubagentRun | undefined): string | undefined {
  if (!run) return undefined;
  for (let i = run.toolCalls.length - 1; i >= 0; i -= 1) {
    const t = run.toolCalls[i];
    if (t && t.state === 'running') return t.toolName;
  }
  const last = run.toolCalls[run.toolCalls.length - 1];
  if (last) return last.toolName;
  const ev = run.latestEvent;
  if (ev && (ev.type === 'tool_call' || ev.type === 'tool_response')) return ev.tool_name;
  return undefined;
}

/**
 * Derive the sub-agent card for a tool call. Returns `null` for tool calls
 * that are not sub-agent related, so callers can fall back to the generic
 * tool row.
 *
 * Rules (mirroring the server's tool semantics):
 *
 * - `create_context` → `created` chip; `contextId` parsed from the
 *   `{"context_id": …}` tool output. `awaiting` until the output lands.
 * - `send_context_message` with `await_response: false` → `sent` chip;
 *   `awaiting` until the acknowledgement lands, then `complete`.
 * - `send_context_message` with `await_response: true` → `awaiting` card.
 *   It stays `awaiting` from its acknowledgement until **either** a
 *   `send_context_message_response` call whose `original_tool_call_id`
 *   matches appears in `messages` (its output becomes `replyText`) **or**
 *   `on_subagent_complete` was recorded in `runs` for this id. Live progress
 *   (`run`, `currentToolName`) is attached when the server relayed any.
 *
 * The function is pure and works on hydrated history (no `runs`) exactly as
 * on a live stream.
 */
export function deriveSubagentCard(
  message: ToolCallMessage,
  messages: ChatMessage[],
  runs: Record<string, SubagentRun> = {}
): SubagentCard | null {
  const input = message.toolInput ?? {};
  const ack = message.toolOutput;
  const cancelledByUser = ack === CANCELLED_TOOL_OUTPUT;

  if (message.toolName === CREATE_CONTEXT_TOOL) {
    return {
      kind: 'created',
      status: cancelledByUser ? 'cancelled' : ack == null ? 'awaiting' : 'complete',
      toolCallId: message.toolCallId,
      contextId: parseContextIdFromOutput(ack),
      ack,
    };
  }

  if (message.toolName !== SEND_CONTEXT_MESSAGE_TOOL) return null;

  const contextId =
    typeof input.context_id === 'string' ? (input.context_id as string) : undefined;
  const text = typeof input.message === 'string' ? (input.message as string) : undefined;
  const awaitResponse = input.await_response === true || input.await_response === 'true';

  if (!awaitResponse) {
    return {
      kind: 'sent',
      status: cancelledByUser ? 'cancelled' : ack == null ? 'awaiting' : 'complete',
      toolCallId: message.toolCallId,
      contextId,
      message: text,
      ack,
    };
  }

  const run = runs[message.toolCallId];
  const reply = findSubagentReply(messages, message.toolCallId);
  const replyText = reply?.toolOutput;

  let status: SubagentCard['status'] = 'awaiting';
  let errorMessage: string | undefined;
  if (reply && replyText != null) {
    status = 'complete';
  } else if (run && run.status !== 'running') {
    status = run.status;
    errorMessage = run.errorMessage;
  } else if (run?.latestEvent?.type === 'error') {
    status = 'error';
    errorMessage = run.errorMessage ?? run.latestEvent.message;
  } else if (cancelledByUser) {
    // The parent turn was stopped before the child replied. The child keeps
    // running server-side (its reply may still land later), so only flag
    // the card — a later `_response` pair flips it back to `complete`.
    status = 'cancelled';
  }

  return {
    kind: 'awaiting',
    status,
    toolCallId: message.toolCallId,
    contextId: run?.childContextId ?? contextId,
    message: text,
    ack,
    replyText,
    replyToolCallId: reply?.toolCallId,
    run,
    currentToolName: currentToolNameOf(run),
    errorMessage,
  };
}

/**
 * Derive every sub-agent card in a message list, keyed by the parent tool
 * call id. Convenience for list renderers / headless consumers.
 */
export function deriveSubagentCards(
  messages: ChatMessage[],
  runs: Record<string, SubagentRun> = {}
): Record<string, SubagentCard> {
  const out: Record<string, SubagentCard> = {};
  for (const m of messages) {
    if (!isSubagentToolCall(m)) continue;
    const card = deriveSubagentCard(m, messages, runs);
    if (card) out[card.toolCallId] = card;
  }
  return out;
}

/**
 * Ids of `send_context_message_response` calls that have been folded onto a
 * card (their originating call is present in `messages`). Renderers hide
 * these; an orphan reply (no matching original) is left visible so nothing
 * silently disappears.
 */
export function linkedSubagentReplyIds(messages: ChatMessage[]): Set<string> {
  const originals = new Set<string>();
  for (const m of messages) {
    if (m.kind === 'tool_call' && m.toolName === SEND_CONTEXT_MESSAGE_TOOL) {
      originals.add(m.toolCallId);
    }
  }
  const linked = new Set<string>();
  for (const m of messages) {
    if (!isSubagentReplyToolCall(m)) continue;
    const original = replyOriginalToolCallId(m);
    if (original && originals.has(original)) linked.add(m.toolCallId);
  }
  return linked;
}
