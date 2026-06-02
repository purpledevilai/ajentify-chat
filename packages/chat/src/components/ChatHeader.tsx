'use client';

import * as React from 'react';
import { Plus, History as HistoryIcon, X, Sparkles } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useContextHistory } from '../hooks/useContextHistory';
import { cn } from '../lib/utils';
import { IconButton } from './primitives/IconButton';

export interface ChatHeaderClassNames {
  root?: string;
  title?: string;
  buttons?: string;
  button?: string;
}

export interface ChatHeaderProps {
  /** Custom title; defaults to the connected agent's name. */
  title?: React.ReactNode;
  /** Show the "new chat" button. Defaults to true. */
  showNew?: boolean;
  /** Show the history button. Defaults to true. */
  showHistory?: boolean;
  /** Show the close button. Defaults to true. */
  showClose?: boolean;
  /** Called when the close button is clicked. */
  onClose?: () => void;
  /** Called when the history button is clicked. */
  onShowHistory?: () => void;
  /** Override the new chat handler (defaults to `useContextHistory().createNew`). */
  onNewChat?: () => void;
  classNames?: ChatHeaderClassNames;
  /** Render extra content on the right edge (before the close button). */
  rightSlot?: React.ReactNode;
}

export function ChatHeader({
  title,
  showNew = true,
  showHistory = true,
  showClose = true,
  onClose,
  onShowHistory,
  onNewChat,
  classNames,
  rightSlot,
}: ChatHeaderProps): JSX.Element {
  const { agent } = useChat();
  const { createNew } = useContextHistory();

  const displayTitle = title ?? agent?.agent_name ?? 'Assistant';

  return (
    <div className={cn('aj-header', classNames?.root)}>
      <div className={cn('aj-header-title', classNames?.title)}>
        <Sparkles aria-hidden />
        <span className="aj-header-title-text">{displayTitle}</span>
      </div>
      <div className={cn('aj-header-buttons', classNames?.buttons)}>
        {showNew ? (
          <IconButton
            label="New chat"
            onClick={() => (onNewChat ? onNewChat() : void createNew())}
            className={classNames?.button}
          >
            <Plus />
          </IconButton>
        ) : null}
        {showHistory ? (
          <IconButton
            label="History"
            onClick={onShowHistory}
            className={classNames?.button}
          >
            <HistoryIcon />
          </IconButton>
        ) : null}
        {rightSlot}
        {showClose ? (
          <IconButton
            label="Close"
            onClick={onClose}
            className={classNames?.button}
          >
            <X />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}
