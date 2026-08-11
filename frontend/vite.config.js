import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward API calls to the backend in development so the frontend can
      // use same-origin `/api` paths everywhere. Overridable so the e2e suite
      // can point the proxy at the scratch e2e backend (port 4100).
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      // Uploaded images served by the backend's local storage driver.
      '/uploads': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
      },
      // Real-time kitchen/delivery queue (Phase 5) — WebSocket upgrade.
      '/ws': {
        target: process.env.VITE_API_TARGET || 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    sourcemap: false,
  },
});
