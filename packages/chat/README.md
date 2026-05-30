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
        createContext: async (req) =>
          fetch('/api/ajentify/context', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(req ?? {}),
          }).then((r) => r.json()),
        generateAccessToken: async () =>
          // Your backend identifies the user from its own session and mints
          // a token from their `client_id`. `contextId` is also passed in
          // (not used here) — handy if you want to access-check it.
          fetch(`/api/ajentify/token`, { method: 'POST' })
            .then((r) => r.json())
            .then((j) => j.token),
        getContext: async (id) =>
          fetch(`/api/ajentify/context/${id}`).then((r) => r.json()),
        getContextHistory: async () =>
          fetch(`/api/ajentify/context-history`).then((r) => r.json()),
        // Optional catch-all for non-built-in client-side tools.
        // (`get_page_data` / `do_page_action` are handled automatically by the
        // `useGetPageData` / `useDoPageAction` hooks. The `navigate` tool can
        // be handled here too — see "Navigation" below.)
        clientSideTools: async (toolName, args) => `unhandled tool: ${toolName}`,
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

### Navigation

The built-in `navigate` tool lets the agent move the user between routes. Handle it from the provider's `clientSideTools` catch-all so it can use whatever router your app uses:

```tsx
// React Router v6 — call useNavigate() inside a component that lives
// under <BrowserRouter />, then pass the function into clientSideTools.
const navigate = useNavigate();

<AjentifyProvider
  config={{
    // ...
    clientSideTools: async (toolName, args) => {
      if (toolName === 'navigate') {
        const path = (args.path ?? args.route ?? args.url) as string | undefined;
        if (!path) return { ok: false, error: 'navigate is missing a `path` argument' };
        navigate(path);
        return { ok: true, path };
      }
      return `unhandled client tool: ${toolName}`;
    },
  }}
>
```

For Next.js App Router, swap `useNavigate()` for `useRouter()` from `next/navigation` and call `router.push(path)`.

## UI

Importing from `@ajentify/chat/ui` is **optional** — use the headless hooks if you want your own UI. If you want the bundled experience:

```tsx
import { ChatPanel, ChatView, ChatHeader, ChatMessages, ChatInput } from '@ajentify/chat/ui';
```

`<ChatPanel />` is opinionated: slide-in from the right, draggable resize handle on desktop, full-screen sheet on mobile. `<ChatView />` is the fill-parent variant if you want to drop it inside your own layout.

### Mount behaviour

When `<ChatView />` (or `<ChatPanel />`) mounts on a fresh session, it auto-calls `startNewContext()` so the user lands on a ready-to-type chat. The provider's `agentSpeaksFirst` flag is the only knob:

- `agentSpeaksFirst: false` (default) — enters a local `'draft'` state. No `create_context` call is made until the user sends their first message. Cheap mounts; perfect for embeds where most opens never become real conversations.
- `agentSpeaksFirst: true` — eagerly calls `create_context` and opens the WebSocket so the agent can stream its greeting before the user types.

```tsx
<AjentifyProvider config={{ ...rest, agentSpeaksFirst: true }}>
  <ChatPanel />
</AjentifyProvider>
```

If the eager call fails, the chat falls back to a "Couldn't start a new chat — Try again" affordance and does not auto-retry. Customise it with the `emptyState` prop on `<ChatView />` / `<ChatPanel />`.

## Theming

The chat is themed entirely through **CSS custom properties** under the
`--aj-*` namespace. That means:

- Theme changes are **live** — toggling a class on `<html>` (or swapping a
  `data-theme` attribute, or matching `prefers-color-scheme`) re-resolves the
  variables and the chat repaints in place. No React props to thread, no
  re-renders.
- Whatever styling system your host uses works — Tailwind, plain CSS, CSS-in-JS,
  Radix Themes, Mantine, MUI — as long as you can set CSS variables.

Pick the integration that matches your app:

### 1. Direct: define `--aj-*` yourself

The simplest path. Override any token in your own stylesheet — values are
HSL channels (no `hsl(...)` wrapper, no commas) so the chat can compose them
with alpha utilities:

```css
:root {
  --aj-primary: 270 95% 60%;
  --aj-radius: 1rem;
}
.dark {
  --aj-background: 240 10% 4%;
  --aj-foreground: 0 0% 98%;
}
```

No provider config needed. Toggle dark mode by adding/removing `class="dark"`
on `<html>` (or any ancestor of the chat) — the chat updates immediately.

### 2. shadcn/ui bridge

If your app already defines shadcn's un-prefixed `--background`, `--foreground`,
`--primary`, ... tokens, point the chat at them with one option:

```tsx
<AjentifyProvider config={{ ...rest, themeBridge: 'shadcn' }}>
```

The bridge declares aliases under `:root`, `.dark`, **and** `[data-theme]`,
so dark-mode shadcn values reach the chat regardless of which selector
strategy you use to flip themes.

### 3. Custom token map

For hosts that don't follow the shadcn naming, hand the bridge a map from
chat tokens to your own variable names:

```tsx
<AjentifyProvider
  config={{
    ...rest,
    themeBridge: {
      tokens: {
        background: '--my-app-bg',
        foreground: '--my-app-fg',
        primary: '--my-app-accent',
        border: '--my-app-line',
      },
      // optional — defaults to [':root', '.dark', '[data-theme]']
      // selectors: [':root', '[data-mode="dark"]'],
    },
  }}
>
```

Any tokens you don't list keep their built-in defaults, so you can theme as
much or as little as you want.

### Per-slot overrides

Every component also accepts a `classNames` prop for fine-grained tweaks:

```tsx
<ChatView classNames={{ messages: { aiBubble: 'bg-blue-100' } }} />
```

## SSR / Next.js

All components and hooks that touch browser APIs are marked `"use client"`. Put `<AjentifyProvider>` inside a client component near the root. `TokenStreamingClient` and the types are server-safe and can be imported from Server Components.
