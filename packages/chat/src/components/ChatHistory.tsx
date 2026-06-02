'use client';

import * as React from 'react';
import { ArrowLeft, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { useContextHistory } from '../hooks/useContextHistory';
import { cn } from '../lib/utils';
import { IconButton } from './primitives/IconButton';
import { Button } from './primitives/Button';

export interface ChatHistoryClassNames {
  root?: string;
  header?: string;
  item?: string;
  empty?: string;
}

export interface ChatHistoryProps {
  /** Called when the user wants to leave the history view. */
  onBack?: () => void;
  /**
   * Auto-load history on mount. Defaults to true.
   *
   * Each mount kicks off a fresh `get_context_history` fetch in the
   * background. If we already have a cached list it keeps rendering during
   * the round-trip (so opening the panel feels instant) and the rows
   * update in place when the refresh resolves. Only the very first load —
   * when there's nothing cached yet — shows the "Loading…" placeholder.
   */
  autoLoad?: boolean;
  /**
   * Show a per-row delete button that dispatches a `delete_context` event.
   * Defaults to true. Pass `false` if your backend doesn't support deletion
   * or you want to handle it elsewhere.
   */
  enableDelete?: boolean;
  classNames?: ChatHistoryClassNames;
}

function formatTimestamp(unixSeconds: number): string {
  const ms = unixSeconds < 1e12 ? unixSeconds * 1000 : unixSeconds;
  const date = new Date(ms);
  const now = Date.now();
  const diffMs = now - ms;
  if (diffMs < 1000 * 60) return 'just now';
  if (diffMs < 1000 * 60 * 60)
    return `${Math.floor(diffMs / (1000 * 60))}m ago`;
  if (diffMs < 1000 * 60 * 60 * 24)
    return `${Math.floor(diffMs / (1000 * 60 * 60))}h ago`;
  if (diffMs < 1000 * 60 * 60 * 24 * 7)
    return `${Math.floor(diffMs / (1000 * 60 * 60 * 24))}d ago`;
  return date.toLocaleDateString();
}

export function ChatHistory({
  onBack,
  autoLoad = true,
  enableDelete = true,
  classNames,
}: ChatHistoryProps): JSX.Element {
  const {
    history,
    loading,
    error,
    loaded,
    load,
    switchTo,
    createNew,
    deleteContext,
    currentContextId,
  } = useContextHistory();

  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!autoLoad) return;
    void load().catch(() => {
      // Failures land on `historyError`; the cached rows stay rendered.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  const onDelete = React.useCallback(
    async (contextId: string) => {
      setDeletingId(contextId);
      try {
        await deleteContext(contextId);
      } catch {
        // The store already surfaces the error via onError; nothing else to do.
      } finally {
        setDeletingId(null);
      }
    },
    [deleteContext]
  );

  return (
    <div className={cn('aj-history', classNames?.root)}>
      <div className={cn('aj-history-header', classNames?.header)}>
        <div className="aj-history-header-title">
          {onBack ? (
            <IconButton label="Back" onClick={onBack}>
              <ArrowLeft />
            </IconButton>
          ) : null}
          <span>Chat history</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void createNew();
            onBack?.();
          }}
        >
          <Plus style={{ marginRight: '0.25rem', width: '0.875rem', height: '0.875rem' }} />
          New chat
        </Button>
      </div>

      {loading && !loaded ? (
        <div className="aj-history-loading">Loading…</div>
      ) : error && !loaded ? (
        <div className="aj-history-error">Failed to load history: {error}</div>
      ) : history.length === 0 ? (
        <div className={cn('aj-history-empty', classNames?.empty)}>
          <MessageSquare aria-hidden />
          No previous chats yet.
        </div>
      ) : (
        <ul className="aj-history-list">
          {history.map((h) => {
            const isCurrent = h.context_id === currentContextId;
            const isDeleting = deletingId === h.context_id;
            return (
              <li key={h.context_id}>
                <button
                  type="button"
                  onClick={() => {
                    void switchTo(h.context_id);
                    onBack?.();
                  }}
                  className={cn(
                    'aj-history-item',
                    isCurrent && 'aj-history-item--current',
                    classNames?.item,
                  )}
                >
                  <div className="aj-history-item-row">
                    <span className="aj-history-item-name">
                      {h.agent.agent_name || 'Chat'}
                    </span>
                    <span className="aj-history-item-time">
                      {formatTimestamp(h.updated_at)}
                    </span>
                  </div>
                  <span className="aj-history-item-preview">
                    {h.last_message || '(empty conversation)'}
                  </span>
                </button>
                {enableDelete ? (
                  <div className="aj-history-delete">
                    <IconButton
                      label="Delete chat"
                      disabled={isDeleting}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDelete(h.context_id);
                      }}
                    >
                      <Trash2 />
                    </IconButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
