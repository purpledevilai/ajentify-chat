'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  createStores,
  type ContextCallbacks,
  type ClientSideToolHandler,
} from '../stores';
import type { AjentifyStores } from '../stores/types';
import type { AgentEvent, AjentifyError } from '../types';
import { createSafeStorage } from '../lib/utils';
import { AjentifyContext } from './context';

export type StorageOption =
  | 'localStorage'
  | 'sessionStorage'
  | 'memory'
  | Storage
  | null;

export interface AjentifyConfig extends ContextCallbacks {
  /** Override the token streaming WebSocket URL. */
  websocketUrl?: string;
  /**
   * Catch-all handler for client-side tools the agent calls that aren't
   * `get_page_data` / `do_page_action`. Receives the tool name, the agent's
   * arguments, and the call's id; return a string (or anything stringifiable)
   * for the agent.
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
   * Inject the consumer's CSS variables (so chat styles pick up their shadcn
   * theme automatically). Currently supported: `'shadcn'` which aliases
   * `--aj-*` tokens to their `--*` counterparts.
   */
  themeBridge?: 'shadcn';
  /** Inject WebSocket implementation. Useful for Node/tests. */
  WebSocketImpl?: typeof WebSocket;
}

export interface AjentifyProviderProps {
  config: AjentifyConfig;
  children: ReactNode;
}

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
 * instance of the three Zustand stores and supplies it via React context.
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
      callbacks: {
        createContext: (req) => configRef.current.createContext(req),
        generateAccessToken: () => configRef.current.generateAccessToken(),
        getContext: (id) => configRef.current.getContext(id),
        getContextHistory: () => configRef.current.getContextHistory(),
      },
      storage: resolveStorage(config.storage),
      storageKey: config.storageKey,
      WebSocketImpl: config.WebSocketImpl,
      reconnect: config.reconnect,
      requestTimeoutMs: config.requestTimeoutMs,
      onEvents: (...args) => configRef.current.onEvents?.(...args),
      onError: (err) => configRef.current.onError?.(err),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {config.themeBridge === 'shadcn' ? <ShadcnThemeBridge /> : null}
      {children}
    </AjentifyContext.Provider>
  );
}

/**
 * Injects a tiny style block aliasing `--aj-*` tokens to a consuming app's
 * shadcn `--*` tokens. Only renders on the client (the provider itself is
 * `"use client"`).
 */
function ShadcnThemeBridge(): JSX.Element {
  return (
    <style
      // The chat uses HSL channels (e.g. "240 10% 4%") so shadcn maps 1:1.
      dangerouslySetInnerHTML={{
        __html: `
        :root {
          --aj-background: var(--background, var(--aj-background));
          --aj-foreground: var(--foreground, var(--aj-foreground));
          --aj-card: var(--card, var(--aj-card));
          --aj-card-foreground: var(--card-foreground, var(--aj-card-foreground));
          --aj-popover: var(--popover, var(--aj-popover));
          --aj-popover-foreground: var(--popover-foreground, var(--aj-popover-foreground));
          --aj-primary: var(--primary, var(--aj-primary));
          --aj-primary-foreground: var(--primary-foreground, var(--aj-primary-foreground));
          --aj-secondary: var(--secondary, var(--aj-secondary));
          --aj-secondary-foreground: var(--secondary-foreground, var(--aj-secondary-foreground));
          --aj-muted: var(--muted, var(--aj-muted));
          --aj-muted-foreground: var(--muted-foreground, var(--aj-muted-foreground));
          --aj-accent: var(--accent, var(--aj-accent));
          --aj-accent-foreground: var(--accent-foreground, var(--aj-accent-foreground));
          --aj-destructive: var(--destructive, var(--aj-destructive));
          --aj-destructive-foreground: var(--destructive-foreground, var(--aj-destructive-foreground));
          --aj-border: var(--border, var(--aj-border));
          --aj-input: var(--input, var(--aj-input));
          --aj-ring: var(--ring, var(--aj-ring));
          --aj-radius: var(--radius, var(--aj-radius));
        }
      `,
      }}
    />
  );
}
