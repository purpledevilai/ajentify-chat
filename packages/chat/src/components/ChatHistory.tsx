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
    // Always trigger a refetch when the panel mounts. The cached list (if
    // any) keeps rendering during the round-trip — see the JSDoc on
    // `autoLoad` and the `loading && !loaded` gate below — so opening the
    // history view feels instant while still surfacing freshly-created or
    // server-side changes.
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
    <div className={cn('flex h-full w-full flex-col bg-background', classNames?.root)}>
      <div
        className={cn(
          'flex items-center justify-between border-b border-border px-3 py-2',
          classNames?.header
        )}
      >
        <div className="flex items-center gap-2">
          {onBack ? (
            <IconButton label="Back" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </IconButton>
          ) : null}
          <span className="text-sm font-semibold">Chat history</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void createNew();
            onBack?.();
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          New chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && !loaded ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
        ) : error && !loaded ? (
          <div className="px-4 py-6 text-sm text-destructive">
            Failed to load history: {error}
          </div>
        ) : history.length === 0 ? (
          <div
            className={cn(
              'flex h-full flex-col items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground',
              classNames?.empty
            )}
          >
            <MessageSquare className="mb-2 h-6 w-6 opacity-50" />
            No previous chats yet.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {history.map((h) => {
              const isCurrent = h.context_id === currentContextId;
              const isDeleting = deletingId === h.context_id;
              return (
                <li key={h.context_id} className="group relative">
                  <button
                    type="button"
                    onClick={() => {
                      void switchTo(h.context_id);
                      onBack?.();
                    }}
                    className={cn(
                      'flex w-full flex-col items-start gap-1 px-4 py-3 pr-12 text-left hover:bg-accent/60 transition-colors',
                      isCurrent && 'bg-accent/40',
                      classNames?.item
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {h.agent.agent_name || 'Chat'}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {formatTimestamp(h.updated_at)}
                      </span>
                    </div>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {h.last_message || '(empty conversation)'}
                    </span>
                  </button>
                  {enableDelete ? (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <IconButton
                        label="Delete chat"
                        disabled={isDeleting}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDelete(h.context_id);
                        }}
                        className="opacity-60 transition-opacity hover:opacity-100 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
