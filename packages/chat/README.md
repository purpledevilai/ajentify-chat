# @ajentify/chat

A React npm package that gives developers a fully headless logic layer (Zustand stores + hooks) and an optional UI (shadcn-style components built on Radix + Tailwind) for connecting to the [Ajentify](https://api.ajentify.com) token streaming server.

## Install

```bash
npm install @ajentify/chat
# or
pnpm add @ajentify/chat
```

The package ships **precompiled styles** so you don't need Tailwind in your app. Import once near the root:

```ts
import '@ajentify/chat/styles.css';
```

## Wire the provider

```tsx
import { AjentifyProvider } from '@ajentify/chat';
import { ChatPanel } from '@ajentify/chat/ui';

export function App() {
  return (
    <AjentifyProvider
      config={{
        callbacks: {
          createContext: async (req) =>
            fetch('/api/ajentify/context', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(req ?? {}),
            }).then((r) => r.json()),
          generateAccessToken: async ({ contextId }) =>
            fetch(`/api/ajentify/token`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ context_id: contextId }),
            })
              .then((r) => r.json())
              .then((j) => j.token),
          getContext: async (id) =>
            fetch(`/api/ajentify/context/${id}`).then((r) => r.json()),
          getContextHistory: async () =>
            fetch(`/api/ajentify/context-history`).then((r) => r.json()),
        },
        // optional fallback for non-built-in client side tools:
        clientSideTools: {
          fallback: async (toolName, args) => {
            return `unhandled tool: ${toolName}`;
          },
        },
      }}
    >
      <YourApp />
      <ChatPanel defaultOpen={false} />
    </AjentifyProvider>
  );
}
```

The four callbacks are proxied through your own backend so your Ajentify **org-scoped API key never reaches the browser**.

## Hooks

```ts
import {
  useChat,
  useCurrentContext,
  useContexts,
  useContextHistory,
  useClientSideTools,
  useGetPageData,
  useDoPageAction,
  useAjentifyConfig,
} from '@ajentify/chat';
```

`useChat()` is the convenience hook:

```ts
const { messages, send, status, agent, pendingResponse } = useChat();
```

## Page-level tools

The agent can call two special tools — `get_page_data` and `do_page_action` — to read the current page and act on it. Mount these from any page:

```tsx
useGetPageData(() => ({
  data: { selected_order_id: orderId },
  actions: {
    refund_order: {
      description: 'Refund the currently selected order',
      argsSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
    },
  },
}), [orderId]);

useDoPageAction(async (key, args) => {
  if (key === 'refund_order') {
    await refundOrder(orderId, args.amount as number);
    return { ok: true };
  }
  throw new Error(`unknown action: ${key}`);
}, [orderId]);
```

## UI

Importing from `@ajentify/chat/ui` is **optional** — use the headless hooks if you want your own UI. If you want the bundled experience:

```tsx
import { ChatPanel, ChatView, ChatHeader, ChatMessages, ChatInput } from '@ajentify/chat/ui';
```

`<ChatPanel />` is opinionated: slide-in from the right, draggable resize handle on desktop, full-screen sheet on mobile. `<ChatView />` is the fill-parent variant if you want to drop it inside your own layout.

## Theming

The chat uses CSS variables under the `--aj-*` namespace. To re-skin, override them in your stylesheet:

```css
:root {
  --aj-primary: 270 95% 60%;
  --aj-radius: 1rem;
}
.dark {
  --aj-background: 240 10% 4%;
}
```

If you already use shadcn/ui, add `themeBridge: 'shadcn'` to the provider config and the chat will pick up your existing tokens automatically.

Every component also accepts a `classNames` prop for per-slot Tailwind overrides:

```tsx
<ChatView classNames={{ messages: { aiBubble: 'bg-blue-100' } }} />
```

## SSR / Next.js

All components and hooks that touch browser APIs are marked `"use client"`. Put `<AjentifyProvider>` inside a client component near the root. `TokenStreamingClient` and the types are server-safe and can be imported from Server Components.
