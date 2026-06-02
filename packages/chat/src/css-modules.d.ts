/**
 * Ambient declaration so `import css from './styles.css'` typechecks.
 * Resolved at build time by tsup's `loader: { '.css': 'text' }` which
 * inlines the file contents as a string literal.
 */
declare module '*.css' {
  const content: string;
  export default content;
}
