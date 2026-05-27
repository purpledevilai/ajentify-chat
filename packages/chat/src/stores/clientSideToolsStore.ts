import { createStore } from 'zustand/vanilla';
import {
  AjentifyError,
  type ClientSideToolCall,
  type ClientSideToolResponse,
  type PageData,
} from '../types';

export type FallbackToolHandler = (
  toolName: string,
  toolInput: Record<string, unknown>,
  ctx: { toolCallId: string }
) => Promise<string | unknown> | string | unknown;

export type PageDataGetter = () => PageData | Promise<PageData>;
export type PageActionHandler = (
  actionKey: string,
  args: Record<string, unknown>
) => Promise<unknown> | unknown;

export interface ClientSideToolsStore {
  fallbackHandler: FallbackToolHandler | null;
  pageDataGetter: PageDataGetter | null;
  pageActionHandler: PageActionHandler | null;

  setFallbackHandler: (h: FallbackToolHandler | null) => void;
  setPageDataGetter: (g: PageDataGetter | null) => void;
  setPageActionHandler: (h: PageActionHandler | null) => void;

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

export function createClientSideToolsStore() {
  return createStore<ClientSideToolsStore>((set, get) => ({
    fallbackHandler: null,
    pageDataGetter: null,
    pageActionHandler: null,

    setFallbackHandler: (h) => set({ fallbackHandler: h }),
    setPageDataGetter: (g) => set({ pageDataGetter: g }),
    setPageActionHandler: (h) => set({ pageActionHandler: h }),

    async handleToolCall(call) {
      const { tool_name, tool_input, tool_call_id } = call;
      const { pageDataGetter, pageActionHandler, fallbackHandler } = get();

      if (tool_name === 'get_page_data') {
        if (!pageDataGetter) {
          return asString({
            data: {},
            actions: {},
            _note: 'No useGetPageData hook is mounted on the current page.',
          });
        }
        const pd = await pageDataGetter();
        return asString({
          data: pd.data ?? {},
          actions: pd.actions ?? {},
        });
      }

      if (tool_name === 'do_page_action') {
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
        return asString(out ?? { ok: true });
      }

      if (!fallbackHandler) {
        throw new AjentifyError(
          `No handler registered for client-side tool '${tool_name}'. Provide a fallback via the AjentifyProvider's clientSideTools.fallback option.`,
          'tool'
        );
      }

      const out = await fallbackHandler(tool_name, tool_input ?? {}, {
        toolCallId: tool_call_id,
      });
      return asString(out);
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
