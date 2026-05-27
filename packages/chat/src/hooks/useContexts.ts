'use client';

import { useStore } from 'zustand';
import { useAjentifyStores } from './useAjentify';
import type { ContextsStore } from '../stores/contextsStore';

export function useContextsStore(): ContextsStore {
  return useStore(useAjentifyStores().contexts);
}

export function useContexts<T>(selector: (s: ContextsStore) => T): T {
  return useStore(useAjentifyStores().contexts, selector);
}
