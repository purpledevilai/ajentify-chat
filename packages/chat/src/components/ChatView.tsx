'use client';

import * as React from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useAjentifyStores } from '../hooks/useAjentify';
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
  inputDock?: string;
  /** The floating error toast shown when something goes wrong. */
  toast?: string;
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
   * Optional starter prompts shown under the new-chat hero. Clicking one
   * sends it immediately, materializing the draft and starting the chat.
   * Forwarded to `<ChatMessages suggestedPrompts={...} />`.
   */
  suggestedPrompts?: string[];
  /**
   * Disable the inline "Running `tool_name`…" indicator on pending
   * client-side tool calls. Defaults to `false` (indicator enabled).
   */
  hideToolRunningIndicator?: boolean;
  /**
   * Forwarded to `<ChatInput />`. Placeholder shown in the textarea.
   * Defaults to `'Ask anything…'`.
   */
  inputPlaceholder?: string;
  /**
   * How long (in ms) an error toast stays visible before auto-dismissing.
   * Defaults to `8000` (8 seconds). Set to `0` to disable auto-dismiss.
   */
  toastDurationMs?: number;
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
  suggestedPrompts,
  hideToolRunningIndicator,
  inputPlaceholder,
  toastDurationMs = 8000,
}: ChatViewProps): JSX.Element {
  const { hasContext, status } = useChat();
  const { createNew } = useContextHistory();
  const [showingHistory, setShowingHistory] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const autoStartFailedRef = React.useRef(false);
  if (hasContext && autoStartFailedRef.current) {
    autoStartFailedRef.current = false;
  }

  // --- Error toast state ---
  const stores = useAjentifyStores();
  const [toasts, setToasts] = React.useState<
    { id: number; message: string }[]
  >([]);
  const nextIdRef = React.useRef(0);

  const pushToast = React.useCallback(
    (message: string) => {
      const id = nextIdRef.current++;
      setToasts((prev) => [...prev, { id, message }]);
      if (toastDurationMs > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, toastDurationMs);
      }
    },
    [toastDurationMs],
  );

  const dismissToast = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to the store's `error` field. Every time it transitions from
  // null → non-null we push a toast. This catches errors regardless of how
  // quickly the state machine clears/re-drafts afterwards.
  React.useEffect(() => {
    let prevError: string | null = stores.currentContext.getState().error;
    const unsub = stores.currentContext.subscribe((state) => {
      if (state.error && state.error !== prevError) {
        pushToast(state.error);
      }
      prevError = state.error;
    });
    return unsub;
  }, [stores, pushToast]);

  // Also catch createError from the contexts store (covers cases where the
  // current-context store's error is cleared before we see it).
  React.useEffect(() => {
    let prevError: string | null = stores.contexts.getState().createError;
    const unsub = stores.contexts.subscribe((state) => {
      if (state.createError && state.createError !== prevError) {
        pushToast(state.createError);
      }
      prevError = state.createError;
    });
    return unsub;
  }, [stores, pushToast]);

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
    <div className={cn('aj-root', 'aj-view', classNames?.root)}>
      {showHeader ? (
        <ChatHeader
          title={title}
          onClose={onClose}
          onShowHistory={() => setShowingHistory(true)}
          classNames={classNames?.header}
        />
      ) : null}

      <div className={cn('aj-view-body', classNames?.body)}>
        {/* Error toasts — float above whatever view is showing */}
        {toasts.length > 0 ? (
          <div className="aj-toast-container">
            {toasts.map((t) => (
              <div
                key={t.id}
                className={cn('aj-toast', classNames?.toast)}
                role="alert"
              >
                <AlertCircle className="aj-toast-icon" aria-hidden />
                <p className="aj-toast-text">{t.message}</p>
                <button
                  type="button"
                  className="aj-toast-dismiss"
                  onClick={() => dismissToast(t.id)}
                  aria-label="Dismiss"
                >
                  <X aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {showingHistory ? (
          <ChatHistory
            onBack={() => setShowingHistory(false)}
            classNames={classNames?.history}
          />
        ) : !hasContext ? (
          <div className={cn('aj-view-empty', classNames?.empty)}>
            {emptyState ?? (
              <>
                <p style={{ margin: 0 }}>
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
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Loader2 className="aj-spin" style={{ width: '0.875rem', height: '0.875rem' }} />
                        Retrying…
                      </span>
                    ) : (
                      'Try again'
                    )}
                  </Button>
                ) : (
                  <Loader2 className="aj-spin" style={{ width: '1rem', height: '1rem' }} />
                )}
              </>
            )}
          </div>
        ) : (
          <ChatMessages
            classNames={classNames?.messages}
            waitingIndicator={waitingIndicator}
            newChatView={newChatView}
            suggestedPrompts={suggestedPrompts}
            hideToolRunningIndicator={hideToolRunningIndicator}
          />
        )}
      </div>

      {!showingHistory && hasContext ? (
        <div className={cn('aj-input-dock', classNames?.inputDock)}>
          <ChatInput
            classNames={classNames?.input}
            placeholder={inputPlaceholder}
          />
        </div>
      ) : null}
    </div>
  );
}
