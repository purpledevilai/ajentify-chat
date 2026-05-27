'use client';

import { useEffect } from 'react';
import type { PageData } from '../types';
import {
  type PageActionHandler,
  type PageDataGetter,
} from '../stores/clientSideToolsStore';
import { useAjentifyStores } from './useAjentify';

/**
 * Register a function that returns the page's current data and the actions
 * the agent may invoke. The agent calls `get_page_data` to retrieve this.
 *
 * The function is re-registered on each render so closures stay fresh. On
 * unmount the getter is cleared so the agent sees an "empty page".
 *
 * Only one getter is active at a time per provider — typically you mount
 * this in the leaf page component.
 *
 * Example:
 * ```tsx
 * useGetPageData(() => ({
 *   data: { selectedOrderId: orderId },
 *   actions: {
 *     refund_order: {
 *       description: 'Refund the currently selected order',
 *       argsSchema: { type: 'object', properties: { amount: { type: 'number' } } }
 *     },
 *   },
 * }), [orderId]);
 * ```
 */
export function useGetPageData(
  getter: PageDataGetter | (() => PageData),
  deps?: React.DependencyList
): void {
  const stores = useAjentifyStores();
  useEffect(() => {
    stores.clientSideTools.getState().setPageDataGetter(() => getter());
    return () => {
      // Only clear if we're still the active getter.
      if (stores.clientSideTools.getState().pageDataGetter) {
        stores.clientSideTools.getState().setPageDataGetter(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? [getter]);
}

/**
 * Register a function that executes a page action when the agent calls
 * `do_page_action`. The function receives the `action_key` and any
 * arguments and returns a value the agent will see in its tool response.
 *
 * Example:
 * ```tsx
 * useDoPageAction(async (key, args) => {
 *   if (key === 'refund_order') {
 *     return await api.refund(orderId, args.amount as number);
 *   }
 *   throw new Error('unknown action: ' + key);
 * }, [orderId]);
 * ```
 */
export function useDoPageAction(
  handler: PageActionHandler,
  deps?: React.DependencyList
): void {
  const stores = useAjentifyStores();
  useEffect(() => {
    stores.clientSideTools.getState().setPageActionHandler(handler);
    return () => {
      if (stores.clientSideTools.getState().pageActionHandler === handler) {
        stores.clientSideTools.getState().setPageActionHandler(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? [handler]);
}
