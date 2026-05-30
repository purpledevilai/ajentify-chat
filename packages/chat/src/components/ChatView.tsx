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
   * Custom recovery UI shown when an upstream `create_context` failed and
   * there is no current context to render. Defaults to a "Couldn't start a
   * new chat — Try again" affordance.
   */
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
 *
 * On mount (and any time `hasContext` flips back to `false`, e.g. after the
 * active context is deleted) the view auto-calls `startNewContext()` so the
 * user lands on a ready-to-type chat. The provider's `agentSpeaksFirst`
 * config decides what that means:
 *  - `false` (default): a local `'draft'` state — no backend call until the
 *    first `sendMessage()`.
 *  - `true`: an eager `create_context` + WebSocket connect so the agent can
 *    stream its greeting.
 *
 * If the eager call fails, the view falls back to the `emptyState` slot
 * (default: a "Couldn't start a new chat — Try again" affordance) and does
 * not auto-retry.
 */
export function ChatView({
  classNames,
  showHeader = true,
  onClose,
  title,
  emptyState,
  waitingIndicator,
  newChatView,
  inputPlaceholder,
}: ChatViewProps): JSX.Element {
  const { hasContext, status } = useChat();
  const { createNew } = useContextHistory();
  const [showingHistory, setShowingHistory] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  // One-shot guard: prevents an infinite loop when an `agentSpeaksFirst`
  // provider's `create_context` keeps rejecting (the store rolls state back
  // to idle on failure, which would otherwise re-flip `hasContext` and
  // re-fire this effect). Reset whenever we successfully land on a context.
  const autoStartFailedRef = React.useRef(false);
  if (hasContext && autoStartFailedRef.current) {
    autoStartFailedRef.current = false;
  }

  React.useEffect(() => {
    if (hasContext || creating) return;
    if (autoStartFailedRef.current) return;
    setCreating(true);
    createNew()
      .catch(() => {
        autoStartFailedRef.current = true;
      })
      .finally(() => setCreating(false));
  }, [hasContext, creating, createNew]);

  const onStartChat = React.useCallback(async () => {
    autoStartFailedRef.current = false;
    setCreating(true);
    try {
      await createNew();
    } catch {
      autoStartFailedRef.current = true;
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
                <p>
                  {autoStartFailedRef.current
                    ? "Couldn't start a new chat."
                    : 'Starting a new chat…'}
                </p>
                {autoStartFailedRef.current ? (
                  <Button
                    onClick={() => void onStartChat()}
                    disabled={creating || status === 'connecting'}
                  >
                    {creating || status === 'connecting' ? (
                      <>
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                        Retrying…
                      </>
                    ) : (
                      'Try again'
                    )}
                  </Button>
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
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
