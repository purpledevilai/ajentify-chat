'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Wrench } from 'lucide-react';
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
  classNames?: MessageClassNames;
}

function Markdown({ children }: { children: string }): JSX.Element {
  return (
    <div className="prose prose-sm max-w-none text-foreground [&_*]:!my-1 [&_p]:!my-1 [&_pre]:my-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !(className?.includes('language-') ?? false);
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1 py-[1px] text-[0.85em] font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
                <code className={className} {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          a({ href, children, ...props }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
                {...props}
              >
                {children}
              </a>
            );
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 space-y-0.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-0.5">{children}</ol>;
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
  classNames,
}: MessageProps): JSX.Element | null {
  if (message.kind === 'tool_call') {
    return (
      <div
        className={cn(
          'flex items-start gap-2 text-xs text-muted-foreground',
          classNames?.toolBubble
        )}
      >
        <Wrench className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span className="leading-relaxed">
          Called <span className="font-mono text-foreground/80">{message.toolName}</span>
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
      <div
        className={cn(
          'rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground',
          classNames?.systemBubble
        )}
      >
        {message.content}
      </div>
    );
  }

  const isHuman = message.sender === 'human';

  return (
    <div
      className={cn(
        'flex w-full',
        isHuman ? 'justify-end' : 'justify-start',
        classNames?.root
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed',
          isHuman
            ? cn('bg-primary text-primary-foreground rounded-br-md', classNames?.humanBubble)
            : cn('bg-secondary text-secondary-foreground rounded-bl-md', classNames?.aiBubble)
        )}
      >
        {isHuman ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : streaming && animate ? (
          <TypingText
            text={message.content}
            done={false}
            render={(visible, caret) => (
              <span>
                <Markdown>{visible}</Markdown>
                {caret ? (
                  <span className="inline-block w-[0.5ch] -ml-1 animate-aj-blink align-baseline">
                    ▍
                  </span>
                ) : null}
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
