import { createStore } from 'zustand/vanilla';
import {
  AjentifyError,
  type ClientSideToolCall,
  type ClientSideToolResponse,
  type PageData,
} from '../types';

/**
 * Optional analytics-style callback fired for every client-side tool dispatch.
 * Surfaced via `AjentifyProvider`'s `onToolCall` config.
 */
export type OnToolCallCallback = (info: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolCallId: string;
  durationMs: number;
  ok: boolean;
  error?: unknown;
}) => void;

export type ClientSideToolHandler = (
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: { toolCallId: string }
) => Promise<string | unknown> | string | unknown;

export type PageDataGetter = () => PageData | Promise<PageData>;
export type PageActionHandler = (
  actionKey: string,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

export interface ClientSideToolsStoreOptions {
  /** Analytics-style callback fired for every tool dispatch (success + error). */
  onToolCall?: OnToolCallCallback;
}

export interface ClientSideToolsStore {
  clientSideToolHandler: ClientSideToolHandler | null;
  pageDataGetter: PageDataGetter | null;
  pageActionHandler: PageActionHandler | null;

  setClientSideToolHandler: (h: ClientSideToolHandler | null) => void;
  setPageDataGetter: (g: PageDataGetter | null) => void;
  setPageActionHandler: (h: PageActionHandler | null) => void;
  /**
   * Update the analytics callback at runtime. Used by the provider to keep
   * the latest closure reachable without rebuilding the store.
   */
  setOnToolCall: (cb: OnToolCallCallback | null) => void;

  /**
   * Dispatch a single client-side tool call. Returns a string suitable for
   * the `response` field of `client_side_tool_responses`. Will stringify
   * non-string returns from handlers so devs can return objects.
   */
  handleToolCall: (call: ClientSideToolCall) => Promise<string>;

  /** Convenience: dispatch many calls and bundle into a response array. */
  handleToolCalls: (
    calls: ClientSideToolCall[]
  ) => Promise<ClientSideToolResponse[]>;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function createClientSideToolsStore(
  options: ClientSideToolsStoreOptions = {}
) {
  let onToolCallCb: OnToolCallCallback | null = options.onToolCall ?? null;

  return createStore<ClientSideToolsStore>((set, get) => ({
    clientSideToolHandler: null,
    pageDataGetter: null,
    pageActionHandler: null,

    setClientSideToolHandler: (h) => set({ clientSideToolHandler: h }),
    setPageDataGetter: (g) => set({ pageDataGetter: g }),
    setPageActionHandler: (h) => set({ pageActionHandler: h }),
    setOnToolCall: (cb) => {
      onToolCallCb = cb;
    },

    async handleToolCall(call) {
      const { tool_name, tool_input, tool_call_id } = call;
      const { pageDataGetter, pageActionHandler, clientSideToolHandler } = get();
      const startedAt = now();
      let ok = false;
      let response: string;
      let caught: unknown;

      try {
        if (tool_name === 'get_page_data') {
          if (!pageDataGetter) {
            response = asString({
              data: {},
              actions: {},
              _note: 'No useGetPageData hook is mounted on the current page.',
            });
          } else {
            const pd = await pageDataGetter();
            response = asString({
              data: pd.data ?? {},
              actions: pd.actions ?? {},
            });
          }
          ok = true;
        } else if (tool_name === 'do_page_action') {
          if (!pageActionHandler) {
            throw new AjentifyError(
              'Received `do_page_action` but no useDoPageAction hook is mounted on the current page.',
              'tool'
            );
          }
          const actionKey =
            (tool_input?.action_key as string | undefined) ??
            (tool_input?.actionKey as string | undefined) ??
            (tool_input?.key as string | undefined);
          const rawArgs =
            (tool_input?.arguments as Record<string, unknown> | undefined) ??
            (tool_input?.args as Record<string, unknown> | undefined) ??
            {};
          if (!actionKey) {
            throw new AjentifyError(
              `do_page_action call ${tool_call_id} is missing an action_key`,
              'tool'
            );
          }
          const out = await pageActionHandler(actionKey, rawArgs);
          response = asString(out ?? { ok: true });
          ok = true;
        } else {
          if (!clientSideToolHandler) {
            throw new AjentifyError(
              `No handler registered for client-side tool '${tool_name}'. ` +
                `Provide a clientSideTools handler on the AjentifyProvider config.`,
              'tool'
            );
          }
          const out = await clientSideToolHandler(tool_name, tool_input ?? {}, {
            toolCallId: tool_call_id,
          });
          response = asString(out);
          ok = true;
        }
        return response;
      } catch (err) {
        caught = err;
        throw err;
      } finally {
        if (onToolCallCb) {
          try {
            onToolCallCb({
              toolName: tool_name,
              toolInput: tool_input ?? {},
              toolCallId: tool_call_id,
              durationMs: now() - startedAt,
              ok,
              error: caught,
            });
          } catch {
            // Never let analytics throw from the dispatch path.
          }
        }
      }
    },

    async handleToolCalls(calls) {
      const responses: ClientSideToolResponse[] = [];
      for (const call of calls) {
        let response: string;
        try {
          response = await get().handleToolCall(call);
        } catch (err) {
          response = asString({
            error: err instanceof Error ? err.message : String(err),
          });
        }
        responses.push({
          tool_call_id: call.tool_call_id,
          response,
        });
      }
      return responses;
    },
  }));
}
