'use client';

import * as React from 'react';
import { ArrowLeft, MessageSquare, Plus } from 'lucide-react';
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
  /** Auto-load history on mount. Defaults to true. */
  autoLoad?: boolean;
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
  classNames,
}: ChatHistoryProps): JSX.Element {
  const {
    history,
    loading,
    error,
    load,
    switchTo,
    createNew,
    currentContextId,
  } = useContextHistory();

  React.useEffect(() => {
    if (autoLoad) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

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
        {loading ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">Loading…</div>
        ) : error ? (
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
              return (
                <li key={h.context_id}>
                  <button
                    type="button"
                    onClick={() => {
                      void switchTo(h.context_id);
                      onBack?.();
                    }}
                    className={cn(
                      'flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-accent/60 transition-colors',
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
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
