import { type ClassValue, clsx } from 'clsx';

/**
 * Class-name combiner.
 *
 * v0.2: the chat is no longer Tailwind-based, so we don't need `tailwind-merge`
 * to dedupe conflicting utilities. Plain `clsx` is enough — overrides win by
 * being later in the className string and by CSS specificity (overrides land
 * in the host's stylesheet, while the chat's own `.aj-*` classes are flat).
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * SSR-safe storage adapter. Returns an in-memory shim when window is not
 * available so that hydration on the server doesn't blow up.
 */
export function createSafeStorage(
  kind: 'localStorage' | 'sessionStorage' = 'localStorage'
): Storage {
  if (typeof window !== 'undefined') {
    try {
      const target = kind === 'localStorage' ? window.localStorage : window.sessionStorage;
      target.getItem('__aj_probe__');
      return target;
    } catch {
      // private mode / disabled storage -> fall through
    }
  }
  const memory = new Map<string, string>();
  return {
    get length() {
      return memory.size;
    },
    clear() {
      memory.clear();
    },
    getItem(key: string) {
      return memory.has(key) ? memory.get(key)! : null;
    },
    key(index: number) {
      return Array.from(memory.keys())[index] ?? null;
    },
    removeItem(key: string) {
      memory.delete(key);
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
  };
}

export function uid(prefix = 'aj'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
