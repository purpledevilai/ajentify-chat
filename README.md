# @ajentify/chat

A React npm package that gives developers a complete (but optional) chat UI plus a fully headless logic layer for connecting to the [Ajentify](https://api.ajentify.com) token streaming server.

This repository is a pnpm monorepo:

```
packages/
  chat/                  -> published as @ajentify/chat
examples/
  backend/               -> Node/Express dev backend (proxies to Ajentify REST)
  react-vite/            -> Vite + React example app
  next-app/              -> Next.js App Router example app
```

## Quick start

```bash
pnpm install
pnpm build           # build the @ajentify/chat package
pnpm dev:backend     # start the dev backend on :4000
pnpm dev:vite        # start the Vite example on :5173
pnpm dev:next        # start the Next.js example on :3000
```

Create `examples/backend/.env` with:

```
AJENTIFY_ORG_API_KEY=...
AJENTIFY_AGENT_ID=...
AJENTIFY_ORG_ID=...
PORT=4000
```

## Package overview

`@ajentify/chat` exports two entry points:

- `@ajentify/chat` — the logic layer: `AjentifyProvider`, hooks (`useChat`, `useCurrentContext`, `useContexts`, `useContextHistory`, `useClientSideTools`, `useGetPageData`, `useDoPageAction`), and the standalone `TokenStreamingClient`.
- `@ajentify/chat/ui` — the optional UI: `ChatView`, `ChatPanel`, `ChatHeader`, `ChatMessages`, `ChatInput`, `ChatHistory`, `Message`, `TypingText`.

Import the precompiled styles once near the root of your app:

```ts
import '@ajentify/chat/styles.css';
```

See `packages/chat/README.md` for the full developer-facing reference.
