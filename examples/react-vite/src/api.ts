import type { AjentifyProxyRequest } from '@ajentify/chat';

/**
 * The Vite dev server proxies `/api/ajentify` to :4000.
 */
export async function onAjentifyProxyRequest(request: AjentifyProxyRequest) {
  const res = await fetch('/api/ajentify/proxy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`Proxy ${request.type} failed: ${res.status}`);
  return res.json();
}
