'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { AjentifyProvider } from '@ajentify/chat';
import { api } from './_lib/api';

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

  const control = useMemo<ChatPanelControl>(
    () => ({ open, setOpen, toggle: () => setOpen((o) => !o) }),
    [open]
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="light">
      <AjentifyProvider
        config={{
          callbacks: {
            createContext: api.createContext,
            getContext: api.getContext,
            generateAccessToken: ({ contextId }) => api.generateAccessToken(contextId),
            getContextHistory: () =>
              api.getContextHistory().then((r) => r.contexts),
          },
          clientSideTools: {
            fallback: async (toolName) => `unhandled client tool: ${toolName}`,
          },
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
