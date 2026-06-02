/**
 * Idempotent stylesheet injector for `@ajentify/chat`.
 *
 * The chat ships a single bundled stylesheet. v0.2 inlines it as a string at
 * build time (tsup loader: `'.css': 'text'`) and injects it into `<head>` on
 * the first `AjentifyProvider` mount. This removes the need for consumers to
 * `import '@ajentify/chat/styles.css'` — and dodges all the host-vs-bundle
 * CSS cascade-layer / Tailwind-version friction that used to come with it.
 *
 * Consumers who *want* to ship the styles via their own bundler (e.g. for
 * SSR pre-paint) can still `import '@ajentify/chat/styles.css'`. The
 * injector noop-checks the marker attribute, so doing both is fine.
 */

// tsup is configured to load `.css` as a text string at build time
// (see tsup.config.ts `loader: { '.css': 'text' }`). The ambient
// `*.css` declaration in `src/css-modules.d.ts` types this as a `string`.
import cssText from '../styles.css';

const STYLE_MARKER = 'data-aj-chat-styles';
const STYLE_ID = 'aj-chat-styles';

let injected = false;

/**
 * Ensure the bundled chat stylesheet is present in `document.head`. Idempotent
 * across multiple provider mounts (and across multiple instances of the SDK,
 * e.g. duplicate node_modules) — the marker attribute is the source of truth.
 */
export function injectChatStyles(): void {
  if (typeof document === 'undefined') return;
  if (injected) return;
  injected = true;
  const existing = document.querySelector(`style[${STYLE_MARKER}]`);
  if (existing) return;
  const style = document.createElement('style');
  style.setAttribute(STYLE_MARKER, '');
  style.id = STYLE_ID;
  style.textContent = String(cssText);
  // Insert at the *start* of <head> so consumer styles (which usually load
  // later, e.g. Tailwind builds emitted by Next.js) can override the chat's
  // defaults via plain class specificity / source order. This makes Tailwind
  // utilities passed via `classNames` props win naturally.
  if (document.head.firstChild) {
    document.head.insertBefore(style, document.head.firstChild);
  } else {
    document.head.appendChild(style);
  }
}
