'use client';

import * as React from 'react';

export interface TypingTextProps {
  /** The current "complete so far" text. When new tokens stream in, just update this prop. */
  text: string;
  /** When true, render at full speed (used after `on_stop_token`). */
  done?: boolean;
  /** Steady-state characters per second. Defaults to 80. */
  cps?: number;
  /** Custom render function for the text. Defaults to a `<span>`. */
  render?: (visible: string, isCaret: boolean) => React.ReactNode;
  className?: string;
}

/**
 * Smoothly reveals an incoming string token by token. Internally it maintains
 * a `rendered` substring of the latest `text` and advances at most
 * `charsPerFrame` per RAF tick. When `done` is true it accelerates so the
 * caret catches up quickly without ever overshooting.
 */
export function TypingText({
  text,
  done = false,
  cps = 80,
  render,
  className,
}: TypingTextProps): JSX.Element {
  const [visible, setVisible] = React.useState('');
  const visibleRef = React.useRef('');
  const targetRef = React.useRef(text);
  const rafRef = React.useRef<number | null>(null);
  const lastTickRef = React.useRef<number>(0);

  React.useEffect(() => {
    targetRef.current = text;
    // If the target ever shrinks (history reset / new message), snap.
    if (text.length < visibleRef.current.length) {
      visibleRef.current = text;
      setVisible(text);
    }
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, done]);

  const schedule = React.useCallback(() => {
    if (rafRef.current != null) return;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame === 'undefined') {
      // SSR / test fallback: jump to target.
      visibleRef.current = targetRef.current;
      setVisible(targetRef.current);
      return;
    }
    lastTickRef.current = performance.now();
    rafRef.current = window.requestAnimationFrame(tick);
  }, []);

  const tick = React.useCallback(
    (now: number) => {
      rafRef.current = null;
      const elapsed = Math.max(0, now - lastTickRef.current);
      lastTickRef.current = now;

      const target = targetRef.current;
      const current = visibleRef.current;
      if (current.length >= target.length) {
        if (done) return; // nothing more coming
        // Wait for next text update.
        return;
      }
      const remainingGap = target.length - current.length;
      // Baseline rate from cps, scaled by elapsed time.
      const baseAdvance = Math.max(1, Math.round((cps * elapsed) / 1000));
      // Catch-up scaling so we never lag too far behind.
      const catchupScale = done ? Math.max(1, remainingGap / 8) : 1 + remainingGap / 200;
      const charsThisFrame = Math.min(
        remainingGap,
        Math.max(1, Math.round(baseAdvance * catchupScale))
      );
      const next = target.slice(0, current.length + charsThisFrame);
      visibleRef.current = next;
      setVisible(next);
      if (next.length < target.length || !done) {
        rafRef.current = window.requestAnimationFrame(tick);
      }
    },
    [cps, done]
  );

  React.useEffect(
    () => () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    []
  );

  if (render) {
    return <span className={className}>{render(visible, !done && visible.length < text.length)}</span>;
  }

  return (
    <span className={className}>
      {visible}
      {!done && visible.length < text.length ? (
        <span className="inline-block w-[0.5ch] animate-aj-blink">▍</span>
      ) : null}
    </span>
  );
}
