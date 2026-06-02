import { AjentifyError } from '../types';
import type { ClientSideToolHandler } from '../stores/clientSideToolsStore';

/**
 * Per-tool input/output shape used to type `defineClientSideTools`.
 *
 * `args` is what the agent sends — typically a JSON object that matches the
 * tool's `parameters_schema`. `result` is whatever you return to the agent
 * (anything stringifiable; the SDK will `JSON.stringify(...)` it for you).
 */
export interface ToolSchema<TArgs = unknown, TResult = unknown> {
  args: TArgs;
  result: TResult;
}

/** A map of tool name → schema. */
export type ToolSpecs = Record<string, ToolSchema>;

/**
 * Per-tool handler signature. `args` is fully typed against the schema, and
 * `ctx` carries the SDK-provided metadata (`toolCallId`, the literal tool
 * name).
 */
export type ToolHandler<TSpec extends ToolSchema, TName extends string> = (
  args: TSpec['args'],
  ctx: { toolCallId: string; toolName: TName }
) => Promise<TSpec['result']> | TSpec['result'];

/** Strict map: every key in `T` must have a handler. */
export type ToolHandlers<T extends ToolSpecs> = {
  [K in keyof T & string]: ToolHandler<T[K], K>;
};

export interface DefineClientSideToolsOptions {
  /**
   * Dev-mode warning emitter when a `do_page_action` / `get_page_data` call
   * arrives but no `useDoPageAction` / `useGetPageData` hook is mounted.
   * The default `defineClientSideTools` already throws a descriptive
   * `AjentifyError`; supplying this lets you log too.
   */
  onUnknownTool?: (toolName: string) => void;
}

/**
 * Build a strongly-typed `clientSideTools` handler from a `tool name → handler`
 * map. Eliminates the `args.x as string | undefined` casts that every
 * consumer otherwise sprinkles through their handler switch.
 *
 * ```ts
 * type Tools = {
 *   get_todos: { args: {}; result: Todo[] };
 *   mark_todo: { args: { id: string; done: boolean }; result: { ok: boolean } };
 * };
 *
 * const clientSideTools = defineClientSideTools<Tools>({
 *   get_todos: () => api.listTodos(),
 *   mark_todo: ({ id, done }) => api.markTodo(id, done).then(() => ({ ok: true })),
 * });
 *
 * <AjentifyProvider config={{ clientSideTools, ... }}>...</AjentifyProvider>
 * ```
 *
 * Unknown tool names raise an `AjentifyError(code: 'tool')` with a hint
 * pointing at the agent's tool list. In dev (NODE_ENV !== 'production')
 * the helper also `console.warn`s so the mistake is visible without
 * mounting the chat first.
 */
export function defineClientSideTools<T extends ToolSpecs>(
  handlers: ToolHandlers<T>,
  options?: DefineClientSideToolsOptions
): ClientSideToolHandler {
  // The dispatcher is intentionally loosely typed at the call site; the
  // strong types live in the `handlers` table and are surfaced to consumers
  // through the generic param. Internally we just route by string.
  const table = handlers as unknown as Record<
    string,
    (args: unknown, ctx: { toolCallId: string; toolName: string }) => Promise<unknown> | unknown
  >;
  return async (toolName, toolInput, ctx) => {
    const handler = table[toolName];
    if (!handler) {
      options?.onUnknownTool?.(toolName);
      if (
        typeof process !== 'undefined' &&
        process.env?.NODE_ENV !== 'production'
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ajentify] client-side tool '${toolName}' has no handler. ` +
            `Available handlers: ${Object.keys(handlers).join(', ') || '(none)'}.`,
        );
      }
      throw new AjentifyError(
        `No client-side tool handler defined for '${toolName}'.`,
        'tool',
      );
    }
    return await handler(toolInput, {
      toolCallId: ctx.toolCallId,
      toolName,
    });
  };
}
