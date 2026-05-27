import { defineConfig } from 'tsup';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ui: 'src/ui.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'es2022',
  external: ['react', 'react-dom'],
  // tsup/esbuild strips module-level `"use client"` directives during bundling
  // because they're considered ambiguous at module scope. We add the banner
  // ourselves AFTER the bundle is written so the directive ends up on line 1
  // of every published JS file.
  onSuccess: async () => {
    const dir = join(process.cwd(), 'dist');
    const targets = readdirSync(dir).filter(
      (f) => f.endsWith('.js') || f.endsWith('.cjs') || f.endsWith('.mjs')
    );
    for (const file of targets) {
      const path = join(dir, file);
      const content = readFileSync(path, 'utf8');
      if (content.startsWith('"use client"') || content.startsWith("'use client'")) {
        continue;
      }
      writeFileSync(path, `"use client";\n${content}`);
    }
  },
});
