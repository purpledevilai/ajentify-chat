'use client';

import { useContext } from 'react';
import { AjentifyContext, type AjentifyContextValue } from '../provider/context';
import type { AjentifyConfig } from '../provider/AjentifyProvider';
import type { AjentifyStores } from '../stores/types';

function useAjentifyInternal(): AjentifyContextValue {
  const value = useContext(AjentifyContext);
  if (!value) {
    throw new Error(
      '@ajentify/chat hooks must be used inside an <AjentifyProvider>.'
    );
  }
  return value;
}

/** Returns the raw stores bundle. Power-user escape hatch. */
export function useAjentifyStores(): AjentifyStores {
  return useAjentifyInternal().stores;
}

/** Returns the raw provider config (callbacks etc.). */
export function useAjentifyConfig(): AjentifyConfig {
  return useAjentifyInternal().config;
}
