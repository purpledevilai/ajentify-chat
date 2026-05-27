# ajentify-chat-example-backend

A minimal Node/Express server that demonstrates the four endpoints `@ajentify/chat` expects a developer's backend to expose:

| Method | Path                          | What it does                                                                                     |
| ------ | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| POST   | `/api/ajentify/context`       | Creates a context for the demo user and persists their `client_id`                              |
| GET    | `/api/ajentify/context/:id`   | Fetches a previously-created context                                                             |
| POST   | `/api/ajentify/token`         | Mints a short-lived client API key scoped to the demo user's `client_id`                         |
| GET    | `/api/ajentify/context-history` | Returns the chat history for the demo user's `client_id`                                       |

The dev user is identified via a `aj_demo_user` cookie. The first request issues a fresh demo-user id; subsequent requests reuse it. The mapping from demo-user → `client_id` lives in `data/users.json` (auto-created).

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `AJENTIFY_ORG_API_KEY` — your Ajentify org API key (from the dashboard)
   - `AJENTIFY_AGENT_ID` — the agent id to chat with
   - `AJENTIFY_ORG_ID` — your Ajentify org id (used by `/generate-api-key`)
2. From the monorepo root: `pnpm install`
3. From the monorepo root: `pnpm dev:backend`

The server listens on `:4000` by default.
