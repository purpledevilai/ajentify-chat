/**
 * `@ajentify/chat/server`
 *
 * Framework-agnostic backend helper for the chat's `ajentify-event` proxy.
 *
 * Consumers point `createAjentifyEventClient({ url: '/api/ajentify-event' })`
 * at a route that dispatches every event variant to the public Ajentify
 * REST API with their org API key. v0.1 made every consumer write that
 * ~80-line dispatcher from scratch; v0.2 ships the canonical version here.
 *
 * The exported `createAjentifyEventRouter` returns a Web-standard
 * `(req: Request) => Promise<Response>` handler. Mount it directly in any
 * framework that speaks Fetch (Next.js Route Handlers, Hono, Bun, Deno,
 * SvelteKit, Cloudflare Workers, etc.) or use the shims below.
 *
 * Important: this handler ONLY proxies; it does not authenticate. Wrap it
 * with your own auth middleware so only signed-in users can hit it.
 */

export type {
  AjentifyEvent,
  AjentifyEventResult,
  CreateContextRequest,
  CreateContextResponse,
  FilteredContext,
  HistoryContext,
} from './types';

import {
  type AjentifyEvent,
  type CreateContextResponse,
  type FilteredContext,
  type HistoryContext,
} from './types';

export type GetClientId = (req: Request) => Promise<string | null> | string | null;
export type SetClientId = (req: Request, clientId: string) => Promise<void> | void;

export interface AjentifyEventRouterOptions {
  /** The org-scoped Ajentify API key (server-side only — never expose to the client). */
  apiKey: string;
  /** The agent id the chat should attach to (defaults to the agent the API key resolves). */
  agentId?: string;
  /** Override the Ajentify API base URL. Defaults to `https://api.ajentify.com`. */
  baseUrl?: string;
  /**
   * Resolve the user's persisted `client_id` from the request (e.g. read a
   * cookie or your own DB). Return `null` for first-time users — the
   * router will mint a new client_id during `create_context`.
   */
  getClientId: GetClientId;
  /** Persist a freshly-minted `client_id` against the authenticated user. */
  setClientId: SetClientId;
  /**
   * Override the access-token TTL (in seconds) when minting client API
   * keys via `generate_access_token`. Defaults to 5 minutes — matches the
   * AgentLambda reference implementation.
   */
  accessTokenTtlSeconds?: number;
  /** Override the `fetch` implementation (testing, Edge runtimes, etc.). */
  fetch?: typeof fetch;
  /**
   * If your `/POST /context` endpoint returns the *full* Context shape (with
   * `messages` etc.) rather than the FilteredContext shape, set this to
   * `true`. Default `false` — matches `transform_to_filtered_context`.
   */
  passThroughCreateContext?: boolean;
  /**
   * Extra fields to merge into the upstream `POST /context` body alongside
   * the chat's own `agent_id` / `client_id`. Use this when you address agents
   * by `(stage, agent)` instead of a UUID, or to inject server-only
   * `user_defined` / `prompt_args` defaults the client should not control.
   */
  extraCreateContextBody?:
    | Record<string, unknown>
    | ((req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>);
}

const DEFAULT_BASE_URL = 'https://api.ajentify.com';
const DEFAULT_ACCESS_TOKEN_TTL = 60 * 5;

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON');
  }
}

function isAjentifyEvent(raw: unknown): raw is AjentifyEvent {
  if (!isPlainObject(raw)) return false;
  switch (raw.type) {
    case 'create_context':
    case 'generate_access_token':
    case 'get_context_history':
      return true;
    case 'get_context':
    case 'delete_context':
      return typeof raw.contextId === 'string' && raw.contextId.length > 0;
    default:
      return false;
  }
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Build a Fetch-style handler that proxies a chat event to the upstream
 * Ajentify REST API. Throws `HttpError` (translated into a JSON response
 * by `createAjentifyEventRouter`).
 */
async function callUpstream(
  options: AjentifyEventRouterOptions,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const f = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await f(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-api-key': options.apiKey,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(
      res.status === 401 || res.status === 403 ? 500 : res.status,
      `Ajentify ${path} returned ${res.status} ${res.statusText}${body ? ' — ' + body.slice(0, 240) : ''}`,
    );
  }
  if (res.status === 204) return null;
  return res.json();
}

/**
 * Mint a fresh client_id by hitting `POST /client`.
 * The chat needs one before `create_context`.
 */
