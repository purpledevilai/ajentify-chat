import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const PORT = Number.parseInt(process.env.PORT ?? '4000', 10);
const API_URL = process.env.AJENTIFY_API_URL ?? 'https://api.ajentify.com';
const ORG_API_KEY = process.env.AJENTIFY_ORG_API_KEY;
const AGENT_ID = process.env.AJENTIFY_AGENT_ID;
const ORG_ID = process.env.AJENTIFY_ORG_ID;

if (!ORG_API_KEY || !AGENT_ID || !ORG_ID) {
  console.warn(
    '\n[ajentify-chat dev backend] Missing one of AJENTIFY_ORG_API_KEY / AJENTIFY_AGENT_ID / AJENTIFY_ORG_ID in env.\n' +
      'Copy examples/backend/.env.example to .env and fill them in.\n'
  );
}

// --------- tiny json-file backed user store ---------

interface UserRecord {
  userId: string;
  clientId: string | null;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

function loadUsers(): Record<string, UserRecord> {
  if (!existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Record<string, UserRecord>;
  } catch {
    return {};
  }
}

function saveUsers(users: Record<string, UserRecord>): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

const users: Record<string, UserRecord> = loadUsers();

function getOrCreateUser(req: Request, res: Response): UserRecord {
  let id = req.headers['x-aj-demo-user'] as string | undefined;
  if (!id) {
    const cookieHeader = req.headers.cookie ?? '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map((p) => {
        const [k, ...v] = p.trim().split('=');
        return [k, decodeURIComponent(v.join('='))];
      })
    );
    id = cookies.aj_demo_user;
  }
  if (!id || !users[id]) {
    id = id ?? `demo_${randomUUID()}`;
    users[id] = users[id] ?? { userId: id, clientId: null };
    saveUsers(users);
    res.cookie?.('aj_demo_user', id, {
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 365,
    });
    res.setHeader(
      'set-cookie',
      `aj_demo_user=${id}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
    );
  }
  return users[id]!;
}

// --------- ajentify proxy helpers ---------

interface AjentifyFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | undefined>;
}

async function ajentifyFetch<T = unknown>(
  pathname: string,
  opts: AjentifyFetchOptions = {}
): Promise<T> {
  const url = new URL(pathname, API_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null) url.searchParams.set(k, v);
    }
  }
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: ORG_API_KEY ?? '',
      'content-type': 'application/json',
    },
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }
  if (!res.ok) {
    const err = new Error(
      `Ajentify ${opts.method ?? 'GET'} ${pathname} -> ${res.status}: ${text}`
    );
    (err as Error & { status?: number; payload?: unknown }).status = res.status;
    (err as Error & { payload?: unknown }).payload = payload;
    throw err;
  }
  return payload as T;
}

// --------- proxy handler ---------

/**
 * The shape mirrors `AjentifyProxyRequest` from `@ajentify/chat`. We
 * re-declare it here so the example backend can stay decoupled from the SDK.
 */
type AjentifyProxyRequest =
  | { type: 'create_context'; request?: Record<string, unknown> }
  | { type: 'generate_access_token' }
  | { type: 'get_context'; contextId: string }
  | { type: 'get_context_history' }
  | { type: 'delete_context'; contextId: string };

async function handleProxyRequest(
  request: AjentifyProxyRequest,
  user: UserRecord
): Promise<unknown> {
  switch (request.type) {
    case 'create_context': {
      const created = await ajentifyFetch<{
        context_id: string;
        client_id?: string;
        client_api_key?: string | null;
        [k: string]: unknown;
      }>('/context', {
        method: 'POST',
        body: {
          agent_id: AGENT_ID,
          ...(request.request ?? {}),
          client_id: user.clientId ?? undefined,
        },
      });
      if (created.client_id && created.client_id !== user.clientId) {
        user.clientId = created.client_id;
        saveUsers(users);
      }
      return created;
    }

    case 'generate_access_token': {
      if (!user.clientId) {
        const err = new Error(
          'No client_id known for this user; create a context first.'
        );
        (err as Error & { status?: number }).status = 409;
        throw err;
      }
      return ajentifyFetch('/generate-api-key', {
        method: 'POST',
        body: {
          org_id: ORG_ID,
          type: 'client',
          client_id: user.clientId,
        },
      });
    }

    case 'get_context': {
      // Pass client_id so Ajentify 404s if the requested context belongs
      // to a different end-user. The browser controls contextId and the
      // org API key can act on every context in the org, so the per-user
      // scoping has to live somewhere — pushing it to the API keeps this
      // proxy a thin pass-through.
      return ajentifyFetch(`/context/${request.contextId}`, {
        query: { client_id: user.clientId ?? undefined },
      });
    }

    case 'get_context_history': {
      if (!user.clientId) return { contexts: [] };
      return ajentifyFetch<{ contexts: unknown[] }>('/context-history', {
        query: { client_id: user.clientId },
      });
    }

    case 'delete_context': {
      await ajentifyFetch(`/context/${request.contextId}`, {
        method: 'DELETE',
        query: { client_id: user.clientId ?? undefined },
      });
      return { success: true };
    }

    default: {
      const exhaustive: never = request;
      throw new Error(`unsupported proxy request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// --------- app ---------

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

/**
 * POST /api/ajentify/proxy
 *
 * Single endpoint the chat SDK posts every backend request to. The body is
 * an `AjentifyProxyRequest`; we route on `request.type` and proxy to the
 * matching Ajentify REST endpoint with the org API key. Responses are
 * returned unchanged — the SDK handles any unwrapping.
 */
app.post('/api/ajentify/proxy', async (req, res) => {
  const request = req.body as AjentifyProxyRequest | undefined;
  if (!request || typeof request !== 'object' || !('type' in request)) {
    res.status(400).json({ error: 'Body must be an AjentifyProxyRequest { type, ... }' });
    return;
  }
  const user = getOrCreateUser(req, res);
  try {
    const result = await handleProxyRequest(request, user);
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({
      error: (err as Error).message,
      payload: (err as { payload?: unknown }).payload,
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `[ajentify-chat dev backend] listening on http://localhost:${PORT}`
  );
});
