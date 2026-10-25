import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Project Pages sites live at /<repo>/. Leave unset for local dev and preview. */
function pagesBase(): string {
  const raw = process.env.PAGES_BASE?.trim();
  if (!raw || raw === '/') return '/';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

/** GitHub Pages has no SPA rewrite, so unknown paths should still load the app. */
function pagesFallback(): Plugin {
  let outDir = '';
  return {
    name: 'github-pages-404',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig({
  base: pagesBase(),
  plugins: [react(), pagesFallback()],
  server: {
    port: 5173,
  },
});
