# Changelog

## 0.4.0 — Beta streaming protocol + richer tool-call UI

Opt-in **beta streaming protocol** plus a reworked tool-call presentation. All
new behavior is gated behind `beta: true` on the provider config (or the
`TokenStreamingClient`), so existing consumers are unaffected until they opt in.
Requires a token streaming server that understands the beta protocol.

### New: beta streaming protocol (`beta: true`)

```diff
  <AjentifyProvider config={{
    onAjentifyProxyRequest,
+   beta: true,
  }}>
```

When enabled:

- **`connect_to_context` sends `beta: true`.** The server routes to the
  structured-event agent and enables per-round persistence, so long tool-call
  chains and interrupted turns still leave consistent saved history.
- **`add_message` / `client_side_tool_responses` are fire-and-forget.** They no
  longer wait on the 30s RPC reply, so a long agent turn can no longer trip the
  `RPC 'add_message' timed out after 30000ms` error. The turn lifecycle instead
  arrives via notifications.
- **Per-segment message boundaries.** The server emits a fresh
  `on_message_start` before each assistant text segment and an `on_stop_token`
  after it, so a model's preamble text (before a tool call) and its final answer
  render as **separate bubbles** instead of being concatenated into one.
- **New terminal notifications.** `on_turn_complete` signals the whole turn
  (all segments + tools + recursion) is done and input can be re-enabled;
  `on_error` reports a server-side turn failure in place of the RPC error reply
  that is no longer sent.

### Tool calls: merged responses + shimmer + expandable details

- **Tool responses are now merged onto their tool call.** `ToolCallMessage`
  gains an optional `toolOutput` that is filled in when the response arrives,
  instead of appending a separate message. `ToolResponseMessage` is deprecated.
- **Shimmer while running.** A tool call shimmers until its `toolOutput` is
  populated.
- **Expandable details.** Each tool call can be expanded to reveal its input
  parameters and response, pretty-printed when the payload is detected as JSON.

### Migration checklist

1. Bump `@ajentify/chat` to `^0.4.0`.
2. To adopt the new protocol, add `beta: true` to your `<AjentifyProvider>`
   config **and** ensure your token streaming server supports the beta protocol.
   Leaving it off keeps the classic behavior.
3. If you read `ToolResponseMessage` anywhere, switch to reading `toolOutput`
   off the matching `ToolCallMessage`.

## 0.3.1 — Rebrand to "proxy", remove `createAjentifyGatewayClient`

The "gateway" concept is now **"proxy"**. The name communicates what the developer's backend actually does: proxy requests to the Ajentify REST API. The `createAjentifyGatewayClient` factory has been removed entirely — developers now write the `fetch` call directly, keeping full control over auth, headers, credentials, and error handling.

### Breaking changes

#### 1. Config prop rename

```diff
  <AjentifyProvider config={{
-   onAjentifyGateway,
+   onAjentifyProxyRequest,
  }}>
```

#### 2. `createAjentifyGatewayClient` removed

The factory was hiding the integration point. Write a plain function instead:

```diff
- import { createAjentifyGatewayClient } from '@ajentify/chat';
- const onAjentifyGateway = createAjentifyGatewayClient({
-   url: '/api/ajentify/gateway',
-   credentials: 'include',
- });
+ import type { AjentifyProxyRequest } from '@ajentify/chat';
+ async function onAjentifyProxyRequest(request: AjentifyProxyRequest) {
+   const res = await fetch('/api/ajentify/proxy', {
+     method: 'POST',
+     credentials: 'include',
+     headers: { 'content-type': 'application/json' },
+     body: JSON.stringify(request),
+   });
+   if (!res.ok) throw new Error(`Proxy error: ${res.status}`);
+   return res.json();
+ }
```

#### 3. Type renames

| Old | New |
|-----|-----|
| `AjentifyGatewayRequest` | `AjentifyProxyRequest` |
| `AjentifyGatewayHandler` | `AjentifyProxyHandler` |
| `AjentifyGatewayResult` | `AjentifyProxyResult` |

