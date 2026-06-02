'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  createStores,
  type ClientSideToolHandler,
  type OnToolCallCallback,
} from '../stores';
import type { AjentifyStores } from '../stores/types';
import type {
  AgentEvent,
  AjentifyError,
  AjentifyEventHandler,
} from '../types';
import { createSafeStorage } from '../lib/utils';
import { injectChatStyles } from '../lib/injectStyles';
import { AjentifyContext } from './context';

export type StorageOption =
  | 'localStorage'
  | 'sessionStorage'
  | 'memory'
  | Storage
  | null;

export interface AjentifyConfig {
  /**
   * Single async handler that services every backend request the SDK makes
   * (create context, fetch context, mint access tokens, list history, delete
   * context). The dev's backend should expose **one** endpoint that routes
   * on `event.type` and proxies to the Ajentify REST API with their org
   * API key. See `AjentifyEvent` for the variant contract.
   *
   * Use `createAjentifyEventClient({ url: '/api/ajentify-event' })` from
   * `@ajentify/chat` to skip the boilerplate.
   */
  onAjentifyEvent: AjentifyEventHandler;
  /** Override the token streaming WebSocket URL. */
  websocketUrl?: string;
  /**
   * Catch-all handler for client-side tools the agent calls that aren't
   * `get_page_data` / `do_page_action`. Receives the tool name, the agent's
   * arguments, and the call's id; return a string (or anything stringifiable)
   * for the agent.
   *
   * Use `defineClientSideTools<TTools>(...)` from `@ajentify/chat` to get
   * a typed per-tool handler map.
   */
  clientSideTools?: ClientSideToolHandler;
  /** Where to persist `{ contextId, accessToken, clientId }`. Defaults to `localStorage`. */
  storage?: StorageOption;
  /** Namespacing key for storage. Defaults to `'ajentify.chat'`. */
  storageKey?: string;
  /** Reconnect tuning. */
  reconnect?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  /** Per-RPC response timeout. */
  requestTimeoutMs?: number;
  /** Surface custom events emitted by the agent. */
  onEvents?: (events: AgentEvent[], responseId: string) => void;
  /** Surface internal AjentifyErrors (transport, tool, callback, etc). */
  onError?: (err: AjentifyError) => void;
  /**
   * Analytics-style callback fired for every client-side tool dispatch
   * (`get_page_data`, `do_page_action`, custom tools). Receives the tool name,
   * the args the agent passed, duration, success flag, and any error.
   */
  onToolCall?: OnToolCallCallback;
  /**
   * Eagerly create + connect on `startNewContext()` (mount, "+ new chat",
   * "+ New chat" in history) so the agent can stream its first message
   * before the user types. Defaults to `false`, in which case those entry
   * points only stage a local `draft` state and the actual `create_context`
   * call is deferred until the user sends their first message. Set to
   * `true` for agents that are configured to speak first.
   */
  agentSpeaksFirst?: boolean;
  /**
   * Initial open/closed state of the chat panel. Mostly useful for routes
   * where the chat should auto-open (e.g. `/help`). Defaults to `false`.
   *
   * Subsequent toggles flow through `useChatPanel()` /
   * `<ChatToggleButton />`; pass `open` directly on `<ChatPanel />` to run
   * it as a controlled component instead.
   */
  panelDefaultOpen?: boolean;
  /**
   * Skip the auto-injected bundled stylesheet. The chat's CSS is normally
   * pushed into `<head>` on first mount (idempotent). Set to true if you
   * already pre-load `@ajentify/chat/styles.css` via your own bundler and
   * don't want the duplicate `<style>` tag.
   */
  disableStyleInject?: boolean;
  /**
   * Hook the chat's `--aj-*` token contract up to the host app's own CSS
   * variables so chat re-themes automatically (including live light/dark
   * toggles via class swaps).
   *
   * Since v0.2 the chat's tokens are **full CSS colors** (oklch / hex / rgb
   * / hsl — any format). Bridges therefore just alias one variable to
   * another via `var()` — no `hsl()` wrapping required. This means the same
   * config works against modern shadcn (oklch), Radix Themes, Mantine,
   * custom palettes — anything that exposes a CSS variable.
   *
   * - `'shadcn'`: aliases `--aj-*` to shadcn/ui's un-prefixed `--background`,
   *   `--foreground`, `--primary`, ... CSS variables. Picks up dark values
   *   under `.dark` automatically.
   * - `{ tokens, selectors? }`: map any subset of `--aj-*` tokens to your
   *   own host variable names, e.g.
   *   `themeBridge={{ tokens: { background: '--my-bg', primary: '--my-accent' } }}`.
   *   Defaults to declaring under `[':root', '.dark', '[data-theme]']` so
   *   most dark-mode strategies (class on html, `data-theme="dark"`, Radix
   *   Themes, etc.) work out of the box.
   *
   * Omit this if you'd rather override `--aj-*` directly in your stylesheet.
   */
  themeBridge?: ThemeBridgeOption;
  /** Inject WebSocket implementation. Useful for Node/tests. */
  WebSocketImpl?: typeof WebSocket;
}

