'use client';

import { useStore } from 'zustand';
import { useAjentifyStores } from './useAjentify';
import type { CurrentContextStore } from '../stores/currentContextStore';

export function useCurrentContextStore(): CurrentContextStore {
  return useStore(useAjentifyStores().currentContext);
}

/**
 * Selector form of useCurrentContextStore. Use for performance to subscribe
 * only to the slice you care about.
 */
export function useCurrentContext<T>(selector: (s: CurrentContextStore) => T): T {
  return useStore(useAjentifyStores().currentContext, selector);
}
