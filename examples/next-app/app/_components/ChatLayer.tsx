'use client';

import type { ReactNode } from 'react';
import { ChatPanel } from '@ajentify/chat/ui';
import { useChatPanel } from '../providers';

export function ChatLayer({ children }: { children: ReactNode }) {
  const { open, setOpen } = useChatPanel();
  return (
    <ChatPanel
      open={open}
      onOpenChange={setOpen}
      desktopVariant="inline"
      autoCreateContext
    >
      {children}
    </ChatPanel>
  );
}
