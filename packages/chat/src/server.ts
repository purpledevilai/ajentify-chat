/**
 * `@ajentify/chat/server`
 *
 * Server-side type re-exports for developers building their own proxy
 * endpoint. The proxy authenticates the caller, resolves the `client_id`,
 * and proxies each request to the Ajentify REST API with the org API key.
 *
 * See the quickstart guide for example implementations in Express, Next.js,
 * Hono, and other frameworks.
 */

export type {
  AjentifyProxyRequest,
  AjentifyProxyResult,
  AjentifyProxyHandler,
  CreateContextRequest,
  CreateContextResponse,
  FilteredContext,
  HistoryContext,
} from './types';
