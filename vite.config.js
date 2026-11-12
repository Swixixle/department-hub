import { defineConfig } from 'vite';
import { buildIdentity } from './scripts/build-identity.mjs';

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __PUBLIC_DEMO__: JSON.stringify(mode === 'demo'), __BUILD_MODE__: JSON.stringify(mode) },
  plugins: [buildIdentity()],
  server: { host: '127.0.0.1' }
}));
