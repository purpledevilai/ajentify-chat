'use client';

import { useStore } from 'zustand';
import { useAjentifyStores } from './useAjentify';
import type { ClientSideToolsStore } from '../stores/clientSideToolsStore';

export function useClientSideToolsStore(): ClientSideToolsStore {
  return useStore(useAjentifyStores().clientSideTools);
}

export function useClientSideTools<T>(
  selector: (s: ClientSideToolsStore) => T
): T {
  return useStore(useAjentifyStores().clientSideTools, selector);
}
