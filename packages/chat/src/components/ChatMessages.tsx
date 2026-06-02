'use client';

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { uid } from '../lib/utils';
import { cn } from '../lib/utils';
import { Message, type MessageClassNames } from './Message';

export interface ChatMessagesClassNames {
  root?: string;
  inner?: string;
  empty?: string;
  /** The AI-styled placeholder bubble shown while waiting for the first token. */
  waitingBubble?: string;
  /** Wrapper around the new-chat (draft) greeting view. */
  newChat?: string;
  /** The default greeting headline rendered when `newChatView` is a string. */
  newChatTitle?: string;
  /** The icon container above the default greeting headline. */
  newChatIcon?: string;
  /** Wrapper around the suggested-prompt buttons (when `suggestedPrompts` is set). */
  newChatPrompts?: string;
  /** Each individual suggested-prompt button. */
  newChatPrompt?: string;
  message?: MessageClassNames;
}

export interface ChatMessagesProps {
  classNames?: ChatMessagesClassNames;
  /** What to show when there are no messages yet. */
  emptyState?: React.ReactNode;
  /** Disable smooth-typing animation. */
  noAnimation?: boolean;
  /**
   * Rendered inside an AI-styled bubble at the end of the list while the
   * agent is processing a turn but hasn't streamed any tokens yet (between
   * sending a message and the first token).
   *
   * - Pass a string (e.g. `'Thinking…'`, `'Working…'`) to show that label.
   * - Pass any `ReactNode` to fully customize the contents.
   * - Defaults to a subtle three-dot animation.
   * - Pass `null` to suppress the indicator entirely.
   */
  waitingIndicator?: React.ReactNode | null;
  /**
   * Centered hero rendered in place of the message list while the chat is
   * in the `'draft'` state (a fresh new chat that hasn't been sent yet).
   * Lets devs greet the user by name or surface their own branding.
   *
   * - Pass a string (e.g. `` `Hey there, ${user.firstName}` ``) to use the
   *   default centered styling with a sparkle icon above.
   * - Pass any other `ReactNode` for full control over the layout.
   * - Defaults to `'Hello! How can I help?'`.
   * - Pass `null` to render nothing in the draft state.
   */
  newChatView?: React.ReactNode | null;
  /**
   * Optional starter prompts shown under the new-chat hero. Clicking one
   * sends it as the user's first message (and materializes the draft). The
   * array is rendered as a stack of clickable chips; pass `[]` or omit to
   * hide.
   */
  suggestedPrompts?: string[];
  /**
   * Disable the inline "Running `tool_name`…" indicator on pending client-side
   * tool calls. Defaults to `false` (indicator enabled).
   */
  hideToolRunningIndicator?: boolean;
}

const DEFAULT_NEW_CHAT_TITLE = 'Hello! How can I help?';

/**
 * Scrollable message list. Auto-scrolls to bottom when new messages or
 * tokens arrive (unless the user has scrolled up). Renders the streaming
 * AI partial as a synthetic "pending" message at the end, and an AI-styled
 * placeholder bubble while waiting for the first token of a response.
 */