async function mintClientId(opts: AjentifyEventRouterOptions): Promise<string> {
  const created = await callUpstream(opts, '/client', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!isPlainObject(created) || typeof created.client_id !== 'string') {
    throw new HttpError(500, 'POST /client did not return a client_id');
  }
  return created.client_id;
}

async function handleCreateContext(
  opts: AjentifyEventRouterOptions,
  req: Request,
  event: Extract<AjentifyEvent, { type: 'create_context' }>,
): Promise<CreateContextResponse> {
  let clientId = await opts.getClientId(req);
  if (!clientId) {
    clientId = await mintClientId(opts);
    await opts.setClientId(req, clientId);
  }
  const extra = opts.extraCreateContextBody;
  const resolvedExtra =
    typeof extra === 'function' ? await extra(req) : extra ?? {};
  const body = {
    ...resolvedExtra,
    ...(opts.agentId ? { agent_id: opts.agentId } : {}),
    ...(event.request ?? {}),
    client_id: clientId,
  };
  const created = (await callUpstream(opts, '/context', {
    method: 'POST',
    body: JSON.stringify(body),
  })) as CreateContextResponse;
  return created;
}

async function handleGenerateAccessToken(
  opts: AjentifyEventRouterOptions,
  req: Request,
): Promise<{ token: string }> {
  const clientId = await opts.getClientId(req);
  if (!clientId) {
    throw new HttpError(
      409,
      'No client_id yet; the chat must create a context before requesting an access token.',
    );
  }
  const minted = await callUpstream(opts, '/generate-api-key', {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      expires_in_seconds: opts.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL,
    }),
  });
  if (!isPlainObject(minted) || typeof minted.token !== 'string') {
    throw new HttpError(
      500,
      `POST /generate-api-key did not return a 'token' string`,
    );
  }
  return { token: minted.token };
}

async function handleGetContext(
  opts: AjentifyEventRouterOptions,
  req: Request,
  event: Extract<AjentifyEvent, { type: 'get_context' }>,
): Promise<FilteredContext> {
  const clientId = await opts.getClientId(req);
  if (!clientId) throw new HttpError(404, 'Context not found');
  const ctx = (await callUpstream(
    opts,
    `/context/${encodeURIComponent(event.contextId)}`,
    { method: 'GET' },
  )) as FilteredContext;
  if (ctx.client_id !== clientId) {
    // Per-user authorization guard (mirrors the AgentLambda reference impl).
    throw new HttpError(404, 'Context not found');
  }
  return ctx;
}

async function handleGetHistory(
  opts: AjentifyEventRouterOptions,
  req: Request,
): Promise<{ contexts: HistoryContext[] }> {
  const clientId = await opts.getClientId(req);
  if (!clientId) return { contexts: [] };
  const raw = await callUpstream(
    opts,
    `/context-history?client_id=${encodeURIComponent(clientId)}`,
    { method: 'GET' },
  );
  if (Array.isArray(raw)) return { contexts: raw };
  if (isPlainObject(raw) && Array.isArray(raw.contexts)) {
    return { contexts: raw.contexts as HistoryContext[] };
  }
  throw new HttpError(
    500,
    `GET /context-history returned an unexpected shape`,
  );
}

async function handleDeleteContext(
  opts: AjentifyEventRouterOptions,
  req: Request,
  event: Extract<AjentifyEvent, { type: 'delete_context' }>,
): Promise<{ success: boolean }> {
  const clientId = await opts.getClientId(req);
  if (!clientId) throw new HttpError(404, 'Context not found');
  // Authorize via the get path first so we 404 cleanly instead of leaking
  // existence; same pattern as the Python reference handler.
  const ctx = (await callUpstream(
    opts,
    `/context/${encodeURIComponent(event.contextId)}`,
    { method: 'GET' },
  )) as FilteredContext;
  if (ctx.client_id !== clientId) {
    throw new HttpError(404, 'Context not found');
  }
  await callUpstream(opts, `/context/${encodeURIComponent(event.contextId)}`, {
    method: 'DELETE',
  });
  return { success: true };
}

/**
 * Build a Web-standard handler `(req: Request) => Promise<Response>` that
 * services the chat's `ajentify-event` envelope. Wire it into any Fetch-aware
 * runtime; thin shims for Next.js, Hono and Express live below.
 */
