import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

import { cspMetaPlugin } from './src/buildtime/csp';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : '/cpap-analyzer/',
  plugins: [react(), tsconfigPaths(), cspMetaPlugin()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-router-dom')
          ) {
            return 'vendor';
          }
          if (id.includes('node_modules/recharts')) {
            return 'recharts';
          }
          if (id.includes('node_modules/d3')) {
            return 'd3';
          }
          // AI Insights provider SDKs (ADR 0024). These are only ever reached
          // via dynamic import() inside the provider methods, so they already
          // code-split into async chunks; naming them keeps each SDK in its own
          // isolated chunk (well clear of the main bundle) and makes the split
          // explicit/auditable rather than incidental.
          if (id.includes('node_modules/@anthropic-ai/sdk')) {
            return 'llm-anthropic';
          }
          if (id.includes('node_modules/@mlc-ai/web-llm')) {
            return 'llm-webllm';
          }
        },
      },
    },
  },
  worker: {
    format: 'es',
    plugins: () => [tsconfigPaths()],
  },
}));
