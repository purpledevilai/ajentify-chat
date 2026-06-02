'use client';

import * as React from 'react';
import { Sparkles, X } from 'lucide-react';
import { useChatPanel } from '../hooks/useChatPanel';
import { cn } from '../lib/utils';

export interface ChatToggleButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Label shown next to the icon. Pass `null` for an icon-only button. */
  label?: string | null;
  /** Override the open-state icon. Defaults to `<Sparkles />`. */
  icon?: React.ReactNode;
  /** Override the close-state icon (only shown when `swapIconWhenOpen`). */
  closeIcon?: React.ReactNode;
  /**
   * Swap the icon when the chat is open (defaults to true). Set to false to
   * keep the same icon regardless of state.
   */
  swapIconWhenOpen?: boolean;
}

/**
 * Pre-built toggle for the chat panel. Reads / writes the provider's
 * built-in panel state via `useChatPanel()`, so dropping one anywhere in
 * the layout is all you need to give users a way to open the chat.
 *
 * ```tsx
 * import { ChatToggleButton } from '@ajentify/chat/ui';
 *
 * function TopBar() {
 *   return <ChatToggleButton label="Ask Aj" />;
 * }
 * ```
 *
 * Styling lives in `.aj-chat-toggle` (see styles.css) — override any aspect
 * by passing `className`. For maximum customization, call `useChatPanel()`
 * directly and roll your own button.
 */
export const ChatToggleButton = React.forwardRef<HTMLButtonElement, ChatToggleButtonProps>(
  (
    {
      label = 'Chat',
      icon,
      closeIcon,
      swapIconWhenOpen = true,
      className,
      onClick,
      type,
      ...props
    },
    ref
  ) => {
    const { open, toggle } = useChatPanel();

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        toggle();
        onClick?.(e);
      },
      [toggle, onClick]
    );

    const renderedIcon =
      swapIconWhenOpen && open
        ? closeIcon ?? <X aria-hidden />
        : icon ?? <Sparkles aria-hidden />;

    const ariaLabel = label ?? (open ? 'Close chat' : 'Open chat');

    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        onClick={handleClick}
        aria-label={typeof ariaLabel === 'string' ? ariaLabel : undefined}
        aria-expanded={open}
        title={typeof ariaLabel === 'string' ? ariaLabel : undefined}
        className={cn(
          'aj-chat-toggle',
          label === null && 'aj-chat-toggle--icon',
          className,
        )}
        {...props}
      >
        {renderedIcon}
        {label != null ? <span>{label}</span> : null}
      </button>
    );
  }
);
ChatToggleButton.displayName = 'ChatToggleButton';