export interface AjentifyProviderProps {
  config: AjentifyConfig;
  children: ReactNode;
}

/**
 * The set of theme tokens the chat understands. Names line up 1:1 with the
 * `--aj-*` CSS variables in `styles.css`.
 */
export type AjThemeToken =
  | 'background'
  | 'foreground'
  | 'card'
  | 'card-foreground'
  | 'popover'
  | 'popover-foreground'
  | 'primary'
  | 'primary-foreground'
  | 'secondary'
  | 'secondary-foreground'
  | 'muted'
  | 'muted-foreground'
  | 'accent'
  | 'accent-foreground'
  | 'destructive'
  | 'destructive-foreground'
  | 'border'
  | 'input'
  | 'ring'
  | 'radius';

export type ThemeBridgeOption =
  | 'shadcn'
  | {
      /**
       * Map of `--aj-*` token names (without the `--aj-` prefix) to host CSS
       * variable names (with the leading `--`). Any token you omit keeps its
       * built-in default.
       */
      tokens: Partial<Record<AjThemeToken, string>>;
      /**
       * CSS selectors to declare the alias block under. Defaults to
       * `[':root', '.dark', '[data-theme]']` so light/dark/data-theme
       * strategies all work without extra config.
       *
       * CSS variables resolve at the *declaring* selector's scope, so
       * declaring under `.dark` (and `[data-theme]`) is what makes dark-mode
       * host variables actually reach `--aj-*`.
       */
      selectors?: string[];
    };

const SHADCN_TOKEN_MAP: Record<AjThemeToken, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  'card-foreground': '--card-foreground',
  popover: '--popover',
  'popover-foreground': '--popover-foreground',
  primary: '--primary',
  'primary-foreground': '--primary-foreground',
  secondary: '--secondary',
  'secondary-foreground': '--secondary-foreground',
  muted: '--muted',
  'muted-foreground': '--muted-foreground',
  accent: '--accent',
  'accent-foreground': '--accent-foreground',
  destructive: '--destructive',
  'destructive-foreground': '--destructive-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  radius: '--radius',
};

const DEFAULT_BRIDGE_SELECTORS = [':root', '.dark', '[data-theme]'];

function resolveStorage(option: StorageOption | undefined): Storage | null {
  if (option === null) return null;
  if (option === undefined) return createSafeStorage('localStorage');
  if (option === 'localStorage') return createSafeStorage('localStorage');
  if (option === 'sessionStorage') return createSafeStorage('sessionStorage');
  if (option === 'memory') {
    // Force the in-memory shim by pretending we're SSR.
    const memory = new Map<string, string>();
    return {
      get length() {
        return memory.size;
      },
      clear() {
        memory.clear();
      },
      getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
      key: (i: number) => Array.from(memory.keys())[i] ?? null,
      removeItem: (k: string) => memory.delete(k),
      setItem: (k: string, v: string) => memory.set(k, v),
    };
  }
  return option;
}

/**
 * The single React entry point developers wrap their app in. Owns one
 * instance of the four Zustand stores and supplies it via React context.
 *
 * The provider is intentionally created **once** per mount and never re-built
 * when `config` changes (you should not change callbacks at runtime). To
 * swap-in a new config, unmount and remount.
 */
