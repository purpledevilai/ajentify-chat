'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Wrench, Loader2, ChevronRight, ChevronDown } from 'lucide-react';
import type { ChatMessage, ToolCallMessage } from '../types';
import { cn } from '../lib/utils';
import { TypingText } from './TypingText';

/**
 * Pretty-print a value as JSON when it is (or parses as) JSON, otherwise
 * return it as raw text. Used for tool params/response display.
 */
function formatMaybeJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  const s = String(value);
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export interface MessageClassNames {
  root?: string;
  humanBubble?: string;
  aiBubble?: string;
  systemBubble?: string;
  toolBubble?: string;
}

export interface MessageProps {
  message: ChatMessage;
  /** True when this is the still-streaming AI partial. */
  streaming?: boolean;
  /** When false, the typing animation is bypassed and the full content is shown. */
  animate?: boolean;
  /**
   * True when this tool_call message has no matching tool_response yet AND
   * the chat is currently awaiting tool responses. Used to surface a subtle
   * "running…" indicator (v0.2). Only applies to `kind: 'tool_call'`.
   */
  toolRunning?: boolean;
  classNames?: MessageClassNames;
}

function Markdown({ children }: { children: string }): JSX.Element {
  // All styling lives in `.aj-prose` (see styles.css). Hand-overrides for
  // `code` / `a` etc. are no longer needed — the CSS handles every element.
  return (
    <div className="aj-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a({ href, children: linkChildren, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                {...props}
              >
                {linkChildren}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Message({
  message,
  streaming = false,
  animate = true,
  toolRunning = false,
  classNames,
}: MessageProps): JSX.Element | null {
  if (message.kind === 'tool_call') {
    return (
      <ToolCallMessageView
        message={message}
        toolRunning={toolRunning}
        className={classNames?.toolBubble}
      />
    );
  }

  if (message.kind === 'tool_response') {
    // Tool responses are intentionally collapsed to avoid noise in the
    // default UI. Devs can render their own variant via the headless layer.
    return null;
  }

  if (message.sender === 'system') {
    return (
      <div className={cn('aj-message-bubble', 'aj-message-bubble--system', classNames?.systemBubble)}>
        {message.content}
      </div>
    );
  }

  const isHuman = message.sender === 'human';

  return (
    <div
      className={cn(
        'aj-message-row',
        isHuman ? 'aj-message-row--human' : 'aj-message-row--ai',
        classNames?.root,
      )}
    >
      <div
        className={cn(
          'aj-message-bubble',
          isHuman ? 'aj-message-bubble--human' : 'aj-message-bubble--ai',
          isHuman ? classNames?.humanBubble : classNames?.aiBubble,
        )}
      >
        {isHuman ? (
          <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
        ) : streaming && animate ? (
          <TypingText
            text={message.content}
            done={false}
            render={(visible, caret) => (
              <span>
                <Markdown>{visible}</Markdown>
                {caret ? <span className="aj-caret">▍</span> : null}
              </span>
            )}
          />
        ) : (
          <Markdown>{message.content}</Markdown>
        )}
      </div>
    </div>
  );
}

/**
 * Expandable, shimmer-while-running tool-call row. Clicking the header toggles
 * a details panel showing pretty-printed parameters and response (JSON is
 * pretty-printed when detected, otherwise shown raw).
 */
function ToolCallMessageView({
  message,
  toolRunning,
  className,
}: {
  message: ToolCallMessage;
  toolRunning: boolean;
  className?: string;
}): JSX.Element {
  const running = toolRunning && message.toolOutput == null;
  const [open, setOpen] = React.useState(false);
  const hasParams =
    Boolean(message.toolInput) && Object.keys(message.toolInput).length > 0;
  const hasDetails = hasParams || message.toolOutput != null;

  return (
    <div className={cn('aj-tool-call', running && 'aj-tool-call--running', className)}>
      <button
        type="button"
        className="aj-tool-call-header"
        onClick={() => hasDetails && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasDetails}
      >
        {hasDetails ? (
          open ? (
            <ChevronDown aria-hidden />
          ) : (
            <ChevronRight aria-hidden />
          )
        ) : (
          <Wrench aria-hidden />
        )}
        <span className={cn('aj-tool-call-label', running && 'aj-shimmer-text')}>
          {running ? 'Running ' : 'Called '}
          <span className="aj-tool-call-name">{message.toolName}</span>
        </span>
        {running ? (
          <Loader2 className="aj-spin aj-tool-call-spin" aria-hidden />
        ) : null}
      </button>
      {open && hasDetails ? (
        <div className="aj-tool-call-details">
          {hasParams ? (
            <div className="aj-tool-call-section">
              <div className="aj-tool-call-section-title">Parameters</div>
              <pre className="aj-tool-call-pre">
                {formatMaybeJson(message.toolInput)}
              </pre>
            </div>
          ) : null}
          <div className="aj-tool-call-section">
            <div className="aj-tool-call-section-title">Response</div>
            <pre className="aj-tool-call-pre">
              {message.toolOutput != null
                ? formatMaybeJson(message.toolOutput)
                : 'Running…'}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
