import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'www',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true
  }
});