export function AjentifyProvider({ config, children }: AjentifyProviderProps): JSX.Element {
  // We keep a ref to the config so the stores see the latest callbacks even
  // when the React tree re-renders with new closures — but the stores
  // themselves are created once.
  const configRef = useRef<AjentifyConfig>(config);
  configRef.current = config;

  const stores: AjentifyStores = useMemo(() => {
    return createStores({
      websocketUrl: config.websocketUrl,
      // Always read through the latest config ref so dev callbacks can change
      // their closure (e.g. router/auth) across renders without us rebuilding
      // the stores or losing the WebSocket.
      onAjentifyEvent: (event) => configRef.current.onAjentifyEvent(event),
      storage: resolveStorage(config.storage),
      storageKey: config.storageKey,
      WebSocketImpl: config.WebSocketImpl,
      reconnect: config.reconnect,
      requestTimeoutMs: config.requestTimeoutMs,
      onEvents: (...args) => configRef.current.onEvents?.(...args),
      onError: (err) => configRef.current.onError?.(err),
      agentSpeaksFirst: config.agentSpeaksFirst,
      panelDefaultOpen: config.panelDefaultOpen,
      // Plumb the latest closure through; the store wires it into every
      // dispatch (including get_page_data / do_page_action).
      onToolCall: (info) => configRef.current.onToolCall?.(info),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-inject the bundled stylesheet on first mount. Idempotent —
  // safe under React 18 strict double-mount and multiple providers.
  useEffect(() => {
    if (config.disableStyleInject) return;
    injectChatStyles();
  }, [config.disableStyleInject]);

  useEffect(() => {
    stores.clientSideTools.getState().setClientSideToolHandler(
      config.clientSideTools ?? null
    );
  }, [stores, config.clientSideTools]);

  // Tear down the WebSocket on unmount.
  useEffect(() => {
    return () => {
      stores.currentContext.getState().disconnect();
    };
  }, [stores]);

  const value = useMemo(() => ({ stores, config }), [stores, config]);

  return (
    <AjentifyContext.Provider value={value}>
      {config.themeBridge ? <ThemeBridge bridge={config.themeBridge} /> : null}
      {children}
    </AjentifyContext.Provider>
  );
}

/**
 * Builds the `--aj-*: var(--host, var(--aj-*))` alias declarations that map
 * a host's CSS variables onto the chat's token contract.
 *
 * Since v0.2 the chat's tokens are full CSS colors (hex / rgb / oklch / hsl,
 * any format) — the alias just passes the host value through. The fallback
 * to the chat's own `--aj-*` default keeps the chat looking right even on
 * pages where the host hasn't declared the variable yet.
 */
function buildAliasDeclarations(
  tokens: Partial<Record<AjThemeToken, string>>
): string {
  return (Object.keys(tokens) as AjThemeToken[])
    .map((token) => {
      const hostVar = tokens[token];
      if (!hostVar) return '';
      return `--aj-${token}: var(${hostVar}, var(--aj-${token}));`;
    })
    .filter(Boolean)
    .join('\n          ');
}

/**
 * Injects a `<style>` block aliasing the chat's `--aj-*` tokens to the
 * host's CSS variables. We declare the same block under several selectors
 * (`:root`, `.dark`, `[data-theme]` by default) because CSS custom property
 * `var()` references resolve at the *declaring* selector's scope — without
 * a `.dark` declaration, dark-mode host values never propagate to chat.
 */
function ThemeBridge({ bridge }: { bridge: ThemeBridgeOption }): JSX.Element {
  const tokens =
    bridge === 'shadcn' ? SHADCN_TOKEN_MAP : bridge.tokens;
  const selectors =
    bridge === 'shadcn'
      ? DEFAULT_BRIDGE_SELECTORS
      : bridge.selectors ?? DEFAULT_BRIDGE_SELECTORS;

  const declarations = buildAliasDeclarations(tokens);
  if (!declarations) return <></>;

  const css = selectors
    .map(
      (selector) => `${selector} {
          ${declarations}
        }`
    )
    .join('\n        ');

  return (
    <style
      data-aj-theme-bridge=""
      dangerouslySetInnerHTML={{ __html: `\n        ${css}\n      ` }}
    />
  );
}