export function ChatMessages({
  classNames,
  emptyState,
  noAnimation,
  waitingIndicator,
  newChatView,
  suggestedPrompts,
  hideToolRunningIndicator,
}: ChatMessagesProps): JSX.Element {
  const { messages, pendingResponse, status, isWaitingForResponse, send } = useChat();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = React.useRef(true);

  const renderItems = React.useMemo(() => {
    if (!pendingResponse) return messages;
    return [
      ...messages,
      {
        kind: 'text' as const,
        localId: `pending-${pendingResponse.responseId}`,
        sender: 'ai' as const,
        content: pendingResponse.text,
        responseId: pendingResponse.responseId,
        pending: true,
        createdAt: Date.now(),
      },
    ];
  }, [messages, pendingResponse]);

  // Pre-compute which tool_call messages have *not* received a matching
  // tool_response yet. Combined with `status === 'awaiting_tool_responses'`
  // this drives the inline "Running…" indicator.
  const respondedToolCallIds = React.useMemo(() => {
    const responded = new Set<string>();
    for (const m of messages) {
      if (m.kind === 'tool_response') responded.add(m.toolCallId);
    }
    return responded;
  }, [messages]);

  const showWaiting = isWaitingForResponse && waitingIndicator !== null;

  // Show the centered "new chat" hero while the user is in a fresh draft
  // (no messages, no `create_context` round trip yet). Once they hit send,
  // status flips to 'streaming' and this falls back to the regular list.
  const showNewChatView =
    status === 'draft' && messages.length === 0 && !showWaiting && newChatView !== null;

  React.useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [renderItems.length, pendingResponse?.text, showWaiting]);

  const onScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    stickToBottomRef.current = distanceFromBottom < 40;
  }, []);

  const isEmpty = renderItems.length === 0 && !showWaiting && !showNewChatView;
  const canSendSuggestion =
    status === 'draft' || status === 'connected' || status === 'idle';

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={cn('aj-messages', classNames?.root)}
    >
      <div className={cn('aj-messages-inner', classNames?.inner)}>
        {showNewChatView ? (
          <NewChatHero
            content={newChatView}
            suggestedPrompts={suggestedPrompts}
            onSuggestionClick={(text) => {
              if (!canSendSuggestion) return;
              void send(text);
            }}
            classNames={{
              root: classNames?.newChat,
              title: classNames?.newChatTitle,
              icon: classNames?.newChatIcon,
              prompts: classNames?.newChatPrompts,
              prompt: classNames?.newChatPrompt,
            }}
          />
        ) : isEmpty ? (
          <div className={cn('aj-messages-empty', classNames?.empty)}>
            {emptyState ?? (
              status === 'connecting' ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Loader2 className="aj-spin" style={{ width: '0.875rem', height: '0.875rem' }} />
                  Loading conversation…
                </span>
              ) : (
                <span>
                  {status === 'idle'
                    ? 'No active chat.'
                    : 'Start the conversation below.'}
                </span>
              )
            )}
          </div>
        ) : (
          renderItems.map((m) => {
            const isToolCall = m.kind === 'tool_call';
            const toolRunning =
              !hideToolRunningIndicator &&
              isToolCall &&
              status === 'awaiting_tool_responses' &&
              !respondedToolCallIds.has(m.toolCallId);
            return (
              <Message
                key={m.kind === 'text' ? m.localId : m.localId ?? uid('msg')}
                message={m}
                streaming={Boolean('pending' in m && m.pending)}
                animate={!noAnimation}
                toolRunning={toolRunning}
                classNames={classNames?.message}
              />
            );
          })
        )}
        {showWaiting ? (
          <WaitingBubble className={classNames?.waitingBubble}>
            {waitingIndicator ?? <BouncingDots />}
          </WaitingBubble>
        ) : null}
      </div>
    </div>
  );
}

function NewChatHero({
  content,
  suggestedPrompts,
  onSuggestionClick,
  classNames,
}: {
  content: React.ReactNode;
  suggestedPrompts?: string[];
  onSuggestionClick: (text: string) => void;
  classNames: {
    root?: string;
    title?: string;
    icon?: string;
    prompts?: string;
    prompt?: string;
  };
}): JSX.Element {
  // When the dev passes a plain string we wrap it in our default centered
  // layout so they can swap the headline (e.g. `` `Hey there, ${name}` ``)
  // without rebuilding the hero from scratch. Anything richer renders as-is.
  const isString = typeof content === 'string';
  const headline = isString ? (content as string) : null;
  const useDefaultLayout = isString || content === undefined;

  const promptList = (suggestedPrompts ?? []).filter((p) => p && p.trim().length > 0);

  if (!useDefaultLayout) {
    return (
      <div className={cn('aj-newchat', classNames.root)}>
        {content}
        {promptList.length > 0 ? (
          <SuggestionList
            prompts={promptList}
            onClick={onSuggestionClick}
            classNames={{ root: classNames.prompts, prompt: classNames.prompt }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn('aj-newchat', classNames.root)}>
      <div className={cn('aj-newchat-icon', classNames.icon)}>
        <Sparkles aria-hidden />
      </div>
      <h2 className={cn('aj-newchat-title', classNames.title)}>
        {headline ?? DEFAULT_NEW_CHAT_TITLE}
      </h2>
      {promptList.length > 0 ? (
        <SuggestionList
          prompts={promptList}
          onClick={onSuggestionClick}
          classNames={{ root: classNames.prompts, prompt: classNames.prompt }}
        />
      ) : null}
    </div>
  );
}

function SuggestionList({
  prompts,
  onClick,
  classNames,
}: {
  prompts: string[];
  onClick: (text: string) => void;
  classNames: { root?: string; prompt?: string };
}): JSX.Element {
  return (
    <div className={cn('aj-newchat-prompts', classNames.root)}>
      {prompts.map((p, i) => (
        <button
          key={`${i}-${p}`}
          type="button"
          className={cn('aj-newchat-prompt', classNames.prompt)}
          onClick={() => onClick(p)}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

function WaitingBubble({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="aj-message-row aj-message-row--ai" aria-live="polite">
      <div className={cn('aj-message-bubble', 'aj-message-bubble--waiting', className)}>
        {children}
      </div>
    </div>
  );
}

function BouncingDots(): JSX.Element {
  return (
    <span className="aj-dots" aria-label="Waiting for response">
      <span className="aj-dot aj-dot--1" />
      <span className="aj-dot aj-dot--2" />
      <span className="aj-dot aj-dot--3" />
    </span>
  );
}
