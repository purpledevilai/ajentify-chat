'use client';

import * as React from 'react';
import { Send, Square } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { cn } from '../lib/utils';

export interface ChatInputClassNames {
  root?: string;
  textarea?: string;
  sendButton?: string;
  /** The stop/cancel button shown in place of send while the agent generates. */
  cancelButton?: string;
}

export interface ChatInputProps {
  /**
   * Placeholder shown in the textarea. Defaults to `'Ask anything…'`.
   * Devs typically thread this through `<ChatView />` /
   * `<ChatPanel />` so the same string is used regardless of how they
   * compose the chat.
   */
  placeholder?: string;
  classNames?: ChatInputClassNames;
  /**
   * Disable the send action (button + Enter) while the agent is streaming
   * or running client-side tools. The textarea itself stays focusable so
   * the user can keep composing their next message. Defaults to true.
   */
  disableWhileStreaming?: boolean;
  /** Max textarea height in px. Defaults to 200. */
  maxHeightPx?: number;
  /** Override of the send action. */
  onSend?: (text: string) => void;
  /**
   * Show a stop button (calls `stop_invocation`) while
   * `status === 'streaming'`. It replaces the send button when the composer
   * is empty and sits next to it otherwise. Defaults to true.
   */
  showCancelButton?: boolean;
  /** Override of the cancel action (defaults to `useChat().cancel`). */
  onCancel?: () => void;
}

/**
 * Auto-growing chat input. Enter sends, Shift+Enter inserts a newline.
 *
 * The textarea is never marked `disabled` — disabling a focused element
 * blurs it and forces the user to click back in after every agent turn.
 * Instead we gate only the send action while the agent is busy.
 */
export function ChatInput({
  placeholder = 'Ask anything…',
  classNames,
  disableWhileStreaming = true,
  maxHeightPx = 200,
  onSend,
  showCancelButton = true,
  onCancel,
}: ChatInputProps): JSX.Element {
  const { send, cancel, status, hasContext, canCancel, isCancelling } = useChat();
  const [value, setValue] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const streaming = status === 'streaming' || status === 'awaiting_tool_responses';
  const connecting = status === 'connecting';
  // `status === 'draft'` deliberately falls through to "enabled" — drafts
  // are the no-backend-yet placeholder users see before sending their first
  // message; the send action itself triggers create_context + connect.
  const sendBlocked = (disableWhileStreaming && streaming) || connecting;
  const showCancel = showCancelButton && canCancel;

  const doCancel = React.useCallback(() => {
    if (onCancel) {
      onCancel();
      return;
    }
    cancel().catch(() => {
      // Errors surface via the store + onError config.
    });
  }, [cancel, onCancel]);

  const resize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${next}px`;
  }, [maxHeightPx]);

  React.useEffect(() => {
    resize();
  }, [value, resize]);

  const submit = React.useCallback(async () => {
    const text = value.trim();
    if (!text || sendBlocked) return;
    setValue('');
    if (onSend) {
      onSend(text);
      return;
    }
    if (!hasContext) {
      // Without a context we can't send. Devs should surface a "create chat"
      // button instead; we silently noop here.
      return;
    }
    try {
      await send(text);
    } catch {
      // Errors surface via the store + onError config.
    }
  }, [value, send, sendBlocked, hasContext, onSend]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // Swallow Enter while the agent is busy so the user can keep
        // typing without accidentally firing a send that would no-op.
        e.preventDefault();
        if (sendBlocked) return;
        void submit();
      }
    },
    [submit, sendBlocked]
  );

  return (
    <div
      className={cn('aj-input', classNames?.root)}
      onClick={() => textareaRef.current?.focus()}
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-busy={sendBlocked || undefined}
        className={cn('aj-input-textarea', classNames?.textarea)}
        style={{ maxHeight: maxHeightPx }}
      />
      {showCancel ? (
        <button
          type="button"
          aria-label="Stop generating"
          title="Stop generating"
          onClick={doCancel}
          disabled={isCancelling}
          className={cn('aj-input-cancel', classNames?.cancelButton)}
        >
          <Square aria-hidden />
        </button>
      ) : null}
      {!showCancel || value.trim().length > 0 ? (
        <button
          type="button"
          aria-label="Send"
          title="Send"
          onClick={() => void submit()}
          disabled={sendBlocked || value.trim().length === 0}
          className={cn('aj-input-send', classNames?.sendButton)}
        >
          <Send aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
