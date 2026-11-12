import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.DEPARTMENT_HUB_TEST_FIXTURE) {
  console.error('BLOCKED: no shared backend fixture. Set DEPARTMENT_HUB_TEST_FIXTURE to the manifest from an isolated synthetic test server. The shared permission gate has NOT passed.');
  process.exit(2);
}
// Always start an independent runner, even when a harness check invokes this from node:test.
const env={...process.env}; delete env.NODE_TEST_CONTEXT;
const result = spawnSync(process.execPath, ['--test','--test-concurrency=1',fileURLToPath(new URL('../tests/shared/permissions.test.mjs',import.meta.url))], {stdio:'inherit',env});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 2);
