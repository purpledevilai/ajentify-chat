'use client';

import * as React from 'react';
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
}

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
}: ChatMessagesProps): JSX.Element {
  const { messages, pendingResponse, status, isWaitingForResponse } = useChat();
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

  const showWaiting = isWaitingForResponse && waitingIndicator !== null;

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

  const isEmpty = renderItems.length === 0 && !showWaiting;

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className={cn(
        'h-full w-full overflow-y-auto',
        '[scrollbar-width:thin]',
        classNames?.root
      )}
    >
      <div
        className={cn(
          'mx-auto flex flex-col gap-3 px-4 py-4',
          'max-w-[760px]',
          classNames?.inner
        )}
      >
        {isEmpty ? (
          <div
            className={cn(
              'flex flex-1 items-center justify-center text-center text-sm text-muted-foreground py-12',
              classNames?.empty
            )}
          >
            {emptyState ?? (
              <span>
                {status === 'idle'
                  ? 'No active chat.'
                  : 'Start the conversation below.'}
              </span>
            )}
          </div>
        ) : (
          renderItems.map((m) => (
            <Message
              key={m.kind === 'text' ? m.localId : m.localId ?? uid('msg')}
              message={m}
              streaming={Boolean('pending' in m && m.pending)}
              animate={!noAnimation}
              classNames={classNames?.message}
            />
          ))
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

function WaitingBubble({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex w-full justify-start" aria-live="polite">
      <div
        className={cn(
          'max-w-[85%] rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2 text-sm leading-relaxed text-secondary-foreground',
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

function BouncingDots(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1" aria-label="Waiting for response">
      <span
        className="h-1.5 w-1.5 rounded-full bg-current opacity-50 animate-aj-dot-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-current opacity-50 animate-aj-dot-bounce"
        style={{ animationDelay: '160ms' }}
      />
      <span
        className="h-1.5 w-1.5 rounded-full bg-current opacity-50 animate-aj-dot-bounce"
        style={{ animationDelay: '320ms' }}
      />
    </span>
  );
}
