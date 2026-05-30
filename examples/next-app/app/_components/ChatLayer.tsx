'use client';

import type { ReactNode } from 'react';
import { ChatPanel } from '@ajentify/chat/ui';
import { useChatPanel } from '../providers';

// In a real app this would come from your auth/session (e.g.
// `const { user } = useUser()`). We hard-code it here just to show how the
// `newChatView` prop can be personalised per-user.
const CURRENT_USER = { firstName: 'Keanu' };

function NewChatHero({ name }: { name: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary">
        <RocketIcon className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Hello, {name}.<br />What should we do next?
      </h2>
    </div>
  );
}

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

export function ChatLayer({ children }: { children: ReactNode }) {
  const { open, setOpen } = useChatPanel();
  return (
    <ChatPanel
      open={open}
      onOpenChange={setOpen}
      desktopVariant="inline"
      autoCreateContext
      newChatView={<NewChatHero name={CURRENT_USER.firstName} />}
    >
      {children}
    </ChatPanel>
  );
}
