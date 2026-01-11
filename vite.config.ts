import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 3007,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: ['zeus.herakles.dev', 'localhost'],
    hmr: {
      host: 'zeus.herakles.dev',
      protocol: 'wss',
      clientPort: 443,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8096',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8096',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
