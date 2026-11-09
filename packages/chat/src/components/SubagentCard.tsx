'use client';

import * as React from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { SubagentCard as SubagentCardModel } from '../types';
import { cn } from '../lib/utils';

export interface SubagentCardClassNames {
  /** The full card (`kind: 'awaiting'`). */
  root?: string;
  /** The compact chip (`kind: 'sent' | 'created'`). */
  chip?: string;
  /** The child's reply text block. */
  reply?: string;
}

export interface SubagentCardProps {
  card: SubagentCardModel;
  /** Hide the processing spinner / shimmer while awaiting. Defaults to false. */
  hideRunningIndicator?: boolean;
  classNames?: SubagentCardClassNames;
}

function shortId(id: string | undefined): string | null {
  if (!id) return null;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Renders a sub-agent tool call. `send_context_message` with
 * `await_response: true` is a card with a processing indicator, the child's
 * current tool, and the reply text once it lands; `await_response: false`
 * and `create_context` render as small chips. Pure: pass the model from
 * `deriveSubagentCard` (or `useChat().subagentRuns` + the messages).
 */
export function SubagentCard({
  card,
  hideRunningIndicator = false,
  classNames,
}: SubagentCardProps): JSX.Element {
  if (card.kind !== 'awaiting') {
    return <SubagentChip card={card} className={classNames?.chip} />;
  }
  return (
    <AwaitingCard
      card={card}
      hideRunningIndicator={hideRunningIndicator}
      className={classNames?.root}
      replyClassName={classNames?.reply}
    />
  );
}

function SubagentChip({
  card,
  className,
}: {
  card: SubagentCardModel;
  className?: string;
}): JSX.Element {
  const pending = card.status === 'awaiting';
  const cancelled = card.status === 'cancelled';
  const id = shortId(card.contextId);
  const label =
    card.kind === 'created'
      ? pending
        ? 'Creating sub-agent context'
        : cancelled
          ? 'Sub-agent context creation cancelled'
          : 'Created sub-agent context'
      : pending
        ? 'Sending to sub-agent'
        : cancelled
          ? 'Send to sub-agent cancelled'
          : 'Sent to sub-agent';
  const Icon = card.kind === 'created' ? Sparkles : Send;
  return (
    <div
      className={cn(
        'aj-subagent-chip',
        pending && 'aj-subagent-chip--pending',
        cancelled && 'aj-subagent-chip--cancelled',
        className
      )}
      title={card.message ?? undefined}
    >
      {pending ? (
        <Loader2 className="aj-spin" aria-hidden />
      ) : cancelled ? (
        <XCircle aria-hidden />
      ) : (
        <Icon aria-hidden />
      )}
      <span className={cn(pending && 'aj-shimmer-text')}>{label}</span>
      {id ? <span className="aj-subagent-id">{id}</span> : null}
    </div>
  );
}

function AwaitingCard({
  card,
  hideRunningIndicator,
  className,
  replyClassName,
}: {
  card: SubagentCardModel;
  hideRunningIndicator: boolean;
  className?: string;
  replyClassName?: string;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const awaiting = card.status === 'awaiting';
  const showRunning = awaiting && !hideRunningIndicator;
  const id = shortId(card.contextId);

  const headline =
    card.status === 'awaiting'
      ? card.ack == null
        ? 'Asking sub-agent'
        : 'Waiting for sub-agent'
      : card.status === 'complete'
        ? card.replyText != null
          ? 'Sub-agent replied'
          : 'Sub-agent finished'
        : card.status === 'error'
          ? 'Sub-agent failed'
          : 'Sub-agent request cancelled';

  const StatusIcon =
    card.status === 'complete'
      ? Check
      : card.status === 'error'
        ? AlertCircle
        : card.status === 'cancelled'
          ? XCircle
          : Bot;

  const childToolCalls = card.run?.toolCalls ?? [];
  const hasDetails = Boolean(card.message) || childToolCalls.length > 0;

  return (
    <div
      className={cn(
        'aj-subagent',
        `aj-subagent--${card.status}`,
        className
      )}
      aria-live={awaiting ? 'polite' : undefined}
    >
      <button
        type="button"
        className="aj-subagent-header"
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
          <StatusIcon aria-hidden />
        )}
        <span className={cn('aj-subagent-title', showRunning && 'aj-shimmer-text')}>
          {headline}
        </span>
        {id ? <span className="aj-subagent-id">{id}</span> : null}
        {showRunning ? <Loader2 className="aj-spin aj-subagent-spin" aria-hidden /> : null}
      </button>

      {awaiting && card.currentToolName ? (
        <div className="aj-subagent-activity">
          <span className={cn(showRunning && 'aj-shimmer-text')}>
            {card.run?.toolCalls.some((t) => t.state === 'running') ? 'Running ' : 'Ran '}
            <span className="aj-tool-call-name">{card.currentToolName}</span>
          </span>
        </div>
      ) : null}

      {open && hasDetails ? (
        <div className="aj-subagent-details">
          {card.message ? (
            <div className="aj-tool-call-section">
              <div className="aj-tool-call-section-title">Message</div>
              <pre className="aj-tool-call-pre">{card.message}</pre>
            </div>
          ) : null}
          {childToolCalls.length > 0 ? (
            <div className="aj-tool-call-section">
              <div className="aj-tool-call-section-title">Sub-agent tools</div>
              <ul className="aj-subagent-tools">
                {childToolCalls.map((t) => (
                  <li key={t.toolCallId} className="aj-subagent-tool">
                    {t.state === 'running' ? (
                      <Loader2 className="aj-spin" aria-hidden />
                    ) : (
                      <Check aria-hidden />
                    )}
                    <span className="aj-tool-call-name">{t.toolName}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {card.status === 'error' ? (
        <div className="aj-subagent-error">
          {card.errorMessage ?? 'The sub-agent reported an error.'}
        </div>
      ) : null}

      {card.replyText != null ? (
        <div className={cn('aj-subagent-reply', replyClassName)}>
          <span style={{ whiteSpace: 'pre-wrap' }}>{card.replyText}</span>
        </div>
      ) : null}
    </div>
  );
}
