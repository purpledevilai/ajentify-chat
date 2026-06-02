import { AjentifyError, type AjentifyEvent, type AjentifyEventHandler } from '../types';

export interface AjentifyEventClientOptions {
  /**
   * Backend URL the SDK should POST every event envelope to. Your route
   * should route on `event.type` and proxy to the Ajentify REST API with the
   * org-scoped API key.
   */
  url: string;
  /** Override `globalThis.fetch` (test injection / custom fetch wrappers). */
  fetch?: typeof fetch;
  /** Additional headers (e.g. CSRF token, custom auth). */
  headers?: Record<string, string>;
  /**
   * Forwarded to the `fetch` `credentials` option. Defaults to `'same-origin'`,
   * which works when the chat and the proxy live on the same domain. Set to
   * `'include'` for cross-origin proxies that use cookies.
   */
  credentials?: RequestCredentials;
  /**
   * Customize the body sent to your proxy. Defaults to `event` (the
   * discriminated event envelope). Useful if your backend expects a wrapper
   * like `{ ajentify_event: event }`.
   */
  transformBody?: (event: AjentifyEvent) => unknown;
  /**
   * If your `generate_access_token` endpoint returns something other than the
   * common `{ token: string }` shape, supply a parser here. Defaults to
   * accepting either a bare string or `{ token: string }`.
   */
  parseAccessToken?: (raw: unknown) => string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function defaultParseAccessToken(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (isPlainObject(raw) && typeof raw.token === 'string') return raw.token;
  throw new AjentifyError(
    `generate_access_token response is malformed: expected a string ` +
      `(or '{ token: string }'), received ${describeShape(raw)}. ` +
      `Did you forget to unwrap '{ token }' from the upstream ` +
      `/generate-api-key response?`,
    'callback',
  );
}

function describeShape(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array(length=${v.length})`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v).slice(0, 5).join(', ');
    return `object({ ${keys}${Object.keys(v).length > 5 ? ', …' : ''} })`;
  }
  return typeof v;
}

async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return '';
  }
}

/**
 * Build a ready-to-use `onAjentifyEvent` handler that POSTs each event to
 * your backend proxy, parses JSON, and unwraps `generate_access_token` for
 * you. Use this directly on `<AjentifyProvider config={{ onAjentifyEvent }} />`
 * instead of hand-rolling the same ~30-line client every consumer ends up
 * writing.
 *
 * ```ts
 * import { createAjentifyEventClient } from '@ajentify/chat';
 *
 * const onAjentifyEvent = createAjentifyEventClient({
 *   url: '/api/ajentify-event',
 *   credentials: 'include',
 * });
 *
 * <AjentifyProvider config={{ onAjentifyEvent, ... }}>...</AjentifyProvider>
 * ```
 */
export function createAjentifyEventClient(
  options: AjentifyEventClientOptions
): AjentifyEventHandler {
  const f = options.fetch ?? globalThis.fetch.bind(globalThis);
  const parseToken = options.parseAccessToken ?? defaultParseAccessToken;
  const buildBody = options.transformBody ?? ((e: AjentifyEvent) => e);

  return async (event) => {
    const body = JSON.stringify(buildBody(event));

    let res: Response;
    try {
      res = await f(options.url, {
        method: 'POST',
        credentials: options.credentials ?? 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(options.headers ?? {}),
        },
        body,
      });
    } catch (cause) {
      throw new AjentifyError(
        `ajentify-event '${event.type}' network call failed: ` +
          (cause instanceof Error ? cause.message : String(cause)),
        'callback',
        cause,
      );
    }

    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new AjentifyError(
        `ajentify-event '${event.type}' returned ${res.status} ${res.statusText}` +
          (body ? ` — ${body}` : ''),
        'callback',
      );
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch (cause) {
      throw new AjentifyError(
        `ajentify-event '${event.type}' returned a non-JSON response`,
        'callback',
        cause,
      );
    }

    if (event.type === 'generate_access_token') {
      return parseToken(json);
    }
    return json;
  };
}
