import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Three pages, one build: the website (/), the kiosk (/kiosk/) and the partner dashboard (/dashboard/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        site: resolve(import.meta.dirname, 'index.html'),
        kiosk: resolve(import.meta.dirname, 'kiosk/index.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard/index.html'),
      },
    },
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
