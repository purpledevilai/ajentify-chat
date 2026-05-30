import type { AjentifyEvent } from '@ajentify/chat';

/**
 * Single helper that POSTs an `AjentifyEvent` to our dev backend's
 * `/api/ajentify/event` endpoint, which routes on `event.type` and proxies
 * to the Ajentify REST API using the org-scoped API key. The Vite dev
 * server proxies `/api/ajentify` to :4000.
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

/**
 * The single function the developer hands to `<AjentifyProvider>`. The chat
 * SDK calls this for *every* backend operation (create / fetch / list /
 * delete contexts, mint access tokens) — the only thing we need to do is
 * forward the event and unwrap any response shape that doesn't already
 * match what the SDK expects.
 */
export async function ajentifyEvent(event: AjentifyEvent): Promise<unknown> {
  const res = await fetch(`${base}/event`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  const payload = await jsonOrThrow<unknown>(res);

  // The /generate-api-key endpoint upstream returns `{ token, ... }`. The
  // SDK's `generate_access_token` event expects just the token string, so
  // unwrap here to keep the dev backend's proxy 1:1 with the upstream API.
  if (event.type === 'generate_access_token') {
    return (payload as { token: string }).token;
  }
  return payload;
}