All deprecated aliases (`AjentifyEvent*`, `AjentifyGateway*`, `createAjentifyEventClient`) have been removed.

### Migration checklist

1. Bump `@ajentify/chat` to `^0.4.0`.
2. Replace `createAjentifyGatewayClient(...)` with a plain `async function` that calls `fetch`.
3. Rename the config prop from `onAjentifyGateway` to `onAjentifyProxyRequest`.
4. Update any type imports from `AjentifyGateway*` to `AjentifyProxy*`.
5. Rename your backend route from `/ajentify/gateway` to `/ajentify/proxy` (or whatever you prefer — the SDK doesn't enforce a path).

## 0.3.0 — Rebrand to "gateway", simplify backend contract

The `ajentify-event` concept is now **`ajentify-gateway`**. The name communicates what the developer's backend actually does: authenticate the caller, resolve the `client_id`, and proxy requests to the Ajentify REST API — a security gateway.

### Breaking changes

#### 1. Config prop rename

```diff
  <AjentifyProvider config={{
-   onAjentifyEvent,
+   onAjentifyGateway,
  }}>
```

#### 2. `generate_access_token` no longer requires unwrapping

The SDK now accepts `{ token: string }` (the upstream `/generate-api-key` response) and extracts `.token` internally. Your gateway can return every Ajentify response unchanged — no special cases.

```diff
- // old: had to unwrap the token
- if (event.type === 'generate_access_token') {
-   return (payload as { token: string }).token;
- }
+ // new: just return the response as-is
+ return payload;
```

#### 3. `createAjentifyEventRouter` removed

The `@ajentify/chat/server` subpath no longer exports `createAjentifyEventRouter`, `toExpressHandler`, `toHonoHandler`, or `toNextRouteHandler`. Write your gateway handler directly — it's clearer, more flexible, and lets you fully own auth and `client_id` management in your own framework idiom. See the TodoApp example for a clean reference implementation.

The server subpath still exports all types (`AjentifyGatewayRequest`, `CreateContextResponse`, `FilteredContext`, `HistoryContext`, etc.).

#### 4. `createAjentifyEventClient` → `createAjentifyGatewayClient`

```diff
- import { createAjentifyEventClient } from '@ajentify/chat';
- const onAjentifyEvent = createAjentifyEventClient({ url: '/api/ajentify-event' });
+ import { createAjentifyGatewayClient } from '@ajentify/chat';
+ const onAjentifyGateway = createAjentifyGatewayClient({ url: '/api/ajentify-gateway' });
```

The `parseAccessToken` option is gone — the SDK handles it.

### Type renames (deprecated aliases preserved)

| Old | New |
|-----|-----|
| `AjentifyEvent` | `AjentifyGatewayRequest` |
| `AjentifyEventHandler` | `AjentifyGatewayHandler` |
| `AjentifyEventResult` | `AjentifyGatewayResult` |
| `AjentifyEventClientOptions` | `AjentifyGatewayClientOptions` |

The old names are re-exported as `@deprecated` aliases and will be removed in a future version.

### Migration checklist

1. Bump `@ajentify/chat` to `^0.3.0`.
2. Rename `onAjentifyEvent` to `onAjentifyGateway` in your `<AjentifyProvider>` config.
3. If you used `createAjentifyEventClient`, rename to `createAjentifyGatewayClient`.
4. Remove any `generate_access_token` token unwrapping from your gateway handler — return the Ajentify response unchanged.
5. If you used `createAjentifyEventRouter` from `@ajentify/chat/server`, replace it with a direct handler that calls the Ajentify API yourself. See the TodoApp example backend.
6. Update your backend route path from `/ajentify-event` to `/ajentify-gateway` (or whatever you prefer — the SDK doesn't enforce a path).

## 0.2.3 — Chat history rows: inline delete button + inset cards

Patch release. The chat-history list was rendering each row as a full-bleed `<li position: relative>` with an absolute-positioned trash button overlaying its right edge — `-webkit-line-clamp` doesn't reserve space for absolute siblings, so long previews flowed under the trash icon. Rows also went edge-to-edge against the panel walls.

v0.2.3 restructures the row layout (CSS-only, no JSX changes needed):

- Each `<li>` is now a flex row. The clickable item is `flex: 1 1 auto; min-width: 0;` and the trash button is an inline flex sibling — no more overlap, the preview text gets its full width.
- Rows are inset from the panel edges with `margin: 0.125rem 0.5rem` and have a `border-radius: 0.5rem`, so hover/active backgrounds read as discrete cards rather than full-width bars.
- `.aj-history-item-name` truncates correctly inside the flex row (`flex: 1 1 auto; min-width: 0;`).
- Removed the row-separator border in favor of the small vertical margin between rows — matches the look of ChatGPT/Claude history lists.

## 0.2.2 — Neutral hover surfaces + roomier chat history

Patch release. Two visual fixes for hosts whose shadcn `--accent` token is set to a saturated brand color rather than a subtle hover tint (shadcn's default is `oklch(0.961 0 0)`, but a lot of apps use `--accent` for a secondary brand color):

- **New `--aj-surface-hover` / `--aj-surface-active` tokens** drive all "subtle interactive surface fill" cases inside the chat — ghost button hover, history row hover, the currently-active history row, the new-chat prompt chip hover, the chat toggle button hover, the outline button hover. They default to a foreground-tinted mix (`color-mix(in oklab, var(--aj-foreground) 7%, transparent)`) so they stay neutral regardless of brand colors. Override either token per-theme if you want a more colored treatment.
  - Previously these cases used `var(--aj-accent)` directly, which (via `themeBridge: 'shadcn'`) would inherit whatever the host set `--accent` to. If the host overrode `--accent` to a saturated color, every chat hover lit up that color.
- **Chat history view padding** bumped: header is now `1rem × 0.625rem` (was `0.75rem × 0.5rem`), list has `0.5rem` vertical padding so the first row isn't flush against the header, items are inset `1.25rem` on the left (was `1rem`).
- **`--aj-header-padding-x` / `--aj-header-padding-y` defaults** also bumped to match (`1rem` / `0.625rem`).

No API changes. The `--aj-accent` token still exists and is still used for the `secondary` Button variant, since that one is supposed to follow the brand.

## 0.2.1 — Don't leak chat styling into host content

Patch release. The `.aj-root` wrapper in v0.2.0 set `color`, `background-color`, `font-family`, `box-sizing`, and a `button { ... }` reset, all of which cascaded into the host's own UI (e.g. the page tree wrapped by `<ChatPanel>{children}</ChatPanel>` in inline mode). The `.aj-root button` reset specifically had specificity (0,1,1), beating Tailwind's `.bg-primary` (0,1,0) — so Shadcn buttons inside the chat-panel-host lost their backgrounds.

v0.2.1 rescopes the cosmetics:

- `.aj-root` is now purely a layout wrapper (no font/color/bg/box-sizing/button reset).
- All cosmetics (font, color, background, box-sizing, button reset) apply only to the chat's own surfaces: `.aj-panel-chat`, `.aj-sheet-content`, `.aj-chat-toggle`.
- Host content under `.aj-panel-host-body` keeps its own styling.

No API changes; this is a drop-in patch for any v0.2.0 consumer where the inline `<ChatPanel>` wraps host UI.

## 0.2.0 — Frictionless integration

A ground-up styling + DX overhaul. Every consumer of v0.1 ended up writing the same ~200 lines of glue (event client, server proxy, toggle store, per-tool argument casts, CSS workarounds). v0.2 ships those as first-class helpers and rebuilds the stylesheet as host-agnostic plain CSS.

### Highlights

- **No more Tailwind dependency.** Components are styled with plain `.aj-*` CSS — no Tailwind preflight, no `prose` plugin, no version conflict with the host. The bundled stylesheet is **auto-injected** from `<AjentifyProvider>` on first mount; remove your `import '@ajentify/chat/styles.css'`.
- **Full-color theme tokens.** `--aj-*` are now real CSS colors (hex / rgb / hsl / oklch — any format), not HSL channels. `themeBridge` aliases full colors directly. Drops the old "tokens must be HSL channels" rule that silently broke against oklch hosts.
- **`.aj-prose` typography.** Markdown messages get real H1–H4, paragraph, list, blockquote, code, and table styling out of the box. No more raw-HTML look.
- **`createAjentifyEventClient(...)`** — POST + JSON parse + typed errors + `generate_access_token` unwrap, in one line.
- **`createAjentifyEventRouter(...)`** (new `@ajentify/chat/server` subpath) — framework-agnostic Fetch handler, with `toNextRouteHandler` / `toHonoHandler` / `toExpressHandler` shims.
- **`useChatPanel()` + `<ChatToggleButton />`** — built-in panel store; toggle from anywhere without prop plumbing.
- **`defineClientSideTools<Tools>(...)`** — typed per-tool handler map, no more `args.x as string | undefined`.
- **`onToolCall` callback** on `AjentifyConfig` — analytics-style hook fired for every client-side tool dispatch.
- **`suggestedPrompts`** on `<ChatPanel />` — 1–3 starter chips in the new-chat hero, click to send.
- **Inline "Running `tool_name`…"** indicator on pending client-side tool calls (opt-out via `hideToolRunningIndicator`).
- **Per-variant error messages.** When the dev's `onAjentifyEvent` resolves with the wrong shape, the SDK throws with the *specific* expected vs received hint, not a generic `callback failed`.
- **CSS-var layout knobs** — `--aj-panel-width`, `--aj-messages-padding-x/y`, `--aj-messages-gap`, `--aj-bubble-padding-x/y`, `--aj-bubble-radius`, `--aj-prose-font-size`. Theme without `classNames` overrides.

### Breaking changes

#### 1. Stylesheet import

```diff
- import '@ajentify/chat/styles.css';
```

The provider injects it for you. Set `disableStyleInject: true` if you'd rather pre-load it via your own bundler (the file is still exported).

#### 2. `--aj-*` tokens are full colors

```diff
- --aj-primary: 240 6% 10%;
+ --aj-primary: #18181b; /* or oklch(0.205 0 0), rgb(24,24,27), etc. */
```

If you used the `'shadcn'` `themeBridge` against modern shadcn (v4+, oklch), no action needed — it already passes through.

If you used `themeBridge: 'shadcn'` against **legacy shadcn (v3 HSL channels)**, define a custom bridge that wraps in `hsl(...)`, or upgrade shadcn.

#### 3. `cn()` is now plain `clsx`

`tailwind-merge` is no longer a dependency. Calling code that relied on `cn()` to dedupe Tailwind class conflicts should use `clsx` directly or pass the final string.

#### 4. Workspace style overrides

The `.aj-*` class names are stable but the old set of Tailwind utility classes baked into the bundle (`bg-secondary`, `hover:bg-primary/90`, etc.) is gone. Per-slot `classNames` props still work — they now sit alongside richer CSS-var knobs, which are usually a better fit for theming.

### New package layout

```
@ajentify/chat            — provider, hooks, types, helpers
@ajentify/chat/ui         — React UI components
@ajentify/chat/server     — backend Fetch handler + framework shims (new)
@ajentify/chat/styles.css — plain stylesheet (auto-injected; manual import optional)
```

### Migration checklist

1. Bump `@ajentify/chat` to `^0.2.0`.
2. Delete `import '@ajentify/chat/styles.css'` from your app.
3. Replace your hand-rolled `onAjentifyEvent` with `createAjentifyEventClient({ url: '/api/ajentify-event' })`.
4. If you maintain the backend proxy yourself, optionally swap it for `createAjentifyEventRouter` from `@ajentify/chat/server`.
5. Replace any local chat-panel-open store with `useChatPanel()` / `<ChatToggleButton />`.
6. If you typed your client-side tools yourself, port to `defineClientSideTools<Tools>(...)`.
7. If your `--aj-*` overrides used HSL-channel syntax, switch them to full CSS colors.
