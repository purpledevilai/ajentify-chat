import { createContext } from 'react';
import type { AjentifyStores } from '../stores/types';
import type { AjentifyConfig } from './AjentifyProvider';

export interface AjentifyContextValue {
  stores: AjentifyStores;
  config: AjentifyConfig;
}

export const AjentifyContext = createContext<AjentifyContextValue | null>(null);
