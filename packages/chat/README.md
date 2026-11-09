# @ajentify/chat

A React npm package that gives developers a fully headless logic layer (Zustand stores + hooks) and an optional UI (plain-CSS components built on Radix) for connecting to the [Ajentify](https://api.ajentify.com) token streaming server.

> **v0.7 adds queued messages, sub-agent cards and a stop button** on top of the connect server's context-runner protocol (`on_queued`, `on_cancelled`, `on_subagent_event`, `on_subagent_complete`). Additive — older servers never send the frames. See [Queued messages, sub-agents, cancel](#queued-messages-sub-agents-cancel) and [CHANGELOG.md](./CHANGELOG.md).

> **v0.6 requires an Ajentify connect server at or after the mainline-beta release.** The streaming protocol that was opt-in (`beta: true`) in 0.4/0.5 is now the only protocol: `add_message` is fire-and-forget, assistant text arrives in segments (`on_message_start` … `on_stop_token`) and the turn ends with `on_turn_complete`. The `beta` config option is deprecated and ignored. See [CHANGELOG.md](./CHANGELOG.md).

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

## Queued messages, sub-agents, cancel

Since 0.7 the connect server runs each context through a single runner with an inbox, so messages can arrive while a turn is generating and agents can spawn and message sub-agents. The package reflects all of it out of the box.

### New frames

| Frame | Store effect | Default UI |
|---|---|---|
| `on_queued { item_id }` | Flags the latest human message (`queued`, `queuedItemId`); stays `'streaming'` through the current turn; cleared on the next `on_message_start` | "Queued" caption under the bubble |
| `on_cancelled { response_id }` | Terminal frame after `stop_invocation`. Marks the partial assistant bubble `cancelled`, fills dangling tool calls with `"cancelled by user"`, `status → 'connected'` | "Stopped" caption, dashed bubble |
| `on_subagent_event { parent_tool_call_id, child_context_id, event }` | Upserts `subagentRuns[parent_tool_call_id]` (child context, latest event, child tool calls + state) | Child's current tool name on the card |
| `on_subagent_complete { parent_tool_call_id, child_context_id, status }` | Sets the run's terminal status (`complete` / `error` / `cancelled`) | Card leaves the processing state |

### Sub-agent cards

Agents use two tools: `create_context` → `{"context_id": …}` and `send_context_message(context_id, message, await_response)`. When `await_response` is true the tool's immediate output is only an acknowledgement; the child's real reply lands later as a separate `send_context_message_response` tool call whose `tool_input.original_tool_call_id` points back at the send. `deriveSubagentCard` folds those pieces into one model:

```ts
import { deriveSubagentCard, useChat } from '@ajentify/chat';

const { messages, subagentRuns } = useChat();
const card = deriveSubagentCard(sendToolCallMessage, messages, subagentRuns);
// card.kind:   'awaiting' | 'sent' | 'created'
// card.status: 'awaiting' | 'complete' | 'error' | 'cancelled'
// card.replyText, card.currentToolName, card.run, card.contextId …
```

- **awaiting** (`await_response: true`) — processing indicator from the ack until the `_response` pair appears (even in a later turn) or `on_subagent_complete` arrives; then shows the reply text.
- **sent** (`await_response: false`) — a small "Sent to sub-agent" chip.
- **created** (`create_context`) — a small "Created sub-agent context" chip.

The derivation is pure and gives the same result for live streams and `GET /context?with_tool_calls` hydration. `<ChatMessages />` does this automatically and hides the linked `_response` row; headless UIs can pass the model to `<Message subagentCard={card} />` or render `<SubagentCard card={card} />` from `@ajentify/chat/ui`.

### Cancel

```tsx
const { cancel, canCancel, isCancelling } = useChat();
<button disabled={!canCancel || isCancelling} onClick={() => void cancel()}>Stop</button>
```

`cancel()` sends `stop_invocation` and resolves with `{ success, cancelled }`; the turn ends with `on_cancelled`. Only this context's turn stops — awaited sub-agents keep running and their replies still land. `<ChatInput />` shows a stop button while `status === 'streaming'` (`showCancelButton={false}` to hide, `onCancel` to override).

### Sending while the agent is busy

`sendMessage()` mid-turn keeps the in-flight partial; the server queues the message and answers `on_queued`. `<ChatInput disableWhileStreaming={false} />` lets users queue follow-ups.

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
