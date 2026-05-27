import { describe, expect, it, vi } from 'vitest';
import { createClientSideToolsStore } from './clientSideToolsStore';

describe('clientSideToolsStore', () => {
  it('dispatches get_page_data through the registered getter', async () => {
    const store = createClientSideToolsStore();
    store.getState().setPageDataGetter(() => ({
      data: { foo: 'bar' },
      actions: { do_thing: { description: 'does a thing' } },
    }));

    const response = await store.getState().handleToolCall({
      tool_call_id: 'c1',
      tool_name: 'get_page_data',
      tool_input: {},
    });
    expect(JSON.parse(response)).toMatchObject({
      data: { foo: 'bar' },
      actions: { do_thing: { description: 'does a thing' } },
    });
  });

  it('dispatches do_page_action with action_key + arguments', async () => {
    const store = createClientSideToolsStore();
    const handler = vi.fn().mockResolvedValue({ ok: true });
    store.getState().setPageActionHandler(handler);

    await store.getState().handleToolCall({
      tool_call_id: 'c2',
      tool_name: 'do_page_action',
      tool_input: { action_key: 'refund', arguments: { amount: 5 } },
    });
    expect(handler).toHaveBeenCalledWith('refund', { amount: 5 });
  });

  it('routes unknown tools through the fallback handler', async () => {
    const store = createClientSideToolsStore();
    store.getState().setFallbackHandler(async (name) => `fallback:${name}`);
    const response = await store.getState().handleToolCall({
      tool_call_id: 'c3',
      tool_name: 'show_dialog',
      tool_input: {},
    });
    expect(response).toBe('fallback:show_dialog');
  });

  it('throws when do_page_action has no handler mounted', async () => {
    const store = createClientSideToolsStore();
    await expect(
      store.getState().handleToolCall({
        tool_call_id: 'c4',
        tool_name: 'do_page_action',
        tool_input: { action_key: 'x' },
      })
    ).rejects.toThrow();
  });

  it('handleToolCalls bundles responses preserving tool_call_id order', async () => {
    const store = createClientSideToolsStore();
    store.getState().setFallbackHandler(async (_n, _a, ctx) => `ok:${ctx.toolCallId}`);
    const result = await store.getState().handleToolCalls([
      { tool_call_id: 'a', tool_name: 'x', tool_input: {} },
      { tool_call_id: 'b', tool_name: 'y', tool_input: {} },
    ]);
    expect(result.map((r) => r.tool_call_id)).toEqual(['a', 'b']);
    expect(result[0]!.response).toBe('ok:a');
    expect(result[1]!.response).toBe('ok:b');
  });
});
