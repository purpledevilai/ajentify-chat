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

// DX helpers
export {
  defineClientSideTools,
  type ToolSchema,
  type ToolSpecs,
  type ToolHandler,
  type ToolHandlers,
  type DefineClientSideToolsOptions,
} from './lib/defineTools';

// Sub-agent card derivation (headless; same output for live + hydrated history)
export {
  deriveSubagentCard,
  deriveSubagentCards,
  findSubagentReply,
  isSubagentReplyToolCall,
  isSubagentToolCall,
  linkedSubagentReplyIds,
  replyOriginalToolCallId,
} from './lib/subagents';

// Text edits (the platform-wide `edits` contract; byte-identical with @ajentify/sdk + @ajentify/voice)
export {
  applyEdits,
  validateEdit,
  TextEditError,
  EDIT_OPERATIONS,
  EDITS_SCHEMA,
  EDITS_FIELD_DESCRIPTION,
  EDITS_TYPE_MARKER,
  EDIT_CONTEXT_CHARS,
  MAX_AMBIGUOUS_CONTEXTS,
  type EditOperation,
  type EditOperationName,
  type EditSummary,
  type TextEditErrorCode,
} from './lib/textEdits';

// Utilities
export { cn, createSafeStorage, uid } from './lib/utils';
export { injectChatStyles } from './lib/injectStyles';
