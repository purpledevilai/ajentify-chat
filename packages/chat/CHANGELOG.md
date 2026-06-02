# Changelog

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
