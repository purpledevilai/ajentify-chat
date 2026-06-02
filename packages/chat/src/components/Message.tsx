'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Wrench, Loader2 } from 'lucide-react';
import type { ChatMessage } from '../types';
import { cn } from '../lib/utils';
import { TypingText } from './TypingText';

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
      <div className={cn('aj-tool-call', classNames?.toolBubble)}>
        <Wrench aria-hidden />
        <span>
          {toolRunning ? 'Running ' : 'Called '}
          <span className="aj-tool-call-name">{message.toolName}</span>
          {toolRunning ? (
            <span className="aj-tool-call-status">
              <Loader2 className="aj-spin" aria-hidden />
            </span>
          ) : null}
        </span>
      </div>
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
