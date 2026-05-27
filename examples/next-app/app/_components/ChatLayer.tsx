'use client';

import { ChatPanel } from '@ajentify/chat/ui';
import { useChatPanel } from '../providers';

export function ChatLayer() {
  const { open, setOpen } = useChatPanel();
  return (
    <ChatPanel
      open={open}
      onOpenChange={setOpen}
      desktopVariant="inline"
      autoCreateContext
    />
  );
}
