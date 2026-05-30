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
          'mx-auto flex min-h-full flex-col gap-3 px-4 py-4',
          'max-w-[760px]',
          classNames?.inner
        )}
      >
        {showNewChatView ? (
          <NewChatHero
            content={newChatView}
            classNames={{
              root: classNames?.newChat,
              title: classNames?.newChatTitle,
              icon: classNames?.newChatIcon,
            }}
          />
        ) : isEmpty ? (
          <div
            className={cn(
              'flex flex-1 items-center justify-center text-center text-sm text-muted-foreground py-12',
              classNames?.empty
            )}
          >
            {emptyState ?? (
              status === 'connecting' ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
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

function NewChatHero({
  content,
  classNames,
}: {
  content: React.ReactNode;
  classNames: { root?: string; title?: string; icon?: string };
}): JSX.Element {
  // When the dev passes a plain string we wrap it in our default centered
  // layout so they can swap the headline (e.g. `` `Hey there, ${name}` ``)
  // without rebuilding the hero from scratch. Anything richer renders as-is.
  const isString = typeof content === 'string';
  const headline = isString ? (content as string) : null;
  const useDefaultLayout = isString || content === undefined;

  if (!useDefaultLayout) {
    return (
      <div
        className={cn(
          'flex flex-1 flex-col items-center justify-center px-4 py-12 text-center',
          classNames.root
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center',
        classNames.root
      )}
    >
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary',
          classNames.icon
        )}
      >
        <Sparkles className="h-6 w-6" />
      </div>
      <h2
        className={cn(
          'text-xl font-semibold tracking-tight text-foreground',
          classNames.title
        )}
      >
        {headline ?? DEFAULT_NEW_CHAT_TITLE}
      </h2>
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
