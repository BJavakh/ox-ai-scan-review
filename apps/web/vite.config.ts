import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web tsconfig has no Node types (browser code must not use Node globals); this file only needs env.
declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5180),
    strictPort: true,
    // Same-origin in development: the browser only ever talks to the Vite server.
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.API_PORT ?? '8787'}`, changeOrigin: false },
    },
  },
  build: { sourcemap: true },
});
