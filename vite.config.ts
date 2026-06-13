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
        },
      },
    },
  },
  worker: {
    format: 'es',
    plugins: () => [tsconfigPaths()],
  },
}));
