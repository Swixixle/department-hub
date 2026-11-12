import { defineConfig } from 'vite';
import { buildIdentity } from './scripts/build-identity.mjs';
import { sourceRevision } from './scripts/source-revision.mjs';
import { fileURLToPath } from 'node:url';

const source = sourceRevision(fileURLToPath(new URL('.', import.meta.url)));

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __PUBLIC_DEMO__: JSON.stringify(mode === 'demo'), __BUILD_MODE__: JSON.stringify(mode), __SOURCE_REVISION__: JSON.stringify(source) },
  plugins: [buildIdentity(source)],
  server: { host: '127.0.0.1' }
}));
