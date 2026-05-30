'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { AjentifyProvider } from '@ajentify/chat';
import { ajentifyEvent } from './_lib/api';

interface ChatPanelControl {
  open: boolean;
  setOpen: (next: boolean) => void;
  toggle: () => void;
}

const ChatPanelContext = createContext<ChatPanelControl | null>(null);

export function useChatPanel(): ChatPanelControl {
  const v = useContext(ChatPanelContext);
  if (!v) throw new Error('useChatPanel outside <Providers>');
  return v;
}

export function Providers({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const control = useMemo<ChatPanelControl>(
    () => ({ open, setOpen, toggle: () => setOpen((o) => !o) }),
    [open]
  );

  // Catch-all for client-side tools. We route the built-in `navigate` tool
  // through Next's app router so the agent can move the user between pages
  // without a full reload.
  const clientSideTools = useCallback(
    async (toolName: string, args: Record<string, unknown>) => {
      if (toolName === 'navigate') {
        const path =
          (args.path as string | undefined) ??
          (args.route as string | undefined) ??
          (args.url as string | undefined);
        if (!path) {
          return { ok: false, error: 'navigate is missing a `path` argument' };
        }
        router.push(path);
        return { ok: true, path };
      }
      return `unhandled client tool: ${toolName}`;
    },
    [router]
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <AjentifyProvider
        config={{
          onAjentifyEvent: ajentifyEvent,
          clientSideTools,
          // Hand the chat the host app's shadcn-style design tokens so the
          // panel and the surrounding chrome stay in lockstep — including
          // when `next-themes` flips `class="dark"` on <html>.
          themeBridge: 'shadcn',
          onError: (err) => {
            console.error('[ajentify]', err);
          },
        }}
      >
        <ChatPanelContext.Provider value={control}>{children}</ChatPanelContext.Provider>
      </AjentifyProvider>
    </ThemeProvider>
  );
}
