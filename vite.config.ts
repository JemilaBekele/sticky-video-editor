import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/voices': 'http://localhost:8787' },
    headers: {
      // Required for ffmpeg.wasm multithreading (SharedArrayBuffer). Single-thread core works without it.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
