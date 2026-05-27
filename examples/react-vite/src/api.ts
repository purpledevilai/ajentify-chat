import type {
  CreateContextRequest,
  CreateContextResponse,
  FilteredContext,
  HistoryContext,
} from '@ajentify/chat';

/**
 * Helpers for talking to the dev backend (which proxies to Ajentify with the
 * org API key). The Vite dev server proxies `/api/ajentify` to :4000.
 */

const base = '/api/ajentify';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.text();
  let payload: unknown = body;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    // leave as text
  }
  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : null) ?? body ?? `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  async createContext(req?: CreateContextRequest): Promise<CreateContextResponse> {
    const res = await fetch(`${base}/context`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req ?? {}),
    });
    return jsonOrThrow<CreateContextResponse>(res);
  },
  async getContext(contextId: string): Promise<FilteredContext> {
    const res = await fetch(`${base}/context/${contextId}`, {
      credentials: 'include',
    });
    return jsonOrThrow<FilteredContext>(res);
  },
  async generateAccessToken(contextId: string): Promise<string> {
    const res = await fetch(`${base}/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context_id: contextId }),
    });
    const { token } = await jsonOrThrow<{ token: string }>(res);
    return token;
  },
  async getContextHistory(): Promise<{ contexts: HistoryContext[] }> {
    const res = await fetch(`${base}/context-history`, {
      credentials: 'include',
    });
    return jsonOrThrow<{ contexts: HistoryContext[] }>(res);
  },
};
