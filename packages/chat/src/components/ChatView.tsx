'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useContextHistory } from '../hooks/useContextHistory';
import { cn } from '../lib/utils';
import { ChatHeader, type ChatHeaderClassNames } from './ChatHeader';
import { ChatMessages, type ChatMessagesClassNames } from './ChatMessages';
import { ChatInput, type ChatInputClassNames } from './ChatInput';
import { ChatHistory, type ChatHistoryClassNames } from './ChatHistory';
import { Button } from './primitives/Button';

export interface ChatViewClassNames {
  root?: string;
  body?: string;
  empty?: string;
  header?: ChatHeaderClassNames;
  messages?: ChatMessagesClassNames;
  input?: ChatInputClassNames;
  history?: ChatHistoryClassNames;
}

export interface ChatViewProps {
  classNames?: ChatViewClassNames;
  /** Show the new/history/close buttons in the header. Defaults to true. */
  showHeader?: boolean;
  /** Called when the chat header's close button is clicked. */
  onClose?: () => void;
  /** Title override for the header. */
  title?: React.ReactNode;
  /**
   * Auto-start a new chat on mount if there isn't one already. Defaults to
   * false.
   *
   * The behavior depends on the provider's `agentSpeaksFirst` config: by
   * default this just enters a local `'draft'` state (no backend call) so
   * the user can start typing immediately, and the actual `create_context`
   * runs lazily on the first send. With `agentSpeaksFirst: true` this
   * eagerly creates and connects so the agent can stream its initial
   * message.
   */
  autoCreateContext?: boolean;
  /** Custom empty state when there is no context. */
  emptyState?: React.ReactNode;
  /**
   * Forwarded to `<ChatMessages />`. Customizes the placeholder shown while
   * waiting for the agent's first token (e.g. `'Thinking…'`, `'Working…'`,
   * a node, or `null` to hide).
   */
  waitingIndicator?: React.ReactNode | null;
  /**
   * Forwarded to `<ChatMessages />`. Centered hero rendered while the chat
   * is in the `'draft'` state. Pass a string to swap the headline (great
   * place to inject the user's name) or a `ReactNode` to fully control the
   * layout. Defaults to `'Hello! How can I help?'`. Pass `null` to hide.
   */
  newChatView?: React.ReactNode | null;
  /**
   * Forwarded to `<ChatInput />`. Placeholder shown in the textarea.
   * Defaults to `'Ask anything…'`.
   */
  inputPlaceholder?: string;
}

/**
 * A complete chat experience that fills its parent. Compose the lower-level
 * components (ChatHeader, ChatMessages, ChatInput) if you need more control.
 */
export function ChatView({
  classNames,
  showHeader = true,
  onClose,
  title,
  autoCreateContext = false,
  emptyState,
  waitingIndicator,
  newChatView,
  inputPlaceholder,
}: ChatViewProps): JSX.Element {
  const { hasContext, status } = useChat();
  const { createNew } = useContextHistory();
  const [showingHistory, setShowingHistory] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    if (!autoCreateContext) return;
    if (hasContext) return;
    if (creating) return;
    setCreating(true);
    createNew().finally(() => setCreating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCreateContext, hasContext]);

  const onStartChat = React.useCallback(async () => {
    setCreating(true);
    try {
      await createNew();
    } finally {
      setCreating(false);
    }
  }, [createNew]);

  return (
    <div
      className={cn(
        'aj-root flex h-full w-full flex-col overflow-hidden bg-background text-foreground',
        classNames?.root
      )}
    >
      {showHeader ? (
        <ChatHeader
          title={title}
          onClose={onClose}
          onShowHistory={() => setShowingHistory(true)}
          classNames={classNames?.header}
        />
      ) : null}

      <div className={cn('relative flex-1 min-h-0', classNames?.body)}>
        {showingHistory ? (
          <ChatHistory
            onBack={() => setShowingHistory(false)}
            classNames={classNames?.history}
          />
        ) : !hasContext ? (
          <div
            className={cn(
              'flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground',
              classNames?.empty
            )}
          >
            {emptyState ?? (
              <>
                <p>Start a new chat to begin.</p>
                <Button
                  onClick={() => void onStartChat()}
                  disabled={creating || status === 'connecting'}
                >
                  {creating || status === 'connecting' ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      Starting…
                    </>
                  ) : (
                    'New chat'
                  )}
                </Button>
              </>
            )}
          </div>
        ) : (
          <ChatMessages
            classNames={classNames?.messages}
            waitingIndicator={waitingIndicator}
            newChatView={newChatView}
          />
        )}
      </div>

      {!showingHistory && hasContext ? (
        <div className="border-t border-border bg-background px-3 py-3">
          <ChatInput
            classNames={classNames?.input}
            placeholder={inputPlaceholder}
          />
        </div>
      ) : null}
    </div>
  );
}
