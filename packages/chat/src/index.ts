// Public types
export * from './types';

// Provider
export {
  AjentifyProvider,
  type AjentifyConfig,
  type AjentifyProviderProps,
  type AjThemeToken,
  type StorageOption,
  type ThemeBridgeOption,
} from './provider/AjentifyProvider';
export { AjentifyContext } from './provider/context';
export type { AjentifyContextValue } from './provider/context';

// Hooks
export * from './hooks';

// Stores (advanced users)
export * from './stores';

// WebSocket client (advanced users)
export {
  TokenStreamingClient,
  DEFAULT_TOKEN_STREAMING_URL,
  type TokenStreamingClientOptions,
  type TokenStreamingEvents,
} from './ws/TokenStreamingClient';

// DX helpers (v0.2) — every Ajentify integration ends up writing these,
// so we ship the canonical versions.
export {
  createAjentifyEventClient,
  type AjentifyEventClientOptions,
} from './lib/eventClient';
export {
  defineClientSideTools,
  type ToolSchema,
  type ToolSpecs,
  type ToolHandler,
  type ToolHandlers,
  type DefineClientSideToolsOptions,
} from './lib/defineTools';

// Utilities
export { cn, createSafeStorage, uid } from './lib/utils';
export { injectChatStyles } from './lib/injectStyles';
