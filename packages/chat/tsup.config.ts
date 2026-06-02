import { defineConfig } from 'tsup';
import { readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ui: 'src/ui.ts',
    server: 'src/server.ts',
  },
  // We ship ESM only. Code splitting requires ESM so the three entry points
  // (`@ajentify/chat`, `@ajentify/chat/ui`, `@ajentify/chat/server`) can
  // share modules via chunks. Without splitting, each bundle gets its own
  // copy of internal modules (e.g. `provider/context.ts`), which causes
  // React Context to be created twice and the `useAjentify*` hooks to throw
  // "must be used inside an <AjentifyProvider>" even when wrapped correctly.
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  target: 'es2022',
  external: ['react', 'react-dom'],
  // Inline `.css` imports as text. The bundled stylesheet is loaded as a
  // string by `lib/injectStyles.ts` and pushed into `<head>` at runtime, so
  // consumers don't need to import the CSS file separately.
  loader: { '.css': 'text' },
  // tsup/esbuild strips module-level `"use client"` directives during
  // bundling because they're considered ambiguous at module scope. We add
  // the banner ourselves AFTER the bundle is written so the directive ends
  // up on line 1 of every published JS file. We also copy the source CSS
  // file straight to `dist/` so consumers who want SSR pre-paint can still
  // `import '@ajentify/chat/styles.css'`.
  onSuccess: async () => {
    const dir = join(process.cwd(), 'dist');
    const targets = readdirSync(dir).filter(
      (f) => f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs')
    );
    for (const file of targets) {
      // The /server entry runs in Node — `"use client"` would error there.
      if (file.startsWith('server')) continue;
      const path = join(dir, file);
      const content = readFileSync(path, 'utf8');
      if (content.startsWith('"use client"') || content.startsWith("'use client'")) {
        continue;
      }
      writeFileSync(path, `"use client";\n${content}`);
    }
    // Copy the raw stylesheet so `@ajentify/chat/styles.css` works for
    // consumers who want to pre-load it (e.g. SSR).
    copyFileSync(
      join(process.cwd(), 'src', 'styles.css'),
      join(dir, 'styles.css'),
    );
  },
});
