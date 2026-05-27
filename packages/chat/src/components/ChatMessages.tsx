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
  message?: MessageClassNames;
}

export interface ChatMessagesProps {
  classNames?: ChatMessagesClassNames;
  /** What to show when there are no messages yet. */
  emptyState?: React.ReactNode;
  /** Disable smooth-typing animation. */
  noAnimation?: boolean;
}

/**
 * Scrollable message list. Auto-scrolls to bottom when new messages or
 * tokens arrive (unless the user has scrolled up). Renders the streaming
 * AI partial as a synthetic "pending" message at the end.
 */
export function ChatMessages({
  classNames,
  emptyState,
  noAnimation,
}: ChatMessagesProps): JSX.Element {
  const { messages, pendingResponse, status } = useChat();
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

  React.useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [renderItems.length, pendingResponse?.text]);

  const onScroll = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    stickToBottomRef.current = distanceFromBottom < 40;
  }, []);

  const isEmpty = renderItems.length === 0;

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
      </div>
    </div>
  );
}
