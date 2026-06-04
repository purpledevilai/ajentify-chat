import type { AjentifyProxyRequest } from '@ajentify/chat';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000';

export async function onAjentifyProxyRequest(request: AjentifyProxyRequest) {
  const res = await fetch(`${BACKEND_URL}/api/ajentify/proxy`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`Proxy ${request.type} failed: ${res.status}`);
  return res.json();
}
