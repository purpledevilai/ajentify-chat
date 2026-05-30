import type { AjentifyEvent } from '@ajentify/chat';

/**
 * Single helper that POSTs an `AjentifyEvent` to our dev backend's
 * `/api/ajentify/event` endpoint, which routes on `event.type` and proxies
 * to the Ajentify REST API using the org-scoped API key. Next.js rewrites
 * `/api/ajentify/*` to the Express server at :4000 (see `next.config.mjs`).
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
 * SDK calls this for *every* backend operation — we just forward the event
 * to our proxy and unwrap any response that doesn't already match the SDK's
 * expected shape.
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
  // SDK's `generate_access_token` event expects just the token string.
  if (event.type === 'generate_access_token') {
    return (payload as { token: string }).token;
  }
  return payload;
}
