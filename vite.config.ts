import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : '/cpap-analyzer/',
  plugins: [react(), tsconfigPaths()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          recharts: ['recharts'],
          d3: ['d3'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
}));
