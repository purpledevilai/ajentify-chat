'use client';

import * as React from 'react';
import { Send } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { cn } from '../lib/utils';
import { Textarea } from './primitives/Textarea';
import { IconButton } from './primitives/IconButton';

export interface ChatInputClassNames {
  root?: string;
  textarea?: string;
  sendButton?: string;
}

export interface ChatInputProps {
  placeholder?: string;
  classNames?: ChatInputClassNames;
  /** Disable send while streaming. Defaults to true. */
  disableWhileStreaming?: boolean;
  /** Max textarea height in px. Defaults to 200. */
  maxHeightPx?: number;
  /** Override of the send action. */
  onSend?: (text: string) => void;
}

/**
 * Auto-growing chat input. Enter sends, Shift+Enter inserts a newline.
 */
export function ChatInput({
  placeholder = 'Ask follow up',
  classNames,
  disableWhileStreaming = true,
  maxHeightPx = 200,
  onSend,
}: ChatInputProps): JSX.Element {
  const { send, status, hasContext } = useChat();
  const [value, setValue] = React.useState('');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const streaming = status === 'streaming' || status === 'awaiting_tool_responses';
  const connecting = status === 'connecting';
  const disabledState = (disableWhileStreaming && streaming) || connecting;

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
    if (!text || disabledState) return;
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
  }, [value, send, disabledState, hasContext, onSend]);

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void submit();
      }
    },
    [submit]
  );

  return (
    <div
      className={cn(
        'flex items-end gap-2 rounded-2xl border border-border bg-card px-3 py-2 shadow-sm',
        'focus-within:ring-2 focus-within:ring-ring',
        classNames?.root
      )}
    >
      <Textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabledState}
        className={cn(
          'min-h-[36px] flex-1 resize-none border-0 bg-transparent p-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0',
          classNames?.textarea
        )}
        style={{ maxHeight: maxHeightPx }}
      />
      <IconButton
        label="Send"
        variant="default"
        type="button"
        onClick={() => void submit()}
        disabled={disabledState || value.trim().length === 0}
        className={cn('rounded-full', classNames?.sendButton)}
      >
        <Send className="h-4 w-4" />
      </IconButton>
    </div>
  );
}