export function createAjentifyEventRouter(
  options: AjentifyEventRouterOptions,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    let raw: unknown;
    try {
      raw = await readJson(req);
    } catch (err) {
      if (err instanceof HttpError) {
        return jsonResponse({ error: err.message }, { status: err.status });
      }
      return jsonResponse({ error: 'Bad request' }, { status: 400 });
    }
    if (!isAjentifyEvent(raw)) {
      return jsonResponse(
        { error: `Unknown ajentify-event payload: ${JSON.stringify(raw).slice(0, 200)}` },
        { status: 400 },
      );
    }
    try {
      switch (raw.type) {
        case 'create_context': {
          const out = await handleCreateContext(options, req, raw);
          return jsonResponse(out);
        }
        case 'generate_access_token': {
          const out = await handleGenerateAccessToken(options, req);
          return jsonResponse(out);
        }
        case 'get_context': {
          const out = await handleGetContext(options, req, raw);
          return jsonResponse(out);
        }
        case 'get_context_history': {
          const out = await handleGetHistory(options, req);
          return jsonResponse(out);
        }
        case 'delete_context': {
          const out = await handleDeleteContext(options, req, raw);
          return jsonResponse(out);
        }
      }
    } catch (err) {
      if (err instanceof HttpError) {
        return jsonResponse({ error: err.message }, { status: err.status });
      }
      const message = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: message }, { status: 500 });
    }
  };
}

// ---------- Framework shims ----------------------------------------------

/**
 * Next.js App Router Route Handler. Drop straight into
 * `src/app/api/ajentify-event/route.ts`:
 *
 * ```ts
 * import { toNextRouteHandler, createAjentifyEventRouter } from '@ajentify/chat/server';
 *
 * const handler = createAjentifyEventRouter({ ... });
 * export const POST = toNextRouteHandler(handler);
 * ```
 */
export function toNextRouteHandler(
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return handler;
}

/**
 * Hono context shim:
 *
 * ```ts
 * app.post('/ajentify-event', toHonoHandler(handler));
 * ```
 */
export function toHonoHandler(
  handler: (req: Request) => Promise<Response>,
): (c: { req: { raw: Request } }) => Promise<Response> {
  return (c) => handler(c.req.raw);
}

interface NodeReqLike {
  method?: string;
  headers: Record<string, string | string[] | undefined> | Headers;
  url?: string;
  on?(event: string, cb: (...args: unknown[]) => void): unknown;
  body?: unknown;
}
interface NodeResLike {
  status(code: number): NodeResLike;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function nodeHeadersToHeaders(
  headers: NodeReqLike['headers'],
): Headers {
  if (headers instanceof Headers) return headers;
  const out = new Headers();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (Array.isArray(v)) {
      for (const item of v) out.append(k, item);
    } else if (v != null) {
      out.set(k, String(v));
    }
  }
  return out;
}

/**
 * Express-style adapter — accepts `(req, res, next?)` and forwards through
 * the Fetch handler. Express body-parser is *not* required; we read the
 * raw body off the request stream.
 *
 * ```ts
 * app.post('/ajentify-event', toExpressHandler(handler));
 * ```
 */
export function toExpressHandler(
  handler: (req: Request) => Promise<Response>,
): (req: NodeReqLike, res: NodeResLike) => Promise<void> {
  return async (nodeReq, nodeRes) => {
    const rawBody: string = await new Promise((resolve, reject) => {
      try {
        if (
          typeof nodeReq.body === 'object' &&
          nodeReq.body !== null
        ) {
          // body-parser already gave us a JSON object — round-trip it so the
          // Fetch handler can `await req.json()` like everywhere else.
          resolve(JSON.stringify(nodeReq.body));
          return;
        }
        if (typeof nodeReq.body === 'string') {
          resolve(nodeReq.body);
          return;
        }
        if (!nodeReq.on) {
          resolve('');
          return;
        }
        let buffer = '';
        nodeReq.on('data', (chunk: unknown) => {
          buffer += String(chunk);
        });
        nodeReq.on('end', () => resolve(buffer));
        nodeReq.on('error', (err: unknown) => reject(err));
      } catch (err) {
        reject(err);
      }
    });

    const fetchReq = new Request(`http://localhost${nodeReq.url ?? '/'}`, {
      method: nodeReq.method ?? 'POST',
      headers: nodeHeadersToHeaders(nodeReq.headers),
      body: rawBody.length > 0 ? rawBody : undefined,
    });
    const fetchRes = await handler(fetchReq);
    nodeRes.status(fetchRes.status);
    fetchRes.headers.forEach((value, key) => {
      nodeRes.setHeader(key, value);
    });
    nodeRes.end(await fetchRes.text());
  };
}
