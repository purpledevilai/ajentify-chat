# @ajentify/chat

A React npm package that gives developers a fully headless logic layer (Zustand stores + hooks) and an optional UI (plain-CSS components built on Radix) for connecting to the [Ajentify](https://api.ajentify.com) token streaming server.

> **v0.2 is a major release.** It's frictionless out of the box: no Tailwind / typography-plugin requirement on the host, auto-injected styles, full-color theme tokens, and built-in helpers for the event client, server router, panel state, and typed client-side tools. See [CHANGELOG.md](./CHANGELOG.md) for the migration steps.

## Install

```bash
npm install @ajentify/chat
# or
pnpm add @ajentify/chat
```

That's it — the chat's stylesheet is auto-injected from `<AjentifyProvider>` on first mount. No `import '@ajentify/chat/styles.css'` line, no Tailwind setup on the host. (If you want SSR pre-paint, the file is still exported and can be imported manually.)

## Quickstart

```tsx
import { AjentifyProvider, createAjentifyEventClient } from '@ajentify/chat';
import { ChatPanel, ChatToggleButton } from '@ajentify/chat/ui';

const onAjentifyEvent = createAjentifyEventClient({
  url: '/api/ajentify-event',
  credentials: 'include',
});

export function App() {
  return (
    <AjentifyProvider config={{ onAjentifyEvent }}>
      <header>
        <ChatToggleButton label="Ask Aj" />
      </header>
      <ChatPanel desktopVariant="inline">
        <YourPages />
      </ChatPanel>
    </AjentifyProvider>
  );
}
```

The backend route `/api/ajentify-event` proxies every event variant to the Ajentify REST API with your **org-scoped API key** so it never reaches the browser:

```ts
// app/api/ajentify-event/route.ts (Next.js App Router)
import { createAjentifyEventRouter, toNextRouteHandler } from '@ajentify/chat/server';
import { cookies } from 'next/headers';

const handler = createAjentifyEventRouter({
  apiKey: process.env.AJENTIFY_API_KEY!,
  agentId: process.env.AJENTIFY_AGENT_ID!,
  getClientId: () => cookies().get('ajentify_client_id')?.value ?? null,
  setClientId: (_req, id) => cookies().set('ajentify_client_id', id, { httpOnly: true }),
});

export const POST = toNextRouteHandler(handler);
```

Express / Hono shims are exported alongside `toNextRouteHandler` from `@ajentify/chat/server`.

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
  useChatPanel,        // v0.2: open/close the panel from anywhere
  useAjentifyConfig,
} from '@ajentify/chat';
```

`useChat()` is the convenience hook:

```ts
const { messages, send, status, agent, pendingResponse } = useChat();
```

`useChatPanel()` reads/writes the built-in panel state — pair it with `<ChatToggleButton />` or roll your own button. Pass `open` / `onOpenChange` to `<ChatPanel />` to take over manually.

## Client-side tools

`defineClientSideTools<TTools>(...)` is a typed dispatcher that replaces the `args.x as string | undefined` casts every consumer was writing by hand:

```ts
import { defineClientSideTools } from '@ajentify/chat';

type Tools = {
  list_todos: { args: {}; result: Todo[] };
  navigate:   { args: { path: string }; result: { ok: boolean } };
};

const clientSideTools = defineClientSideTools<Tools>({
  list_todos: () => api.listTodos(),
  navigate:   ({ path }) => { router.push(path); return { ok: true }; },
});

<AjentifyProvider config={{ onAjentifyEvent, clientSideTools }}>
```

Missing handlers throw a descriptive `AjentifyError` and warn in dev.

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
import {
  ChatPanel,
  ChatView,
  ChatHeader,
  ChatMessages,
  ChatInput,
  ChatToggleButton,
} from '@ajentify/chat/ui';
```

`<ChatPanel />` is opinionated: slide-in from the right, draggable resize handle on desktop, full-screen sheet on mobile. `<ChatView />` is the fill-parent variant if you want to drop it inside your own layout.

### Starter prompts

Render 1–3 starter chips on the new-chat hero — clicking sends instantly:

```tsx
<ChatPanel
  suggestedPrompts={['How does X work?', 'Show me my open orders']}
  newChatView={`Hey there, ${user.firstName}`}
/>
```

### Mount behaviour

When `<ChatView />` (or `<ChatPanel />`) mounts on a fresh session, it auto-calls `startNewContext()` so the user lands on a ready-to-type chat. The provider's `agentSpeaksFirst` flag is the only knob:

- `agentSpeaksFirst: false` (default) — enters a local `'draft'` state. No `create_context` call is made until the user sends their first message.
- `agentSpeaksFirst: true` — eagerly calls `create_context` and opens the WebSocket so the agent can stream its greeting before the user types.

If the eager call fails, the chat falls back to a "Couldn't start a new chat — Try again" affordance and does not auto-retry. Customise it with the `emptyState` prop.

## Theming

Every visual surface is themed through **plain CSS custom properties** under the `--aj-*` namespace. v0.2 ships them as **full CSS colors** (not HSL channels), so any color format works — `oklch(...)`, `#hex`, `rgb(...)`, `hsl(...)`. Alpha modulation is done internally via `color-mix(...)`.

```css
:root {
  --aj-primary: oklch(0.55 0.18 270);
  --aj-radius: 1rem;
}
.dark {
  --aj-background: #0a0a0a;
  --aj-foreground: #fafafa;
}
```

Layout / spacing knobs are CSS variables too:

```css
:root {
  --aj-panel-width: 480px;
  --aj-messages-padding-x: 1.5rem;
  --aj-messages-padding-y: 2rem;
  --aj-messages-gap: 1rem;
  --aj-bubble-padding-x: 1rem;
  --aj-bubble-padding-y: 0.625rem;
  --aj-bubble-radius: 1.25rem;
  --aj-prose-font-size: 0.9375rem;
}
```

### shadcn / Radix Themes / Mantine bridge

Hand the chat your host's CSS variables — full colors pass through directly:

```tsx
<AjentifyProvider config={{ onAjentifyEvent, themeBridge: 'shadcn' }}>
```

Or supply a custom map:

```tsx
themeBridge={{
  tokens: {
    background: '--mantine-color-body',
    foreground: '--mantine-color-text',
    primary:    '--mantine-color-blue-6',
    border:     '--mantine-color-default-border',
  },
}}
```

### Per-slot overrides

Every component still accepts a `classNames` prop for one-off tweaks; in most apps the CSS variables alone are enough.

## SSR / Next.js

All components and hooks that touch browser APIs are marked `"use client"`. Put `<AjentifyProvider>` inside a client component near the root. `TokenStreamingClient`, the types, and `@ajentify/chat/server` are server-safe.
