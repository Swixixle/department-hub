import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __PUBLIC_DEMO__: JSON.stringify(mode === 'demo') },
  server: { host: '127.0.0.1' }
}));
